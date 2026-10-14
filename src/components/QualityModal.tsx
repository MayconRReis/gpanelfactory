import { createPortal } from 'react-dom';
import { X, CheckCircle2 } from 'lucide-react';
import { ProductionLine, ProductionOrder } from '../types';

/**
 * QUALIDADE — OP a OP: (produzido − perdido) ÷ produzido, com as OPs que
 * produziram no período (as mesmas do cálculo do OEE).
 */
interface Props {
  ops: ProductionOrder[];
  lines: ProductionLine[];
  periodLabel: string;
  onClose: () => void;
  onOpenOp?: (opId: string) => void;
}

const nf = (n: number) => n.toLocaleString('pt-BR');
const pctColor = (p: number) => (p >= 99 ? 'text-emerald-300' : p >= 97 ? 'text-lime-300' : p >= 95 ? 'text-amber-300' : 'text-rose-300');

export function QualityModal({ ops, lines, periodLabel, onClose, onOpenOp }: Props) {
  const lineName = (id?: string | null) => (id ? lines.find(l => l.id === id)?.name || id : '—');
  const rows = ops
    .filter(o => (o.producedQuantity || 0) > 0)
    .map(o => {
      const produced = o.producedQuantity || 0;
      const rejected = o.rejectedQuantity || 0;
      const good = Math.max(0, produced - rejected);
      return { op: o, produced, rejected, good, pct: Math.round((good / produced) * 1000) / 10 };
    })
    .sort((a, b) => a.pct - b.pct || b.rejected - a.rejected);
  const totP = rows.reduce((a, r) => a + r.produced, 0);
  const totR = rows.reduce((a, r) => a + r.rejected, 0);
  const totPct = totP > 0 ? Math.round((Math.max(0, totP - totR) / totP) * 1000) / 10 : null;

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121216] border border-[#222228] w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[#222228] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-emerald-300 uppercase tracking-wider">Qualidade · OPs do período</h3>
            <p className="text-[11px] text-[#71717a] mt-0.5">{periodLabel} · (produzido − perdido) ÷ produzido</p>
          </div>
          <button onClick={onClose} className="text-[#71717a] hover:text-white p-1.5 rounded-lg hover:bg-[#1f1f28]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <h4 className="text-[11px] font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> No cálculo ({rows.length})
            {totPct !== null && <span className="ml-auto normal-case tracking-normal font-semibold text-[#71717a]">boas {nf(Math.max(0, totP - totR))} ÷ produzido {nf(totP)} = {totPct}%</span>}
          </h4>
          {rows.length === 0 ? (
            <p className="text-[11px] text-[#52525b]">Nenhuma OP com produção no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a] whitespace-nowrap">
                    <th className="py-1.5 px-2">OP</th><th className="py-1.5 pr-3">Produto</th><th className="py-1.5 pr-3">Linha</th>
                    <th className="py-1.5 pr-3 text-right">Produzido</th><th className="py-1.5 pr-3 text-right">Perdido</th>
                    <th className="py-1.5 pr-3 text-right">Boas</th><th className="py-1.5 pr-2 text-right">Qualid.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#22222b]">
                  {rows.map(r => (
                    <tr
                      key={r.op.id}
                      onClick={onOpenOp ? () => onOpenOp(String(r.op.id)) : undefined}
                      title={onOpenOp ? 'Ver detalhes da OP' : undefined}
                      className={`text-[#d4d4d8] whitespace-nowrap ${onOpenOp ? 'cursor-pointer hover:bg-[#1a1a22]' : ''}`}
                    >
                      <td className="py-1.5 px-2 font-mono font-bold text-white">{r.op.number}</td>
                      <td className="py-1.5 pr-3">{r.op.product}</td>
                      <td className="py-1.5 pr-3">{lineName(r.op.lineId)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{nf(r.produced)}</td>
                      <td className={`py-1.5 pr-3 text-right font-mono ${r.rejected > 0 ? 'text-rose-300 font-bold' : ''}`}>{nf(r.rejected)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{nf(r.good)}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono font-bold ${pctColor(r.pct)}`}>{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {onOpenOp && rows.length > 0 && <p className="text-[10px] text-[#71717a]">Clique numa OP para ver os detalhes completos.</p>}
          <p className="text-[10px] text-[#71717a]">Perdido = unidades apontadas como perdidas na OP. Entram as OPs de Envase do período com produção apontada.</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
