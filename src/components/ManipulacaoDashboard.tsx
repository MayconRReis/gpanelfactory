import React, { useState, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  BarChart3,
  FlaskConical,
  Sun,
  Moon,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  Download,
  Settings2,
  Sparkles,
  Layers,
  Scale,
  CalendarDays,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  Tag,
  Hash,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
  Legend
} from 'recharts';
import { ProductionOrder, UserProfile } from '../types';
import { Button } from './ui/button';

interface ManipulacaoDashboardProps {
  ops: ProductionOrder[];
  leaders?: UserProfile[];
  initialDate?: string; // YYYY-MM-DD
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

// Chave para persistência de metas no localStorage
const MANIPULACAO_GOALS_KEY = 'GPANEL_MANIPULACAO_GOALS_V1';

interface ManipulacaoGoals {
  dailyKg: number;
  weeklyKg: number;
}

const DEFAULT_GOALS: ManipulacaoGoals = {
  dailyKg: 10000,
  weeklyKg: 50000,
};

// Retorna string YYYY-MM-DD
function formatDateToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper para obter a data relevante da OP de manipulação
function getOpDate(op: ProductionOrder): string {
  if (op.completedAt) {
    return op.completedAt.split('T')[0];
  }
  if (op.scheduledDate && op.scheduledDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return op.scheduledDate;
  }
  if (op.createdAt) {
    return op.createdAt.split('T')[0];
  }
  return formatDateToIso(new Date());
}

// Normaliza o turno da OP ('1º Turno (Manhã)' ou '2º Turno (Tarde)')
function getNormalizedShift(op: ProductionOrder): 'Manhã' | 'Tarde' {
  const s = (op.finishedShift || op.scheduledShift || '').toLowerCase();
  if (s.includes('manh') || s.includes('1') || s.includes('primeiro')) {
    return 'Manhã';
  }
  if (s.includes('tard') || s.includes('2') || s.includes('segundo')) {
    return 'Tarde';
  }
  // Se não definido, tenta inferir pelo horário de conclusão ou criação
  const timeStr = op.completedAt || op.createdAt;
  if (timeStr) {
    try {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        return date.getHours() < 12 ? 'Manhã' : 'Tarde';
      }
    } catch {}
  }
  return 'Manhã';
}

// Helper para calcular a semana (Segunda a Domingo)
function getWeekInfo(dateStr: string) {
  const parts = dateStr.split('-').map(Number);
  const targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
  
  // Dia da semana: 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  const dayOfWeek = targetDate.getDay();
  // Diferença para a segunda-feira da mesma semana (Segunda = 1, Domingo = -6)
  const diffToMonday = targetDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(targetDate.getFullYear(), targetDate.getMonth(), diffToMonday);

  const days: { dateStr: string; dayName: string; shortDisplay: string; fullDate: Date }[] = [];
  const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  for (let i = 0; i < 7; i++) {
    const current = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const iso = formatDateToIso(current);
    days.push({
      dateStr: iso,
      dayName: dayNames[i],
      shortDisplay: `${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}`,
      fullDate: current,
    });
  }

  const sunday = days[6].fullDate;

  // Calcula número aproximado da semana no ano
  const startOfYear = new Date(monday.getFullYear(), 0, 1);
  const pastDaysOfYear = (monday.getTime() - startOfYear.getTime()) / 86400000;
  const weekNumber = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  return {
    mondayIso: days[0].dateStr,
    sundayIso: days[6].dateStr,
    monday,
    sunday,
    days,
    weekNumber,
    label: `Semana ${weekNumber} · ${days[0].shortDisplay} a ${days[6].shortDisplay}`,
  };
}

export function ManipulacaoDashboard({
  ops,
  leaders = [],
  initialDate,
  onRefresh,
  isRefreshing = false,
}: ManipulacaoDashboardProps) {
  const todayIso = useMemo(() => formatDateToIso(new Date()), []);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayIso);

  // Modo de exibição: 'integrated' | 'daily' | 'weekly'
  const [viewTab, setViewTab] = useState<'integrated' | 'daily' | 'weekly'>('integrated');

  // Filtros da tabela
  const [tableScope, setTableScope] = useState<'day' | 'week'>('day');
  const [filterShift, setFilterShift] = useState<'Todos' | 'Manhã' | 'Tarde'>('Todos');
  const [searchQuery, setSearchQuery] = useState('');

  // Metas de Manipulação
  const [goals, setGoals] = useState<ManipulacaoGoals>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(MANIPULACAO_GOALS_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_GOALS;
  });

  // Modal de edição de metas
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [tempDailyGoal, setTempDailyGoal] = useState(String(goals.dailyKg));
  const [tempWeeklyGoal, setTempWeeklyGoal] = useState(String(goals.weeklyKg));

  const handleSaveGoals = (e: React.FormEvent) => {
    e.preventDefault();
    const dKg = parseFloat(tempDailyGoal) || DEFAULT_GOALS.dailyKg;
    const wKg = parseFloat(tempWeeklyGoal) || DEFAULT_GOALS.weeklyKg;
    const newGoals = { dailyKg: dKg, weeklyKg: wKg };
    setGoals(newGoals);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(MANIPULACAO_GOALS_KEY, JSON.stringify(newGoals));
      } catch {}
    }
    setShowGoalModal(false);
  };

  // Navegação de dias
  const handlePrevDay = () => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 1);
    setSelectedDate(formatDateToIso(d));
  };

  const handleNextDay = () => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 1);
    setSelectedDate(formatDateToIso(d));
  };

  const handleSetToday = () => {
    setSelectedDate(todayIso);
  };

  // Informações da Semana Selecionada
  const weekInfo = useMemo(() => getWeekInfo(selectedDate), [selectedDate]);

  // Navegação de semanas (pula 7 dias)
  const handlePrevWeek = () => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 7);
    setSelectedDate(formatDateToIso(d));
  };

  const handleNextWeek = () => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 7);
    setSelectedDate(formatDateToIso(d));
  };

  // Semana Anterior (para comparativo)
  const prevWeekInfo = useMemo(() => {
    const parts = weekInfo.mondayIso.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 7);
    return getWeekInfo(formatDateToIso(d));
  }, [weekInfo.mondayIso]);

  // Texto formatado da data selecionada
  const formattedDateTitle = useMemo(() => {
    try {
      const parts = selectedDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  // ---------------- FILTRAGEM DE TODAS AS OPS DE MANIPULAÇÃO ----------------
  const manipulacaoOps = useMemo(() => {
    return ops.filter(op => {
      // É explicitamente Manipulação ou OSM executada em reator/área de manipulação
      const isSetorManip = op.setor === 'Manipulação';
      const isLineManip = Boolean(op.lineId && op.lineId.toLowerCase().includes('manipulacao'));
      const isOsm = op.tipoDocumento === 'OSM' && op.setor !== 'Pesagem';
      return isSetorManip || isLineManip || isOsm;
    });
  }, [ops]);

  // Mapa de Líderes por UID
  const leaderMap = useMemo(() => {
    const map = new Map<string, string>();
    leaders.forEach(l => map.set(l.uid, l.name));
    return map;
  }, [leaders]);

  // ---------------- 1. DADOS DE PRODUÇÃO DO DIA SELECIONADO ----------------
  const dailyData = useMemo(() => {
    const opsDoDia = manipulacaoOps.filter(op => getOpDate(op) === selectedDate);
    
    let totalKg = 0;
    let manhaKg = 0;
    let tardeKg = 0;
    let completedCount = 0;
    let inProgressCount = 0;

    opsDoDia.forEach(op => {
      const kg = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
      const shift = getNormalizedShift(op);

      if (op.status === 'completed') {
        totalKg += kg;
        completedCount++;
        if (shift === 'Manhã') manhaKg += kg;
        else tardeKg += kg;
      } else {
        inProgressCount++;
      }
    });

    // Dia anterior para comparativo diário
    const parts = selectedDate.split('-').map(Number);
    const prevDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    prevDateObj.setDate(prevDateObj.getDate() - 1);
    const prevDateIso = formatDateToIso(prevDateObj);

    const opsDiaAnterior = manipulacaoOps.filter(op => getOpDate(op) === prevDateIso && op.status === 'completed');
    const totalKgDiaAnterior = opsDiaAnterior.reduce((acc, op) => acc + (Number(op.producedQuantity) || Number(op.plannedQuantity) || 0), 0);

    let variacaoOntem = 0;
    if (totalKgDiaAnterior > 0) {
      variacaoOntem = ((totalKg - totalKgDiaAnterior) / totalKgDiaAnterior) * 100;
    }

    const metaPercent = goals.dailyKg > 0 ? Math.min(Math.round((totalKg / goals.dailyKg) * 100), 999) : 0;

    return {
      opsDoDia,
      totalKg,
      manhaKg,
      tardeKg,
      completedCount,
      inProgressCount,
      totalKgDiaAnterior,
      variacaoOntem,
      metaPercent,
    };
  }, [manipulacaoOps, selectedDate, goals.dailyKg]);

  // ---------------- 2. DADOS DE PRODUÇÃO DA SEMANA SELECIONADA ----------------
  const weeklyData = useMemo(() => {
    // Array com dados dia a dia da semana (Segunda a Domingo)
    const weekDaysData = weekInfo.days.map(d => {
      const opsDay = manipulacaoOps.filter(op => getOpDate(op) === d.dateStr && op.status === 'completed');
      let manha = 0;
      let tarde = 0;
      let total = 0;

      opsDay.forEach(op => {
        const kg = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
        const shift = getNormalizedShift(op);
        total += kg;
        if (shift === 'Manhã') manha += kg;
        else tarde += kg;
      });

      return {
        dayName: d.dayName,
        shortDisplay: d.shortDisplay,
        dateStr: d.dateStr,
        manhaKg: manha,
        tardeKg: tarde,
        totalKg: total,
        osmCount: opsDay.length,
        metaDiaria: goals.dailyKg,
        isSelected: d.dateStr === selectedDate,
        isToday: d.dateStr === todayIso,
      };
    });

    const totalKgSemana = weekDaysData.reduce((acc, d) => acc + d.totalKg, 0);
    const totalManhaSemana = weekDaysData.reduce((acc, d) => acc + d.manhaKg, 0);
    const totalTardeSemana = weekDaysData.reduce((acc, d) => acc + d.tardeKg, 0);
    const totalOsmsSemana = weekDaysData.reduce((acc, d) => acc + d.osmCount, 0);

    // Média diária nos dias da semana que tiveram produção (ou mínimo 1)
    const activeDaysCount = weekDaysData.filter(d => d.totalKg > 0).length || 1;
    const mediaDiaria = Math.round(totalKgSemana / activeDaysCount);

    const metaSemanalPercent = goals.weeklyKg > 0 ? Math.min(Math.round((totalKgSemana / goals.weeklyKg) * 100), 999) : 0;

    // Dados da semana anterior para comparativo
    let totalKgSemanaAnterior = 0;
    const prevWeekDaysData = prevWeekInfo.days.map(d => {
      const opsDay = manipulacaoOps.filter(op => getOpDate(op) === d.dateStr && op.status === 'completed');
      const total = opsDay.reduce((acc, op) => acc + (Number(op.producedQuantity) || Number(op.plannedQuantity) || 0), 0);
      totalKgSemanaAnterior += total;
      return {
        dayName: d.dayName,
        totalKgPrev: total,
      };
    });

    let variacaoSemanaAnterior = 0;
    if (totalKgSemanaAnterior > 0) {
      variacaoSemanaAnterior = ((totalKgSemana - totalKgSemanaAnterior) / totalKgSemanaAnterior) * 100;
    }

    // Gráfico comparativo: Semana Atual vs Semana Anterior lado a lado
    const comparativoSemanal = weekDaysData.map((d, index) => {
      return {
        dayName: d.dayName,
        semanaAtual: d.totalKg,
        semanaAnterior: prevWeekDaysData[index]?.totalKgPrev || 0,
      };
    });

    // Todas as OPs da semana
    const weekDatesSet = new Set(weekInfo.days.map(d => d.dateStr));
    const opsDaSemana = manipulacaoOps.filter(op => weekDatesSet.has(getOpDate(op)));

    return {
      weekDaysData,
      totalKgSemana,
      totalManhaSemana,
      totalTardeSemana,
      totalOsmsSemana,
      mediaDiaria,
      metaSemanalPercent,
      totalKgSemanaAnterior,
      variacaoSemanaAnterior,
      comparativoSemanal,
      opsDaSemana,
    };
  }, [manipulacaoOps, weekInfo, prevWeekInfo, goals.dailyKg, goals.weeklyKg, selectedDate, todayIso]);

  // ---------------- 3. TOP GRANÉIS / PRODUTOS MANIPULADOS ----------------
  const topProducts = useMemo(() => {
    // Agrupa por produto ou granel baseado no escopo ativo (dia ou semana)
    const targetOps = viewTab === 'daily' ? dailyData.opsDoDia : weeklyData.opsDaSemana;
    const map = new Map<string, { name: string; totalKg: number; osmCount: number }>();

    targetOps
      .filter(op => op.status === 'completed')
      .forEach(op => {
        const name = (op.product || op.granel || 'Granel Não Especificado').trim();
        const kg = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
        const curr = map.get(name) || { name, totalKg: 0, osmCount: 0 };
        curr.totalKg += kg;
        curr.osmCount++;
        map.set(name, curr);
      });

    const arr = Array.from(map.values()).sort((a, b) => b.totalKg - a.totalKg);
    return arr.slice(0, 6);
  }, [viewTab, dailyData.opsDoDia, weeklyData.opsDaSemana]);

  // ---------------- 4. TABELA DE DETALHE DE OSMS ----------------
  const displayedTableOps = useMemo(() => {
    const baseOps = tableScope === 'day' ? dailyData.opsDoDia : weeklyData.opsDaSemana;

    return baseOps.filter(op => {
      // Filtro de turno
      if (filterShift !== 'Todos') {
        const shift = getNormalizedShift(op);
        if (shift !== filterShift) return false;
      }

      // Filtro de busca por texto (número, produto, lote, granel)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNumber = (op.number || '').toLowerCase().includes(q);
        const matchProduct = (op.product || '').toLowerCase().includes(q);
        const matchLot = (op.lote || '').toLowerCase().includes(q);
        const matchGranel = (op.granel || '').toLowerCase().includes(q);
        if (!matchNumber && !matchProduct && !matchLot && !matchGranel) return false;
      }

      return true;
    });
  }, [tableScope, dailyData.opsDoDia, weeklyData.opsDaSemana, filterShift, searchQuery]);

  // ---------------- EXPORTAR CSV ----------------
  const handleExportCsv = () => {
    if (displayedTableOps.length === 0) return;

    const headers = ['Data', 'Turno', 'OSM', 'Produto/Granel', 'Lote', 'Indústria', 'Qtd Planejada (Kg)', 'Qtd Manipulada (Kg)', 'Status'];
    const rows = displayedTableOps.map(op => {
      const shift = getNormalizedShift(op);
      const planned = op.plannedQuantity || 0;
      const produced = op.producedQuantity || 0;
      return [
        getOpDate(op),
        shift,
        `"${op.number || ''}"`,
        `"${op.product || op.granel || ''}"`,
        `"${op.lote || ''}"`,
        `"${op.industria || 'Ybera'}"`,
        planned,
        produced,
        op.status === 'completed' ? 'Concluída' : 'Em Andamento',
      ].join(';');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `manipulacao_${tableScope === 'day' ? selectedDate : weekInfo.mondayIso + '_a_' + weekInfo.sundayIso}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full text-[#f4f4f5] flex flex-col font-sans space-y-6">
      
      {/* ---------------- BARRA DE TOPO DO DASHBOARD DE MANIPULAÇÃO ---------------- */}
      <div className="bg-[#121216] border border-[#27272a] p-4 sm:p-5 rounded-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-xl">
        {/* Título & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-400 shadow-inner shrink-0">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-white">
                Dashboard de Manipulação
              </h1>
              <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 shadow-sm flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                Produção Diária & Semanal
              </span>
            </div>
            <p className="text-xs text-[#a1a1aa] mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Granéis Industriais</span>
              <span>•</span>
              <span className="font-mono text-cyan-300 font-bold">Unidade: Quilogramas (Kg)</span>
              <span>•</span>
              <span className="text-[#71717a]">2 Turnos de Mistura (Manhã & Tarde)</span>
            </p>
          </div>
        </div>

        {/* Controles de Modo de Visualização e Configurações */}
        <div className="flex items-center gap-2 flex-wrap self-end lg:self-auto">
          {/* Sub-abas de Visualização */}
          <div className="bg-[#18181b] border border-[#27272a] p-1 rounded-xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewTab('integrated')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewTab === 'integrated'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#222228]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Visão Geral</span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('daily')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewTab === 'daily'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#222228]'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Diário</span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('weekly')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewTab === 'weekly'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#222228]'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Semanal</span>
            </button>
          </div>

          {/* Botão Configurar Metas */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTempDailyGoal(String(goals.dailyKg));
              setTempWeeklyGoal(String(goals.weeklyKg));
              setShowGoalModal(true);
            }}
            className="h-9 px-3 rounded-xl bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-cyan-300 hover:border-cyan-800/60 hover:bg-cyan-950/20 text-xs font-semibold flex items-center gap-1.5"
            title="Ajustar Metas Diária e Semanal"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Metas</span>
          </Button>

          {/* Botão Atualizar */}
          {onRefresh && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-9 w-9 p-0 rounded-xl bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
              title="Atualizar Dados"
            >
              <BarChart3 className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- NAVEGAÇÃO DE DIAS E SEMANAS ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Painel 1: Navegação Diária */}
        <div className="bg-[#121216] border border-[#27272a] p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              Data de Referência (Diária)
            </span>
            {selectedDate === todayIso && (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                Hoje
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevDay}
                className="w-8 h-8 rounded-lg bg-[#1a1a20] border border-[#2e2e36] hover:border-cyan-500/50 flex items-center justify-center text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                title="Dia anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSetToday}
                className="h-8 px-2.5 rounded-lg bg-[#1a1a20] border border-[#2e2e36] text-[11px] font-bold text-[#d4d4d8] hover:text-white hover:border-cyan-500/50 transition-colors cursor-pointer"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={handleNextDay}
                className="w-8 h-8 rounded-lg bg-[#1a1a20] border border-[#2e2e36] hover:border-cyan-500/50 flex items-center justify-center text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                title="Próximo dia"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="bg-[#18181b] border border-[#2e2e36] rounded-xl px-2.5 py-1 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
              />
            </div>
          </div>

          <div className="text-xs font-semibold text-cyan-300 capitalize truncate">
            {formattedDateTitle}
          </div>
        </div>

        {/* Painel 2: Navegação Semanal */}
        <div className="bg-[#121216] border border-[#27272a] p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-cyan-400" />
              Ciclo Produtivo Semanal
            </span>
            <span className="text-[10px] font-mono font-bold text-[#a1a1aa] bg-[#1a1a20] px-2 py-0.5 rounded border border-[#27272a]">
              Segunda a Domingo
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="w-8 h-8 rounded-lg bg-[#1a1a20] border border-[#2e2e36] hover:border-cyan-500/50 flex items-center justify-center text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                title="Semana anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSetToday}
                className="h-8 px-2.5 rounded-lg bg-[#1a1a20] border border-[#2e2e36] text-[11px] font-bold text-[#d4d4d8] hover:text-white hover:border-cyan-500/50 transition-colors cursor-pointer"
              >
                Semana Atual
              </button>
              <button
                type="button"
                onClick={handleNextWeek}
                className="w-8 h-8 rounded-lg bg-[#1a1a20] border border-[#2e2e36] hover:border-cyan-500/50 flex items-center justify-center text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                title="Próxima semana"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="text-right">
              <span className="text-xs font-bold text-white block">
                {weekInfo.label}
              </span>
            </div>
          </div>

          {/* Mini Seletor Visual dos 7 Dias da Semana */}
          <div className="grid grid-cols-7 gap-1 pt-1">
            {weekInfo.days.map((d) => {
              const isSelected = d.dateStr === selectedDate;
              const isToday = d.dateStr === todayIso;
              return (
                <button
                  key={d.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(d.dateStr)}
                  className={`py-1 px-0.5 rounded-lg text-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-600 text-white font-extrabold shadow-sm'
                      : isToday
                      ? 'bg-[#1e1e26] text-cyan-300 border border-cyan-800/50 font-bold'
                      : 'bg-[#18181b] text-[#a1a1aa] hover:text-white hover:bg-[#222228]'
                  }`}
                  title={`${d.dayName} (${d.shortDisplay})`}
                >
                  <div className="text-[9px] uppercase leading-none">{d.dayName}</div>
                  <div className="text-[10px] font-mono mt-0.5">{d.shortDisplay.split('/')[0]}</div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* ---------------- CARDS DE KPIS DE PRODUÇÃO (DIÁRIO & SEMANAL) ---------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* KPI 1: Produção Diária (Kg) */}
        <div className="bg-[#121216] border border-[#27272a] hover:border-cyan-500/40 p-5 rounded-2xl shadow-lg transition-all relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition-all pointer-events-none" />
          
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              Produção Diária
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 font-bold">
              {dailyData.metaPercent}% da meta
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-baseline gap-1.5 font-mono">
            <span>{dailyData.totalKg.toLocaleString('pt-BR')}</span>
            <span className="text-sm font-bold text-cyan-400">Kg</span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#222228] flex items-center justify-between text-xs">
            <span className="text-[#71717a]">Meta: {goals.dailyKg.toLocaleString('pt-BR')} Kg</span>
            {dailyData.variacaoOntem !== 0 && (
              <span className={`flex items-center font-bold font-mono ${dailyData.variacaoOntem > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dailyData.variacaoOntem > 0 ? (
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                )}
                {Math.abs(Math.round(dailyData.variacaoOntem))}% vs ontem
              </span>
            )}
          </div>

          {/* Barra de Progresso da Meta Diária */}
          <div className="w-full h-1.5 bg-[#222228] rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(dailyData.metaPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* KPI 2: Produção Semanal Acumulada (Kg) */}
        <div className="bg-[#121216] border border-[#27272a] hover:border-cyan-500/40 p-5 rounded-2xl shadow-lg transition-all relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all pointer-events-none" />
          
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-blue-400" />
              Produção Semanal
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40 font-bold">
              {weeklyData.metaSemanalPercent}% da meta
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-baseline gap-1.5 font-mono">
            <span>{weeklyData.totalKgSemana.toLocaleString('pt-BR')}</span>
            <span className="text-sm font-bold text-blue-400">Kg</span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#222228] flex items-center justify-between text-xs">
            <span className="text-[#71717a]">Meta: {goals.weeklyKg.toLocaleString('pt-BR')} Kg</span>
            {weeklyData.variacaoSemanaAnterior !== 0 && (
              <span className={`flex items-center font-bold font-mono ${weeklyData.variacaoSemanaAnterior > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {weeklyData.variacaoSemanaAnterior > 0 ? (
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                )}
                {Math.abs(Math.round(weeklyData.variacaoSemanaAnterior))}% vs sem. ant.
              </span>
            )}
          </div>

          {/* Barra de Progresso da Meta Semanal */}
          <div className="w-full h-1.5 bg-[#222228] rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(weeklyData.metaSemanalPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* KPI 3: Produção por Turnos (Manhã vs Tarde) */}
        <div className="bg-[#121216] border border-[#27272a] hover:border-cyan-500/40 p-5 rounded-2xl shadow-lg transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Turnos ({viewTab === 'daily' ? 'Hoje' : 'Semana'})
            </span>
          </div>

          {/* Comparativo de Volume dos Turnos */}
          <div className="space-y-2 mt-1">
            {/* 1º Turno (Manhã) */}
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-blue-300 font-bold">
                <Sun className="w-3.5 h-3.5 text-blue-400" />
                1º Turno (Manhã)
              </span>
              <span className="font-mono font-bold text-white">
                {(viewTab === 'daily' ? dailyData.manhaKg : weeklyData.totalManhaSemana).toLocaleString('pt-BR')} Kg
              </span>
            </div>

            {/* 2º Turno (Tarde) */}
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-amber-300 font-bold">
                <Moon className="w-3.5 h-3.5 text-amber-400" />
                2º Turno (Tarde)
              </span>
              <span className="font-mono font-bold text-white">
                {(viewTab === 'daily' ? dailyData.tardeKg : weeklyData.totalTardeSemana).toLocaleString('pt-BR')} Kg
              </span>
            </div>
          </div>

          {/* Barra bipartida visual de divisão */}
          {(() => {
            const m = viewTab === 'daily' ? dailyData.manhaKg : weeklyData.totalManhaSemana;
            const t = viewTab === 'daily' ? dailyData.tardeKg : weeklyData.totalTardeSemana;
            const sum = m + t;
            const mPercent = sum > 0 ? Math.round((m / sum) * 100) : 50;
            const tPercent = sum > 0 ? 100 - mPercent : 50;

            return (
              <div className="mt-3">
                <div className="w-full h-2 rounded-full overflow-hidden flex bg-[#222228]">
                  <div style={{ width: `${mPercent}%` }} className="bg-blue-500 transition-all duration-500" title={`Manhã: ${mPercent}%`} />
                  <div style={{ width: `${tPercent}%` }} className="bg-amber-500 transition-all duration-500" title={`Tarde: ${tPercent}%`} />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#71717a] mt-1">
                  <span>{mPercent}% Manhã</span>
                  <span>{tPercent}% Tarde</span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* KPI 4: OSMs Finalizadas & Média Diária */}
        <div className="bg-[#121216] border border-[#27272a] hover:border-cyan-500/40 p-5 rounded-2xl shadow-lg transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              OSMs Concluídas
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-2xl sm:text-3xl font-black text-white tracking-tight font-mono">
              {viewTab === 'daily' ? dailyData.completedCount : weeklyData.totalOsmsSemana}
            </div>
            <span className="text-xs text-[#a1a1aa]">
              {viewTab === 'daily' ? 'ordens hoje' : 'ordens na semana'}
            </span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#222228] space-y-1 text-xs">
            <div className="flex items-center justify-between text-[#a1a1aa]">
              <span>Média da Semana:</span>
              <span className="font-mono font-bold text-white">{weeklyData.mediaDiaria.toLocaleString('pt-BR')} Kg/dia</span>
            </div>
            <div className="flex items-center justify-between text-[#a1a1aa]">
              <span>Em Andamento:</span>
              <span className="font-mono font-bold text-cyan-300">{dailyData.inProgressCount} nos reatores</span>
            </div>
          </div>
        </div>

      </div>

      {/* ---------------- SEÇÃO PRINCIPAL DE GRÁFICOS RECHARTS ---------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* GRÁFICO 1: EVOLUÇÃO DIÁRIA DA SEMANA (SEGUNDA A DOMINGO) (2 COLUNAS) */}
        <div className="lg:col-span-2 bg-[#121216] border border-[#27272a] p-5 rounded-2xl shadow-xl flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#222228]">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                <span>Produção Diária da Semana (Kg)</span>
              </h3>
              <p className="text-xs text-[#a1a1aa] mt-0.5">
                Volume manipulado por turno de Segunda a Domingo · Meta de {goals.dailyKg.toLocaleString('pt-BR')} Kg/dia
              </p>
            </div>

            {/* Legenda rápida */}
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-[#a1a1aa]">1º Turno (Manhã)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-500" />
                <span className="text-[#a1a1aa]">2º Turno (Tarde)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-emerald-400 border-dashed" />
                <span className="text-emerald-400">Meta</span>
              </div>
            </div>
          </div>

          {/* Componente Recharts */}
          <div className="w-full h-72 sm:h-80 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weeklyData.weekDaysData}
                margin={{ top: 15, right: 15, left: -10, bottom: 5 }}
                onClick={(e: any) => {
                  if (e && e.activePayload && e.activePayload.length > 0) {
                    const clickedDate = e.activePayload[0].payload.dateStr;
                    if (clickedDate) setSelectedDate(clickedDate);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#222228" vertical={false} />
                <XAxis
                  dataKey="dayName"
                  stroke="#71717a"
                  tick={{ fill: '#a1a1aa', fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const total = data.manhaKg + data.tardeKg;
                      const percentMeta = goals.dailyKg > 0 ? Math.round((total / goals.dailyKg) * 100) : 0;
                      return (
                        <div className="bg-[#18181f] border border-[#2e2e38] p-3 rounded-xl shadow-2xl text-xs font-sans min-w-[200px]">
                          <div className="font-bold text-white border-b border-[#2a2a34] pb-1.5 mb-2 flex items-center justify-between">
                            <span>{label} ({data.shortDisplay})</span>
                            {data.isToday && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-mono">
                                Hoje
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5 font-mono">
                            <div className="flex items-center justify-between text-blue-300">
                              <span className="flex items-center gap-1.5 font-sans">
                                <Sun className="w-3 h-3 text-blue-400" /> Manhã:
                              </span>
                              <span className="font-bold">{data.manhaKg.toLocaleString('pt-BR')} Kg</span>
                            </div>
                            <div className="flex items-center justify-between text-amber-300">
                              <span className="flex items-center gap-1.5 font-sans">
                                <Moon className="w-3 h-3 text-amber-400" /> Tarde:
                              </span>
                              <span className="font-bold">{data.tardeKg.toLocaleString('pt-BR')} Kg</span>
                            </div>
                            <div className="pt-1.5 border-t border-[#2a2a34] flex items-center justify-between text-white font-bold">
                              <span className="font-sans">Total do Dia:</span>
                              <span className="text-cyan-300">{total.toLocaleString('pt-BR')} Kg</span>
                            </div>
                            <div className="flex items-center justify-between text-emerald-400 text-[11px]">
                              <span className="font-sans">Atingimento Meta:</span>
                              <span>{percentMeta}%</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-[#71717a] mt-2 pt-1 border-t border-[#222228] text-center italic">
                            Clique para selecionar este dia
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={goals.dailyKg}
                  stroke="#10b981"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
                <Bar
                  dataKey="manhaKg"
                  name="1º Turno (Manhã)"
                  stackId="a"
                  fill="#3b82f6"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="tardeKg"
                  name="2º Turno (Tarde)"
                  stackId="a"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="text-center text-[11px] text-[#71717a] pt-2 border-t border-[#222228]">
            Dica: Clique em qualquer dia no gráfico para selecioná-lo e analisar o detalhe na tabela abaixo.
          </div>
        </div>

        {/* GRÁFICO 2: COMPARATIVO SEMANAL & TOP GRANÉIS (1 COLUNA) */}
        <div className="bg-[#121216] border border-[#27272a] p-5 rounded-2xl shadow-xl flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#222228]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>Semana Atual vs Anterior</span>
              </h3>
            </div>
            <p className="text-xs text-[#a1a1aa] mt-1">
              Ritmo de produção diário comparado com a semana passada
            </p>

            {/* Mini Gráfico de Barras Lado a Lado */}
            <div className="w-full h-44 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={weeklyData.comparativoSemanal}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#222228" vertical={false} />
                  <XAxis dataKey="dayName" stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const atual = payload[0]?.value as number || 0;
                        const anterior = payload[1]?.value as number || 0;
                        return (
                          <div className="bg-[#18181f] border border-[#2e2e38] p-2.5 rounded-xl shadow-xl text-xs font-mono">
                            <div className="font-bold text-white font-sans border-b border-[#27272a] pb-1 mb-1.5">{label}</div>
                            <div className="text-cyan-400">Atual: {atual.toLocaleString('pt-BR')} Kg</div>
                            <div className="text-[#a1a1aa]">Anterior: {anterior.toLocaleString('pt-BR')} Kg</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="semanaAtual" name="Semana Atual" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="semanaAnterior" name="Semana Anterior" fill="#52525b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ranking Top Granéis */}
          <div className="pt-3 border-t border-[#222228]">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] flex items-center justify-between mb-2">
              <span>Top Granéis Manipulados ({viewTab === 'daily' ? 'Hoje' : 'Semana'})</span>
              <span className="text-cyan-400 font-mono text-[10px]">Volume (Kg)</span>
            </span>

            {topProducts.length === 0 ? (
              <div className="text-center py-4 text-xs text-[#71717a]">
                Nenhum granel concluído no período selecionado.
              </div>
            ) : (
              <div className="space-y-2">
                {topProducts.slice(0, 4).map((item, idx) => {
                  const maxKg = topProducts[0]?.totalKg || 1;
                  const barPercent = Math.round((item.totalKg / maxKg) * 100);
                  return (
                    <div key={item.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-white truncate max-w-[170px]" title={item.name}>
                          {idx + 1}. {item.name}
                        </span>
                        <span className="font-mono font-bold text-cyan-300">
                          {item.totalKg.toLocaleString('pt-BR')} Kg
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#222228] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 rounded-full"
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ---------------- TABELA DETALHADA DE ORDENS DE SERVIÇO (OSMS) ---------------- */}
      <div className="bg-[#121216] border border-[#27272a] rounded-2xl overflow-hidden shadow-xl">
        
        {/* Cabeçalho da Tabela com Filtros */}
        <div className="p-4 sm:p-5 border-b border-[#222228] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#141418]">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
              <span>Ordens de Serviço de Manipulação (OSMs)</span>
            </h3>
            <p className="text-xs text-[#a1a1aa] mt-0.5">
              Rastreabilidade individual de lotes, produtos e volumes manipulados
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
            {/* Escopo: Dia ou Semana */}
            <div className="bg-[#18181b] border border-[#27272a] p-1 rounded-xl flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTableScope('day')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tableScope === 'day'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                Dia ({dailyData.opsDoDia.length})
              </button>
              <button
                type="button"
                onClick={() => setTableScope('week')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tableScope === 'week'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                Semana ({weeklyData.opsDaSemana.length})
              </button>
            </div>

            {/* Filtro de Turno */}
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value as any)}
              className="h-9 bg-[#18181b] border border-[#27272a] text-xs font-bold text-white rounded-xl px-2.5 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="Todos">Todos os Turnos</option>
              <option value="Manhã">1º Turno (Manhã)</option>
              <option value="Tarde">2º Turno (Tarde)</option>
            </select>

            {/* Campo de Busca */}
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar OSM, lote..."
                className="w-full h-9 bg-[#18181b] border border-[#27272a] rounded-xl pl-8 pr-3 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Botão Exportar CSV */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCsv}
              disabled={displayedTableOps.length === 0}
              className="h-9 px-3 rounded-xl bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] text-xs font-semibold flex items-center gap-1.5"
              title="Exportar dados da tabela em formato CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
          </div>
        </div>

        {/* Tabela de Dados */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#18181f] text-[#a1a1aa] uppercase font-bold text-[10px] tracking-wider border-b border-[#222228]">
              <tr>
                <th className="py-3 px-4">Data & Turno</th>
                <th className="py-3 px-4">OSM #</th>
                <th className="py-3 px-4">Produto / Granel</th>
                <th className="py-3 px-4">Lote</th>
                <th className="py-3 px-4">Indústria</th>
                <th className="py-3 px-4 text-right">Planejado (Kg)</th>
                <th className="py-3 px-4 text-right">Manipulado (Kg)</th>
                <th className="py-3 px-4 text-center">Eficiência</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222228]">
              {displayedTableOps.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#71717a]">
                    <AlertCircle className="w-8 h-8 text-[#3f3f46] mx-auto mb-2" />
                    <span className="text-sm font-bold block text-[#a1a1aa]">Nenhuma OSM encontrada</span>
                    <span className="text-xs">
                      {tableScope === 'day'
                        ? `Não há registros de manipulação para o dia ${selectedDate}.`
                        : `Não há registros para o período da ${weekInfo.label}.`}
                    </span>
                  </td>
                </tr>
              ) : (
                displayedTableOps.map((op) => {
                  const shift = getNormalizedShift(op);
                  const planned = Number(op.plannedQuantity) || 0;
                  const produced = Number(op.producedQuantity) || 0;
                  const percent = planned > 0 ? Math.round((produced / planned) * 100) : 100;
                  const isFinished = op.status === 'completed';

                  return (
                    <tr key={op.id} className="hover:bg-[#181820] transition-colors">
                      {/* Data & Turno */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-white font-mono">{getOpDate(op)}</div>
                        <div className="flex items-center gap-1 text-[11px] mt-0.5">
                          {shift === 'Manhã' ? (
                            <span className="text-blue-400 flex items-center gap-1 font-semibold">
                              <Sun className="w-3 h-3" /> 1º Turno (Manhã)
                            </span>
                          ) : (
                            <span className="text-amber-400 flex items-center gap-1 font-semibold">
                              <Moon className="w-3 h-3" /> 2º Turno (Tarde)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* OSM # */}
                      <td className="py-3 px-4 font-mono font-bold text-cyan-300">
                        {op.number || 'S/N'}
                      </td>

                      {/* Produto / Granel */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-white max-w-xs truncate" title={op.product}>
                          {op.product}
                        </div>
                        {op.granel && op.granel !== op.product && (
                          <div className="text-[11px] text-[#a1a1aa] truncate max-w-xs">
                            {op.granel}
                          </div>
                        )}
                      </td>

                      {/* Lote */}
                      <td className="py-3 px-4 font-mono text-[#d4d4d8]">
                        {op.lote || '-'}
                      </td>

                      {/* Indústria */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#27272a] text-[#d4d4d8] border border-[#3f3f46]">
                          {op.industria || 'Ybera'}
                        </span>
                      </td>

                      {/* Planejado */}
                      <td className="py-3 px-4 text-right font-mono text-[#a1a1aa]">
                        {planned.toLocaleString('pt-BR')} Kg
                      </td>

                      {/* Manipulado */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        <span className="text-cyan-300">{produced.toLocaleString('pt-BR')}</span> Kg
                      </td>

                      {/* Eficiência */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                            percent >= 100
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                              : percent >= 90
                              ? 'bg-blue-950 text-blue-300 border border-blue-800/60'
                              : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                          }`}
                        >
                          {percent}%
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center">
                        {isFinished ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Concluída
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 animate-pulse" /> Em Andamento
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé com Resumo */}
        <div className="p-3 sm:p-4 bg-[#141418] border-t border-[#222228] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#a1a1aa]">
          <div>
            Mostrando <strong>{displayedTableOps.length}</strong> ordens de serviço
          </div>
          <div className="flex items-center gap-4 font-mono font-bold">
            <span>
              Total Manipulado: <strong className="text-cyan-300">
                {displayedTableOps.reduce((acc, op) => acc + (Number(op.producedQuantity) || 0), 0).toLocaleString('pt-BR')} Kg
              </strong>
            </span>
          </div>
        </div>

      </div>

      {/* ---------------- MODAL DE CONFIGURAÇÃO DE METAS ---------------- */}
      {showGoalModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowGoalModal(false);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-[#121216] border border-cyan-800/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="p-4 sm:p-5 border-b border-[#222228] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Metas de Manipulação</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGoalModal(false)}
                className="text-[#71717a] hover:text-white p-1 rounded-lg hover:bg-[#1f1f28] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveGoals} className="p-5 space-y-4">
              <p className="text-xs text-[#a1a1aa]">
                Defina os objetivos de produção de granel para a área de manipulação. Estas metas serão refletidas em todos os gráficos e indicadores de desempenho.
              </p>

              <div>
                <label className="text-xs font-bold text-white block mb-1">
                  Meta Diária (Kg)
                </label>
                <input
                  type="number"
                  value={tempDailyGoal}
                  onChange={(e) => setTempDailyGoal(e.target.value)}
                  className="w-full h-10 bg-[#18181b] border border-[#2e2e38] rounded-xl px-3 text-sm text-white font-mono font-bold focus:outline-none focus:border-cyan-500"
                  placeholder="Ex: 10000"
                  min={100}
                  required
                />
                <span className="text-[10px] text-[#71717a] mt-1 block">
                  Meta padrão sugerida: 10.000 Kg por dia
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-white block mb-1">
                  Meta Semanal (Kg)
                </label>
                <input
                  type="number"
                  value={tempWeeklyGoal}
                  onChange={(e) => setTempWeeklyGoal(e.target.value)}
                  className="w-full h-10 bg-[#18181b] border border-[#2e2e38] rounded-xl px-3 text-sm text-white font-mono font-bold focus:outline-none focus:border-cyan-500"
                  placeholder="Ex: 50000"
                  min={500}
                  required
                />
                <span className="text-[10px] text-[#71717a] mt-1 block">
                  Meta padrão sugerida: 50.000 Kg por semana (5 dias úteis)
                </span>
              </div>

              <div className="pt-3 border-t border-[#222228] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGoalModal(false)}
                  className="h-9 px-3.5 text-xs text-[#a1a1aa] hover:text-white rounded-xl hover:bg-[#1a1a24] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-lg shadow-cyan-950/50 transition-all cursor-pointer"
                >
                  Salvar Metas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
