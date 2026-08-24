import React, { useState, useMemo } from 'react';
import { 
  X, 
  Search, 
  Package, 
  Layers, 
  Play, 
  Plus, 
  Check, 
  ArrowRight,
  Sparkles,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ProductionLine, ProductionOrder } from '../types';

interface AssignStockOpToLineModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLine: ProductionLine | null;
  ops: ProductionOrder[];
  onAssignAndStart: (opId: string, lineId: string) => Promise<void>;
  onAssignToQueue: (opId: string, lineId: string) => Promise<void>;
}

export function AssignStockOpToLineModal({
  isOpen,
  onClose,
  targetLine,
  ops,
  onAssignAndStart,
  onAssignToQueue,
}: AssignStockOpToLineModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterMode, setFilterMode] = useState<'available' | 'all'>('available');

  if (!isOpen || !targetLine) return null;

  // Filtragem de OPs disponíveis para alocação
  const availableOps = ops.filter(op => {
    // Se filterMode === 'available', pega OPs não concluídas e que não estão ativas em outra linha
    if (filterMode === 'available') {
      return op.status !== 'completed';
    }
    return true;
  });

  const filteredOps = availableOps.filter(op => {
    const term = searchTerm.toLowerCase();
    return (
      op.number.toLowerCase().includes(term) ||
      op.product.toLowerCase().includes(term) ||
      (op.lote ? op.lote.toLowerCase().includes(term) : false) ||
      (op.granel ? op.granel.toLowerCase().includes(term) : false)
    );
  });

  const selectedOp = ops.find(o => o.id === selectedOpId);

  const handleStartNow = async (op: ProductionOrder) => {
    setIsProcessing(true);
    try {
      await onAssignAndStart(op.id, targetLine.id);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQueueOnly = async (op: ProductionOrder) => {
    setIsProcessing(true);
    try {
      await onAssignToQueue(op.id, targetLine.id);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#111116] border border-[#272732] w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-[#202026] flex items-center justify-between bg-[#14141a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-950/40">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                  Vincular OP do Estoque à {targetLine.name}
                </h3>
                <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full font-bold">
                  {filteredOps.length} OPs disponíveis
                </span>
              </div>
              <p className="text-xs text-[#71717a] mt-0.5">
                Escolha uma ordem de produção do estoque para enfileirar ou iniciar a fabricação imediatamente nesta linha.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#71717a] hover:text-[#f4f4f5] p-1.5 rounded-lg hover:bg-[#1f1f28] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Busca e Filtro */}
        <div className="p-4 bg-[#14141a]/60 border-b border-[#202026] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#71717a] absolute left-3 top-2.5" />
            <Input
              placeholder="Buscar por OP, nome do produto, lote ou granel..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 bg-[#0c0c10] border-[#252530] pl-9 text-xs text-[#f4f4f5] rounded-xl"
            />
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              onClick={() => setFilterMode('available')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                filterMode === 'available' ? 'bg-blue-600 text-white' : 'text-[#71717a] hover:text-[#f4f4f5] bg-[#1a1a22]'
              }`}
            >
              Não Concluídas ({ops.filter(o => o.status !== 'completed').length})
            </button>
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                filterMode === 'all' ? 'bg-blue-600 text-white' : 'text-[#71717a] hover:text-[#f4f4f5] bg-[#1a1a22]'
              }`}
            >
              Todas ({ops.length})
            </button>
          </div>
        </div>

        {/* Lista de OPs */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-[#1e1e26] space-y-2">
          {filteredOps.length === 0 ? (
            <div className="py-12 text-center text-[#71717a]">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-bold text-[#f4f4f5]">Nenhuma Ordem de Produção disponível no estoque</p>
              <p className="text-xs mt-1">Importe uma planilha CSV na aba Estoque de OPs ou cadastre uma nova OP.</p>
            </div>
          ) : (
            filteredOps.map((op) => {
              const isSelected = selectedOpId === op.id;
              const isAlreadyInThisLine = op.lineId === targetLine.id;
              const isCurrentActive = targetLine.currentOpId === op.id || (isAlreadyInThisLine && op.status === 'in_progress');

              return (
                <div
                  key={op.id}
                  onClick={() => setSelectedOpId(op.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-blue-600/10 border-blue-500/80 shadow-md'
                      : isAlreadyInThisLine
                      ? 'bg-[#151520] border-blue-900/30'
                      : 'bg-[#131318] border-[#22222c] hover:border-[#353545]'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-800/40 flex items-center justify-center text-xs font-mono font-black text-blue-400 shrink-0">
                      {op.number.slice(-3)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-xs text-blue-400 bg-blue-950/60 border border-blue-800/40 px-2 py-0.5 rounded">
                          OP #{op.number}
                        </span>
                        <span className="font-bold text-xs text-[#f4f4f5] truncate">
                          {op.product}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.2 rounded uppercase ${
                          op.status === 'in_progress' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40' :
                          op.status === 'paused' ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40' :
                          op.status === 'completed' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                          'bg-[#1e1e28] text-[#a1a1aa]'
                        }`}>
                          {op.status === 'in_progress' ? 'Em Produção' : op.status === 'paused' ? 'Pausada' : op.status === 'completed' ? 'Concluída' : 'Disponível'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-[#71717a] mt-1.5 flex-wrap">
                        <span>Lote: <strong className="text-emerald-400 font-mono">{op.lote || 'Sem Lote'}</strong></span>
                        <span>•</span>
                        <span>Qtd: <strong className="text-white font-mono">{op.plannedQuantity.toLocaleString('pt-BR')} un</strong></span>
                        {op.granel && (
                          <>
                            <span>•</span>
                            <span>Granel: <strong className="text-amber-300 font-mono">{op.granel}</strong></span>
                          </>
                        )}
                        <span>•</span>
                        <span>Prioridade: <strong className="text-blue-300">{op.priority}</strong></span>
                        {op.lineId && (
                          <>
                            <span>•</span>
                            <span className="text-blue-400">
                              {isAlreadyInThisLine ? 'Já vinculada a esta linha' : `Vinculada à Linha ${op.lineId}`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ações Rápidas por Linha da Tabela */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isProcessing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQueueOnly(op);
                      }}
                      className="h-8 px-3 bg-[#181822] hover:bg-[#222230] border-[#2f2f3f] text-[#d4d4d8] text-xs font-semibold rounded-lg flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-400" />
                      <span>Colocar na Fila</span>
                    </Button>

                    <Button
                      size="sm"
                      disabled={isProcessing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartNow(op);
                      }}
                      className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Iniciar Agora</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#202026] bg-[#14141a] flex items-center justify-between">
          <span className="text-xs text-[#71717a]">
            Linha de destino: <strong className="text-white">{targetLine.name}</strong>
          </span>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 text-xs text-[#a1a1aa] hover:text-white"
          >
            Fechar
          </Button>
        </div>

      </div>
    </div>
  );
}
