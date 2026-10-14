import { ProductionEvent, ProductionOrder } from '../types';
import { getBreakAllowanceMs, isBreakPauseReason, BREAK_RETURN_GRACE_MS, splitWorkingAcrossDays } from './productionTime';
import { WorkSession } from '../types';
import { extractJustification, JUSTIFICATION_TAG } from './tolerances';

/**
 * HISTÓRICO DE UMA OP — tudo o que os registros de produção (eventos) dizem
 * sobre ela: quem iniciou/finalizou, tempo de envase (trabalhado), tempo
 * parado e ocioso, cada pausa com motivo e observação, apontamentos,
 * conclusões parciais e justificativas de atraso/tempo excedido.
 *
 * Ocioso = tempo parado, menos o café/almoço tolerado (padrão + 5 min de
 * tolerância de retorno) e o "Fim de expediente" (a noite não é parada de
 * produção).
 */

export interface OpPause {
  reason: string;
  observation: string;
  startMs: number;
  /** null = pausa ainda aberta */
  endMs: number | null;
  durationMs: number;
  idleMs: number;
  pausedBy?: string;
  resumedBy?: string;
  /** Justificativa dada ao retomar (café/almoço excedido) */
  justification: string | null;
  lineId?: string;
}

export interface OpJustification {
  at: number;
  /** Ex.: "Atraso no início (25 min)" */
  what: string;
  text: string;
  by?: string;
}

export interface OpHistory {
  events: ProductionEvent[];
  startedAt: number | null;
  startedBy?: string;
  finishedAt: number | null;
  finishedBy?: string;
  workingMs: number;
  stoppedMs: number;
  idleMs: number;
  pauses: OpPause[];
  reports: { at: number; qty: number; by?: string; lineId?: string }[];
  partials: { at: number; qty: number; by?: string; observation: string }[];
  justifications: OpJustification[];
  cancelledCount: number;
  lineIds: string[];
}

const ms = (e: ProductionEvent) => new Date(e.createdAt).getTime();

/** Parte da pausa que conta como ociosa (café/almoço tolerado não conta). */
export const isEndOfShiftReason = (reason?: string | null) => /fim\s*d[eo]\s*expediente/i.test(String(reason || ''));

function pauseIdleMs(reason: string | undefined, durationMs: number): number {
  // Fim de expediente não é parada de produção (a OP fica parada até o dia seguinte)
  if (isEndOfShiftReason(reason)) return 0;
  if (!isBreakPauseReason(reason)) return durationMs;
  const allowance = getBreakAllowanceMs(reason);
  return durationMs <= allowance + BREAK_RETURN_GRACE_MS ? 0 : durationMs - allowance;
}

export function buildOpHistory(
  op: ProductionOrder,
  allEvents: ProductionEvent[],
  nowMs: number = Date.now(),
  workSessions: WorkSession[] = []
): OpHistory {
  const events = allEvents
    .filter(e => String(e.opId) === String(op.id) && !isNaN(ms(e)))
    .sort((a, b) => ms(a) - ms(b));

  const out: OpHistory = {
    events,
    startedAt: null,
    finishedAt: null,
    workingMs: 0,
    stoppedMs: 0,
    idleMs: 0,
    pauses: [],
    reports: [],
    partials: [],
    justifications: [],
    cancelledCount: 0,
    lineIds: [],
  };

  let workStart: number | null = null;
  let workLine: string | undefined = op.lineId || undefined;
  // Trecho em produção: se atravessou a noite (OP esquecida "em produção", sem
  // pausar/encerrar o expediente), só conta dentro da jornada/expediente de
  // cada dia — a mesma regra do dashboard (splitWorkingAcrossDays).
  const addWork = (a: number, b: number) => {
    if (!(b > a)) return;
    for (const [x, y] of splitWorkingAcrossDays(a, b, workLine, workSessions)) out.workingMs += y - x;
  };
  let openPause: OpPause | null = null;
  const lines = new Set<string>();

  const closePause = (t: number, ev?: ProductionEvent) => {
    if (!openPause) return;
    openPause.endMs = t;
    openPause.durationMs = Math.max(0, t - openPause.startMs);
    openPause.idleMs = pauseIdleMs(openPause.reason, openPause.durationMs);
    openPause.resumedBy = ev?.leaderId;
    if (ev?.type === 'RESUMED') openPause.justification = extractJustification(ev.observation);
    openPause = null;
  };

  for (const ev of events) {
    const t = ms(ev);
    if (ev.lineId) lines.add(ev.lineId);
    const just = (ev.type === 'STARTED' || ev.type === 'RESUMED') ? extractJustification(ev.observation) : null;
    if (just) {
      const obs = String(ev.observation || '');
      out.justifications.push({ at: t, what: obs.slice(0, obs.indexOf(JUSTIFICATION_TAG)).replace(/\s*—\s*$/, '').trim() || 'Justificativa', text: just, by: ev.leaderId });
    }

    switch (ev.type) {
      case 'CANCELLED': {
        // Início feito por engano: descarta o que foi contado até aqui
        out.cancelledCount += 1;
        out.workingMs = 0;
        out.pauses = [];
        out.startedAt = null;
        out.startedBy = undefined;
        workStart = null;
        openPause = null;
        break;
      }
      case 'STARTED': {
        if (out.startedAt === null) { out.startedAt = t; out.startedBy = ev.leaderId; }
        closePause(t, ev);
        workStart = t;
        workLine = ev.lineId || workLine;
        break;
      }
      case 'RESUMED': {
        closePause(t, ev);
        workStart = t;
        workLine = ev.lineId || workLine;
        break;
      }
      case 'PAUSED': {
        if (workStart !== null) { addWork(workStart, t); workStart = null; }
        if (!openPause) {
          openPause = {
            reason: ev.reason || 'Sem motivo',
            observation: String(ev.observation || '').trim(),
            startMs: t, endMs: null, durationMs: 0, idleMs: 0,
            pausedBy: ev.leaderId, justification: null, lineId: ev.lineId,
          };
          out.pauses.push(openPause);
        }
        break;
      }
      case 'FINISHED': {
        if (workStart !== null) { addWork(workStart, t); workStart = null; }
        closePause(t, ev);
        const obs = String(ev.observation || '').trim();
        if (/^envase parcial/i.test(obs)) {
          out.partials.push({ at: t, qty: Number(ev.quantity) || 0, by: ev.leaderId, observation: obs });
        } else {
          out.finishedAt = t;
          out.finishedBy = ev.leaderId;
        }
        break;
      }
      case 'QUANTITY_REPORTED': {
        const q = Number(ev.quantity) || 0;
        if (q > 0) out.reports.push({ at: t, qty: q, by: ev.leaderId, lineId: ev.lineId });
        break;
      }
    }
  }

  // OP ainda aberta: conta até agora
  if (workStart !== null && op.status === 'in_progress') addWork(workStart, nowMs);
  if (openPause && op.status === 'paused') {
    const p = openPause as OpPause;
    p.durationMs = Math.max(0, nowMs - p.startMs);
    p.idleMs = pauseIdleMs(p.reason, p.durationMs);
  }
  if (out.finishedAt === null && op.status === 'completed' && op.completedAt) {
    const c = new Date(op.completedAt).getTime();
    if (!isNaN(c)) out.finishedAt = c;
  }

  // Tempo parado de produção (a noite do "Fim de expediente" fica de fora; a pausa continua na lista)
  out.stoppedMs = out.pauses.filter(p => !isEndOfShiftReason(p.reason)).reduce((a, p) => a + p.durationMs, 0);
  out.idleMs = out.pauses.reduce((a, p) => a + p.idleMs, 0);
  out.lineIds = Array.from(lines);
  return out;
}
