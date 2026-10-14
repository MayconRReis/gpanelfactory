import { useEffect, useState } from 'react';

/**
 * ÚLTIMA ATUALIZAÇÃO DO DASHBOARD — "Atualizado às 14:32:05 · há 12 s".
 * Verde: dados em dia (até 1 min). Amarelo: há mais de 1 min sem
 * atualizar. Vermelho: há mais de 5 min (conexão provavelmente caiu).
 */
export function LastUpdatedBadge({ at }: { at: number | Date | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  const ms = at instanceof Date ? at.getTime() : at;
  const age = Math.max(0, now - ms);
  const sec = Math.floor(age / 1000);
  const ago = sec < 60 ? `há ${sec} s` : sec < 3600 ? `há ${Math.floor(sec / 60)} min` : `há ${Math.floor(sec / 3600)} h`;
  const level = age <= 60_000 ? 'ok' : age <= 300_000 ? 'warn' : 'stale';
  const dot = level === 'ok' ? 'bg-emerald-500' : level === 'warn' ? 'bg-amber-500' : 'bg-rose-500';
  const ping = level === 'ok' ? 'bg-emerald-400' : level === 'warn' ? 'bg-amber-400' : 'bg-rose-400';
  const text = level === 'ok' ? 'text-emerald-300' : level === 'warn' ? 'text-amber-300' : 'text-rose-300';
  return (
    <div
      className="flex items-center gap-2 bg-[#0b0b0e] border border-[#25252c] rounded-xl px-3 py-1.5 text-[11px] font-mono"
      title={level === 'ok' ? 'Dados em tempo real' : level === 'warn' ? 'Sem atualização há mais de 1 minuto' : 'Sem atualização há mais de 5 minutos — verifique a conexão'}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {level === 'ok' && <span className={`absolute inline-flex h-full w-full rounded-full ${ping} opacity-75 animate-ping`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      <span className="text-[#a1a1aa]">Atualizado às</span>
      <strong className="text-white tabular-nums">{new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
      <span className={`${text} tabular-nums`}>· {level === 'stale' ? `desatualizado (${ago})` : ago}</span>
    </div>
  );
}
