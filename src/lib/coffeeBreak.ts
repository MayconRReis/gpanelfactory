import { ProductionEvent, ProductionLine } from '../types';

/**
 * PAUSA AUTOMÁTICA DO CAFÉ (só a saída) — no horário do café de cada linha
 * de Envase, a OP que estiver rodando é pausada sozinha com o motivo "Café".
 * A volta continua manual: o líder retoma quando a equipe volta.
 *
 * Horário de saída por linha (HH:MM), pelo número do nome da linha.
 */
export const COFFEE_BREAK_BY_ENVASE: Record<number, string> = {
  1: '08:00',
  2: '08:20',
  3: '08:40',
};

export const COFFEE_PAUSE_REASON = 'Café';
export const COFFEE_AUTO_OBSERVATION = 'Pausa automática do café';

/** Janela depois do horário em que a pausa ainda é feita (tela aberta com atraso). */
const WINDOW_MIN = 30;
/** Café pausado à mão até este tempo antes do horário já vale como o café do dia. */
const EARLY_MANUAL_MIN = 15;

/** Horário do café da linha (minutos desde 00:00), ou null se a linha não tem café automático. */
export function getCoffeeBreakMinutes(line: ProductionLine | null | undefined): number | null {
  if (!line) return null;
  const m = String(line.name || '').match(/envase\s*0?(\d+)/i) || String(line.id || '').match(/^line-(\d+)$/i);
  const hhmm = m ? COFFEE_BREAK_BY_ENVASE[Number(m[1])] : undefined;
  if (!hhmm) return null;
  const [h, min] = hhmm.split(':').map(Number);
  return h * 60 + min;
}

/**
 * true quando é hora de pausar a linha para o café agora: dentro da janela
 * do horário e sem nenhuma pausa de Café já registrada hoje nessa linha
 * (automática ou feita à mão perto do horário).
 */
export function isCoffeeBreakDue(line: ProductionLine, events: ProductionEvent[], now: Date): boolean {
  const startMin = getCoffeeBreakMinutes(line);
  if (startMin === null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < startMin || nowMin >= startMin + WINDOW_MIN) return false;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromMs = dayStart.getTime() + (startMin - EARLY_MANUAL_MIN) * 60000;
  return !events.some(e =>
    e.type === 'PAUSED' &&
    (e.lineId === line.id || e.lineName === line.name) &&
    String(e.reason || '').trim().toLowerCase() === COFFEE_PAUSE_REASON.toLowerCase() &&
    new Date(e.createdAt).getTime() >= fromMs
  );
}
