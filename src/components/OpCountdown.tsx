import { Timer } from 'lucide-react';

/**
 * CRONÔMETRO DA OP — etiqueta discreta com a contagem regressiva do tempo
 * previsto (plannedHours da OP), usando só o tempo TRABALHADO: para quando a
 * OP é pausada e volta a contar ao retomar. Passou do previsto, vira hora
 * negativa crescente. A cor vai de verde (início) a amarelo (metade) e
 * vermelho (no previsto). Previsto/trabalhado aparecem ao passar o mouse.
 */

interface Props {
  expectedMs: number;
  workingMs: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
function fmtClock(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtHM(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${pad(m % 60)}` : `${m} min`;
}

/** Verde (0%) → amarelo (50%) → vermelho (100% ou mais) */
export function timeUsedColor(fraction: number): string {
  const hue = Math.max(0, Math.min(120, 120 * (1 - fraction)));
  return `hsl(${hue}, 80%, 55%)`;
}

export function OpCountdown({ expectedMs, workingMs }: Props) {
  const remaining = expectedMs - workingMs;
  const fraction = expectedMs > 0 ? workingMs / expectedMs : 0;
  const color = timeUsedColor(fraction);
  return (
    <span
      className="px-3 py-1 rounded-xl text-xs font-black font-mono tabular-nums flex items-center gap-1.5 border bg-[#121217] border-[#2c2c3a]"
      style={{ color }}
      title={`Previsto ${fmtHM(expectedMs)} · trabalhado ${fmtHM(workingMs)} (${Math.round(fraction * 100)}%) — pausas não contam`}
    >
      <Timer className="w-3.5 h-3.5" />
      {remaining < 0 ? '−' : ''}{fmtClock(remaining)}
    </span>
  );
}
