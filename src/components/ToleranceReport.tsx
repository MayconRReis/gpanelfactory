import React, { useMemo } from 'react';
import { ProductionEvent, ProductionLine, LineChangeover, UserProfile } from '../types';
import { computeToleranceOccurrences, TOLERANCE_KIND_LABEL, ToleranceOccurrence } from '../lib/tolerances';

/**
 * ATRASOS E TEMPOS EXCEDIDOS — início da produção depois da tolerância
 * (jornada + 10 min) e café/almoço acima da tolerância de retorno (+5 min),
 * com a justificativa que o líder informou ao iniciar/retomar.
 * variant 'light' = folha do Relatório do Dia; 'dark' = dashboard.
 */
interface Props {
  events: ProductionEvent[];
  lines: ProductionLine[];
  rangeStart: string;
  rangeEnd: string;
  changeovers?: LineChangeover[];
  users?: UserProfile[];
  variant?: 'light' | 'dark';
  nowMs?: number;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ddmm = (day: string) => day.split('-').reverse().slice(0, 2).join('/');

export function useToleranceOccurrences(p: Props): ToleranceOccurrence[] {
  const { events, lines, rangeStart, rangeEnd, changeovers = [], nowMs } = p;
  return useMemo(
    () => computeToleranceOccurrences(events, lines, rangeStart, rangeEnd, nowMs ?? Date.now(), changeovers),
    [events, lines, rangeStart, rangeEnd, changeovers, nowMs]
  );
}

export function ToleranceReport(props: Props) {
  const { users = [], variant = 'dark', rangeStart, rangeEnd } = props;
  const rows = useToleranceOccurrences(props);
  const multiDay = rangeStart !== rangeEnd;
  const who = (id?: string) => (id ? users.find(u => u.uid === id)?.name : undefined);
  const totalMin = rows.reduce((a, r) => a + r.excessMin, 0);
  const pending = rows.filter(r => !r.justification).length;
  const when = (r: ToleranceOccurrence) =>
    r.kind === 'inicio'
      ? `início ${r.endMs ? hhmm(r.endMs) : '—'}`
      : `${hhmm(r.startMs)}–${r.endMs ? hhmm(r.endMs) : 'agora'}`;

  if (variant === 'light') {
    const th = 'text-left text-[9px] font-black uppercase tracking-wider text-[#475569] border-b border-[#cbd5e1] py-1 pr-2';
    const td = 'border-b border-[#e2e8f0] py-1 pr-2 align-top';
    if (rows.length === 0) return <p className="text-[#94a3b8] italic">Nenhum atraso ou tempo excedido.</p>;
    return (
      <div>
        <table className="w-full border-collapse text-[10px] leading-tight">
          <thead>
            <tr>
              {multiDay && <th className={th}>Dia</th>}
              <th className={th}>Linha</th><th className={th}>Ocorrência</th><th className={th}>Horário</th>
              <th className={th + ' text-right'}>Excedido</th><th className={th}>Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                {multiDay && <td className={td}>{ddmm(r.day)}</td>}
                <td className={td + ' font-semibold'}>{r.lineName}</td>
                <td className={td}>{TOLERANCE_KIND_LABEL[r.kind]}{r.opNumber ? <span className="block text-[9px] text-[#64748b]">OP {r.opNumber}</span> : null}</td>
                <td className={td + ' font-mono'}>{when(r)}<span className="block text-[9px] text-[#64748b]">{r.durationMin} min</span></td>
                <td className={td + ' text-right font-bold text-[#b91c1c]'}>{r.excessMin} min</td>
                <td className={td}>
                  {r.justification
                    ? <span className="italic text-[#334155]">{r.justification}</span>
                    : <span className="italic text-[#dc2626]">{r.endMs ? 'Sem justificativa' : 'Em andamento'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[9.5px] text-[#64748b] mt-1">
          Total excedido: <strong>{totalMin} min</strong> (conta como ocioso){pending > 0 ? ` · ${pending} sem justificativa` : ''}. Tolerâncias: início 10 min após a jornada; retorno do café/almoço 5 min.
        </p>
      </div>
    );
  }

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[#52525b] py-3 text-center">Nenhum atraso ou tempo excedido no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                {multiDay && <th className="py-1.5 pr-3">Dia</th>}
                <th className="py-1.5 pr-3">Linha</th><th className="py-1.5 pr-3">Ocorrência</th><th className="py-1.5 pr-3">Horário</th>
                <th className="py-1.5 pr-3 text-right">Excedido</th><th className="py-1.5 pr-3">Justificativa</th><th className="py-1.5">Por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22222b]">
              {rows.map(r => (
                <tr key={r.key} className="text-[#d4d4d8] align-top">
                  {multiDay && <td className="py-2 pr-3 font-mono">{ddmm(r.day)}</td>}
                  <td className="py-2 pr-3 text-white font-semibold">{r.lineName}</td>
                  <td className="py-2 pr-3">
                    <span className={r.kind === 'inicio' ? 'text-rose-300' : 'text-orange-300'}>{TOLERANCE_KIND_LABEL[r.kind]}</span>
                    {r.opNumber && <span className="block text-[9px] text-[#71717a]">OP {r.opNumber}</span>}
                  </td>
                  <td className="py-2 pr-3 font-mono">{when(r)}<span className="block text-[9px] text-[#71717a]">{r.durationMin} min</span></td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-rose-300">{r.excessMin} min</td>
                  <td className="py-2 pr-3 max-w-[320px]">
                    {r.justification
                      ? <span className="text-[#e4e4e7]">{r.justification}</span>
                      : <span className="italic text-rose-400">{r.endMs ? 'Sem justificativa' : 'Em andamento'}</span>}
                  </td>
                  <td className="py-2 text-[#a1a1aa]">{who(r.leaderId) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-[10px] text-[#71717a] mt-2">
          Total excedido: <strong className="text-rose-300">{totalMin} min</strong> (conta como ocioso){pending > 0 ? <> · <span className="text-rose-400">{pending} sem justificativa</span></> : null}
        </p>
      )}
    </div>
  );
}
