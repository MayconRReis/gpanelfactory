import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PerfOpDetail } from '../services/db';
import { ProductionLine } from '../types';
import { formatMsToHoursMinutes } from '../lib/productionTime';

/**
 * PERFORMANCE — OP a OP: quais entraram no cálculo (tempo esperado para o
 * que foi produzido × tempo trabalhado) e quais ficaram de fora, com o motivo
 * (sem tempo previsto, sem tempo trabalhado registrado…).
 */
interface Props {
  ops: PerfOpDetail[];
  lines: ProductionLine[];
  periodLabel: string;
  onClose: () => void;
}

const nf = (n: number) => n.toLocaleString('pt-BR');
const pctColor = (p: number) => (p >= 95 ? 'text-emerald-300' : p >= 80 ? 'text-lime-300' : p >= 60 ? 'text-amber-300' : 'text-rose-300');

export function PerformanceOpsModal({ ops, lines, periodLabel, onClose }: Props) {
  const lineName = (id: string | null) => (id ? lines.find(l => l.id === id)?.name || id : '—');
  const included = ops.filter(o => o.included).sort((a, b) => (a.expectedMs / (a.workedMs || 1)) - (b.expectedMs / (b.workedMs || 1)));
  const missing = ops.filter(o => !o.included);
  const totExp = included.reduce((a, o) => a + o.expectedMs, 0);
  const totWork = included.reduce((a, o) => a + o.workedMs, 0);

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121216] border border-[#222228] w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[#222228] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-orange-300 uppercase tracking-wider">Performance · OPs do período</h3>
            <p className="text-[11px] text-[#71717a] mt-0.5">{periodLabel} · tempo esperado para o que foi produzido ÷ tempo trabalhado na OP</p>
          </div>
          <button onClick={onClose} className="text-[#71717a] hover:text-white p-1.5 rounded-lg hover:bg-[#1f1f28]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto">
          {/* Fora do cálculo */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Fora do cálculo ({missing.length})
            </h4>
            {missing.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Todas as OPs do período entraram no cálculo.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] min-w-[520px]">
                    <thead>
                      <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                        <th className="py-1.5 pr-3">OP</th><th className="py-1.5 pr-3">Produto</th><th className="py-1.5 pr-3">Linha</th><th className="py-1.5">O que falta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#22222b]">
                      {missing.map(o => (
                        <tr key={o.opId} className="text-[#d4d4d8]">
                          <td className="py-1.5 pr-3 font-mono font-bold text-white">{o.number}</td>
                          <td className="py-1.5 pr-3">{o.product}</td>
                          <td className="py-1.5 pr-3">{lineName(o.lineId)}</td>
                          <td className="py-1.5 font-semibold text-amber-300">{o.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {missing.some(o => o.reason === 'Sem tempo previsto') && (
                  <p className="text-[10px] text-[#71717a]">Para entrar no cálculo, preencha o <strong className="text-[#a1a1aa]">Tempo esperado</strong> da OP no Editar OP.</p>
                )}
              </>
            )}
          </section>

          {/* No cálculo */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> No cálculo ({included.length})
              {included.length > 0 && <span className="ml-auto normal-case tracking-normal font-semibold text-[#71717a]">esperado {formatMsToHoursMinutes(totExp)} ÷ trabalhado {formatMsToHoursMinutes(totWork)}</span>}
            </h4>
            {included.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Nenhuma OP entrou no cálculo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] min-w-[640px]">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                      <th className="py-1.5 pr-3">OP</th><th className="py-1.5 pr-3">Produto</th><th className="py-1.5 pr-3">Linha</th>
                      <th className="py-1.5 pr-3 text-right">Produzido</th><th className="py-1.5 pr-3 text-right">Previsto (OP)</th>
                      <th className="py-1.5 pr-3 text-right">Esperado</th><th className="py-1.5 pr-3 text-right">Trabalhado</th><th className="py-1.5 text-right">Perf.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#22222b]">
                    {included.map(o => {
                      const p = o.workedMs > 0 ? Math.min(100, Math.round((o.expectedMs / o.workedMs) * 1000) / 10) : 0;
                      return (
                        <tr key={o.opId} className="text-[#d4d4d8]">
                          <td className="py-1.5 pr-3 font-mono font-bold text-white">{o.number}</td>
                          <td className="py-1.5 pr-3">{o.product}</td>
                          <td className="py-1.5 pr-3">{lineName(o.lineId)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{nf(o.produced)} / {nf(o.planned)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(o.plannedHours * 3600000)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(o.expectedMs)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{formatMsToHoursMinutes(o.workedMs)}</td>
                          <td className={`py-1.5 text-right font-mono font-bold ${pctColor(p)}`}>{p}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-[#71717a]">Esperado = tempo previsto da OP proporcional ao que já foi produzido. Trabalhado = tempo com a OP em produção (pausas não entram).</p>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
