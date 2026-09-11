import React, { useMemo, useState } from 'react';
import { Layers, Plus, GripVertical, Package, AlertTriangle } from 'lucide-react';
import { ProductionLine, ProductionOrder } from '../types';

interface CronogramaBoardProps {
  lines: ProductionLine[];
  ops: ProductionOrder[];
  /** Arrasta um card de OP para dentro de uma coluna de linha (atribui/reatribui a linha). */
  onAssignToQueue: (opId: string, lineId: string) => Promise<void>;
  /** Arrasta um card de OP de volta para a coluna "Estoque" (remove a linha). */
  onUnassign: (opId: string) => Promise<void>;
  /** Botão "+" no topo de cada coluna de linha — abre o modal de vincular OP do estoque. */
  onOpenAssignModal: (line: ProductionLine) => void;
  /** Clique em um card de OP para editar seus dados. */
  onOpenEditOpModal?: (op: ProductionOrder) => void;
}

const BACKLOG_COLUMN_ID = '__estoque__';

export function CronogramaBoard({
  lines,
  ops,
  onAssignToQueue,
  onUnassign,
  onOpenAssignModal,
  onOpenEditOpModal,
}: CronogramaBoardProps) {
  const [draggingOpId, setDraggingOpId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  // OPs sem linha atribuída (ainda no estoque) e não concluídas
  const backlogOps = useMemo(
    () => ops.filter(o => !o.lineId && o.status !== 'completed'),
    [ops]
  );

  const opsByLine = useMemo(() => {
    const map: Record<string, ProductionOrder[]> = {};
    for (const line of lines) {
      map[line.id] = ops
        .filter(o => o.lineId === line.id && o.status !== 'completed')
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }
    return map;
  }, [lines, ops]);

  const handleDragStart = (e: React.DragEvent, opId: string) => {
    e.dataTransfer.setData('text/plain', opId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingOpId(opId);
  };

  const handleDragEnd = () => {
    setDraggingOpId(null);
    setDragOverColumn(null);
  };

  const handleDragOverColumn = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
  };

  const handleDropOnColumn = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    const opId = e.dataTransfer.getData('text/plain') || draggingOpId;
    setDragOverColumn(null);
    setDraggingOpId(null);
    if (!opId) return;

    const op = ops.find(o => o.id === opId);
    if (!op) return;

    // Já está na mesma coluna — nada a fazer
    if (columnId === BACKLOG_COLUMN_ID && !op.lineId) return;
    if (op.lineId === columnId) return;

    setIsDropping(true);
    try {
      if (columnId === BACKLOG_COLUMN_ID) {
        await onUnassign(opId);
      } else {
        await onAssignToQueue(opId, columnId);
      }
    } finally {
      setIsDropping(false);
    }
  };

  const renderCard = (op: ProductionOrder) => {
    const isCritical = op.priority === 'Crítica' || op.priority === 'Alta';
    return (
      <div
        key={op.id}
        draggable
        onDragStart={(e) => handleDragStart(e, op.id)}
        onDragEnd={handleDragEnd}
        onClick={() => onOpenEditOpModal && onOpenEditOpModal(op)}
        className={`p-2.5 rounded-xl border text-xs cursor-grab active:cursor-grabbing transition-all shadow-sm select-none ${
          draggingOpId === op.id ? 'opacity-30' : 'opacity-100'
        } ${
          op.status === 'in_progress'
            ? 'bg-emerald-950/70 border-emerald-700/60 hover:border-emerald-500'
            : op.priority === 'Crítica'
            ? 'bg-red-950/60 border-red-800/60 hover:border-red-500'
            : op.priority === 'Alta'
            ? 'bg-orange-950/50 border-orange-800/50 hover:border-orange-500'
            : 'bg-[#181822] border-[#2c2c3c] hover:border-blue-500'
        }`}
        title="Arraste para outra coluna para reatribuir a linha"
      >
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <div className="flex items-center gap-1">
            <GripVertical className="w-3 h-3 text-[#52525b] shrink-0" />
            <span className="font-mono font-bold text-white text-[11px]">OP {op.number}</span>
          </div>
          {op.status === 'in_progress' ? (
            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500 text-black uppercase shrink-0">
              Produzindo
            </span>
          ) : isCritical ? (
            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-red-900/80 text-red-300 border border-red-700/50 shrink-0 flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" />
              {op.priority}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-[#d4d4d8] font-medium line-clamp-1 leading-tight" title={op.product}>
          {op.product}
        </p>
        <div className="flex items-center justify-between text-[10px] text-[#a1a1aa] mt-1.5 pt-1 border-t border-white/5">
          <span className="font-bold text-[#f4f4f5]">
            {op.plannedQuantity.toLocaleString('pt-BR')} {op.unidade || 'un'}
          </span>
          {op.lote && <span className="font-mono text-emerald-400">{op.lote}</span>}
        </div>
        {op.status === 'in_progress' && (
          <div className="w-full bg-black/40 rounded-full h-1 mt-1.5 overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.round(((op.producedQuantity || 0) / (op.plannedQuantity || 1)) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto custom-scrollbar pb-2">
      <div className="flex items-start gap-3 min-w-max">
        {/* Coluna: Estoque / Fila Geral (OPs sem linha) */}
        <div
          onDragOver={(e) => handleDragOverColumn(e, BACKLOG_COLUMN_ID)}
          onDrop={(e) => handleDropOnColumn(e, BACKLOG_COLUMN_ID)}
          className={`w-[260px] shrink-0 bg-[#0e0e12] border rounded-2xl flex flex-col max-h-[calc(100vh-260px)] transition-colors ${
            dragOverColumn === BACKLOG_COLUMN_ID ? 'border-blue-500' : 'border-[#222228]'
          }`}
        >
          <div className="p-3 border-b border-[#1f1f26] flex items-center justify-between gap-2 sticky top-0 bg-[#0e0e12] rounded-t-2xl z-10">
            <div className="flex items-center gap-1.5 min-w-0">
              <Package className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
              <span className="text-xs font-bold text-[#a1a1aa] uppercase tracking-wide truncate">Estoque / Sem Linha</span>
            </div>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1a1a22] text-[#a1a1aa] shrink-0">
              {backlogOps.length}
            </span>
          </div>
          <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-[80px]">
            {backlogOps.length === 0 ? (
              <p className="text-[11px] text-[#52525b] text-center py-6">Nenhuma OP em estoque</p>
            ) : (
              backlogOps.map(renderCard)
            )}
          </div>
        </div>

        {/* Uma coluna por linha de produção */}
        {lines.map((line) => {
          const lineOps = opsByLine[line.id] || [];
          const isOver = dragOverColumn === line.id;
          return (
            <div
              key={line.id}
              onDragOver={(e) => handleDragOverColumn(e, line.id)}
              onDrop={(e) => handleDropOnColumn(e, line.id)}
              className={`w-[260px] shrink-0 bg-[#121216] border rounded-2xl flex flex-col max-h-[calc(100vh-260px)] transition-colors ${
                isOver ? 'border-blue-500' : 'border-[#222228]'
              }`}
            >
              <div className="p-3 border-b border-[#1f1f26] flex items-center justify-between gap-2 sticky top-0 bg-[#121216] rounded-t-2xl z-10">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      line.status === 'active'
                        ? 'bg-emerald-500 animate-pulse'
                        : line.status === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-[#52525b]'
                    }`}
                  />
                  <span className="text-xs font-bold text-[#f4f4f5] truncate">{line.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1a1a22] text-[#a1a1aa]">
                    {lineOps.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenAssignModal(line)}
                    title={`Vincular OP do estoque à ${line.name}`}
                    className="p-1 rounded-lg text-[#71717a] hover:text-blue-400 hover:bg-blue-950/40 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-[80px]">
                {lineOps.length === 0 ? (
                  <p className="text-[11px] text-[#52525b] text-center py-6">Arraste uma OP aqui</p>
                ) : (
                  lineOps.map(renderCard)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isDropping && (
        <p className="text-[11px] text-blue-400 font-semibold mt-2 flex items-center gap-1.5">
          <Layers className="w-3 h-3 animate-pulse" /> Atualizando linha da OP...
        </p>
      )}
    </div>
  );
}
