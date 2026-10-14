import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, PauseCircle, ListOrdered } from 'lucide-react';
import { ProductionLine, ProductionOrder, LineChangeover } from '../types';
import { formatMsToHoursMinutes, LineTimeMetrics, TimelineInterval } from '../lib/productionTime';

/**
 * DISPONIBILIDADE — de onde vem o número: tempo trabalhado ÷ (trabalhado +
 * parado) de cada linha do Envase no período, e o tempo parado aberto por
 * motivo. O parado é o mesmo trecho que entra no cálculo (dentro do
 * expediente): cada pedaço é atribuído à troca de produto, à pausa
 * registrada naquele horário ou, sem nada, a "Sem pausa registrada".
 */
interface Props {
  lines: ProductionLine[];
  byLine: Record<string, LineTimeMetrics>;
  intervals: TimelineInterval[];
  changeovers: LineChangeover[];
  ops: ProductionOrder[];
  periodLabel: string;
  nowMs: number;
  onClose: () => void;
  onOpenOp?: (opId: string) => void;
}

type Stop = { lineId: string; opId?: string; reason: string; observation?: string; startMs: number; durationMs: number };

const NO_PAUSE = 'Sem pausa registrada';
const CHANGEOVER = 'Troca de produto';
const pctColor = (p: number) => (p >= 85 ? 'text-emerald-300' : p >= 70 ? 'text-lime-300' : p >= 50 ? 'text-amber-300' : 'text-rose-300');
const fmtDT = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// Motivo "limpo" (o cálculo interno pode acrescentar detalhes ao motivo)
const baseReason = (r: string) => r.replace(/\s*\(excedido[^)]*\)\s*$/i, '').trim() || NO_PAUSE;

/** Recorta [a, b] pelos trechos `cuts`: devolve as partes cobertas e o que sobra. */
function splitByRanges(a: number, b: number, cuts: Array<{ s: number; e: number; tag: Omit<Stop, 'startMs' | 'durationMs' | 'lineId'> }>) {
  const covered: Array<{ s: number; e: number; tag: Omit<Stop, 'startMs' | 'durationMs' | 'lineId'> }> = [];
  let rest: Array<[number, number]> = [[a, b]];
  for (const c of cuts) {
    const next: Array<[number, number]> = [];
    for (const [rs, re] of rest) {
      const s = Math.max(rs, c.s);
      const e = Math.min(re, c.e);
      if (e <= s) { next.push([rs, re]); continue; }
      covered.push({ s, e, tag: c.tag });
      if (s > rs) next.push([rs, s]);
      if (re > e) next.push([e, re]);
    }
    rest = next;
  }
  return { covered, rest };
}

export function AvailabilityModal({ lines, byLine, intervals, changeovers, ops, periodLabel, nowMs, onClose, onOpenOp }: Props) {
  const [showAll, setShowAll] = useState(false);
  const opNumber = (id?: string) => (id ? ops.find(o => String(o.id) === String(id))?.number || '—' : '—');

  const data = useMemo(() => {
    const stops: Stop[] = [];
    const rows = lines.map(l => {
      const m = byLine[l.id];
      const working = m?.workingMs || 0;
      const idle = m?.idleMs || 0;
      const cuts: Array<{ s: number; e: number; tag: Omit<Stop, 'startMs' | 'durationMs' | 'lineId'> }> = [];
      for (const co of changeovers) {
        if (co.lineId !== l.id) continue;
        const s = new Date(co.startedAt).getTime();
        const e = co.endedAt ? new Date(co.endedAt).getTime() : nowMs;
        if (!isNaN(s) && !isNaN(e) && e > s) cuts.push({ s, e, tag: { reason: CHANGEOVER, opId: co.nextOpId || co.previousOpId || undefined } });
      }
      for (const it of intervals) {
        if (it.type !== 'IDLE' || it.lineId !== l.id || !it.reason) continue;
        cuts.push({ s: it.startMs, e: it.endMs, tag: { reason: baseReason(it.reason), observation: it.observation, opId: it.opId } });
      }
      for (const [a, b] of m?.idleRanges || []) {
        const { covered, rest } = splitByRanges(a, b, cuts);
        for (const c of covered) stops.push({ lineId: l.id, ...c.tag, startMs: c.s, durationMs: c.e - c.s });
        for (const [s, e] of rest) stops.push({ lineId: l.id, reason: NO_PAUSE, startMs: s, durationMs: e - s });
      }
      return { line: l, working, idle, session: m?.sessionMs || working + idle, pct: working + idle > 0 ? Math.round((working / (working + idle)) * 1000) / 10 : null };
    });
    // Junta pedaços vizinhos do mesmo motivo/OP (a mesma pausa recortada)
    stops.sort((x, y) => x.lineId.localeCompare(y.lineId) || x.startMs - y.startMs);
    const merged: Stop[] = [];
    for (const s of stops) {
      const last = merged[merged.length - 1];
      if (last && last.lineId === s.lineId && last.reason === s.reason && last.opId === s.opId && s.startMs - (last.startMs + last.durationMs) < 60000) {
        last.durationMs = s.startMs + s.durationMs - last.startMs;
      } else merged.push({ ...s });
    }
    const byReason = new Map<string, { ms: number; count: number }>();
    for (const s of merged) {
      const r = byReason.get(s.reason) || { ms: 0, count: 0 };
      r.ms += s.durationMs; r.count += 1;
      byReason.set(s.reason, r);
    }
    return {
      rows,
      stops: merged.filter(s => s.durationMs >= 60000).sort((a, b) => b.durationMs - a.durationMs),
      reasons: Array.from(byReason.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.ms - a.ms),
    };
  }, [lines, byLine, intervals, changeovers, nowMs]);

  const totW = data.rows.reduce((a, r) => a + r.working, 0);
  const totI = data.rows.reduce((a, r) => a + r.idle, 0);
  const totPct = totW + totI > 0 ? Math.round((totW / (totW + totI)) * 1000) / 10 : null;
  const visibleStops = showAll ? data.stops : data.stops.slice(0, 15);
  const lineName = (id: string) => lines.find(l => l.id === id)?.name || id;

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121216] border border-[#222228] w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[#222228] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-blue-300 uppercase tracking-wider">Disponibilidade · linhas do Envase</h3>
            <p className="text-[11px] text-[#71717a] mt-0.5">{periodLabel} · tempo trabalhado ÷ (trabalhado + parado), dentro do expediente</p>
          </div>
          <button onClick={onClose} className="text-[#71717a] hover:text-white p-1.5 rounded-lg hover:bg-[#1f1f28]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto">
          {/* Por linha */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Por linha
              {totPct !== null && <span className="ml-auto normal-case tracking-normal font-semibold text-[#71717a]">trabalhado {formatMsToHoursMinutes(totW)} ÷ {formatMsToHoursMinutes(totW + totI)} = {totPct}%</span>}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a] whitespace-nowrap">
                    <th className="py-1.5 px-2">Linha</th><th className="py-1.5 pr-3 text-right">Expediente</th><th className="py-1.5 pr-3 text-right">Trabalhado</th>
                    <th className="py-1.5 pr-3 text-right">Parado</th><th className="py-1.5 pr-2 text-right">Disponib.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#22222b]">
                  {data.rows.map(r => (
                    <tr key={r.line.id} className="text-[#d4d4d8] whitespace-nowrap">
                      <td className="py-1.5 px-2 font-bold text-white">{r.line.name}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(r.session)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(r.working)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(r.idle)}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono font-bold ${r.pct === null ? 'text-[#52525b]' : pctColor(r.pct)}`}>{r.pct === null ? '—' : `${r.pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Por motivo */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <PauseCircle className="w-3.5 h-3.5" /> Tempo parado por motivo
            </h4>
            {data.reasons.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Nenhuma parada no período.</p>
            ) : (
              <div className="space-y-1.5">
                {data.reasons.map(r => {
                  const share = totI > 0 ? Math.round((r.ms / totI) * 1000) / 10 : 0;
                  return (
                    <div key={r.reason} className="flex items-center gap-3 text-[11px] whitespace-nowrap">
                      <span className={`w-48 shrink-0 font-semibold truncate ${r.reason === NO_PAUSE ? 'text-rose-300' : 'text-[#d4d4d8]'}`} title={r.reason}>{r.reason}</span>
                      <div className="flex-1 h-2 rounded-full bg-[#1f1f28] overflow-hidden min-w-[60px]">
                        <div className={`h-full rounded-full ${r.reason === NO_PAUSE ? 'bg-rose-500/70' : 'bg-amber-500/70'}`} style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <span className="w-16 text-right font-mono text-white">{formatMsToHoursMinutes(r.ms)}</span>
                      <span className="w-12 text-right font-mono text-[#71717a]">{share}%</span>
                      <span className="w-14 text-right text-[#71717a]">{r.count}x</span>
                    </div>
                  );
                })}
              </div>
            )}
            {data.reasons.some(r => r.reason === NO_PAUSE) && (
              <p className="text-[10px] text-[#71717a]"><strong className="text-rose-300">Sem pausa registrada</strong> = linha dentro do expediente sem OP em produção e sem pausa apontada (ex.: entre uma OP e outra, ou antes da primeira OP do dia).</p>
            )}
          </section>

          {/* Paradas */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-[#d4d4d8] flex items-center gap-1.5">
              <ListOrdered className="w-3.5 h-3.5" /> Maiores paradas ({data.stops.length})
            </h4>
            {data.stops.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Nenhuma parada no período.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a] whitespace-nowrap">
                        <th className="py-1.5 px-2">Início</th><th className="py-1.5 pr-3">Linha</th><th className="py-1.5 pr-3">OP</th>
                        <th className="py-1.5 pr-3">Motivo</th><th className="py-1.5 pr-3">Observação</th><th className="py-1.5 pr-2 text-right">Duração</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#22222b]">
                      {visibleStops.map((s, i) => {
                        const clickable = !!(onOpenOp && s.opId);
                        return (
                          <tr
                            key={`${s.lineId}-${s.startMs}-${i}`}
                            onClick={clickable ? () => onOpenOp!(String(s.opId)) : undefined}
                            title={clickable ? 'Ver detalhes da OP' : undefined}
                            className={`text-[#d4d4d8] whitespace-nowrap ${clickable ? 'cursor-pointer hover:bg-[#1a1a22]' : ''}`}
                          >
                            <td className="py-1.5 px-2 font-mono">{fmtDT(s.startMs)}</td>
                            <td className="py-1.5 pr-3">{lineName(s.lineId)}</td>
                            <td className="py-1.5 pr-3 font-mono font-bold text-white">{opNumber(s.opId)}</td>
                            <td className={`py-1.5 pr-3 font-semibold ${s.reason === NO_PAUSE ? 'text-rose-300' : ''}`}>{s.reason}</td>
                            <td className="py-1.5 pr-3 text-[#a1a1aa] max-w-[320px] truncate" title={s.observation || ''}>{s.observation || '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono font-bold text-white">{formatMsToHoursMinutes(s.durationMs)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {data.stops.length > 15 && (
                  <button type="button" onClick={() => setShowAll(v => !v)} className="text-[11px] font-bold text-blue-300 hover:text-blue-200">
                    {showAll ? 'Mostrar só as 15 maiores' : `Mostrar todas (${data.stops.length})`}
                  </button>
                )}
              </>
            )}
            {onOpenOp && <p className="text-[10px] text-[#71717a]">Clique numa parada com OP para ver os detalhes completos da OP.</p>}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
