import { ProductionEvent, ProductionLine, LineChangeover } from '../types';
import {
  getScheduledWindow,
  getBreakAllowanceMs,
  getBreakLimitMs,
  getBreakExcessMs,
  isCoffeePauseReason,
  isBreakPauseReason,
  isReactorLineId,
  BREAK_RETURN_GRACE_MS,
} from './productionTime';

/**
 * TOLERÂNCIAS DO ENVASE
 * - Retorno do café (15 min) e do almoço (1h): 5 min de tolerância
 *   (BREAK_RETURN_GRACE_MS, em productionTime). Passou, o líder justifica.
 * - Início da produção: 10 min depois do início da jornada (07:00 → 07:10).
 *   A primeira OP iniciada/retomada na linha depois disso pede justificativa.
 *   O ocioso continua contando desde o início da jornada.
 *
 * A justificativa é gravada na observação do evento que encerra o atraso
 * (STARTED/RESUMED), com o prefixo JUSTIFICATION_TAG — o relatório lê de lá.
 */
export const START_TOLERANCE_MS = 10 * 60 * 1000;
export const JUSTIFICATION_TAG = 'Justificativa:';

export type ToleranceKind = 'inicio' | 'cafe' | 'almoco';

export const TOLERANCE_KIND_LABEL: Record<ToleranceKind, string> = {
  inicio: 'Atraso no início',
  cafe: 'Café excedido',
  almoco: 'Almoço excedido',
};

export interface PendingJustification {
  kind: ToleranceKind;
  /** Minutos que contam como ocioso por causa do atraso/excesso */
  excessMin: number;
  /** Texto do que aconteceu, para o modal e para a observação */
  summary: string;
}

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60000));
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const evMs = (e: ProductionEvent) => new Date(e.createdAt).getTime();
const sameLine = (e: ProductionEvent, line: ProductionLine) => e.lineId === line.id || (!!e.lineName && e.lineName === line.name);

/** Linha sujeita às tolerâncias (Envase/Sleev — reatores têm regra própria). */
export function lineHasTolerances(line: ProductionLine | null | undefined): boolean {
  return !!line && !isReactorLineId(line.id) && !/reator|pesagem|manipula/i.test(line.id) && !/reator/i.test(line.name);
}

export function breakKindOf(reason?: string | null): ToleranceKind | null {
  if (!isBreakPauseReason(reason)) return null;
  return isCoffeePauseReason(reason) ? 'cafe' : 'almoco';
}

/** Situação da pausa em andamento (para o cronômetro da tela da linha). */
export function getBreakStatus(reason: string | null | undefined, sinceMs: number, nowMs: number) {
  const standardMs = getBreakAllowanceMs(reason);
  if (standardMs <= 0) return null;
  const elapsedMs = Math.max(0, nowMs - sinceMs);
  const limitMs = getBreakLimitMs(reason);
  return {
    kind: breakKindOf(reason) as ToleranceKind,
    elapsedMs,
    standardMs,
    limitMs,
    graceMs: BREAK_RETURN_GRACE_MS,
    /** 'ok' dentro do padrão · 'tolerancia' nos 5 min extras · 'excedido' passou do limite */
    level: elapsedMs > limitMs ? 'excedido' as const : elapsedMs > standardMs ? 'tolerancia' as const : 'ok' as const,
    excessMs: getBreakExcessMs(reason, elapsedMs),
  };
}

/**
 * A primeira OP do dia na linha está sendo iniciada/retomada com atraso?
 * Atraso = depois do início da jornada + 10 min, ainda dentro da jornada, sem
 * nenhum evento de produção da linha antes disso no dia (OP que ficou rodando
 * da véspera não conta) e sem setup registrado até o limite.
 */
export function getLateStart(
  line: ProductionLine,
  events: ProductionEvent[],
  nowMs: number,
  changeovers: LineChangeover[] = []
): PendingJustification | null {
  if (!lineHasTolerances(line)) return null;
  const win = getScheduledWindow(nowMs, line.id);
  if (!win) return null;
  const [start, end] = win;
  const limit = start + START_TOLERANCE_MS;
  if (nowMs <= limit || nowMs >= end) return null;
  const today = dayKey(nowMs);
  const dayStart = new Date(nowMs); dayStart.setHours(0, 0, 0, 0);
  const hadActivity = events.some(e => {
    if (!sameLine(e, line)) return false;
    const t = evMs(e);
    return t >= dayStart.getTime() && t < nowMs &&
      ['STARTED', 'RESUMED', 'PAUSED', 'QUANTITY_REPORTED', 'FINISHED'].includes(e.type);
  });
  if (hadActivity) return null;
  const setupInTime = changeovers.some(c => c.lineId === line.id && dayKey(new Date(c.startedAt).getTime()) === today && new Date(c.startedAt).getTime() <= limit);
  if (setupInTime) return null;
  const lateMin = minutes(nowMs - start);
  return {
    kind: 'inicio',
    excessMin: lateMin,
    summary: `Início da produção às ${hhmm(nowMs)} — ${lateMin} min depois do início da jornada (${hhmm(start)}).`,
  };
}

/** A pausa que está sendo encerrada (café/almoço) passou da tolerância? */
export function getBreakOverrun(reason: string | null | undefined, sinceMs: number, nowMs: number): PendingJustification | null {
  const kind = breakKindOf(reason);
  if (!kind) return null;
  const dur = nowMs - sinceMs;
  const excess = getBreakExcessMs(reason, dur);
  if (excess <= 0) return null;
  const std = minutes(getBreakAllowanceMs(reason));
  return {
    kind,
    excessMin: minutes(excess),
    summary: `${kind === 'cafe' ? 'Café' : 'Almoço'} das ${hhmm(sinceMs)} às ${hhmm(nowMs)}: ${minutes(dur)} min (padrão ${std >= 60 ? '1h' : `${std} min`}). ${minutes(excess)} min contam como ociosos.`,
  };
}

/** Monta a observação gravada no evento STARTED/RESUMED. */
export function buildJustificationObservation(items: PendingJustification[], text: string): string {
  const head = items.map(i => `${TOLERANCE_KIND_LABEL[i.kind]} (${i.excessMin} min)`).join(' + ');
  return `${head} — ${JUSTIFICATION_TAG} ${text.trim()}`;
}

export function extractJustification(observation?: string | null): string | null {
  const s = String(observation || '');
  const i = s.indexOf(JUSTIFICATION_TAG);
  if (i < 0) return null;
  const t = s.slice(i + JUSTIFICATION_TAG.length).trim();
  return t || null;
}

export interface ToleranceOccurrence {
  key: string;
  day: string;
  lineId: string;
  lineName: string;
  kind: ToleranceKind;
  opNumber?: string;
  startMs: number;
  /** null = ainda em andamento (pausa aberta) */
  endMs: number | null;
  durationMin: number;
  excessMin: number;
  justification: string | null;
  /** quem encerrou (iniciou/retomou) */
  leaderId?: string;
}

/**
 * Atrasos no início e cafés/almoços que passaram da tolerância, por linha e
 * dia, no intervalo [rangeStart, rangeEnd] (YYYY-MM-DD, hora local).
 */
export function computeToleranceOccurrences(
  events: ProductionEvent[],
  lines: ProductionLine[],
  rangeStart: string,
  rangeEnd: string,
  nowMs: number = Date.now(),
  changeovers: LineChangeover[] = []
): ToleranceOccurrence[] {
  const out: ToleranceOccurrence[] = [];
  const valid = events
    .filter(e => !isNaN(evMs(e)))
    .sort((a, b) => evMs(a) - evMs(b));

  for (const line of lines) {
    if (!lineHasTolerances(line)) continue;
    const lineEvents = valid.filter(e => sameLine(e, line));
    if (lineEvents.length === 0) continue;

    // --- Atraso no início (primeiro evento do dia na linha) ---
    const firstByDay = new Map<string, ProductionEvent>();
    for (const e of lineEvents) {
      const k = dayKey(evMs(e));
      if (k < rangeStart || k > rangeEnd) continue;
      if (!firstByDay.has(k)) firstByDay.set(k, e);
    }
    for (const [day, e] of firstByDay.entries()) {
      if (e.type !== 'STARTED' && e.type !== 'RESUMED') continue;
      const t = evMs(e);
      const win = getScheduledWindow(t, line.id);
      if (!win) continue;
      const [start, end] = win;
      if (t <= start + START_TOLERANCE_MS || t >= end) continue;
      const setupInTime = changeovers.some(c => c.lineId === line.id && dayKey(new Date(c.startedAt).getTime()) === day && new Date(c.startedAt).getTime() <= start + START_TOLERANCE_MS);
      if (setupInTime) continue;
      out.push({
        key: `ini-${line.id}-${day}`,
        day, lineId: line.id, lineName: line.name, kind: 'inicio', opNumber: e.opNumber,
        startMs: start, endMs: t,
        durationMin: minutes(t - start), excessMin: minutes(t - start),
        justification: extractJustification(e.observation),
        leaderId: e.leaderId,
      });
    }

    // --- Café / almoço acima da tolerância ---
    for (let i = 0; i < lineEvents.length; i++) {
      const p = lineEvents[i];
      if (p.type !== 'PAUSED' || !breakKindOf(p.reason)) continue;
      const t0 = evMs(p);
      const day = dayKey(t0);
      if (day < rangeStart || day > rangeEnd) continue;
      // próximo evento da mesma OP encerra a pausa
      const next = lineEvents.slice(i + 1).find(e => String(e.opId) === String(p.opId));
      const t1 = next ? evMs(next) : (day === dayKey(nowMs) ? nowMs : null);
      if (t1 === null) continue;
      const excess = getBreakExcessMs(p.reason, t1 - t0);
      if (excess <= 0) continue;
      out.push({
        key: `brk-${line.id}-${p.id || t0}`,
        day, lineId: line.id, lineName: line.name, kind: breakKindOf(p.reason) as ToleranceKind, opNumber: p.opNumber,
        startMs: t0, endMs: next ? t1 : null,
        durationMin: minutes(t1 - t0), excessMin: minutes(excess),
        justification: next ? extractJustification(next.observation) : null,
        leaderId: next?.leaderId,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
