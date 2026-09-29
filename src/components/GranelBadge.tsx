import { ProductionOrder } from '../types';
import { getGranelStatus, GranelStatus } from '../services/db';

const STYLES: Record<GranelStatus, { label: string; className: string; title: string }> = {
  manipulado: {
    label: 'Manipulado',
    className: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60',
    title: 'Granel pronto: a Manipulação finalizou a OSM',
  },
  manipulando: {
    label: 'Manipulando',
    className: 'bg-cyan-950/70 text-cyan-300 border-cyan-800/60',
    title: 'A OSM está em processo num reator',
  },
  separado: {
    label: 'Separado',
    className: 'bg-purple-950/70 text-purple-300 border-purple-800/60',
    title: 'A Pesagem já separou a OSM; ainda não foi manipulada',
  },
  nao_separado: {
    label: 'Não separado',
    className: 'bg-[#1a1a22] text-[#a1a1aa] border-[#2c2c3c]',
    title: 'Nenhuma OSM com esse número foi registrada pela Pesagem',
  },
};

/** Selo do status do granel (Separado → Manipulando → Manipulado) de uma OP de Envase. */
export function GranelBadge({ granel, ops, className = '' }: { granel?: string | null; ops: ProductionOrder[]; className?: string }) {
  const status = getGranelStatus(granel, ops);
  if (!status) return null;
  const s = STYLES[status];
  return (
    <span
      title={`Granel ${granel}: ${s.title}`}
      className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.className} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
