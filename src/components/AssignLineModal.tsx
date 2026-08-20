import React, { useState, useMemo } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  Layers, 
  CheckCircle2, 
  X, 
  ArrowRight, 
  TrendingUp, 
  Boxes, 
  Sparkles,
  Info,
  CalendarCheck,
  AlertCircle,
  RotateCcw
} from 'lucide-react';
import { Button } from './ui/button';
import { ProductionLine, ProductionOrder } from '../types';

interface AssignLineModalProps {
  isOpen: boolean;
  onClose: () => void;
  op: ProductionOrder | null;
  lines: ProductionLine[];
  allOps: ProductionOrder[];
  onSave: (opId: string, updates: { lineId: string | null; scheduledDate?: string; scheduledShift?: string }) => Promise<void>;
}

// Helpers para calcular semana e datas
export function getWeekRange(dateStr: string) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const day = d.getDay();
  // Ajusta para segunda-feira como início da semana
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const format = (date: Date) => date.toISOString().split('T')[0];
  const formatDisplay = (date: Date) => {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  return {
    startStr: format(monday),
    endStr: format(sunday),
    displayLabel: `Semana de ${formatDisplay(monday)} a ${formatDisplay(sunday)}`,
    monday,
    sunday,
  };
}

export function AssignLineModal({
  isOpen,
  onClose,
  op,
  lines,
  allOps,
  onSave,
}: AssignLineModalProps) {
  if (!isOpen || !op) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedLineId, setSelectedLineId] = useState<string | null>(op.lineId || (lines[0]?.id || 'line-1'));
  const [selectedDate, setSelectedDate] = useState<string>(op.scheduledDate || todayStr);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick date pickers
  const getRelativeDate = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  };

  const getNextMonday = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilNextMonday = (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilNextMonday);
    return d.toISOString().split('T')[0];
  };

  // Cálculo da capacidade do Dia e da Semana para apoio à decisão do coordenador
  const weekInfo = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  const statsForDateAndWeek = useMemo(() => {
    const otherOps = allOps.filter((o) => o.id !== op.id);

    // No dia selecionado
    const opsInDay = otherOps.filter((o) => o.scheduledDate === selectedDate);
    const dayVolumeTotal = opsInDay.reduce((acc, o) => acc + o.plannedQuantity, 0);
    const dayOpsInSelectedLine = opsInDay.filter((o) => o.lineId === selectedLineId);
    const dayVolumeInSelectedLine = dayOpsInSelectedLine.reduce((acc, o) => acc + o.plannedQuantity, 0);

    // Na semana selecionada
    const opsInWeek = otherOps.filter((o) => {
      if (!o.scheduledDate) return false;
      return o.scheduledDate >= weekInfo.startStr && o.scheduledDate <= weekInfo.endStr;
    });
    const weekVolumeTotal = opsInWeek.reduce((acc, o) => acc + o.plannedQuantity, 0);
    const weekOpsInSelectedLine = opsInWeek.filter((o) => o.lineId === selectedLineId);
    const weekVolumeInSelectedLine = weekOpsInSelectedLine.reduce((acc, o) => acc + o.plannedQuantity, 0);

    return {
      dayOpsCount: dayOpsInSelectedLine.length,
      dayVolume: dayVolumeInSelectedLine,
      newDayVolume: selectedLineId ? dayVolumeInSelectedLine + op.plannedQuantity : dayVolumeInSelectedLine,
      dayTotalFactoryVolume: selectedLineId ? dayVolumeTotal + op.plannedQuantity : dayVolumeTotal,

      weekOpsCount: weekOpsInSelectedLine.length,
      weekVolume: weekVolumeInSelectedLine,
      newWeekVolume: selectedLineId ? weekVolumeInSelectedLine + op.plannedQuantity : weekVolumeInSelectedLine,
      weekTotalFactoryVolume: selectedLineId ? weekVolumeTotal + op.plannedQuantity : weekVolumeTotal,
    };
  }, [allOps, op, selectedDate, selectedLineId, weekInfo]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onSave(op.id, {
        lineId: selectedLineId,
        scheduledDate: selectedDate,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveFromSchedule = async () => {
    setIsSubmitting(true);
    try {
      await onSave(op.id, {
        lineId: null,
        scheduledDate: undefined,
        scheduledShift: undefined,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedLineObj = lines.find((l) => l.id === selectedLineId);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#111116] border border-[#272730] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-[#202026] flex items-center justify-between bg-[#14141a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-950/40">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                  Atribuir Linha & Cronograma de Produção
                </h3>
                <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full font-bold">
                  OP #{op.number}
                </span>
              </div>
              <p className="text-xs text-[#71717a] mt-0.5">
                Defina a linha operacional e a data prevista para planejar a carga diária e semanal.
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

        {/* Corpo do Modal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          
          {/* Card Resumo da OP selecionada */}
          <div className="bg-[#15151c] border border-[#242430] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-[#71717a] tracking-wider block">
                Produto Selecionado
              </span>
              <p className="text-sm font-black text-[#f4f4f5] leading-snug">
                {op.product}
              </p>
              <div className="flex items-center gap-2 flex-wrap text-xs text-[#a1a1aa] mt-1">
                <span>Lote: <strong className="text-emerald-400 font-mono">{op.lote || 'S/ Lote'}</strong></span>
                <span>•</span>
                <span>Granel: <strong className="text-amber-400 font-mono">{op.granel || 'S/ Granel'}</strong></span>
                <span>•</span>
                <span>Prioridade: <strong className="text-blue-400">{op.priority}</strong></span>
              </div>
            </div>

            <div className="text-left sm:text-right shrink-0 bg-[#0d0d12] border border-[#22222a] px-3.5 py-2 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-[#71717a] block">
                Quantidade a Produzir
              </span>
              <span className="text-lg font-black font-mono text-[#f4f4f5]">
                {op.plannedQuantity.toLocaleString('pt-BR')} <span className="text-xs text-[#71717a] font-normal">un</span>
              </span>
            </div>
          </div>

          {/* Seleção de Linha */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#f4f4f5] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-400" />
              1. Selecione a Linha de Produção
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {lines.map((line) => {
                const isSelected = selectedLineId === line.id;
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => setSelectedLineId(line.id)}
                    className={`p-3 rounded-xl border text-left transition-all relative ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-900/20'
                        : 'bg-[#15151c] border-[#252530] hover:border-[#383848] text-[#a1a1aa]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-black ${isSelected ? 'text-white' : 'text-[#d4d4d8]'}`}>
                        {line.name}
                      </span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />}
                    </div>
                    <span className="text-[10px] text-[#71717a] block mt-1">
                      Linha Fabril
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setSelectedLineId(null)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedLineId === null
                    ? 'bg-amber-600/15 border-amber-500 shadow-md shadow-amber-900/20'
                    : 'bg-[#15151c] border-[#252530] hover:border-[#383848] text-[#a1a1aa]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${selectedLineId === null ? 'text-amber-300' : 'text-[#d4d4d8]'}`}>
                    Sem Linha
                  </span>
                  {selectedLineId === null && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                </div>
                <span className="text-[10px] text-[#71717a] block mt-1">
                  Apenas Estoque
                </span>
              </button>
            </div>
          </div>

          {/* Seleção de Data (Cronograma) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#f4f4f5] uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-emerald-400" />
              2. Data Prevista de Produção (Cronograma)
            </label>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="flex-1 bg-[#15151c] border border-[#2c2c38] rounded-xl px-3.5 py-2.5 text-sm text-[#f4f4f5] focus:outline-none focus:border-blue-500 font-semibold cursor-pointer"
              />

              {/* Botões rápidos de data */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedDate(getRelativeDate(0))}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                    selectedDate === getRelativeDate(0)
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-[#181820] text-[#a1a1aa] border-[#2c2c38] hover:border-[#3f3f4e]'
                  }`}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(getRelativeDate(1))}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                    selectedDate === getRelativeDate(1)
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-[#181820] text-[#a1a1aa] border-[#2c2c38] hover:border-[#3f3f4e]'
                  }`}
                >
                  Amanhã
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(getNextMonday())}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                    selectedDate === getNextMonday()
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-[#181820] text-[#a1a1aa] border-[#2c2c38] hover:border-[#3f3f4e]'
                  }`}
                >
                  Próxima Segunda
                </button>
              </div>
            </div>
          </div>

          {/* Painel de Apoio à Decisão: Capacidade do Dia e da Semana */}
          <div className="bg-[#0e0e14] border border-[#242432] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#f4f4f5] uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Impacto no Cronograma & Capacidade
              </h4>
              <span className="text-[11px] text-[#71717a] font-medium">
                {weekInfo.displayLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              
              {/* No Dia Selecionado */}
              <div className="bg-[#15151e] border border-[#272736] p-3 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>Programado para o Dia:</span>
                  <span className="font-mono font-bold text-white">
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
                
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-xs text-[#71717a]">
                    Na {selectedLineObj ? selectedLineObj.name : 'Linha'}:
                  </span>
                  <span className="text-base font-black font-mono text-blue-400">
                    {statsForDateAndWeek.newDayVolume.toLocaleString('pt-BR')} <span className="text-[10px] text-[#71717a]">un</span>
                  </span>
                </div>

                <div className="text-[10px] text-[#71717a] flex items-center justify-between border-t border-[#20202a] pt-1 mt-1">
                  <span>Total Fábrica no Dia:</span>
                  <span className="font-mono font-bold text-[#d4d4d8]">
                    {statsForDateAndWeek.dayTotalFactoryVolume.toLocaleString('pt-BR')} un
                  </span>
                </div>
              </div>

              {/* Na Semana Selecionada */}
              <div className="bg-[#15151e] border border-[#272736] p-3 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>Programado para a Semana:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    Total Acumulado
                  </span>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-xs text-[#71717a]">
                    Na {selectedLineObj ? selectedLineObj.name : 'Linha'}:
                  </span>
                  <span className="text-base font-black font-mono text-emerald-400">
                    {statsForDateAndWeek.newWeekVolume.toLocaleString('pt-BR')} <span className="text-[10px] text-[#71717a]">un</span>
                  </span>
                </div>

                <div className="text-[10px] text-[#71717a] flex items-center justify-between border-t border-[#20202a] pt-1 mt-1">
                  <span>Total Fábrica na Semana:</span>
                  <span className="font-mono font-bold text-[#d4d4d8]">
                    {statsForDateAndWeek.weekTotalFactoryVolume.toLocaleString('pt-BR')} un
                  </span>
                </div>
              </div>

            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#202026] bg-[#14141a] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div>
            {op.lineId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemoveFromSchedule}
                disabled={isSubmitting}
                className="h-8 text-xs bg-transparent border-red-800/40 text-red-400 hover:bg-red-950/40 hover:text-red-300 rounded-lg flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Desalocar da Linha (Voltar ao Estoque)</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-8 text-xs text-[#a1a1aa] hover:text-white"
            >
              Cancelar
            </Button>
            
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="h-9 px-5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.35)]"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Salvando Cronograma...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Salvar Atribuição & Cronograma</span>
                </>
              )}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
