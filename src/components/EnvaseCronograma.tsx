import React, { useState, useMemo } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  Clock, 
  Layers, 
  Plus, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  AlertTriangle, 
  Boxes, 
  UserCheck, 
  Play, 
  Edit3, 
  X, 
  Sparkles,
  TrendingUp,
  RotateCcw,
  CalendarCheck
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ProductionLine, ProductionOrder, UserProfile } from '../types';

interface EnvaseCronogramaProps {
  lines: ProductionLine[];
  ops: ProductionOrder[];
  leaders: UserProfile[];
  rotations: Record<string, string>;
  onUpdateOpSchedule: (
    opId: string, 
    updates: { 
      lineId: string | null; 
      scheduledDate?: string; 
      scheduledEndDate?: string; 
      scheduledDays?: number; 
      scheduledShift?: string;
    }
  ) => Promise<void>;
  onOpenCreateOpModal?: (prefillLineId?: string, prefillDate?: string) => void;
  onOpenEditOpModal?: (op: ProductionOrder) => void;
  onStartOp?: (opId: string, lineId: string) => Promise<void>;
}

// Retorna as datas de segunda a domingo para uma data de referência
function getWeekDays(referenceDate: Date) {
  const d = new Date(referenceDate);
  const day = d.getDay();
  // 1 = Segunda, ..., 0 = Domingo
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  monday.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const nextDay = new Date(monday);
    nextDay.setDate(monday.getDate() + i);
    days.push(nextDay);
  }
  return days;
}

function formatDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calcEndDate(startDateStr: string, days: number): string {
  if (!startDateStr) return '';
  const d = new Date(startDateStr + 'T12:00:00');
  d.setDate(d.getDate() + (Math.max(1, days) - 1));
  return formatDateISO(d);
}

// Verifica se uma OP cai no dia especificado considerando scheduledDate e scheduledEndDate ou scheduledDays
function isOpScheduledForDate(op: ProductionOrder, targetDateStr: string): { isScheduled: boolean; dayIndex?: number; totalDays?: number } {
  if (!op.scheduledDate) return { isScheduled: false };

  const start = op.scheduledDate;
  const days = op.scheduledDays || 1;
  const end = op.scheduledEndDate || calcEndDate(start, days);

  if (targetDateStr >= start && targetDateStr <= end) {
    const startDate = new Date(start + 'T12:00:00');
    const targetDate = new Date(targetDateStr + 'T12:00:00');
    const diffTime = targetDate.getTime() - startDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return {
      isScheduled: true,
      dayIndex: diffDays + 1,
      totalDays: days,
    };
  }

  return { isScheduled: false };
}

export function EnvaseCronograma({
  lines,
  ops,
  leaders,
  rotations,
  onUpdateOpSchedule,
  onOpenCreateOpModal,
  onOpenEditOpModal,
  onStartOp,
}: EnvaseCronogramaProps) {
  // Estado da semana atual
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(new Date());
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewFormat, setViewFormat] = useState<'matrix' | 'daily'>('matrix');

  // Modal rápido de agendamento de OP no Cronograma
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [modalTargetOp, setModalTargetOp] = useState<ProductionOrder | null>(null);
  const [modalSelectedOpId, setModalSelectedOpId] = useState<string>('');
  const [modalLineId, setModalLineId] = useState<string>('line-1');
  const [modalStartDate, setModalStartDate] = useState<string>(formatDateISO(new Date()));
  const [modalDays, setModalDays] = useState<number>(1);
  const [modalShift, setModalShift] = useState<string>('Integral');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  const todayStr = useMemo(() => formatDateISO(new Date()), []);
  const weekDays = useMemo(() => getWeekDays(currentWeekDate), [currentWeekDate]);
  const weekStartStr = useMemo(() => formatDateISO(weekDays[0]), [weekDays]);
  const weekEndStr = useMemo(() => formatDateISO(weekDays[6]), [weekDays]);

  const weekLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    const formatDayMonth = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const year = end.getFullYear();
    return `${formatDayMonth(start)} a ${formatDayMonth(end)} de ${year}`;
  }, [weekDays]);

  // Navegações de data
  const handlePrevWeek = () => {
    const d = new Date(currentWeekDate);
    d.setDate(d.getDate() - 7);
    setCurrentWeekDate(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentWeekDate);
    d.setDate(d.getDate() + 7);
    setCurrentWeekDate(d);
  };

  const handleToday = () => {
    setCurrentWeekDate(new Date());
  };

  const handleDatePick = (dateStr: string) => {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    setCurrentWeekDate(new Date(y, m - 1, d));
  };

  // OPs do Envase
  const envaseOps = useMemo(() => {
    return ops.filter(o => !o.setor || o.setor === 'Envase');
  }, [ops]);

  // OPs da semana filtradas
  const weekOps = useMemo(() => {
    return envaseOps.filter(op => {
      if (!op.scheduledDate) return false;
      const start = op.scheduledDate;
      const days = op.scheduledDays || 1;
      const end = op.scheduledEndDate || calcEndDate(start, days);
      // Sobreposição de períodos
      return start <= weekEndStr && end >= weekStartStr;
    });
  }, [envaseOps, weekStartStr, weekEndStr]);

  // Métricas do cronograma
  const metrics = useMemo(() => {
    const totalScheduledWeek = weekOps.length;
    const totalUnitsPlanned = weekOps.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);
    const linesWithOps = new Set(weekOps.map(o => o.lineId).filter(Boolean)).size;
    const criticalOps = weekOps.filter(o => o.priority === 'Crítica' || o.priority === 'Alta').length;

    return {
      totalScheduledWeek,
      totalUnitsPlanned,
      linesWithOps,
      criticalOps,
    };
  }, [weekOps]);

  // Linhas filtradas
  const filteredLines = useMemo(() => {
    if (selectedLineFilter === 'all') return lines;
    return lines.filter(l => l.id === selectedLineFilter);
  }, [lines, selectedLineFilter]);

  // Abre modal para agendar OP existente ou pré-selecionada
  const handleOpenScheduleForOp = (op: ProductionOrder) => {
    setModalTargetOp(op);
    setModalSelectedOpId(op.id);
    setModalLineId(op.lineId || 'line-1');
    setModalStartDate(op.scheduledDate || todayStr);
    setModalDays(op.scheduledDays || 1);
    setModalShift(op.scheduledShift || 'Integral');
    setIsScheduleModalOpen(true);
  };

  // Abre modal para agendar em uma linha e dia específicos
  const handleOpenScheduleForLineAndDay = (lineId: string, dateStr: string) => {
    setModalTargetOp(null);
    setModalSelectedOpId('');
    setModalLineId(lineId);
    setModalStartDate(dateStr);
    setModalDays(1);
    setModalShift('Integral');
    setIsScheduleModalOpen(true);
  };

  // Salva agendamento
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const opId = modalSelectedOpId || modalTargetOp?.id;
    if (!opId) return;

    setIsSavingSchedule(true);
    try {
      const calculatedEnd = calcEndDate(modalStartDate, modalDays);
      await onUpdateOpSchedule(opId, {
        lineId: modalLineId,
        scheduledDate: modalStartDate,
        scheduledEndDate: calculatedEnd,
        scheduledDays: modalDays,
        scheduledShift: modalShift,
      });
      setIsScheduleModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar cronograma:', err);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Remove OP da linha / do cronograma
  const handleRemoveFromSchedule = async (opId: string) => {
    if (!confirm('Deseja desatribuir esta OP da linha e enviá-la para o Estoque Geral?')) return;
    setIsSavingSchedule(true);
    try {
      await onUpdateOpSchedule(opId, {
        lineId: null,
        scheduledDate: undefined,
        scheduledEndDate: undefined,
        scheduledDays: undefined,
      });
      setIsScheduleModalOpen(false);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Nomes dos dias da semana em pt-BR
  const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  return (
    <div className="space-y-5">
      {/* ---------------- CABEÇALHO DO CRONOGRAMA & NAVEGAÇÃO ---------------- */}
      <div className="bg-[#111116] border border-[#202028] p-4 rounded-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
              Cronograma de Envase das Linhas
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-300 border border-blue-800/50">
              {weekOps.length} OPs na semana
            </span>
          </div>
          <p className="text-xs text-[#71717a] mt-0.5">
            Distribua e acompanhe as OPs nos dias de envase em cada uma das 8 linhas de produção.
          </p>
        </div>

        {/* Controles de Semana e Ações */}
        <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto justify-start lg:justify-end">
          {/* Navegador de Semana */}
          <div className="flex items-center bg-[#171720] border border-[#2c2c3a] rounded-xl p-1 gap-1">
            <button
              type="button"
              onClick={handlePrevWeek}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#252532] transition-colors cursor-pointer"
              title="Semana anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="px-2.5 py-1 text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-[#252532] rounded-lg transition-colors cursor-pointer"
              title="Ir para hoje"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={handleNextWeek}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#252532] transition-colors cursor-pointer"
              title="Próxima semana"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-[#f4f4f5] px-2 whitespace-nowrap">
              {weekLabel}
            </span>
          </div>

          {/* Seletor rápido de data */}
          <input
            type="date"
            value={formatDateISO(currentWeekDate)}
            onChange={(e) => handleDatePick(e.target.value)}
            className="h-9 bg-[#171720] border border-[#2c2c3a] rounded-xl px-2.5 text-xs text-[#f4f4f5] font-semibold cursor-pointer focus:outline-none focus:border-blue-500"
            title="Selecionar data específica"
          />

          {/* Botão para programar nova OP */}
          <Button
            onClick={() => {
              setModalTargetOp(null);
              setModalSelectedOpId('');
              setModalLineId('line-1');
              setModalStartDate(todayStr);
              setModalDays(1);
              setIsScheduleModalOpen(true);
            }}
            className="h-9 px-3.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-blue-900/30"
          >
            <Plus className="w-4 h-4" />
            <span>+ Programar OP</span>
          </Button>
        </div>
      </div>

      {/* ---------------- CARDS DE RESUMO DO CRONOGRAMA ---------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#121216] border border-[#222228] p-3.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#71717a] uppercase tracking-wider">OPs na Semana</span>
            <Boxes className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-extrabold text-[#f4f4f5] mt-1">{metrics.totalScheduledWeek}</p>
          <span className="text-[10px] text-[#71717a]">distribuídas nas linhas</span>
        </div>

        <div className="bg-[#121216] border border-[#222228] p-3.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#71717a] uppercase tracking-wider">Volume Planejado</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-extrabold text-emerald-400 mt-1">
            {metrics.totalUnitsPlanned.toLocaleString('pt-BR')} <span className="text-xs font-normal text-[#a1a1aa]">un</span>
          </p>
          <span className="text-[10px] text-[#71717a]">capacidade prevista</span>
        </div>

        <div className="bg-[#121216] border border-[#222228] p-3.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#71717a] uppercase tracking-wider">Linhas Ocupadas</span>
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl font-extrabold text-purple-400 mt-1">
            {metrics.linesWithOps} <span className="text-xs font-normal text-[#a1a1aa]">de {lines.length}</span>
          </p>
          <span className="text-[10px] text-[#71717a]">com envase agendado</span>
        </div>

        <div className="bg-[#121216] border border-[#222228] p-3.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#71717a] uppercase tracking-wider">Prioridade Alta/Crítica</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-xl font-extrabold text-amber-400 mt-1">{metrics.criticalOps}</p>
          <span className="text-[10px] text-[#71717a]">atenção operacional</span>
        </div>
      </div>

      {/* ---------------- BARRA DE FILTROS & VISUALIZAÇÃO ---------------- */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#121216] border border-[#222228] p-3 rounded-xl">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Busca por OP ou Produto */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]" />
            <Input
              type="text"
              placeholder="Buscar OP, produto ou lote..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-[#0c0c10] border-[#2c2c3a] text-[#f4f4f5] rounded-lg"
            />
          </div>

          {/* Filtro de Linha */}
          <select
            value={selectedLineFilter}
            onChange={(e) => setSelectedLineFilter(e.target.value)}
            className="h-8 bg-[#0c0c10] border border-[#2c2c3a] text-xs text-[#f4f4f5] rounded-lg px-2.5 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="all">Todas as Linhas (8)</option>
            {lines.map(line => (
              <option key={line.id} value={line.id}>{line.name}</option>
            ))}
          </select>

          {/* Filtro de Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 bg-[#0c0c10] border border-[#2c2c3a] text-xs text-[#f4f4f5] rounded-lg px-2.5 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="all">Todos os Status</option>
            <option value="in_progress">Em Produção</option>
            <option value="pending">Agendadas / Fila</option>
            <option value="completed">Concluídas</option>
          </select>
        </div>

        {/* Alternador de formato: Matriz vs Diário */}
        <div className="flex items-center bg-[#0c0c10] border border-[#2c2c3a] rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setViewFormat('matrix')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
              viewFormat === 'matrix' ? 'bg-blue-600 text-white shadow-sm' : 'text-[#a1a1aa] hover:text-white'
            }`}
          >
            Matriz Semanal
          </button>
          <button
            type="button"
            onClick={() => setViewFormat('daily')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
              viewFormat === 'daily' ? 'bg-blue-600 text-white shadow-sm' : 'text-[#a1a1aa] hover:text-white'
            }`}
          >
            Visão Diária
          </button>
        </div>
      </div>

      {/* ---------------- FORMATO 1: MATRIZ SEMANAL (LINHAS X DIAS) ---------------- */}
      {viewFormat === 'matrix' && (
        <div className="bg-[#121216] border border-[#222228] rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[950px]">
              <thead>
                <tr className="border-b border-[#222228] bg-[#16161c]">
                  {/* Coluna Linha */}
                  <th className="py-3 px-4 text-xs font-bold text-[#a1a1aa] uppercase tracking-wider w-44 sticky left-0 bg-[#16161c] z-10">
                    Linha / Líder
                  </th>
                  {/* Colunas dos 7 Dias */}
                  {weekDays.map((day, idx) => {
                    const dayStr = formatDateISO(day);
                    const isToday = dayStr === todayStr;
                    return (
                      <th
                        key={dayStr}
                        className={`py-3 px-3 text-center border-l border-[#222228] transition-colors ${
                          isToday ? 'bg-blue-950/40 text-blue-300' : 'text-[#a1a1aa]'
                        }`}
                      >
                        <div className="text-[11px] font-bold uppercase tracking-wider">
                          {dayNames[idx]}
                        </div>
                        <div className={`text-sm font-extrabold mt-0.5 ${isToday ? 'text-blue-400 underline underline-offset-4' : 'text-[#f4f4f5]'}`}>
                          {day.getDate().toString().padStart(2, '0')}/{(day.getMonth() + 1).toString().padStart(2, '0')}
                        </div>
                        {isToday && (
                          <span className="text-[9px] font-bold text-blue-400 uppercase bg-blue-900/60 px-1.5 py-0.2 rounded-full mt-0.5 inline-block">
                            Hoje
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e26]">
                {filteredLines.map((line) => {
                  // Descobre o líder da linha
                  const leaderId = Object.keys(rotations).find(k => rotations[k] === line.id) || (rotations as any)[line.id];
                  const leader = leaderId
                    ? leaders.find(l => l.uid === leaderId || (l.email && l.email.toLowerCase() === leaderId.toLowerCase()) || l.name?.toLowerCase() === leaderId.toLowerCase())
                    : null;

                  return (
                    <tr key={line.id} className="hover:bg-[#15151c] transition-colors">
                      {/* Coluna Fixa da Linha */}
                      <td className="py-3 px-4 sticky left-0 bg-[#121216] z-10 border-r border-[#222228]">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            line.status === 'active' ? 'bg-emerald-500 animate-pulse' :
                            line.status === 'paused' ? 'bg-amber-500' : 'bg-[#52525b]'
                          }`} />
                          <div>
                            <p className="text-xs font-bold text-[#f4f4f5] whitespace-nowrap">{line.name}</p>
                            {leader ? (
                              <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                                <UserCheck className="w-2.5 h-2.5" />
                                {leader.name.split(' ')[0]}
                              </p>
                            ) : (
                              <p className="text-[10px] text-[#71717a]">Sem líder</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 7 Células de Dias */}
                      {weekDays.map((day) => {
                        const dayStr = formatDateISO(day);
                        const isToday = dayStr === todayStr;

                        // Busca OPs agendadas para esta linha neste dia
                        const cellOps = envaseOps.filter(op => {
                          if (op.lineId !== line.id) return false;
                          if (statusFilter !== 'all' && op.status !== statusFilter) return false;
                          if (searchQuery) {
                            const query = searchQuery.toLowerCase();
                            const matchNum = op.number.toLowerCase().includes(query);
                            const matchProd = op.product.toLowerCase().includes(query);
                            const matchLote = op.lote ? op.lote.toLowerCase().includes(query) : false;
                            if (!matchNum && !matchProd && !matchLote) return false;
                          }
                          const sched = isOpScheduledForDate(op, dayStr);
                          return sched.isScheduled;
                        });

                        return (
                          <td
                            key={dayStr}
                            className={`p-2 border-l border-[#222228] align-top min-w-[130px] group transition-colors ${
                              isToday ? 'bg-blue-950/15' : ''
                            }`}
                          >
                            <div className="space-y-2 min-h-[70px] flex flex-col justify-between">
                              {/* Lista de OPs no dia */}
                              <div className="space-y-1.5">
                                {cellOps.map(op => {
                                  const schedInfo = isOpScheduledForDate(op, dayStr);
                                  const isMultiDay = (schedInfo.totalDays || 1) > 1;

                                  return (
                                    <div
                                      key={op.id}
                                      onClick={() => handleOpenScheduleForOp(op)}
                                      className={`p-2 rounded-xl border text-xs cursor-pointer transition-all hover:scale-[1.02] shadow-sm ${
                                        op.status === 'in_progress'
                                          ? 'bg-emerald-950/70 border-emerald-700/60 hover:border-emerald-500'
                                          : op.priority === 'Crítica'
                                          ? 'bg-red-950/60 border-red-800/60 hover:border-red-500'
                                          : op.priority === 'Alta'
                                          ? 'bg-orange-950/50 border-orange-800/50 hover:border-orange-500'
                                          : 'bg-[#181822] border-[#2c2c3c] hover:border-blue-500'
                                      }`}
                                      title="Clique para editar agendamento ou remanejar dias"
                                    >
                                      {/* Topo do card da OP */}
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                        <span className="font-mono font-bold text-white text-[11px]">
                                          OP {op.number}
                                        </span>
                                        {op.status === 'in_progress' ? (
                                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500 text-black uppercase">
                                            Produzindo
                                          </span>
                                        ) : isMultiDay ? (
                                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-900/80 text-blue-300 border border-blue-700/50">
                                            {schedInfo.dayIndex}º de {schedInfo.totalDays}d
                                          </span>
                                        ) : (
                                          <span className="text-[9px] font-semibold text-[#a1a1aa]">
                                            1 dia
                                          </span>
                                        )}
                                      </div>

                                      {/* Nome do Produto */}
                                      <p className="text-[11px] text-[#d4d4d8] font-medium line-clamp-1 leading-tight" title={op.product}>
                                        {op.product}
                                      </p>

                                      {/* Quantidade e Lote */}
                                      <div className="flex items-center justify-between text-[10px] text-[#a1a1aa] mt-1.5 pt-1 border-t border-white/5">
                                        <span className="font-bold text-[#f4f4f5]">
                                          {op.plannedQuantity.toLocaleString('pt-BR')} {op.unidade || 'un'}
                                        </span>
                                        {op.lote && (
                                          <span className="font-mono text-emerald-400">
                                            {op.lote}
                                          </span>
                                        )}
                                      </div>

                                      {/* Progresso se em produção */}
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
                                })}
                              </div>

                              {/* Botão rápido + para agendar nessa linha e dia */}
                              <button
                                type="button"
                                onClick={() => handleOpenScheduleForLineAndDay(line.id, dayStr)}
                                className="w-full py-1 text-[11px] text-[#52525b] hover:text-blue-400 hover:bg-blue-950/30 rounded-lg border border-transparent hover:border-blue-900/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-1 cursor-pointer font-semibold"
                                title={`Agendar OP na ${line.name} para o dia ${dayStr}`}
                              >
                                <Plus className="w-3 h-3" />
                                <span>Agendar</span>
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- FORMATO 2: VISÃO DIÁRIA EM CARDS ---------------- */}
      {viewFormat === 'daily' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {weekDays.map((day, idx) => {
            const dayStr = formatDateISO(day);
            const isToday = dayStr === todayStr;

            // OPs do dia
            const opsInDay = envaseOps.filter(op => {
              if (selectedLineFilter !== 'all' && op.lineId !== selectedLineFilter) return false;
              if (statusFilter !== 'all' && op.status !== statusFilter) return false;
              return isOpScheduledForDate(op, dayStr).isScheduled;
            });

            const dayVolume = opsInDay.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);

            return (
              <div
                key={dayStr}
                className={`bg-[#121216] border rounded-2xl p-4 flex flex-col justify-between transition-all ${
                  isToday ? 'border-blue-500/60 shadow-lg shadow-blue-950/20' : 'border-[#222228]'
                }`}
              >
                <div>
                  {/* Topo do dia */}
                  <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#202028]">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className={`text-sm font-extrabold uppercase ${isToday ? 'text-blue-400' : 'text-[#f4f4f5]'}`}>
                          {dayNames[idx]} - {day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        </h3>
                        {isToday && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-600 text-white uppercase">
                            Hoje
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#71717a] mt-0.5">
                        {opsInDay.length} {opsInDay.length === 1 ? 'OP programada' : 'OPs programadas'}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-400 block">
                        {dayVolume.toLocaleString('pt-BR')} un
                      </span>
                      <span className="text-[9px] text-[#71717a]">volume</span>
                    </div>
                  </div>

                  {/* Lista de OPs */}
                  {opsInDay.length === 0 ? (
                    <div className="py-6 text-center text-[#52525b] border border-dashed border-[#202028] rounded-xl text-xs">
                      <p>Nenhuma OP agendada</p>
                      <button
                        type="button"
                        onClick={() => handleOpenScheduleForLineAndDay(lines[0]?.id || 'line-1', dayStr)}
                        className="text-blue-400 hover:text-blue-300 font-semibold text-[11px] mt-1 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        Programar OP neste dia
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                      {opsInDay.map(op => {
                        const lineName = lines.find(l => l.id === op.lineId)?.name || 'Sem linha';
                        return (
                          <div
                            key={op.id}
                            onClick={() => handleOpenScheduleForOp(op)}
                            className="p-2.5 bg-[#171720] border border-[#272734] hover:border-blue-500 rounded-xl cursor-pointer transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-xs text-white">OP {op.number}</span>
                              <span className="text-[10px] font-bold text-blue-400 bg-blue-950/70 px-2 py-0.5 rounded-md border border-blue-800/40">
                                {lineName}
                              </span>
                            </div>
                            <p className="text-xs text-[#d4d4d8] font-semibold mt-1 line-clamp-1">{op.product}</p>
                            <div className="flex items-center justify-between text-[10px] text-[#a1a1aa] mt-1.5 pt-1 border-t border-white/5">
                              <span>Qtd: <strong className="text-white">{op.plannedQuantity}</strong></span>
                              <span>Duração: <strong className="text-blue-300">{op.scheduledDays || 1}d</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Botão rápido no rodapé do dia */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenScheduleForLineAndDay(lines[0]?.id || 'line-1', dayStr)}
                  className="w-full mt-3 h-7.5 bg-[#171720] hover:bg-[#20202c] border-[#2c2c3a] text-xs text-[#a1a1aa] hover:text-white rounded-lg flex items-center justify-center gap-1 font-semibold"
                >
                  <Plus className="w-3 h-3" />
                  <span>Programar OP neste dia</span>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- MODAL: PROGRAMAR / EDITAR OP NO CRONOGRAMA ---------------- */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-[#27272e] w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header do modal */}
            <div className="p-4 border-b border-[#222228] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wide">
                  {modalTargetOp ? `Editar Cronograma: OP ${modalTargetOp.number}` : 'Programar OP no Cronograma de Envase'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-[#71717a] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Formulário */}
            <form onSubmit={handleSaveSchedule} className="p-5 space-y-4">
              {/* Seleção de OP se não for uma OP específica já aberta */}
              {!modalTargetOp && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase font-bold text-[#a1a1aa]">1. Selecione a OP do Estoque *</Label>
                    {onOpenCreateOpModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsScheduleModalOpen(false);
                          onOpenCreateOpModal(modalLineId, modalStartDate);
                        }}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold underline flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        Criar Nova OP
                      </button>
                    )}
                  </div>
                  <select
                    value={modalSelectedOpId}
                    onChange={(e) => setModalSelectedOpId(e.target.value)}
                    className="w-full h-10 bg-[#0b0b0e] border border-[#25252c] rounded-xl px-3 text-xs text-[#f4f4f5] font-semibold cursor-pointer focus:outline-none focus:border-blue-500"
                    required
                  >
                    <option value="">Selecione uma OP da carteira / estoque...</option>
                    {envaseOps
                      .filter(o => o.status !== 'completed')
                      .map(op => (
                        <option key={op.id} value={op.id}>
                          OP {op.number} - {op.product} ({op.plannedQuantity} {op.unidade || 'un'}) {op.lote ? `[Lote: ${op.lote}]` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Informações da OP se já aberta */}
              {modalTargetOp && (
                <div className="p-3 bg-[#171720] border border-[#282836] rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-white">OP {modalTargetOp.number}</p>
                    <p className="text-[11px] text-[#a1a1aa] line-clamp-1">{modalTargetOp.product}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-400">
                      {modalTargetOp.plannedQuantity.toLocaleString('pt-BR')} {modalTargetOp.unidade || 'un'}
                    </span>
                    {modalTargetOp.lote && (
                      <span className="text-[10px] text-[#71717a] block font-mono">
                        Lote: {modalTargetOp.lote}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 2. Seleção da Linha de Envase */}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase font-bold text-[#a1a1aa]">2. Linha de Envase *</Label>
                <select
                  value={modalLineId}
                  onChange={(e) => setModalLineId(e.target.value)}
                  className="w-full h-10 bg-[#0b0b0e] border border-[#25252c] rounded-xl px-3 text-xs text-[#f4f4f5] font-semibold cursor-pointer focus:outline-none focus:border-blue-500"
                  required
                >
                  {lines.map(line => {
                    const leaderId = Object.keys(rotations).find(k => rotations[k] === line.id) || (rotations as any)[line.id];
                    const leader = leaderId ? leaders.find(l => l.uid === leaderId || l.email === leaderId) : null;
                    return (
                      <option key={line.id} value={line.id}>
                        {line.name} {leader ? `(Líder: ${leader.name})` : '(Sem líder)'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 3. Data de Início e Dias Previstos de Envase */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase font-bold text-[#a1a1aa]">Data de Início *</Label>
                  <Input
                    type="date"
                    value={modalStartDate}
                    onChange={(e) => setModalStartDate(e.target.value)}
                    className="bg-[#0b0b0e] border-[#25252c] text-xs font-semibold text-[#f4f4f5]"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs uppercase font-bold text-[#a1a1aa]">Duração (Dias de Envase) *</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={modalDays}
                      onChange={(e) => setModalDays(Math.max(1, Number(e.target.value)))}
                      className="bg-[#0b0b0e] border-[#25252c] text-xs font-bold text-[#f4f4f5] text-center"
                      required
                    />
                    {/* Atalhos rápidos de dias */}
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 5].map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setModalDays(d)}
                          className={`h-9 px-2 text-[11px] font-bold rounded-lg border transition-all ${
                            modalDays === d
                              ? 'bg-blue-600 text-white border-blue-500'
                              : 'bg-[#181820] text-[#a1a1aa] border-[#2c2c3a] hover:border-[#3c3c4e]'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Prevista de Término e Turno */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-[#171720] border border-[#282836] rounded-xl">
                  <span className="text-[10px] text-[#71717a] font-bold uppercase block">Data de Término Prevista</span>
                  <p className="text-xs font-bold text-emerald-400 mt-0.5">
                    {modalStartDate ? (
                      new Date(calcEndDate(modalStartDate, modalDays) + 'T12:00:00').toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        weekday: 'short',
                      })
                    ) : 'Informe a data'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs uppercase font-bold text-[#a1a1aa]">Turno Previsto</Label>
                  <select
                    value={modalShift}
                    onChange={(e) => setModalShift(e.target.value)}
                    className="w-full h-10 bg-[#0b0b0e] border border-[#25252c] rounded-xl px-3 text-xs text-[#f4f4f5] font-semibold cursor-pointer focus:outline-none focus:border-blue-500"
                  >
                    <option value="Integral">Integral (Turno Completo)</option>
                    <option value="Manhã">Turno Manhã</option>
                    <option value="Tarde">Turno Tarde</option>
                  </select>
                </div>
              </div>

              {/* Botões do Rodapé */}
              <div className="pt-4 border-t border-[#222228] flex items-center justify-between">
                <div>
                  {modalTargetOp && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleRemoveFromSchedule(modalTargetOp.id)}
                      disabled={isSavingSchedule}
                      className="text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 h-9"
                    >
                      Remover do Cronograma
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsScheduleModalOpen(false)}
                    className="text-xs text-[#a1a1aa] hover:text-white h-9"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSavingSchedule || (!modalSelectedOpId && !modalTargetOp)}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold h-9 px-4 rounded-xl"
                  >
                    {isSavingSchedule ? 'Salvando...' : 'Salvar no Cronograma'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
