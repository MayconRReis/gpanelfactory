import { Timer, Pause } from 'lucide-react';

/**
 * CRONÔMETRO DA OP — contagem regressiva do tempo previsto (plannedHours da
 * OP) usando só o tempo TRABALHADO: para quando a OP é pausada e volta a
 * contar ao retomar. Passou do previsto, vira hora negativa crescente.
 * A cor vai de verde (início) a amarelo (metade) e vermelho (no previsto).
 */

interface Props {
  expectedMs: number;
  workingMs: number;
  running: boolean;
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
  return `hsl(${hue}, 80%, 50%)`;
}

export function OpCountdown({ expectedMs, workingMs, running }: Props) {
  const remaining = expectedMs - workingMs;
  const over = remaining < 0;
  const fraction = expectedMs > 0 ? workingMs / expectedMs : 0;
  const color = timeUsedColor(fraction);
  const pct = Math.min(100, Math.max(0, fraction * 100));

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 space-y-3 transition-colors ${over ? 'bg-rose-950/30 border-rose-800/60' : 'bg-[#171720] border-[#262634]'}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <span className="text-xs font-bold text-[#71717a] uppercase tracking-wider flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5" style={{ color }} />
            {over ? 'Tempo previsto excedido' : 'Tempo restante previsto'}
            {!running && (
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/50 normal-case tracking-normal">
                <Pause className="w-3 h-3" /> pausado
              </span>
            )}
          </span>
          <span
            className={`block text-4xl sm:text-5xl font-black font-mono tracking-tight mt-0.5 ${over && running ? 'animate-pulse' : ''}`}
            style={{ color }}
          >
            {over ? '−' : ''}{fmtClock(remaining)}
          </span>
        </div>
        <div className="text-left sm:text-right text-xs font-mono text-[#a1a1aa] space-y-0.5">
          <div>Previsto: <strong className="text-white">{fmtHM(expectedMs)}</strong></div>
          <div>Trabalhado: <strong className="text-white">{fmtHM(workingMs)}</strong> ({Math.round(fraction * 100)}%)</div>
        </div>
      </div>

      {/* Barra: degradê verde → vermelho, preenchida até o tempo já usado */}
      <div className="relative w-full h-3.5 bg-[#0e0e12] rounded-full overflow-hidden p-0.5 border border-[#2a2a38]">
        <div className="h-full rounded-full overflow-hidden transition-all duration-500" style={{ width: `${pct}%` }}>
          <div
            className="h-full"
            style={{
              width: pct > 0 ? `${(100 / pct) * 100}%` : '100%',
              background: 'linear-gradient(90deg, hsl(120,80%,45%) 0%, hsl(60,85%,50%) 50%, hsl(0,80%,50%) 100%)',
            }}
          />
        </div>
      </div>
      {over && (
        <p className="text-[11px] font-bold text-rose-300">
          {fmtHM(-remaining)} acima do previsto — só conta o tempo trabalhado (pausas não entram).
        </p>
      )}
    </div>
  );
}
