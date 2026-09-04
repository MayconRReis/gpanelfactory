import React, { useState, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Package,
  Layers,
  Sparkles,
  Clock,
  CheckCircle2,
  Filter,
  Search,
  Download,
  AlertCircle,
  FileSpreadsheet,
  Sun,
  Moon,
  FlaskConical,
  Scale,
  CalendarDays,
  Hash,
  UserCheck,
  Tag
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
import { ProductionOrder, ProductionLine, UserProfile, MonthlyGoal, ProductionEvent } from '../types';

interface DailyProductionHistoryProps {
  ops: ProductionOrder[];
  lines?: ProductionLine[];
  leaders?: UserProfile[];
  goals?: MonthlyGoal[];
  events?: ProductionEvent[];
  initialDate?: string; // Formato YYYY-MM-DD
  defaultSectorFilter?: 'Todos' | 'Envase' | 'Pesagem' | 'Manipulação';
  defaultDailyChartMode?: 'turno' | 'setor' | 'total' | 'osms' | 'volume';
  pesagemOnly?: boolean;
}

/**
 * Identifica se a ordem de produção pertence ao setor de Pesagem
 */
export function isPesagemOp(op: ProductionOrder): boolean {
  return (
    op.setor === 'Pesagem' ||
    op.tipoDocumento === 'OSM' ||
    (Boolean(op.number) && String(op.number).startsWith('300')) ||
    (Boolean(op.lineId) && String(op.lineId).toLowerCase().includes('pesagem'))
  );
}

/**
 * Função utilitária para extrair a data YYYY-MM-DD relevante da OP:
 * Prioriza completedAt (se concluída), scheduledDate ou createdAt.
 */
export function getOpDateString(op: ProductionOrder): string {
  if (op.completedAt) {
    return op.completedAt.split('T')[0];
  }
  if (op.scheduledDate && op.scheduledDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return op.scheduledDate;
  }
  if (op.createdAt) {
    return op.createdAt.split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Retorna string YYYY-MM-DD a partir de um objeto Date local
 */
export function formatDateToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DailyProductionHistory({
  ops,
  lines = [],
  leaders = [],
  goals = [],
  events = [],
  initialDate,
  defaultSectorFilter,
  defaultDailyChartMode,
  pesagemOnly = false,
}: DailyProductionHistoryProps) {
  // Data selecionada para o histórico diário
  const todayIso = useMemo(() => formatDateToIso(new Date()), []);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayIso);

  // Sub-abas do módulo: 'integrated' (Visão completa) | 'table' (Só Histórico) | 'daily_chart' | 'monthly_chart'
  const [activeView, setActiveView] = useState<'integrated' | 'table' | 'daily_chart' | 'monthly_chart'>('integrated');

  // Filtros da Tabela do Histórico Diário
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<'Todos' | 'Envase' | 'Pesagem' | 'Manipulação'>(
    pesagemOnly ? 'Pesagem' : (defaultSectorFilter || 'Todos')
  );
  const [shiftFilter, setShiftFilter] = useState<'Todos' | '1º Turno' | '2º Turno'>('Todos');
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'completed' | 'in_progress'>('Todos');

  // Determina se estamos em modo Pesagem exclusivo ou filtrado
  const isPesagemMode = pesagemOnly || sectorFilter === 'Pesagem';

  // Modo do gráfico diário: 'turno' | 'setor' | 'total' | 'osms' | 'volume'
  const [dailyChartMode, setDailyChartMode] = useState<'turno' | 'setor' | 'total' | 'osms' | 'volume'>(
    defaultDailyChartMode || (isPesagemMode ? 'osms' : 'turno')
  );

  // Mês / Ano atual baseados na data selecionada
  const { selectedYear, selectedMonthIndex, selectedDayNum } = useMemo(() => {
    const parts = selectedDate.split('-');
    if (parts.length === 3) {
      return {
        selectedYear: parseInt(parts[0], 10),
        selectedMonthIndex: parseInt(parts[1], 10) - 1,
        selectedDayNum: parseInt(parts[2], 10),
      };
    }
    const d = new Date();
    return {
      selectedYear: d.getFullYear(),
      selectedMonthIndex: d.getMonth(),
      selectedDayNum: d.getDate(),
    };
  }, [selectedDate]);

  // Navegação de datas
  const handlePrevDay = () => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() - 1);
    setSelectedDate(formatDateToIso(dateObj));
  };

  const handleNextDay = () => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + 1);
    setSelectedDate(formatDateToIso(dateObj));
  };

  const handleSetToday = () => {
    setSelectedDate(todayIso);
  };

  // Texto amigável da data selecionada
  const formattedDateTitle = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      return dateObj.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const isToday = selectedDate === todayIso;

  // Mapa de nomes de líderes
  const leaderMap = useMemo(() => {
    const map = new Map<string, string>();
    leaders.forEach(l => {
      map.set(l.uid, l.name);
    });
    return map;
  }, [leaders]);

  // Mapa de nomes de linhas
  const lineMap = useMemo(() => {
    const map = new Map<string, string>();
    lines.forEach(l => {
      map.set(l.id, l.name);
    });
    return map;
  }, [lines]);

  // ---------------- 1. DADOS DE TODAS AS OPS NO DIA SELECIONADO ----------------
  const opsOfDay = useMemo(() => {
    return ops.filter((op) => {
      // Data associada à OP
      const opDate = getOpDateString(op);
      if (opDate !== selectedDate) return false;

      // Ter alguma quantidade produzida ou planejada
      return (Number(op.producedQuantity) > 0 || Number(op.plannedQuantity) > 0 || op.status === 'completed' || op.status === 'in_progress');
    });
  }, [ops, selectedDate]);

  // Totais e KPIs do dia selecionado
  const dailySummary = useMemo(() => {
    let totalProducedEnvase = 0; // Un
    let totalProducedPesagem = 0; // Kg
    let totalProducedManipulacao = 0; // Kg
    let totalTurno1 = 0;
    let totalTurno2 = 0;
    let completedCount = 0;
    let inProgressCount = 0;

    for (const op of opsOfDay) {
      const qty = Number(op.producedQuantity) || 0;
      const setor = op.setor || 'Envase';
      const shift = (op.finishedShift || op.scheduledShift || '').toLowerCase();

      if (setor === 'Pesagem') {
        totalProducedPesagem += qty;
      } else if (setor === 'Manipulação') {
        totalProducedManipulacao += qty;
      } else {
        totalProducedEnvase += qty;
      }

      if (shift.includes('2') || shift.includes('tarde') || shift.includes('noite')) {
        totalTurno2 += qty;
      } else {
        totalTurno1 += qty;
      }

      if (op.status === 'completed') {
        completedCount++;
      } else if (op.status === 'in_progress') {
        inProgressCount++;
      }
    }

    return {
      totalOpsCount: opsOfDay.length,
      completedCount,
      inProgressCount,
      totalProducedEnvase,
      totalProducedPesagem,
      totalProducedManipulacao,
      totalTurno1,
      totalTurno2,
    };
  }, [opsOfDay]);

  // ---------------- 1.1 DADOS EXCLUSIVOS DE PESAGEM (DIA, MÊS E ANO) ----------------
  const pesagemOpsOfDay = useMemo(() => {
    return opsOfDay.filter(isPesagemOp);
  }, [opsOfDay]);

  // Quantidade de OSMs e total Kg adicionados naquele dia
  const pesagemDailyStats = useMemo(() => {
    let count = pesagemOpsOfDay.length;
    let totalKg = 0;
    let turno1Count = 0;
    let turno1Kg = 0;
    let turno2Count = 0;
    let turno2Kg = 0;
    let completedCount = 0;

    for (const op of pesagemOpsOfDay) {
      const qty = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
      totalKg += qty;
      const shift = (op.finishedShift || op.scheduledShift || '').toLowerCase();
      const isT2 = shift.includes('2') || shift.includes('tarde') || shift.includes('noite');
      if (isT2) {
        turno2Count++;
        turno2Kg += qty;
      } else {
        turno1Count++;
        turno1Kg += qty;
      }
      if (op.status === 'completed') {
        completedCount++;
      }
    }

    return {
      count,
      totalKg,
      turno1Count,
      turno1Kg,
      turno2Count,
      turno2Kg,
      completedCount,
    };
  }, [pesagemOpsOfDay]);

  // Total de OSMs e total Kg adicionados no mês selecionado
  const pesagemMonthStats = useMemo(() => {
    let count = 0;
    let totalKg = 0;
    const distinctDays = new Set<number>();
    let turno1Kg = 0;
    let turno2Kg = 0;

    for (const op of ops) {
      if (!isPesagemOp(op)) continue;
      const dateStr = getOpDateString(op);
      const parts = dateStr.split('-');
      if (parts.length !== 3) continue;

      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);

      if (y === selectedYear && m === selectedMonthIndex) {
        count++;
        const qty = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
        totalKg += qty;
        distinctDays.add(d);

        const shift = (op.finishedShift || op.scheduledShift || '').toLowerCase();
        if (shift.includes('2') || shift.includes('tarde') || shift.includes('noite')) {
          turno2Kg += qty;
        } else {
          turno1Kg += qty;
        }
      }
    }

    return {
      count,
      totalKg,
      distinctDaysCount: distinctDays.size,
      avgKgPerDay: distinctDays.size > 0 ? Math.round(totalKg / distinctDays.size) : 0,
      turno1Kg,
      turno2Kg,
    };
  }, [ops, selectedYear, selectedMonthIndex]);

  // Total de OSMs e total Kg adicionados no ano selecionado
  const pesagemYearStats = useMemo(() => {
    let count = 0;
    let totalKg = 0;
    const distinctMonths = new Set<number>();

    for (const op of ops) {
      if (!isPesagemOp(op)) continue;
      const dateStr = getOpDateString(op);
      const parts = dateStr.split('-');
      if (parts.length !== 3) continue;

      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;

      if (y === selectedYear) {
        count++;
        const qty = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
        totalKg += qty;
        distinctMonths.add(m);
      }
    }

    return {
      count,
      totalKg,
      distinctMonthsCount: distinctMonths.size,
      avgOsmPerMonth: distinctMonths.size > 0 ? (count / distinctMonths.size).toFixed(1) : '0',
    };
  }, [ops, selectedYear]);

  // Filtragem da tabela do histórico diário
  const filteredOpsOfDay = useMemo(() => {
    return opsOfDay.filter((op) => {
      // Se estiver em modo pesagem restrito, só aceita pesagem
      if (pesagemOnly && !isPesagemOp(op)) {
        return false;
      }

      // 1. Busca textual (OP, Produto, Lote)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchNumber = op.number?.toLowerCase().includes(query);
        const matchProduct = op.product?.toLowerCase().includes(query);
        const matchLot = op.lote?.toLowerCase().includes(query);
        const matchObs = op.observation?.toLowerCase().includes(query);
        if (!matchNumber && !matchProduct && !matchLot && !matchObs) {
          return false;
        }
      }

      // 2. Filtro por Setor
      if (sectorFilter !== 'Todos') {
        const opSetor = op.setor || (isPesagemOp(op) ? 'Pesagem' : 'Envase');
        if (opSetor !== sectorFilter) return false;
      }

      // 3. Filtro por Turno
      if (shiftFilter !== 'Todos') {
        const shift = (op.finishedShift || op.scheduledShift || '').toLowerCase();
        const isT2 = shift.includes('2') || shift.includes('tarde') || shift.includes('noite');
        if (shiftFilter === '2º Turno' && !isT2) return false;
        if (shiftFilter === '1º Turno' && isT2) return false;
      }

      // 4. Filtro por Status
      if (statusFilter !== 'Todos') {
        if (op.status !== statusFilter) return false;
      }

      return true;
    });
  }, [opsOfDay, pesagemOnly, searchQuery, sectorFilter, shiftFilter, statusFilter]);

  // ---------------- 2. DADOS PARA O GRÁFICO DE PRODUÇÃO DIÁRIA (MÊS SELECIONADO) ----------------
  const daysInSelectedMonth = useMemo(() => {
    return new Date(selectedYear, selectedMonthIndex + 1, 0).getDate();
  }, [selectedYear, selectedMonthIndex]);

  // Meta mensal para o mês e diária
  const monthGoal = useMemo(() => {
    if (goals && goals.length > 0) {
      const found = goals.filter(g => g.year === selectedYear && g.month === (selectedMonthIndex + 1));
      if (found.length > 0) {
        return found.reduce((acc, g) => acc + (g.goalQuantity || 0), 0);
      }
    }
    const saved = localStorage.getItem('gpanel_monthly_goal');
    return saved ? parseInt(saved, 10) : 100000;
  }, [goals, selectedYear, selectedMonthIndex]);

  const dailyGoalValue = useMemo(() => {
    return Math.round(monthGoal / Math.max(1, daysInSelectedMonth));
  }, [monthGoal, daysInSelectedMonth]);

  const dailyChartData = useMemo(() => {
    const map = new Map<number, {
      day: number;
      label: string;
      dateIso: string;
      isCurrentSelection: boolean;
      turno1: number;
      turno2: number;
      envase: number;
      pesagem: number;
      manipulacao: number;
      total: number;
      osms: number;
      pesagemKg: number;
      turno1Osm: number;
      turno2Osm: number;
      turno1PesagemKg: number;
      turno2PesagemKg: number;
    }>();

    for (let i = 1; i <= daysInSelectedMonth; i++) {
      const dateStr = `${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      map.set(i, {
        day: i,
        label: `${i}`,
        dateIso: dateStr,
        isCurrentSelection: i === selectedDayNum,
        turno1: 0,
        turno2: 0,
        envase: 0,
        pesagem: 0,
        manipulacao: 0,
        total: 0,
        osms: 0,
        pesagemKg: 0,
        turno1Osm: 0,
        turno2Osm: 0,
        turno1PesagemKg: 0,
        turno2PesagemKg: 0,
      });
    }

    for (const op of ops) {
      const qty = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
      if (qty <= 0 && op.status !== 'completed') continue;

      const dateStr = getOpDateString(op);
      const parts = dateStr.split('-');
      if (parts.length !== 3) continue;

      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);

      if (y === selectedYear && m === selectedMonthIndex && map.has(d)) {
        const item = map.get(d)!;
        const isPesagem = isPesagemOp(op);
        const setor = op.setor || (isPesagem ? 'Pesagem' : 'Envase');
        const shift = (op.finishedShift || op.scheduledShift || '').toLowerCase();
        const isT2 = shift.includes('2') || shift.includes('tarde') || shift.includes('noite');

        if (isT2) {
          item.turno2 += qty;
        } else {
          item.turno1 += qty;
        }

        if (isPesagem || setor === 'Pesagem') {
          item.pesagem += qty;
          item.osms += 1;
          item.pesagemKg += qty;
          if (isT2) {
            item.turno2Osm += 1;
            item.turno2PesagemKg += qty;
          } else {
            item.turno1Osm += 1;
            item.turno1PesagemKg += qty;
          }
        } else if (setor === 'Manipulação') {
          item.manipulacao += qty;
        } else {
          item.envase += qty;
        }

        item.total += qty;
      }
    }

    return Array.from(map.values());
  }, [ops, selectedYear, selectedMonthIndex, daysInSelectedMonth, selectedDayNum]);

  // ---------------- 3. DADOS PARA O GRÁFICO DE PRODUÇÃO MENSAL (12 MESES) ----------------
  const monthlyChartData = useMemo(() => {
    const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const result = monthLabels.map((label, idx) => ({
      month: idx,
      monthName: label,
      envase: 0,
      pesagem: 0,
      manipulacao: 0,
      realizado: 0,
      meta: monthGoal,
      isCurrent: idx === selectedMonthIndex,
      pesagemOsms: 0,
      pesagemKg: 0,
    }));

    for (const op of ops) {
      const qty = Number(op.producedQuantity) || Number(op.plannedQuantity) || 0;
      if (qty <= 0 && op.status !== 'completed') continue;

      const dateStr = getOpDateString(op);
      const parts = dateStr.split('-');
      if (parts.length !== 3) continue;

      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;

      if (y === selectedYear && m >= 0 && m < 12) {
        const isPesagem = isPesagemOp(op);
        const setor = op.setor || (isPesagem ? 'Pesagem' : 'Envase');
        result[m].realizado += qty;

        if (isPesagem || setor === 'Pesagem') {
          result[m].pesagem += qty;
          result[m].pesagemOsms += 1;
          result[m].pesagemKg += qty;
        } else if (setor === 'Manipulação') {
          result[m].manipulacao += qty;
        } else {
          result[m].envase += qty;
        }
      }
    }

    return result;
  }, [ops, selectedYear, selectedMonthIndex, monthGoal]);

  // Total acumulado no ano
  const totalYearProduced = useMemo(() => {
    return monthlyChartData.reduce((acc, m) => acc + m.realizado, 0);
  }, [monthlyChartData]);

  // Exportar histórico diário em CSV
  const handleExportCsv = () => {
    if (filteredOpsOfDay.length === 0) return;

    const headers = ['Tipo', 'Número', 'Produto', 'Lote', 'Setor', 'Linha', 'Turno', 'Qtd Produzida', 'Unidade', 'Qtd Planejada', 'Status', 'Líder', 'Observação'];
    const rows = filteredOpsOfDay.map(op => [
      op.tipoDocumento || 'OP',
      `"${op.number}"`,
      `"${op.product}"`,
      `"${op.lote || ''}"`,
      op.setor || 'Envase',
      `"${op.lineId ? (lineMap.get(op.lineId) || op.lineId) : '-'}"`,
      op.finishedShift || op.scheduledShift || 'Manhã',
      op.producedQuantity,
      op.unidade || 'Un',
      op.plannedQuantity,
      op.status,
      `"${op.leaderId ? (leaderMap.get(op.leaderId) || op.leaderId) : '-'}"`,
      `"${op.observation || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historico_producao_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      
      {/* ── SEÇÃO SUPERIOR: BARRA DE CONTROLE DE DATA E MODOS ── */}
      <div className="bg-[#111116] border border-[#202028] rounded-2xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Título & Badge de Data */}
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-black tracking-tight text-[#f4f4f5] uppercase flex items-center gap-2">
                  Histórico Produtivo & Análise Diária
                  {isToday && (
                    <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded-full font-sans lowercase font-bold tracking-normal">
                      hoje
                    </span>
                  )}
                </h2>
                <p className="text-xs text-[#a1a1aa] capitalize">
                  {formattedDateTitle}
                </p>
              </div>
            </div>
          </div>

          {/* Navegação de Data */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-[#18181f] border border-[#272733] rounded-xl p-1">
              <button
                onClick={handlePrevDay}
                title="Dia anterior"
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#252530] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <button
                onClick={handleSetToday}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  isToday
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[#a1a1aa] hover:text-white hover:bg-[#252530]'
                }`}
              >
                Hoje
              </button>

              <button
                onClick={handleNextDay}
                title="Próximo dia"
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#252530] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Input Datepicker Direto */}
            <div className="flex items-center gap-2 bg-[#18181f] border border-[#272733] rounded-xl px-3 py-1.5">
              <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                className="bg-transparent text-xs font-bold font-mono text-white focus:outline-none cursor-pointer"
              />
            </div>

            {/* Botão Exportar CSV */}
            <button
              onClick={handleExportCsv}
              disabled={filteredOpsOfDay.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#18181f] border border-[#272733] hover:border-emerald-600/50 hover:bg-emerald-950/30 text-[#d4d4d8] hover:text-emerald-300 text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Exportar CSV</span>
            </button>
          </div>

        </div>

        {/* Barra de Abas / Modos de Visualização */}
        <div className="mt-4 pt-3 border-t border-[#202028] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-[#18181f] p-1 rounded-xl border border-[#272733]">
            <button
              onClick={() => setActiveView('integrated')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeView === 'integrated'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Visão Completa
            </button>
            <button
              onClick={() => setActiveView('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeView === 'table'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              O Que Foi Produzido ({opsOfDay.length})
            </button>
            <button
              onClick={() => setActiveView('daily_chart')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeView === 'daily_chart'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Gráfico Diário
            </button>
            <button
              onClick={() => setActiveView('monthly_chart')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeView === 'monthly_chart'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Gráfico Mensal
            </button>
          </div>

          <div className="text-[11px] text-[#71717a] font-mono flex items-center gap-2">
            <span>Ordens no dia: <strong className="text-white">{opsOfDay.length}</strong></span>
            <span>•</span>
            <span>Concluídas: <strong className="text-emerald-400">{dailySummary.completedCount}</strong></span>
          </div>
        </div>

      </div>

      {/* ── CARDS DE RESUMO DO DIA SELECIONADO ── */}
      {isPesagemMode ? (
        /* CARDS EXCLUSIVOS DO SETOR DE PESAGEM */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* CARD 1: QUANTIDADE DE OSMs ADICIONADAS NO DIA */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5" />
                OSMs ADICIONADAS NO DIA
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-950/70 text-purple-300 border border-purple-800/40 font-mono">
                {selectedDate}
              </span>
            </div>

            <div className="my-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-[#f4f4f5] font-mono tracking-tight">
                  {pesagemDailyStats.count}
                </span>
                <span className="text-xs font-bold text-purple-300">
                  {pesagemDailyStats.count === 1 ? 'OSM no dia' : 'OSMs no dia'}
                </span>
              </div>
              <div className="text-xs font-mono text-[#a1a1aa] mt-1 flex items-center gap-1.5">
                <span>Volume Total:</span>
                <strong className="text-white font-bold">{pesagemDailyStats.totalKg.toLocaleString('pt-BR')} Kg</strong>
              </div>
            </div>

            <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
              <span>Concluídas: <strong className="text-emerald-400">{pesagemDailyStats.completedCount}</strong></span>
              <span>Pendentes: <strong className="text-amber-400">{pesagemDailyStats.count - pesagemDailyStats.completedCount}</strong></span>
            </div>
          </div>

          {/* CARD 2: TOTAL NO MÊS */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                TOTAL NO MÊS ({selectedMonthIndex + 1}/{selectedYear})
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/40 font-mono">
                {pesagemMonthStats.distinctDaysCount} dias ativos
              </span>
            </div>

            <div className="my-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-[#f4f4f5] font-mono tracking-tight">
                  {pesagemMonthStats.count}
                </span>
                <span className="text-xs font-bold text-cyan-300">OSMs no mês</span>
              </div>
              <div className="text-xs font-mono text-[#a1a1aa] mt-1 flex items-center gap-1.5">
                <span>Volume Mensal:</span>
                <strong className="text-white font-bold">{pesagemMonthStats.totalKg.toLocaleString('pt-BR')} Kg</strong>
              </div>
            </div>

            <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
              <span>Média diária:</span>
              <strong className="text-cyan-300">~{pesagemMonthStats.avgKgPerDay.toLocaleString('pt-BR')} Kg/dia</strong>
            </div>
          </div>

          {/* CARD 3: TOTAL NO ANO */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                TOTAL NO ANO ({selectedYear})
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-300 border border-emerald-800/40 font-mono">
                {pesagemYearStats.distinctMonthsCount} meses
              </span>
            </div>

            <div className="my-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-[#f4f4f5] font-mono tracking-tight">
                  {pesagemYearStats.count}
                </span>
                <span className="text-xs font-bold text-emerald-300">OSMs no ano</span>
              </div>
              <div className="text-xs font-mono text-[#a1a1aa] mt-1 flex items-center gap-1.5">
                <span>Volume Acumulado:</span>
                <strong className="text-white font-bold">{pesagemYearStats.totalKg.toLocaleString('pt-BR')} Kg</strong>
              </div>
            </div>

            <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
              <span>Média mensal:</span>
              <strong className="text-emerald-300">~{pesagemYearStats.avgOsmPerMonth} OSMs/mês</strong>
            </div>
          </div>

          {/* CARD 4: OPERAÇÃO EM TURNO ÚNICO */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                TURNO ÚNICO DE PESAGEM
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/40 font-mono">
                1 Turno
              </span>
            </div>

            <div className="my-2 grid grid-cols-2 gap-2">
              <div className="bg-[#121215] border border-[#232328] rounded-xl p-2.5 text-center">
                <span className="text-[9px] text-[#a1a1aa] font-bold flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> CONCLUÍDAS
                </span>
                <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                  {pesagemDailyStats.completedCount}
                </div>
                <div className="text-[10px] text-[#71717a] font-mono">
                  {pesagemDailyStats.count > 0 ? Math.round((pesagemDailyStats.completedCount / pesagemDailyStats.count) * 100) : 0}% no turno
                </div>
              </div>
              <div className="bg-[#121215] border border-[#232328] rounded-xl p-2.5 text-center">
                <span className="text-[9px] text-[#a1a1aa] font-bold flex items-center justify-center gap-1">
                  <Scale className="w-3 h-3 text-cyan-400" /> MÉDIA / OSM
                </span>
                <div className="text-xl font-black text-white font-mono mt-0.5">
                  {pesagemDailyStats.count > 0 ? Math.round(pesagemDailyStats.totalKg / pesagemDailyStats.count).toLocaleString('pt-BR') : 0}
                </div>
                <div className="text-[10px] text-cyan-300/80 font-mono font-bold">
                  Kg por ordem
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#a1a1aa] flex items-center justify-between font-mono">
              <span>Regime: <strong className="text-white">Turno Único (Geral)</strong></span>
              <span className="text-purple-300 font-bold">{pesagemDailyStats.totalKg.toLocaleString('pt-BR')} Kg</span>
            </div>
          </div>
        </div>
      ) : (
        /* CARDS GERAIS DA FÁBRICA (COORDENAÇÃO) */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* CARD 1: TOTAL GERAL DO DIA */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              PRODUÇÃO DO DIA
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/70 text-blue-300 border border-blue-800/40">
              {opsOfDay.length} {opsOfDay.length === 1 ? 'ordem' : 'ordens'}
            </span>
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black text-[#f4f4f5] font-mono tracking-tight">
                {dailySummary.totalProducedEnvase.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs font-bold text-[#71717a]">Un (Envase)</span>
            </div>
            {(dailySummary.totalProducedPesagem > 0 || dailySummary.totalProducedManipulacao > 0) && (
              <div className="text-xs font-mono text-purple-300 mt-1 flex items-center gap-2">
                <span>+ {(dailySummary.totalProducedPesagem + dailySummary.totalProducedManipulacao).toLocaleString('pt-BR')} Kg</span>
                <span className="text-[10px] text-[#71717a]">(granel/pesagem)</span>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
            <span>Concluídas: <strong className="text-emerald-400">{dailySummary.completedCount}</strong></span>
            <span>Em linha: <strong className="text-blue-400">{dailySummary.inProgressCount}</strong></span>
          </div>
        </div>

        {/* CARD 2: ENVASE (UNIDADES) */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              SETOR ENVASE
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/40">
              Unidades
            </span>
          </div>

          <div className="my-3">
            <span className="text-2xl font-black text-[#f4f4f5] font-mono tracking-tight">
              {dailySummary.totalProducedEnvase.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs text-[#71717a] ml-1 font-bold">Un</span>
            <p className="text-[10px] text-[#a1a1aa] mt-0.5">
              Produtos acabados e envasados nas linhas industriais.
            </p>
          </div>

          <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
            <span>Meta Diária: <strong>{dailyGoalValue.toLocaleString('pt-BR')} Un</strong></span>
          </div>
        </div>

        {/* CARD 3: PESAGEM & MANIPULAÇÃO (KG) */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5" />
              PESAGEM & MANIPULAÇÃO
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-950/70 text-purple-300 border border-purple-800/40">
              Granel / Kg
            </span>
          </div>

          <div className="my-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#a1a1aa] flex items-center gap-1">
                <Scale className="w-3 h-3 text-purple-400" /> Pesagem:
              </span>
              <span className="font-mono font-black text-purple-200">
                {dailySummary.totalProducedPesagem.toLocaleString('pt-BR')} Kg
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#a1a1aa] flex items-center gap-1">
                <FlaskConical className="w-3 h-3 text-cyan-400" /> Manipulação:
              </span>
              <span className="font-mono font-black text-cyan-200">
                {dailySummary.totalProducedManipulacao.toLocaleString('pt-BR')} Kg
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#27272a]/60 text-[10px] text-[#71717a] flex items-center justify-between font-mono">
            <span>Total Granel: <strong>{(dailySummary.totalProducedPesagem + dailySummary.totalProducedManipulacao).toLocaleString('pt-BR')} Kg</strong></span>
          </div>
        </div>

        {/* CARD 4: DIVISÃO POR TURNO */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              DISTRIBUIÇÃO POR TURNO
            </span>
          </div>

          <div className="my-2 grid grid-cols-2 gap-2">
            <div className="bg-[#121215] border border-[#232328] rounded-xl p-2 text-center">
              <span className="text-[9px] text-[#a1a1aa] font-bold flex items-center justify-center gap-1">
                <Sun className="w-3 h-3 text-amber-400" /> 1º TURNO
              </span>
              <div className="text-base font-black text-white font-mono mt-0.5">
                {dailySummary.totalTurno1.toLocaleString('pt-BR')}
              </div>
            </div>
            <div className="bg-[#121215] border border-[#232328] rounded-xl p-2 text-center">
              <span className="text-[9px] text-[#a1a1aa] font-bold flex items-center justify-center gap-1">
                <Moon className="w-3 h-3 text-blue-400" /> 2º TURNO
              </span>
              <div className="text-base font-black text-white font-mono mt-0.5">
                {dailySummary.totalTurno2.toLocaleString('pt-BR')}
              </div>
            </div>
          </div>

          <div className="pt-1.5 border-t border-[#27272a]/60 text-[10px] text-[#71717a] text-center font-mono">
            <span>Total Produzido: <strong>{(dailySummary.totalTurno1 + dailySummary.totalTurno2).toLocaleString('pt-BR')}</strong></span>
          </div>
        </div>

      </div>
      )}

      {/* ── SEÇÃO DOS GRÁFICOS (DIÁRIO E MENSAL) ── */}
      {(activeView === 'integrated' || activeView === 'daily_chart' || activeView === 'monthly_chart') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* GRÁFICO DIÁRIO */}
          {(activeView === 'integrated' || activeView === 'daily_chart') && (
            <div className={`${activeView === 'daily_chart' ? 'lg:col-span-12' : 'lg:col-span-7'} bg-[#18181b] border border-[#27272a] rounded-2xl p-5 shadow-lg flex flex-col justify-between`}>
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      {isPesagemMode
                        ? `Ordens de Pesagem Diárias (${selectedMonthIndex + 1}/${selectedYear})`
                        : `Produção Diária do Mês (${selectedMonthIndex + 1}/${selectedYear})`}
                    </h3>
                    <p className="text-[11px] text-[#71717a]">
                      {isPesagemMode
                        ? `Quantidade de OSMs e volume (Kg) pesado dia a dia. Clique em um dia para inspecionar as OSMs.`
                        : `Volume dia a dia. Clique em um dia para inspecionar o histórico produtivo.`}
                    </p>
                  </div>

                  {/* Seletor de Modo do Gráfico Diário */}
                  <div className="flex items-center gap-1 bg-[#121215] p-1 rounded-xl border border-[#232328] text-[10px] font-bold">
                    {isPesagemMode ? (
                      <>
                        <button
                          onClick={() => setDailyChartMode('osms')}
                          className={`px-2.5 py-1 rounded-lg transition-all ${
                            dailyChartMode === 'osms' ? 'bg-purple-600 text-white shadow' : 'text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          Qtd de OSMs
                        </button>
                        <button
                          onClick={() => setDailyChartMode('volume')}
                          className={`px-2.5 py-1 rounded-lg transition-all ${
                            dailyChartMode === 'volume' ? 'bg-purple-600 text-white shadow' : 'text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          Volume (Kg)
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setDailyChartMode('turno')}
                          className={`px-2 py-1 rounded-lg transition-all ${
                            dailyChartMode === 'turno' ? 'bg-blue-600 text-white' : 'text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          Por Turno
                        </button>
                        <button
                          onClick={() => setDailyChartMode('setor')}
                          className={`px-2 py-1 rounded-lg transition-all ${
                            dailyChartMode === 'setor' ? 'bg-blue-600 text-white' : 'text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          Por Setor
                        </button>
                        <button
                          onClick={() => setDailyChartMode('total')}
                          className={`px-2 py-1 rounded-lg transition-all ${
                            dailyChartMode === 'total' ? 'bg-blue-600 text-white' : 'text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          Total
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Legenda do Gráfico */}
                <div className="flex flex-wrap items-center gap-3 text-[10px] mb-3 pb-2 border-b border-[#27272a]/60">
                  {isPesagemMode ? (
                    <>
                      {dailyChartMode === 'osms' && (
                        <span className="flex items-center gap-1 text-purple-400 font-medium">
                          <span className="w-2.5 h-2.5 rounded-sm bg-purple-500"></span> OSMs Adicionadas (Turno Único)
                        </span>
                      )}
                      {dailyChartMode === 'volume' && (
                        <span className="flex items-center gap-1 text-purple-400 font-medium">
                          <span className="w-2.5 h-2.5 rounded-sm bg-purple-500"></span> Volume Pesado Kg (Turno Único)
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[#a1a1aa] font-medium ml-auto">
                        Total no Mês: <strong className="text-white font-mono">{pesagemMonthStats.count} OSMs ({pesagemMonthStats.totalKg.toLocaleString('pt-BR')} Kg)</strong>
                      </span>
                    </>
                  ) : (
                    <>
                      {dailyChartMode === 'turno' && (
                        <>
                          <span className="flex items-center gap-1 text-cyan-400 font-medium">
                            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500"></span> 1º Turno (Manhã)
                          </span>
                          <span className="flex items-center gap-1 text-blue-400 font-medium">
                            <span className="w-2.5 h-2.5 rounded-sm bg-blue-600"></span> 2º Turno (Tarde)
                          </span>
                        </>
                      )}
                      {dailyChartMode === 'setor' && (
                        <>
                          <span className="flex items-center gap-1 text-cyan-400 font-medium">
                            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500"></span> Envase (Un)
                          </span>
                          <span className="flex items-center gap-1 text-purple-400 font-medium">
                            <span className="w-2.5 h-2.5 rounded-sm bg-purple-600"></span> Pesagem (Kg)
                          </span>
                          <span className="flex items-center gap-1 text-emerald-400 font-medium">
                            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600"></span> Manipulação (Kg)
                          </span>
                        </>
                      )}
                      {dailyChartMode === 'total' && (
                        <span className="flex items-center gap-1 text-blue-400 font-medium">
                          <span className="w-2.5 h-2.5 rounded-sm bg-blue-600"></span> Volume Total Diário
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-red-400 font-medium ml-auto">
                        <span className="w-3 h-0.5 bg-red-500 border-t border-dashed"></span> Meta ({dailyGoalValue.toLocaleString('pt-BR')})
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Área do Gráfico Diário */}
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dailyChartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    onClick={(e: any) => {
                      if (e && e.activePayload && e.activePayload[0]) {
                        const clicked = e.activePayload[0].payload;
                        if (clicked && clicked.dateIso) {
                          setSelectedDate(clicked.dateIso);
                        }
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        borderColor: '#27272a',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: '#f4f4f5',
                      }}
                      formatter={(value: any, name: any, item: any) => {
                        if (isPesagemMode) {
                          const payload = item?.payload;
                          if (name === 'osms' || name === 'OSMs Adicionadas') {
                            return [`${Number(value || 0)} OSMs (${Number(payload?.pesagemKg || 0).toLocaleString('pt-BR')} Kg)`, 'Pesagem'];
                          }
                          if (name === 'pesagemKg' || name === 'Volume Pesado (Kg)') {
                            return [`${Number(value || 0).toLocaleString('pt-BR')} Kg (${Number(payload?.osms || 0)} OSMs)`, 'Volume Pesado'];
                          }
                          if (name === 'turno1Osm' || name === '1º Turno (OSMs)') {
                            return [`${Number(value || 0)} OSMs (${Number(payload?.turno1PesagemKg || 0).toLocaleString('pt-BR')} Kg)`, '1º Turno'];
                          }
                          if (name === 'turno2Osm' || name === '2º Turno (OSMs)') {
                            return [`${Number(value || 0)} OSMs (${Number(payload?.turno2PesagemKg || 0).toLocaleString('pt-BR')} Kg)`, '2º Turno'];
                          }
                          return [`${Number(value || 0)}`, name];
                        }
                        return [
                          `${Number(value || 0).toLocaleString('pt-BR')}`,
                          name === 'turno1' ? '1º Turno' :
                          name === 'turno2' ? '2º Turno' :
                          name === 'envase' ? 'Envase' :
                          name === 'pesagem' ? 'Pesagem' :
                          name === 'manipulacao' ? 'Manipulação' :
                          name === 'total' ? 'Total Diário' : name,
                        ];
                      }}
                      labelFormatter={(label) => `Dia ${label} de ${selectedMonthIndex + 1}/${selectedYear}`}
                    />
                    {!isPesagemMode && (
                      <ReferenceLine
                        y={dailyGoalValue}
                        stroke="#ef4444"
                        strokeDasharray="3 3"
                        strokeWidth={1.5}
                        label={{ value: 'Meta', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }}
                      />
                    )}

                    {isPesagemMode ? (
                      <>
                        {dailyChartMode === 'osms' && (
                          <Bar dataKey="osms" fill="#a855f7" radius={[4, 4, 0, 0]} name="OSMs Adicionadas (Turno Único)">
                            {dailyChartData.map((entry, index) => (
                              <Cell
                                key={`cell-osms-${index}`}
                                fill={entry.isCurrentSelection ? '#c084fc' : '#a855f7'}
                                stroke={entry.isCurrentSelection ? '#fbbf24' : 'transparent'}
                                strokeWidth={entry.isCurrentSelection ? 2 : 0}
                              />
                            ))}
                          </Bar>
                        )}
                        {dailyChartMode === 'volume' && (
                          <Bar dataKey="pesagemKg" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Volume Pesado Kg (Turno Único)">
                            {dailyChartData.map((entry, index) => (
                              <Cell
                                key={`cell-kg-${index}`}
                                fill={entry.isCurrentSelection ? '#a78bfa' : '#8b5cf6'}
                                stroke={entry.isCurrentSelection ? '#fbbf24' : 'transparent'}
                                strokeWidth={entry.isCurrentSelection ? 2 : 0}
                              />
                            ))}
                          </Bar>
                        )}
                      </>
                    ) : (
                      <>
                        {dailyChartMode === 'turno' && (
                          <>
                            <Bar dataKey="turno1" stackId="a" fill="#06b6d4" name="1º Turno" />
                            <Bar dataKey="turno2" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} name="2º Turno">
                              {dailyChartData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  stroke={entry.isCurrentSelection ? '#fbbf24' : 'transparent'}
                                  strokeWidth={entry.isCurrentSelection ? 2 : 0}
                                />
                              ))}
                            </Bar>
                          </>
                        )}

                        {dailyChartMode === 'setor' && (
                          <>
                            <Bar dataKey="envase" stackId="a" fill="#06b6d4" name="Envase" />
                            <Bar dataKey="pesagem" stackId="a" fill="#a855f7" name="Pesagem" />
                            <Bar dataKey="manipulacao" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} name="Manipulação" />
                          </>
                        )}

                        {dailyChartMode === 'total' && (
                          <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Total">
                            {dailyChartData.map((entry, index) => (
                              <Cell
                                key={`cell-total-${index}`}
                                fill={entry.isCurrentSelection ? '#38bdf8' : '#3b82f6'}
                                stroke={entry.isCurrentSelection ? '#fbbf24' : 'transparent'}
                                strokeWidth={entry.isCurrentSelection ? 2 : 0}
                              />
                            ))}
                          </Bar>
                        )}
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 text-[10px] text-[#71717a] flex items-center justify-between">
                <span>Dia selecionado no gráfico: <strong className="text-amber-300">Dia {selectedDayNum}</strong></span>
                <span>Clique em qualquer barra para carregar o dia correspondente.</span>
              </div>
            </div>
          )}

          {/* GRÁFICO MENSAL (12 MESES) */}
          {(activeView === 'integrated' || activeView === 'monthly_chart') && (
            <div className={`${activeView === 'monthly_chart' ? 'lg:col-span-12' : 'lg:col-span-5'} bg-[#18181b] border border-[#27272a] rounded-2xl p-5 shadow-lg flex flex-col justify-between`}>
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-purple-400" />
                      {isPesagemMode ? `OSMs Mensais de Pesagem (${selectedYear})` : `Produção Mensal (${selectedYear})`}
                    </h3>
                    <p className="text-[11px] text-[#71717a]">
                      {isPesagemMode
                        ? `Consolidado de OSMs e volume (Kg) adicionados mês a mês em ${selectedYear}.`
                        : `Consolidado de 12 meses vs Meta Mensal (${monthGoal.toLocaleString('pt-BR')} un/mês).`}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#71717a] block">Acumulado {selectedYear}</span>
                    <span className="text-sm font-black text-purple-300 font-mono">
                      {isPesagemMode
                        ? `${pesagemYearStats.count} OSMs (${pesagemYearStats.totalKg.toLocaleString('pt-BR')} Kg)`
                        : totalYearProduced.toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] mb-3 pb-2 border-b border-[#27272a]/60">
                  <span className="flex items-center gap-1 text-purple-400 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-purple-600"></span> {isPesagemMode ? 'OSMs no Mês' : 'Realizado no Mês'}
                  </span>
                  {!isPesagemMode && (
                    <span className="flex items-center gap-1 text-blue-400 font-medium">
                      <span className="w-3 h-0.5 bg-blue-500 border-t border-dashed"></span> Meta ({monthGoal.toLocaleString('pt-BR')})
                    </span>
                  )}
                  {isPesagemMode && (
                    <span className="flex items-center gap-1 text-[#a1a1aa] font-medium ml-auto">
                      Média: <strong className="text-white font-mono">~{pesagemYearStats.avgOsmPerMonth} OSMs/mês</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Área do Gráfico Mensal */}
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="monthName" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        borderColor: '#27272a',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: '#f4f4f5',
                      }}
                      formatter={(value: any, name: any, item: any) => {
                        if (isPesagemMode) {
                          const payload = item?.payload;
                          return [
                            `${Number(payload?.pesagemOsms || 0)} OSMs (${Number(payload?.pesagemKg || 0).toLocaleString('pt-BR')} Kg)`,
                            'Pesagem'
                          ];
                        }
                        return [`${Number(value || 0).toLocaleString('pt-BR')} unidades`, 'Realizado'];
                      }}
                      labelFormatter={(label) => `Mês de ${label}/${selectedYear}`}
                    />
                    {!isPesagemMode && (
                      <ReferenceLine
                        y={monthGoal}
                        stroke="#3b82f6"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{ value: 'Meta', fill: '#3b82f6', fontSize: 9, position: 'insideTopRight' }}
                      />
                    )}
                    <Bar
                      dataKey={isPesagemMode ? "pesagemOsms" : "realizado"}
                      fill="#a855f7"
                      radius={[4, 4, 0, 0]}
                      name={isPesagemMode ? "OSMs Adicionadas" : "Realizado"}
                    >
                      {monthlyChartData.map((entry, index) => (
                        <Cell
                          key={`cell-month-${index}`}
                          fill={entry.isCurrent ? '#c084fc' : '#7e22ce'}
                          stroke={entry.isCurrent ? '#fbbf24' : 'transparent'}
                          strokeWidth={entry.isCurrent ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 text-[10px] text-[#71717a] flex items-center justify-between">
                <span>Mês em foco: <strong className="text-purple-300">{monthlyChartData[selectedMonthIndex]?.monthName}</strong></span>
                <span>
                  {isPesagemMode ? (
                    <>Total Mês: <strong className="text-white font-mono">{monthlyChartData[selectedMonthIndex]?.pesagemOsms} OSMs ({monthlyChartData[selectedMonthIndex]?.pesagemKg.toLocaleString('pt-BR')} Kg)</strong></>
                  ) : (
                    <>Atingimento no mês: <strong className="text-white">{monthGoal > 0 ? Math.round((monthlyChartData[selectedMonthIndex]?.realizado / monthGoal) * 100) : 0}%</strong></>
                  )}
                </span>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── SEÇÃO PRINCIPAL: HISTÓRICO PRODUTIVO DIÁRIO (O QUE FOI PRODUZIDO E A QUANTIDADE) ── */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-5 shadow-lg space-y-4">
        
        {/* Cabeçalho da Tabela com Filtros */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#27272a]">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" />
              {isPesagemMode ? `OSMs Adicionadas Neste Dia (${filteredOpsOfDay.length})` : 'O Que Foi Produzido Neste Dia'}
            </h3>
            <p className="text-xs text-[#a1a1aa] mt-0.5">
              {isPesagemMode
                ? `Rastreabilidade das ordens de pesagem de matérias-primas e granel registradas em `
                : `Rastreabilidade detalhada: Ordens de produção, lotes, produtos e volumes produzidos em `}
              <span className="text-white font-semibold">{selectedDate}</span>.
            </p>
          </div>

          {/* Filtros da Tabela */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Input de Busca Rápida */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]" />
              <input
                type="text"
                placeholder="Buscar produto, OP ou lote..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111116] border border-[#272733] focus:border-blue-500 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-[#52525b] focus:outline-none"
              />
            </div>

            {/* Filtro por Setor */}
            {pesagemOnly ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-xs text-purple-300 font-bold">
                <Scale className="w-3.5 h-3.5 text-purple-400" />
                <span>Setor: Pesagem</span>
              </div>
            ) : (
              <select
                value={sectorFilter}
                onChange={(e: any) => setSectorFilter(e.target.value)}
                className="bg-[#111116] border border-[#272733] text-xs text-white rounded-xl px-2.5 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="Todos">Todos os Setores</option>
                <option value="Envase">Envase</option>
                <option value="Pesagem">Pesagem</option>
                <option value="Manipulação">Manipulação</option>
              </select>
            )}

            {/* Filtro por Turno */}
            {pesagemOnly ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111116] border border-[#272733] text-xs text-[#a1a1aa] font-medium">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                <span>Turno: Turno Único</span>
              </div>
            ) : (
              <select
                value={shiftFilter}
                onChange={(e: any) => setShiftFilter(e.target.value)}
                className="bg-[#111116] border border-[#272733] text-xs text-white rounded-xl px-2.5 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="Todos">Todos os Turnos</option>
                <option value="1º Turno">1º Turno (Manhã)</option>
                <option value="2º Turno">2º Turno (Tarde)</option>
              </select>
            )}

            {/* Filtro por Status */}
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="bg-[#111116] border border-[#272733] text-xs text-white rounded-xl px-2.5 py-1.5 focus:outline-none cursor-pointer"
            >
              <option value="Todos">Todos os Status</option>
              <option value="completed">Concluídos</option>
              <option value="in_progress">Em Produção</option>
            </select>

          </div>
        </div>

        {/* Tabela Analítica de Produção */}
        {filteredOpsOfDay.length === 0 ? (
          <div className="py-12 px-4 text-center bg-[#121215] border border-dashed border-[#272733] rounded-xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#1e1e26] flex items-center justify-center mx-auto text-[#71717a]">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#f4f4f5]">
                Nenhuma produção encontrada para {selectedDate}
              </p>
              <p className="text-xs text-[#71717a] mt-1 max-w-md mx-auto">
                Não há apontamentos registrados com os filtros selecionados nesta data. Tente alterar a data ou limpar a busca.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-center gap-2">
              <button
                onClick={handleSetToday}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
              >
                Ir para Hoje ({todayIso})
              </button>
              {(searchQuery || sectorFilter !== 'Todos' || shiftFilter !== 'Todos' || statusFilter !== 'Todos') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSectorFilter('Todos');
                    setShiftFilter('Todos');
                    setStatusFilter('Todos');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#22222a] hover:bg-[#2b2b35] text-[#d4d4d8] text-xs font-bold transition-colors"
                >
                  Limpar Filtros
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#d4d4d8]">
              <thead>
                <tr className="border-b border-[#272733] text-[10px] uppercase font-mono tracking-wider text-[#71717a] bg-[#121215]">
                  <th className="py-3 px-3">Doc / Ordem</th>
                  <th className="py-3 px-3">Produto / Granel</th>
                  <th className="py-3 px-3">Lote</th>
                  <th className="py-3 px-3">Setor / Linha</th>
                  <th className="py-3 px-3">Turno</th>
                  <th className="py-3 px-3 text-right">Qtd Produzida</th>
                  <th className="py-3 px-3 text-right">Planejado</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Líder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202028]">
                {filteredOpsOfDay.map((op) => {
                  const docType = op.tipoDocumento || (op.setor === 'Pesagem' || op.setor === 'Manipulação' ? 'OSM' : 'OP');
                  const unit = op.unidade || (op.setor === 'Pesagem' || op.setor === 'Manipulação' ? 'Kg' : 'Un');
                  const produced = Number(op.producedQuantity) || 0;
                  const planned = Number(op.plannedQuantity) || 0;
                  const progressPct = planned > 0 ? Math.min(100, Math.round((produced / planned) * 100)) : 100;
                  const shift = op.finishedShift || op.scheduledShift || 'Manhã';
                  const isShift2 = shift.toLowerCase().includes('2') || shift.toLowerCase().includes('tarde');
                  const leaderName = op.leaderId ? (leaderMap.get(op.leaderId) || 'Líder') : 'Não atribuído';
                  const lineName = op.lineId ? (lineMap.get(op.lineId) || op.lineId) : (op.setor || 'Geral');

                  return (
                    <tr key={op.id} className="hover:bg-[#1f1f26] transition-colors group">
                      
                      {/* Documento / Número */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded font-mono ${
                            docType === 'OSM'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                              : 'bg-blue-950 text-blue-300 border border-blue-800/40'
                          }`}>
                            {docType}
                          </span>
                          <span className="font-mono font-bold text-white text-xs">
                            {op.number}
                          </span>
                          {op.industria && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-950/70 text-purple-300 border border-purple-800/50">
                              {op.industria}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Produto e Observação */}
                      <td className="py-3 px-3 max-w-[260px]">
                        <div className="font-bold text-white text-xs truncate" title={op.product}>
                          {op.product}
                        </div>
                        {op.observation && (
                          <div className="text-[10px] text-amber-300/80 truncate mt-0.5 flex items-center gap-1" title={op.observation}>
                            <Tag className="w-2.5 h-2.5 shrink-0" />
                            <span>{op.observation}</span>
                          </div>
                        )}
                      </td>

                      {/* Lote */}
                      <td className="py-3 px-3">
                        {op.lote ? (
                          <span className="font-mono text-xs font-bold text-purple-300 bg-[#121215] border border-purple-900/40 px-2 py-0.5 rounded-lg">
                            {op.lote}
                          </span>
                        ) : (
                          <span className="text-[#52525b] font-mono text-[11px]">-</span>
                        )}
                      </td>

                      {/* Setor / Linha */}
                      <td className="py-3 px-3">
                        <div className="text-xs font-semibold text-[#f4f4f5]">
                          {lineName}
                        </div>
                        <div className="text-[10px] text-[#71717a]">
                          {op.setor || 'Envase'}
                        </div>
                      </td>

                      {/* Turno */}
                      <td className="py-3 px-3">
                        {isPesagemOp(op) ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit bg-purple-950/80 text-purple-300 border border-purple-800/40 font-mono">
                            <Clock className="w-2.5 h-2.5 text-purple-400" />
                            Turno Único
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit ${
                            isShift2
                              ? 'bg-blue-950/80 text-blue-300 border border-blue-800/40'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-800/40'
                          }`}>
                            {isShift2 ? <Moon className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
                            {isShift2 ? '2º Turno' : '1º Turno'}
                          </span>
                        )}
                      </td>

                      {/* Quantidade Produzida */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-mono font-black text-sm text-emerald-400">
                          {produced.toLocaleString('pt-BR')} <span className="text-[10px] font-sans font-bold text-emerald-300">{unit}</span>
                        </div>
                        <div className="text-[10px] text-[#71717a] font-mono">
                          {progressPct}% atingido
                        </div>
                      </td>

                      {/* Quantidade Planejada */}
                      <td className="py-3 px-3 text-right font-mono text-xs text-[#a1a1aa]">
                        {planned.toLocaleString('pt-BR')} {unit}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          op.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                            : op.status === 'in_progress'
                            ? 'bg-blue-950 text-blue-300 border border-blue-800/40'
                            : 'bg-[#27272a] text-[#a1a1aa]'
                        }`}>
                          {op.status === 'completed' ? 'Concluído' : op.status === 'in_progress' ? 'Em linha' : op.status}
                        </span>
                      </td>

                      {/* Líder */}
                      <td className="py-3 px-3 text-xs text-[#a1a1aa] truncate max-w-[120px]">
                        <span className="flex items-center gap-1">
                          <UserCheck className="w-3 h-3 text-[#71717a]" />
                          {leaderName}
                        </span>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Rodapé da Tabela com Somatórios */}
        {filteredOpsOfDay.length > 0 && (
          <div className="pt-3 border-t border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#a1a1aa] bg-[#121215] p-3 rounded-xl">
            <div>
              <span>Exibindo <strong>{filteredOpsOfDay.length}</strong> de <strong>{opsOfDay.length}</strong> ordens registradas no dia.</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono font-bold">
              <span>Envase: <strong className="text-cyan-300">{dailySummary.totalProducedEnvase.toLocaleString('pt-BR')} Un</strong></span>
              <span>•</span>
              <span>Pesagem: <strong className="text-purple-300">{dailySummary.totalProducedPesagem.toLocaleString('pt-BR')} Kg</strong></span>
              <span>•</span>
              <span>Manipulação: <strong className="text-emerald-300">{dailySummary.totalProducedManipulacao.toLocaleString('pt-BR')} Kg</strong></span>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
