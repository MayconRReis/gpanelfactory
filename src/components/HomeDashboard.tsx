import React, { useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  Target,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Users,
  Calendar,
  Flame,
  ArrowUpRight,
  ShieldCheck,
  Percent,
  Search,
  X,
  Filter,
  BarChart3,
  Sun,
  Play,
  Pause,
  Package,
  Box,
  Check,
  SlidersHorizontal,
  FileSpreadsheet,
  AlertCircle,
  Award,
  Sparkles,
  Info
} from 'lucide-react';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, MonthlyGoal } from '../types';
import { INTEGRATIONS_ARE_MOCKED } from '../integrations/mocks';
import { calculateOEE, groupProductionByDayAndSetor, groupProductionByMonth } from '../services/db';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';

interface HomeDashboardProps {
  lines: ProductionLine[];
  ops: ProductionOrder[];
  leaders: UserProfile[];
  allUsers: UserProfile[];
  events: ProductionEvent[];
  rotations?: Record<string, string>;
  goals?: MonthlyGoal[];
  onNavigateTab: (tab: 'lines' | 'ops' | 'rotations' | 'users' | 'events' | 'daily_production') => void;
  onNewOp: () => void;
}

/**
 * Calcula o tempo total real de pausas (em horas decimais) a partir dos eventos.
 * Para cada evento PAUSED, pareia com o próximo evento cronológico RESUMED ou FINISHED
 * de mesma opId e calcula a diferença de createdAt.
 * Retorna 0 se não houver pares completos ou se events for vazio.
 * Pausas abertas sem retomada são desconsideradas.
 */
export function calculateTotalPauseHours(events: ProductionEvent[]): number {
  if (!events || events.length === 0) return 0;

  // Ordena os eventos em ordem cronológica crescente
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Agrupa eventos por opId
  const eventsByOp: Record<string, ProductionEvent[]> = {};
  for (const ev of sorted) {
    const key = ev.opId || 'global';
    if (!eventsByOp[key]) eventsByOp[key] = [];
    eventsByOp[key].push(ev);
  }

  let totalMs = 0;

  for (const opId of Object.keys(eventsByOp)) {
    const opEvents = eventsByOp[opId];
    let pauseStartTime: number | null = null;

    for (const ev of opEvents) {
      const time = new Date(ev.createdAt).getTime();
      if (isNaN(time)) continue;

      if (ev.type === 'PAUSED') {
        pauseStartTime = time;
      } else if (
        (ev.type === 'RESUMED' || ev.type === 'FINISHED') &&
        pauseStartTime !== null
      ) {
        const diff = time - pauseStartTime;
        if (diff > 0) {
          totalMs += diff;
        }
        pauseStartTime = null; // encerra o par completo
      }
    }
  }

  return totalMs / (1000 * 60 * 60);
}

/**
 * Formata um número decimal de horas em string "Xh Ymin"
 * Ex: 2.75 -> "2h 45min" | 0 -> "0h 0min"
 */
export function formatHoursAndMinutes(decimalHours: number): string {
  if (!decimalHours || decimalHours <= 0 || isNaN(decimalHours)) return '0h 0min';
  const totalMinutes = Math.round(decimalHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}min`;
}

export function HomeDashboard({
  lines,
  ops,
  leaders,
  allUsers,
  events,
  rotations = {},
  goals = [],
  onNavigateTab,
  onNewOp,
}: HomeDashboardProps) {
  // Constante para indicar estimativa visual nas métricas operacionais não auditadas
  const WORK_HOURS_ARE_ESTIMATED = true;

  // Sub-aba ativa no Painel PCP: 'farol' | 'curva_a'
  const [activeSubTab, setActiveSubTab] = useState<'farol' | 'curva_a'>('farol');

  // Meta Mensal Global (Persistida no localStorage com padrão industrial de 100.000 un)
  const [monthlyGoal, setMonthlyGoal] = useState<number>(() => {
    const saved = localStorage.getItem('gpanel_monthly_goal');
    return saved ? parseInt(saved, 10) : 100000;
  });
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [tempGoal, setTempGoal] = useState(monthlyGoal.toString());

  const handleSaveGoal = () => {
    const val = parseInt(tempGoal, 10);
    if (!isNaN(val) && val > 0) {
      setMonthlyGoal(val);
      localStorage.setItem('gpanel_monthly_goal', val.toString());
    }
    setIsEditingGoal(false);
  };

  // ---------------- HELPER PARA RESOLVER LÍDER DA LINHA PELA ESCALA ----------------
  const getLineLeader = useCallback((lineId: string): UserProfile | null => {
    // 1. Verificar em rotations (bidirecional)
    let leaderKey = Object.keys(rotations || {}).find(k => rotations[k] === lineId);
    if (!leaderKey && rotations?.[lineId]) {
      leaderKey = rotations[lineId];
    }
    if (leaderKey) {
      const found = leaders.find(l => 
        l.uid === leaderKey || 
        (l.email && l.email.toLowerCase() === leaderKey.toLowerCase()) || 
        l.name?.toLowerCase() === leaderKey.toLowerCase()
      );
      if (found) return found;
    }

    // 2. Fallback: procurar por propriedade lineId no perfil do líder
    const byLine = leaders.find(l => (l as any).lineId === lineId);
    if (byLine) return byLine;

    return null;
  }, [rotations, leaders]);

  // ---------------- FILTROS ESTILO FAROL DE OPS ----------------
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>('Todas');
  const [selectedDeliveryFilter, setSelectedDeliveryFilter] = useState<string>('Todos');

  // Limpar Filtros
  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedLineFilter('all');
    setSelectedStatusFilter('all');
    setSelectedPriorityFilter('Todas');
    setSelectedDeliveryFilter('Todos');
  };

  // ---------------- CÁLCULOS DAS 8 MÉTRICAS PRINCIPAIS ----------------
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // 1. Total Produzidos e Planejados
  const totalProduced = useMemo(() => {
    return ops.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
  }, [ops]);

  const totalPlanned = useMemo(() => {
    return ops.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);
  }, [ops]);

  // Volume do Mês Atual
  const opsThisMonth = useMemo(() => {
    return ops.filter((o) => {
      if (!o.createdAt) return true;
      const d = new Date(o.createdAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
  }, [ops, currentMonth, currentYear]);

  const monthProducedQuantity = useMemo(() => {
    return opsThisMonth.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
  }, [opsThisMonth]);

  // Porcentagem da Meta Mensal
  const monthlyGoalPercentage = useMemo(() => {
    if (monthlyGoal <= 0) return 0;
    return Math.min(Math.round((monthProducedQuantity / monthlyGoal) * 100 * 10) / 10, 100);
  }, [monthProducedQuantity, monthlyGoal]);

  // 2. OPs Concluídas no Mês
  const completedOpsMonth = useMemo(() => {
    return opsThisMonth.filter((o) => o.status === 'completed').length;
  }, [opsThisMonth]);

  const totalCompletedOps = useMemo(() => {
    return ops.filter((o) => o.status === 'completed').length;
  }, [ops]);

  // 3. OPs Críticas e Atrasadas
  const delayedOps = useMemo(() => {
    return ops.filter((o) => {
      if (o.status === 'completed') return false;
      return (
        o.priority === 'Crítica' ||
        (o.status === 'paused' && o.packageAvailability === 0) ||
        (o.status === 'pending' && o.priority === 'Alta')
      );
    });
  }, [ops]);

  const totalDelayedOpsCount = delayedOps.length;

  // 4. Tempos de Trabalho e Ociosidade (Dia e Total)
  const activeLinesCount = lines.filter((l) => l.status === 'active').length;
  const pausedLinesCount = lines.filter((l) => l.status === 'paused').length;
  const idleLinesCount = lines.filter((l) => l.status === 'idle').length;

  const hoursPassedToday = Math.max(1, Math.min(8, (now.getHours() - 7) || 4));
  const workHoursTodayDecimal = (activeLinesCount * hoursPassedToday * 0.85) + 2.5;
  const workHoursToday = Math.floor(workHoursTodayDecimal);
  const workMinutesToday = Math.round((workHoursTodayDecimal - workHoursToday) * 60);

  const idleHoursTodayDecimal = ((pausedLinesCount + idleLinesCount * 0.5) * hoursPassedToday * 0.35) + 1.25;
  const idleHoursToday = Math.floor(idleHoursTodayDecimal);
  const idleMinutesToday = Math.round((idleHoursTodayDecimal - idleHoursToday) * 60);

  const workHoursTotalDecimal = (totalProduced / 85) + 42.5;
  const workHoursTotal = Math.floor(workHoursTotalDecimal);
  const workMinutesTotal = Math.round((workHoursTotalDecimal - workHoursTotal) * 60);

  // Cálculo real baseado nos eventos PAUSED -> RESUMED/FINISHED
  const idleHoursTotalDecimal = useMemo(() => calculateTotalPauseHours(events), [events]);
  const formattedIdleTotal = useMemo(() => formatHoursAndMinutes(idleHoursTotalDecimal), [idleHoursTotalDecimal]);
  const idleHoursTotal = Math.floor(idleHoursTotalDecimal);
  const idleMinutesTotal = Math.round((idleHoursTotalDecimal - idleHoursTotal) * 60);

  // ---------------- FILTRAGEM DA TABELA DE OPS ----------------
  const filteredOps = useMemo(() => {
    return ops.filter((op) => {
      // 1. Busca por Produto / Lote / Número
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchProduct = op.product?.toLowerCase().includes(query);
        const matchNumber = op.number?.toLowerCase().includes(query);
        if (!matchProduct && !matchNumber) return false;
      }

      // 2. Filtro por Linha
      if (selectedLineFilter !== 'all') {
        if (op.lineId !== selectedLineFilter) return false;
      }

      // 3. Filtro por Situação
      if (selectedStatusFilter !== 'all') {
        if (selectedStatusFilter === 'in_progress' && op.status !== 'in_progress') return false;
        if (selectedStatusFilter === 'paused' && op.status !== 'paused') return false;
        if (selectedStatusFilter === 'pending' && op.status !== 'pending') return false;
        if (selectedStatusFilter === 'completed' && op.status !== 'completed') return false;
      }

      // 4. Filtro por Prioridade
      if (selectedPriorityFilter !== 'Todas') {
        if (selectedPriorityFilter === 'Crítico' && op.priority !== 'Crítica') return false;
        if (selectedPriorityFilter === 'Atenção' && op.priority !== 'Alta') return false;
        if (selectedPriorityFilter === 'Normal' && op.priority !== 'Normal') return false;
        if (selectedPriorityFilter === 'Concluido' && op.status !== 'completed') return false;
        if (selectedPriorityFilter === 'Completa' && (op.producedQuantity < op.plannedQuantity)) return false;
        if (selectedPriorityFilter === 'Entregue' && op.status !== 'completed') return false;
      }

      // 5. Filtro por Status de Entrega
      if (selectedDeliveryFilter !== 'Todos') {
        if (selectedDeliveryFilter === 'No prazo') {
          if (op.priority === 'Crítica' || op.status === 'paused') return false;
        } else if (selectedDeliveryFilter === 'Atrasado') {
          if (op.priority !== 'Crítica' && op.status !== 'paused') return false;
        } else if (selectedDeliveryFilter === 'Sem previsão') {
          if (op.status !== 'pending') return false;
        }
      }

      return true;
    });
  }, [ops, searchTerm, selectedLineFilter, selectedStatusFilter, selectedPriorityFilter, selectedDeliveryFilter]);

  // ---------------- CÁLCULO DE CURVA A (PARETO) ----------------
  const curvaAData = useMemo(() => {
    const productVolumeMap: Record<string, { product: string; planned: number; produced: number; opsCount: number }> = {};
    ops.forEach((op) => {
      const key = op.product || 'Produto Geral';
      if (!productVolumeMap[key]) {
        productVolumeMap[key] = { product: key, planned: 0, produced: 0, opsCount: 0 };
      }
      productVolumeMap[key].planned += op.plannedQuantity || 0;
      productVolumeMap[key].produced += op.producedQuantity || 0;
      productVolumeMap[key].opsCount += 1;
    });

    const sorted = Object.values(productVolumeMap).sort((a, b) => b.planned - a.planned);
    const sumAll = sorted.reduce((acc, p) => acc + p.planned, 0) || 1;

    let acc = 0;
    return sorted.map((item, index) => {
      acc += item.planned;
      const cumPct = Math.round((acc / sumAll) * 100);
      const category: 'A' | 'B' | 'C' = cumPct <= 70 || index === 0 ? 'A' : cumPct <= 90 ? 'B' : 'C';
      return {
        ...item,
        sharePct: Math.round((item.planned / sumAll) * 100 * 10) / 10,
        cumPct,
        category,
      };
    });
  }, [ops]);

  // Formatação de Data / Hora para o Badge
  const formattedDate = useMemo(() => {
    const d = now.toLocaleDateString('pt-BR');
    const h = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${d}, ${h}`;
  }, []);

  // ---------------- NOVO PAINEL DE CONTROLE DE PRODUÇÃO: CÁLCULOS ----------------
  
  // 1. KPIs de Volume por Setor (Mês e Ano)
  const sectorKpis = useMemo(() => {
    const getOpDate = (op: ProductionOrder) => {
      if (op.scheduledDate) {
        const parts = op.scheduledDate.split('-');
        if (parts.length >= 2) {
          return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) - 1 };
        }
      }
      if (op.createdAt) {
        const d = new Date(op.createdAt);
        if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() };
      }
      return { year: currentYear, month: currentMonth };
    };

    let pesagemMes = 0;
    let pesagemAno = 0;
    let manipMes = 0;
    let manipAno = 0;
    let envaseMes = 0;
    let envaseAno = 0;

    for (const op of ops) {
      const d = getOpDate(op);
      const isYear = d.year === currentYear;
      const isMonth = isYear && d.month === currentMonth;
      const qty = Number(op.producedQuantity || 0);

      const s = op.setor;
      if (s === 'Pesagem') {
        if (isYear) pesagemAno += qty;
        if (isMonth) pesagemMes += qty;
      } else if (s === 'Manipulação') {
        if (isYear) manipAno += qty;
        if (isMonth) manipMes += qty;
      } else if (s === 'Envase') {
        if (isYear) envaseAno += qty;
        if (isMonth) envaseMes += qty;
      } else {
        // Fallback setor geral / não especificado -> somar no Envase (padrão de saída final)
        if (isYear) envaseAno += qty;
        if (isMonth) envaseMes += qty;
      }
    }

    return {
      pesagem: { mes: pesagemMes, ano: pesagemAno, unidade: 'Qtd' },
      manipulacao: { mes: manipMes, ano: manipAno, unidade: 'Kg' },
      envase: { mes: envaseMes, ano: envaseAno, unidade: 'Un' },
    };
  }, [ops, currentYear, currentMonth]);

  // 2. OEE (Disponibilidade, Performance, Qualidade, Geral)
  const oeeMetrics = useMemo(() => {
    return calculateOEE(ops, events);
  }, [ops, events]);

  // 3. Meta Diária do Mês Atual
  const daysInCurrentMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const activeMonthGoal = useMemo(() => {
    if (goals && goals.length > 0) {
      const found = goals.filter(g => g.year === currentYear && g.month === (currentMonth + 1));
      if (found.length > 0) {
        return found.reduce((acc, g) => acc + (g.goalQuantity || 0), 0);
      }
    }
    return monthlyGoal;
  }, [goals, currentYear, currentMonth, monthlyGoal]);

  const dailyGoalValue = useMemo(() => {
    return Math.round(activeMonthGoal / Math.max(1, daysInCurrentMonth));
  }, [activeMonthGoal, daysInCurrentMonth]);

  // 4. Gráfico Diário por Turno (1º Turno e 2º Turno)
  const dailyTurnoChartData = useMemo(() => {
    const dayMap = new Map<number, { day: number; label: string; turno1: number; turno2: number; total: number }>();
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      dayMap.set(i, {
        day: i,
        label: `${i}`,
        turno1: 0,
        turno2: 0,
        total: 0,
      });
    }

    for (const op of ops) {
      if (!op.producedQuantity) continue;
      let opYear = currentYear;
      let opMonth = currentMonth;
      let opDay = 1;

      if (op.scheduledDate) {
        const parts = op.scheduledDate.split('-');
        if (parts.length === 3) {
          opYear = parseInt(parts[0], 10);
          opMonth = parseInt(parts[1], 10) - 1;
          opDay = parseInt(parts[2], 10);
        }
      } else if (op.createdAt) {
        const d = new Date(op.createdAt);
        if (!isNaN(d.getTime())) {
          opYear = d.getFullYear();
          opMonth = d.getMonth();
          opDay = d.getDate();
        }
      }

      if (opYear === currentYear && opMonth === currentMonth && dayMap.has(opDay)) {
        const item = dayMap.get(opDay)!;
        const shift = (op.scheduledShift || '').toLowerCase();
        const qty = Number(op.producedQuantity || 0);

        if (shift.includes('2') || shift.includes('tarde') || shift.includes('noite')) {
          item.turno2 += qty;
        } else {
          item.turno1 += qty;
        }
        item.total += qty;
      }
    }

    return Array.from(dayMap.values());
  }, [ops, currentYear, currentMonth, daysInCurrentMonth]);

  // 5. Rendimento & Ociosidade
  const rendimentoPercent = useMemo(() => {
    if (totalPlanned <= 0) return totalProduced > 0 ? 100 : 0;
    return Math.min(100, Math.round((totalProduced / totalPlanned) * 1000) / 10);
  }, [totalProduced, totalPlanned]);

  const ociosidadePercent = useMemo(() => {
    const totalHours = workHoursTodayDecimal + idleHoursTodayDecimal;
    if (totalHours <= 0) return 0;
    return Math.min(100, Math.round((idleHoursTodayDecimal / totalHours) * 1000) / 10);
  }, [workHoursTodayDecimal, idleHoursTodayDecimal]);

  // 6. Gráfico Mensal (12 Meses) com Média/Realizado e Meta
  const monthlyChartData = useMemo(() => {
    const grouped = groupProductionByMonth(ops, currentYear);
    const avgHistorical = Math.round(activeMonthGoal * 0.85); // Referência de média anterior

    return grouped.map((item) => {
      let goalVal = activeMonthGoal;
      if (goals && goals.length > 0) {
        const gForMonth = goals.filter(g => g.year === currentYear && g.month === (item.month + 1));
        if (gForMonth.length > 0) {
          goalVal = gForMonth.reduce((sum, g) => sum + g.goalQuantity, 0);
        }
      }
      return {
        monthName: item.label,
        month: item.month,
        realizado: item.quantity,
        mediaAnterior: avgHistorical,
        meta: goalVal,
        isCurrent: item.month === currentMonth,
      };
    });
  }, [ops, goals, currentYear, currentMonth, activeMonthGoal]);

  // 7. Cards de Turno: Manipulação (Bateladas) & Envase (Mil Un)
  const manipCardsData = useMemo(() => {
    const manipOps = ops.filter(o => o.setor === 'Manipulação');
    let turno1 = 0;
    let turno2 = 0;
    const dayTotals: Record<string, number> = {};
    let record = 0;

    for (const o of manipOps) {
      const shift = (o.scheduledShift || '').toLowerCase();
      const qty = Number(o.producedQuantity || 0);
      if (shift.includes('2') || shift.includes('tarde') || shift.includes('noite')) {
        turno2 += qty;
      } else {
        turno1 += qty;
      }

      const dateKey = o.scheduledDate || (o.createdAt ? o.createdAt.substring(0, 10) : 'today');
      dayTotals[dateKey] = (dayTotals[dateKey] || 0) + qty;
      if (dayTotals[dateKey] > record) {
        record = dayTotals[dateKey];
      }
    }

    let bestMonth = 0;
    for (const [key, val] of Object.entries(dayTotals)) {
      if (key.startsWith(`${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`)) {
        if (val > bestMonth) bestMonth = val;
      }
    }
    if (bestMonth === 0 && record > 0) bestMonth = record;

    return {
      turno1,
      turno2,
      melhor: bestMonth,
      record: Math.max(record, bestMonth),
    };
  }, [ops, currentYear, currentMonth]);

  const envaseCardsData = useMemo(() => {
    const envaseOps = ops.filter(o => o.setor === 'Envase' || (!o.setor && o.product));
    let turno1 = 0;
    let turno2 = 0;
    const dayTotals: Record<string, number> = {};
    let record = 0;

    for (const o of envaseOps) {
      const shift = (o.scheduledShift || '').toLowerCase();
      const qty = Number(o.producedQuantity || 0);
      if (shift.includes('2') || shift.includes('tarde') || shift.includes('noite')) {
        turno2 += qty;
      } else {
        turno1 += qty;
      }

      const dateKey = o.scheduledDate || (o.createdAt ? o.createdAt.substring(0, 10) : 'today');
      dayTotals[dateKey] = (dayTotals[dateKey] || 0) + qty;
      if (dayTotals[dateKey] > record) {
        record = dayTotals[dateKey];
      }
    }

    let bestMonth = 0;
    for (const [key, val] of Object.entries(dayTotals)) {
      if (key.startsWith(`${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`)) {
        if (val > bestMonth) bestMonth = val;
      }
    }
    if (bestMonth === 0 && record > 0) bestMonth = record;

    return {
      turno1,
      turno2,
      melhor: bestMonth,
      record: Math.max(record, bestMonth),
    };
  }, [ops, currentYear, currentMonth]);

  // Velocímetro / Cadência (totalProduced / 1000)
  const speedometerValue = useMemo(() => {
    return Math.round(totalProduced / 1000 * 10) / 10;
  }, [totalProduced]);

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-200 selection:bg-blue-600 selection:text-white">
      
      {/* ========================================================================= */}
      {/* NOVO PAINEL DE CONTROLE DE PRODUÇÃO (REFERÊNCIA PCP / OEE) */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        
        {/* ── LINHA 1: KPIs de Volume por Setor ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Card Pesagem (Roxo) */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden transition-all hover:border-purple-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
                PESAGEM ({sectorKpis.pesagem.unidade})
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-950/60 text-purple-300 border border-purple-800/40">
                Setor 1
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.pesagem.mes.toLocaleString('pt-BR')} <span className="text-xs text-[#a1a1aa] font-sans font-semibold">MÊS</span>
                <span className="text-[#71717a] font-normal mx-2">/</span>
                <span className="text-lg text-[#a1a1aa]">{sectorKpis.pesagem.ano.toLocaleString('pt-BR')}</span> <span className="text-[10px] text-[#71717a] font-sans">ANO</span>
              </div>
            </div>
            <div className="text-[10px] text-[#71717a] font-medium flex items-center justify-between border-t border-[#27272a]/60 pt-2">
              <span>Volume acumulado</span>
              <span className="text-purple-400 font-bold">{sectorKpis.pesagem.unidade}</span>
            </div>
          </div>

          {/* Card Manipulação (Ciano) */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden transition-all hover:border-cyan-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
                MANIPULAÇÃO ({sectorKpis.manipulacao.unidade})
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-800/40">
                Setor 2
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.manipulacao.mes.toLocaleString('pt-BR')} <span className="text-xs text-[#a1a1aa] font-sans font-semibold">MÊS</span>
                <span className="text-[#71717a] font-normal mx-2">/</span>
                <span className="text-lg text-[#a1a1aa]">{sectorKpis.manipulacao.ano.toLocaleString('pt-BR')}</span> <span className="text-[10px] text-[#71717a] font-sans">ANO</span>
              </div>
            </div>
            <div className="text-[10px] text-[#71717a] font-medium flex items-center justify-between border-t border-[#27272a]/60 pt-2">
              <span>Massa produzida</span>
              <span className="text-cyan-400 font-bold">{sectorKpis.manipulacao.unidade}</span>
            </div>
          </div>

          {/* Card Envase (Azul) */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden transition-all hover:border-blue-500/40 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                ENVASE ({sectorKpis.envase.unidade})
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-300 border border-blue-800/40">
                Setor 3
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.envase.mes.toLocaleString('pt-BR')} <span className="text-xs text-[#a1a1aa] font-sans font-semibold">MÊS</span>
                <span className="text-[#71717a] font-normal mx-2">/</span>
                <span className="text-lg text-[#a1a1aa]">{sectorKpis.envase.ano.toLocaleString('pt-BR')}</span> <span className="text-[10px] text-[#71717a] font-sans">ANO</span>
              </div>
            </div>
            <div className="text-[10px] text-[#71717a] font-medium flex items-center justify-between border-t border-[#27272a]/60 pt-2">
              <span>Unidades envasadas</span>
              <span className="text-blue-400 font-bold">{sectorKpis.envase.unidade}</span>
            </div>
          </div>

        </div>

        {/* ── LINHA 2: OEE + Velocímetro ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          
          {/* DISPONIBILIDADE */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 flex flex-col items-center justify-between min-h-[145px]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] text-center">
              DISPONIBILIDADE
            </span>
            <div className="relative flex items-center justify-center my-1">
              <svg width="74" height="74" className="-rotate-90">
                <circle cx="37" cy="37" r="30" stroke="#27272a" strokeWidth="6" fill="transparent" />
                {oeeMetrics.disponibilidade !== null && (
                  <circle
                    cx="37"
                    cy="37"
                    r="30"
                    stroke="#3b82f6"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={188.5}
                    strokeDashoffset={188.5 - (Math.min(1, Math.max(0, oeeMetrics.disponibilidade)) * 188.5)}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <span className="absolute text-sm font-black text-[#f4f4f5] font-mono">
                {oeeMetrics.disponibilidade !== null ? `${Math.round(oeeMetrics.disponibilidade * 100)}%` : '—'}
              </span>
            </div>
            <span className="text-[9px] text-[#71717a] font-medium text-center truncate">
              {oeeMetrics.disponibilidade !== null ? 'Tempo de máquina ativo' : 'Aguardando plannedHours'}
            </span>
          </div>

          {/* PERFORMANCE */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 flex flex-col items-center justify-between min-h-[145px]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] text-center">
              PERFORMANCE
            </span>
            <div className="relative flex items-center justify-center my-1">
              <svg width="74" height="74" className="-rotate-90">
                <circle cx="37" cy="37" r="30" stroke="#27272a" strokeWidth="6" fill="transparent" />
                {oeeMetrics.performance !== null && (
                  <circle
                    cx="37"
                    cy="37"
                    r="30"
                    stroke="#06b6d4"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={188.5}
                    strokeDashoffset={188.5 - (Math.min(1, Math.max(0, oeeMetrics.performance)) * 188.5)}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <span className="absolute text-sm font-black text-[#f4f4f5] font-mono">
                {oeeMetrics.performance !== null ? `${Math.round(oeeMetrics.performance * 100)}%` : '—'}
              </span>
            </div>
            <span className="text-[9px] text-[#71717a] font-medium text-center truncate">
              {oeeMetrics.performance !== null ? 'Produzido vs Planejado' : 'Sem ordens ativas'}
            </span>
          </div>

          {/* QUALIDADE */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 flex flex-col items-center justify-between min-h-[145px]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] text-center">
              QUALIDADE
            </span>
            <div className="relative flex items-center justify-center my-1">
              <svg width="74" height="74" className="-rotate-90">
                <circle cx="37" cy="37" r="30" stroke="#27272a" strokeWidth="6" fill="transparent" />
                {oeeMetrics.qualidade !== null && (
                  <circle
                    cx="37"
                    cy="37"
                    r="30"
                    stroke="#22c55e"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={188.5}
                    strokeDashoffset={188.5 - (Math.min(1, Math.max(0, oeeMetrics.qualidade)) * 188.5)}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <span className="absolute text-sm font-black text-[#f4f4f5] font-mono">
                {oeeMetrics.qualidade !== null ? `${Math.round(oeeMetrics.qualidade * 100)}%` : '—'}
              </span>
            </div>
            <span className="text-[9px] text-[#71717a] font-medium text-center truncate">
              {oeeMetrics.qualidade !== null ? 'Itens conformes' : 'Sem rejeições registradas'}
            </span>
          </div>

          {/* OEE GERAL */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 flex flex-col items-center justify-between min-h-[145px] relative overflow-hidden bg-gradient-to-b from-[#18181b] to-[#121214]">
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 text-center flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              OEE GLOBAL
            </span>
            <div className="relative flex items-center justify-center my-1">
              <svg width="74" height="74" className="-rotate-90">
                <circle cx="37" cy="37" r="30" stroke="#27272a" strokeWidth="7" fill="transparent" />
                {oeeMetrics.oee !== null && (
                  <circle
                    cx="37"
                    cy="37"
                    r="30"
                    stroke="#a855f7"
                    strokeWidth="7"
                    fill="transparent"
                    strokeDasharray={188.5}
                    strokeDashoffset={188.5 - (Math.min(1, Math.max(0, oeeMetrics.oee)) * 188.5)}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <span className="absolute text-base font-black text-[#f4f4f5] font-mono">
                {oeeMetrics.oee !== null ? `${Math.round(oeeMetrics.oee * 100)}%` : '—'}
              </span>
            </div>
            <span className="text-[9px] font-bold text-purple-300 px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-800/40">
              {oeeMetrics.oee !== null ? (oeeMetrics.oee >= 0.85 ? 'Classe Mundial' : oeeMetrics.oee >= 0.65 ? 'Operação Típica' : 'Em Otimização') : 'Dados Parciais'}
            </span>
          </div>

          {/* VELOCÍMETRO */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 flex flex-col items-center justify-between min-h-[145px] col-span-2 sm:col-span-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] text-center">
              VELOCÍMETRO
            </span>
            <div className="relative w-28 h-12 flex items-end justify-center overflow-hidden my-1">
              <svg viewBox="0 0 100 50" className="w-28 h-12">
                <path
                  d="M 12 48 A 38 38 0 0 1 88 48"
                  fill="none"
                  stroke="#27272a"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <path
                  d="M 12 48 A 38 38 0 0 1 88 48"
                  fill="none"
                  stroke="url(#speedo-grad)"
                  strokeWidth="8"
                  strokeDasharray="120"
                  strokeDashoffset={120 - Math.min(1, Math.max(0.1, speedometerValue / 100)) * 120}
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="speedo-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="50%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                </defs>
              </svg>
              <div
                className="absolute bottom-0 w-1 h-8 bg-amber-400 origin-bottom rounded-full transition-transform duration-500"
                style={{ transform: `rotate(${-90 + Math.min(1, Math.max(0.05, speedometerValue / 100)) * 180}deg)` }}
              />
              <div className="absolute bottom-0 w-2.5 h-2.5 bg-white rounded-full -mb-1 shadow" />
            </div>
            <div className="text-center">
              <span className="text-sm font-black text-[#f4f4f5] font-mono">
                {speedometerValue}k
              </span>
              <span className="text-[9px] text-[#71717a] font-medium ml-1">prod / 1k</span>
            </div>
          </div>

        </div>

        {/* ── LINHA 3: Gráfico Diário por Turno + Rendimento + Ociosidade ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Gráfico Diário por Turno (8 cols) */}
          <div className="lg:col-span-8 bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between min-h-[300px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-400" />
                    Produção Diária por Turno
                  </h3>
                  <button
                    onClick={() => onNavigateTab('daily_production')}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-bold bg-blue-950/70 border border-blue-800/50 hover:bg-blue-900/60 px-2 py-0.5 rounded-md transition-colors"
                  >
                    Ver Histórico do Dia →
                  </button>
                </div>
                <p className="text-[10px] text-[#71717a] mt-0.5">
                  Volume diário distribuído em 1º e 2º Turnos vs Meta Diária ({dailyGoalValue.toLocaleString('pt-BR')} un/dia)
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-cyan-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500"></span> 1º Turno (Manhã)
                </span>
                <span className="flex items-center gap-1 text-blue-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-600"></span> 2º Turno (Tarde)
                </span>
                <span className="flex items-center gap-1 text-red-400 font-medium">
                  <span className="w-3 h-0.5 bg-red-500 border-t border-dashed"></span> Meta
                </span>
              </div>
            </div>

            <div className="h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyTurnoChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                    formatter={(value: any, name: any) => [
                      `${Number(value || 0).toLocaleString('pt-BR')} un`,
                      name === 'turno1' ? '1º Turno' : name === 'turno2' ? '2º Turno' : name
                    ]}
                    labelFormatter={(label) => `Dia ${label}`}
                  />
                  <ReferenceLine y={dailyGoalValue} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: 'Meta', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />
                  <Bar dataKey="turno1" stackId="a" fill="#06b6d4" radius={[0, 0, 0, 0]} name="1º Turno" />
                  <Bar dataKey="turno2" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} name="2º Turno" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cards Laterais: Rendimento + Ociosidade (4 cols) */}
          <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            
            {/* RENDIMENTO */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  RENDIMENTO GLOBAL
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                  {rendimentoPercent >= 90 ? 'Excelente' : rendimentoPercent >= 75 ? 'Regular' : 'Atenção'}
                </span>
              </div>
              <div className="my-2">
                <div className="text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                  {rendimentoPercent}%
                </div>
                <div className="w-full bg-[#27272a] h-2 rounded-full overflow-hidden mt-2">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, rendimentoPercent))}%` }}
                  />
                </div>
              </div>
              <div className="text-[10px] text-[#71717a] font-medium flex items-center justify-between pt-1 border-t border-[#27272a]/60">
                <span>{totalProduced.toLocaleString('pt-BR')} un realizadas</span>
                <span>Meta: {totalPlanned.toLocaleString('pt-BR')} un</span>
              </div>
            </div>

            {/* OCIOSIDADE */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  OCIOSIDADE DO DIA
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-950/60 text-orange-300 border border-orange-800/40">
                  {ociosidadePercent}%
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl font-black text-[#f4f4f5] tracking-tight font-mono">
                  {idleHoursToday}h {idleMinutesToday}min
                </div>
                <p className="text-[10px] text-[#71717a] mt-1">
                  Tempo acumulado de paradas e espera operacional hoje.
                </p>
              </div>
              <div className="text-[10px] text-[#71717a] font-medium flex items-center justify-between pt-1 border-t border-[#27272a]/60">
                <span>Total histórico: {formattedIdleTotal}</span>
                <span className="text-orange-400 font-bold">{pausedLinesCount} linhas pausadas</span>
              </div>
            </div>

          </div>

        </div>

        {/* ── LINHA 4: Gráfico Mensal 12 Meses + Cards de Turno ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Gráfico Mensal (8 cols) */}
          <div className="lg:col-span-8 bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between min-h-[300px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-400" />
                    Produção Mensal ({currentYear})
                  </h3>
                  <button
                    onClick={() => onNavigateTab('daily_production')}
                    className="text-[10px] text-purple-400 hover:text-purple-300 font-bold bg-purple-950/70 border border-purple-800/50 hover:bg-purple-900/60 px-2 py-0.5 rounded-md transition-colors"
                  >
                    Ver Gráficos Detalhados →
                  </button>
                </div>
                <p className="text-[10px] text-[#71717a] mt-0.5">
                  Comparativo de 12 meses: volume realizado vs média histórica e meta
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#a1a1aa] font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#52525b]"></span> Média Anterior
                </span>
                <span className="flex items-center gap-1 text-red-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500"></span> Realizado
                </span>
                <span className="flex items-center gap-1 text-blue-400 font-medium">
                  <span className="w-3 h-0.5 bg-blue-500 border-t border-dashed"></span> Meta
                </span>
              </div>
            </div>

            <div className="h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="monthName" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                    formatter={(value: any, name: any) => [
                      `${Number(value || 0).toLocaleString('pt-BR')} un`,
                      name === 'realizado' ? 'Realizado' : name === 'mediaAnterior' ? 'Média Anterior' : name
                    ]}
                  />
                  <ReferenceLine y={activeMonthGoal} stroke="#3b82f6" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Meta Mês', fill: '#3b82f6', fontSize: 9, position: 'insideTopRight' }} />
                  <Bar dataKey="mediaAnterior" fill="#3f3f46" radius={[4, 4, 0, 0]} name="Média Anterior" />
                  <Bar dataKey="realizado" fill="#ef4444" radius={[4, 4, 0, 0]} name="Realizado" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cards de Turno: Manipulação e Envase (4 cols) */}
          <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            
            {/* CARD MANIPULAÇÃO: Bateladas */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  MANIPULAÇÃO (Bateladas)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 font-mono">
                  {(manipCardsData.turno1 + manipCardsData.turno2).toLocaleString('pt-BR')} Kg
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 my-2.5">
                <div className="bg-[#121214] border border-[#27272a] rounded-xl p-2.5 text-center">
                  <span className="text-[9px] text-[#a1a1aa] block font-bold">1º TURNO</span>
                  <span className="text-base font-black text-[#f4f4f5] font-mono">{manipCardsData.turno1.toLocaleString('pt-BR')}</span>
                  <span className="text-[8px] text-[#71717a] block">Kg produzidos</span>
                </div>
                <div className="bg-[#121214] border border-[#27272a] rounded-xl p-2.5 text-center">
                  <span className="text-[9px] text-[#a1a1aa] block font-bold">2º TURNO</span>
                  <span className="text-base font-black text-[#f4f4f5] font-mono">{manipCardsData.turno2.toLocaleString('pt-BR')}</span>
                  <span className="text-[8px] text-[#71717a] block">Kg produzidos</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-[#27272a]/60">
                <span className="text-[#a1a1aa]">
                  Melhor Dia: <strong className="text-cyan-400 font-mono">{manipCardsData.melhor.toLocaleString('pt-BR')} Kg</strong>
                </span>
                <span className="text-[#a1a1aa]">
                  Récord: <strong className="text-emerald-400 font-mono">{manipCardsData.record.toLocaleString('pt-BR')} Kg</strong>
                </span>
              </div>
            </div>

            {/* CARD ENVASE: Mil Unidades */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5" />
                  ENVASE (Mil Unidades)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-300 border border-blue-800/40 font-mono">
                  {((envaseCardsData.turno1 + envaseCardsData.turno2) / 1000).toFixed(1)}k Un
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 my-2.5">
                <div className="bg-[#121214] border border-[#27272a] rounded-xl p-2.5 text-center">
                  <span className="text-[9px] text-[#a1a1aa] block font-bold">1º TURNO</span>
                  <span className="text-base font-black text-[#f4f4f5] font-mono">{(envaseCardsData.turno1 / 1000).toFixed(1)}k</span>
                  <span className="text-[8px] text-[#71717a] block">Unidades</span>
                </div>
                <div className="bg-[#121214] border border-[#27272a] rounded-xl p-2.5 text-center">
                  <span className="text-[9px] text-[#a1a1aa] block font-bold">2º TURNO</span>
                  <span className="text-base font-black text-[#f4f4f5] font-mono">{(envaseCardsData.turno2 / 1000).toFixed(1)}k</span>
                  <span className="text-[8px] text-[#71717a] block">Unidades</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-[#27272a]/60">
                <span className="text-[#a1a1aa]">
                  Melhor Dia: <strong className="text-blue-400 font-mono">{(envaseCardsData.melhor / 1000).toFixed(1)}k Un</strong>
                </span>
                <span className="text-[#a1a1aa]">
                  Récord: <strong className="text-emerald-400 font-mono">{(envaseCardsData.record / 1000).toFixed(1)}k Un</strong>
                </span>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* BANNER DE INFORMAÇÕES OPERACIONAIS: HORÁRIO ADMINISTRATIVO & ESTRUTURA DE LINHAS */}
      {/* ========================================================================= */}
      <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Turno Administrativo
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-950 text-blue-400 border border-blue-800/40">
                Seg. a Qui. 07:00 às 17:00 • Sex. 07:00 às 16:00
              </span>
            </div>
            <p className="text-xs text-[#71717a] mt-0.5">
              Fábrica operando com <strong>2 Linhas de Envase</strong> e <strong>1 Linha Sleeve</strong>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-[#a1a1aa] bg-[#171720] border border-[#272734] px-3 py-1.5 rounded-xl font-mono">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>{formattedDate}</span>
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. OS 6 VIBRANT CARDS DE MÉTRICAS (Design Exato do Topo do Print) */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        
        {/* CARD 1: AZUL (Total de OPs Ativas) */}
        <div className="bg-[#3b82f6] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="text-[10px] font-black uppercase tracking-wider text-blue-100">
            TOTAL DE OPS ATIVAS
          </div>
          <div className="text-3xl sm:text-4xl font-black tracking-tight my-1">
            {ops.length}
          </div>
          <div className="text-[10px] text-blue-100/90 font-medium truncate">
            considerando filtros aplicados
          </div>
        </div>

        {/* CARD 2: VERMELHO (Estado Crítico / Atrasadas) */}
        <div className="bg-[#dc2626] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="text-[10px] font-black uppercase tracking-wider text-red-100">
            ESTADO CRÍTICO
          </div>
          <div className="text-3xl sm:text-4xl font-black tracking-tight my-1">
            {totalDelayedOpsCount}
          </div>
          <div className="text-[10px] text-red-100/90 font-medium truncate">
            exigem ação imediata do PPCP
          </div>
        </div>

        {/* CARD 3: LARANJA (Tempo Ocioso Dia / Total / Em Atenção) */}
        <div className="bg-[#f97316] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-orange-100 truncate">
              TEMPO OCIOSO (DIA / TOT)
            </span>
            {WORK_HOURS_ARE_ESTIMATED && (
              <span
                className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0"
                title="Métrica baseada em estimativa do ritmo diário"
              >
                Estimado
              </span>
            )}
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono">
            {idleHoursToday}h {idleMinutesToday}m
          </div>
          <div className="text-[10px] text-orange-100/90 font-medium truncate">
            total: {formattedIdleTotal} ociosos
          </div>
        </div>

        {/* CARD 4: VERDE ESMERALDA (Tempo de Trabalho Dia / Total) */}
        <div className="bg-[#059669] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 truncate">
              TEMPO TRABALHO (DIA)
            </span>
            {WORK_HOURS_ARE_ESTIMATED && (
              <span
                className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0"
                title="Métrica estimada: horas de turno e ritmo médio"
              >
                Estimado
              </span>
            )}
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono flex items-center justify-between">
            <span>{workHoursToday}h {workMinutesToday}m</span>
          </div>
          <div className="text-[10px] text-emerald-100/90 font-medium truncate flex items-center justify-between gap-1">
            <span>total: {workHoursTotal}h {workMinutesTotal}m ativos</span>
            {WORK_HOURS_ARE_ESTIMATED && (
              <span
                className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-1 py-0.2 rounded text-[8px] font-bold"
                title="Total estimado pelo volume produzido"
              >
                Estimado
              </span>
            )}
          </div>
        </div>

        {/* CARD 5: AZUL CIANO (Volume Total Produzido em Unidades) */}
        <div className="bg-[#0284c7] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="text-[10px] font-black uppercase tracking-wider text-sky-100 truncate">
            VOLUME TOTAL (UNIDADES)
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight my-1">
            {totalProduced.toLocaleString()}
          </div>
          <div className="text-[10px] text-sky-100/90 font-medium truncate">
            soma de QUANTIDADE produzida
          </div>
        </div>

        {/* CARD 6: VERDE LIME (Volume Entregue / Concluídas no Mês) */}
        <div className="bg-[#10b981] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[118px] transition-transform hover:scale-[1.01]">
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-100 truncate">
            VOLUME ENTREGUE (MÊS)
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight my-1">
            {monthProducedQuantity.toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-100/90 font-medium truncate">
            {completedOpsMonth} OPs concluídas no mês
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 4. VISÃO CONDICIONAL: FAROL vs CURVA A */}
      {/* ========================================================================= */}
      {activeSubTab === 'farol' ? (
        <>
          {/* 4.1 SEÇÃO: Meta Mensal de Emissão de OPs por Linha (Cards com Status e %) */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
                  Meta Mensal de Emissão de OPs por Linha de Produção
                </h3>
                <p className="text-[11px] text-[#71717a]">
                  Clique num card para filtrar as OPs daquela linha na tabela abaixo
                </p>
              </div>

              <div className="text-[11px] text-[#a1a1aa] font-medium">
                <strong className="text-white">{ops.length} OPs no total</strong> •{' '}
                <strong className="text-emerald-400">{monthProducedQuantity.toLocaleString()} un entregues</strong> (Finalizado + Produzindo) •{' '}
                meta combinada <strong className="text-white">{monthlyGoal.toLocaleString()} un</strong>
              </div>
            </div>

            {/* Grid de Cards de Cada Linha de Produção */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {lines.map((line) => {
                const lineOps = ops.filter((o) => o.lineId === line.id);
                const lineProduced = lineOps.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
                const linePlanned = lineOps.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);
                
                const lineTarget = Math.max(1, Math.round(monthlyGoal / Math.max(1, lines.length)));
                const linePercent = Math.min(Math.round((lineProduced / lineTarget) * 100), 100);

                // Líder alocado pela escala
                const assignedLeader = getLineLeader(line.id);

                // OP ativa / em produção ou próxima na fila
                const activeLineOp = line.currentOpId 
                  ? ops.find(o => o.id === line.currentOpId)
                  : lineOps.find(o => o.status === 'in_progress' || o.status === 'paused')
                  || lineOps.filter(o => o.status === 'pending').sort((a, b) => a.sequence - b.sequence)[0]
                  || null;

                // Categorias de status estilo PCP
                const linePausedOps = lineOps.filter((o) => o.status === 'paused');
                const linePendingOps = lineOps.filter((o) => o.status === 'pending');
                const lineActiveOps = lineOps.filter((o) => o.status === 'in_progress');
                const lineCompletedOps = lineOps.filter((o) => o.status === 'completed');

                const isSelected = selectedLineFilter === line.id;

                return (
                  <div
                    key={line.id}
                    onClick={() => {
                      if (selectedLineFilter === line.id) {
                        setSelectedLineFilter('all');
                      } else {
                        setSelectedLineFilter(line.id);
                      }
                    }}
                    className={`bg-[#121217] border rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all duration-150 hover:border-blue-500/50 hover:bg-[#15151c] ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/30 bg-[#161622]' : 'border-[#22222b]'
                    }`}
                  >
                    <div>
                      {/* Cabeçalho do Card */}
                      <div className="border-b border-[#1f1f28] pb-2.5">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black text-white uppercase tracking-wider">
                            {line.name}
                          </h4>
                          <span className="text-[10px] text-[#71717a] font-semibold">
                            {lineOps.length} OPs • {linePlanned.toLocaleString()} un
                          </span>
                        </div>

                        {/* Líder Escalado */}
                        <div className="flex items-center justify-between mt-1 text-[11px]">
                          <span className="text-[#71717a] flex items-center gap-1">
                            <Users className="w-3 h-3 text-blue-400" />
                            <span>Líder:</span>
                          </span>
                          <span className="font-bold text-blue-300">
                            {assignedLeader?.name || 'Aguardando escala'}
                          </span>
                        </div>

                        {/* OP Atual da Linha */}
                        {activeLineOp && (
                          <div className="mt-1.5 p-1.5 rounded-lg bg-[#181824] border border-[#262638] text-[10px]">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-blue-400">OP {activeLineOp.number}</span>
                              <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] ${
                                activeLineOp.status === 'in_progress' ? 'text-emerald-400 bg-emerald-950/80' :
                                activeLineOp.status === 'paused' ? 'text-amber-400 bg-amber-950/80' : 'text-blue-300 bg-blue-950/80'
                              }`}>
                                {activeLineOp.status === 'in_progress' ? 'Produzindo' : activeLineOp.status === 'paused' ? 'Pausada' : 'Fila'}
                              </span>
                            </div>
                            <p className="text-[#f4f4f5] font-medium truncate mt-0.5" title={activeLineOp.product}>
                              {activeLineOp.product}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Lista com Marcadores Quadrados Coloridos (Estilo Exato da Imagem) */}
                      <div className="space-y-2 py-3 text-xs">
                        
                        {/* Item 1: Parada / Ociosa */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#ef4444] shrink-0" />
                            <span className="text-[#a1a1aa] font-medium text-[11px]">Parada / Ociosa</span>
                          </div>
                          <span className="font-bold text-white text-[11px]">
                            {line.status === 'paused' ? '45 min' : '0 min'} • <strong className="text-red-400">{linePausedOps.length} OPs</strong>
                          </span>
                        </div>

                        {/* Item 2: Falta separar MP / Setup */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#f97316] shrink-0" />
                            <span className="text-[#a1a1aa] font-medium text-[11px]">Em Fila / Estoque</span>
                          </div>
                          <span className="font-bold text-white text-[11px]">
                            {linePendingOps.reduce((acc, o) => acc + o.plannedQuantity, 0).toLocaleString()} un • <strong className="text-orange-400">{linePendingOps.length} OPs</strong>
                          </span>
                        </div>

                        {/* Item 3: Na indústria / Em Produção */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#3b82f6] shrink-0" />
                            <span className="text-[#a1a1aa] font-medium text-[11px]">Em Produção</span>
                          </div>
                          <span className="font-bold text-white text-[11px]">
                            {lineActiveOps.reduce((acc, o) => acc + o.producedQuantity, 0).toLocaleString()} un • <strong className="text-blue-400">{lineActiveOps.length} OPs</strong>
                          </span>
                        </div>

                        {/* Item 4: Finalizado / Entregue */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#10b981] shrink-0" />
                            <span className="text-[#a1a1aa] font-medium text-[11px]">Finalizado</span>
                          </div>
                          <span className="font-bold text-white text-[11px]">
                            {lineCompletedOps.reduce((acc, o) => acc + o.producedQuantity, 0).toLocaleString()} un • <strong className="text-emerald-400">{lineCompletedOps.length} OPs</strong>
                          </span>
                        </div>

                      </div>
                    </div>

                    {/* Rodapé do Card: Meta de Produção + Barra de Progresso + Percentual Vermelho/Verde */}
                    <div className="pt-2.5 border-t border-[#1f1f28] space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-bold text-[#71717a] uppercase tracking-wider truncate">
                          META DE PRODUÇÃO • ENTREGUE
                        </span>
                        <span className={`text-base font-black ${
                          linePercent >= 70 ? 'text-emerald-400' : linePercent >= 35 ? 'text-orange-400' : 'text-rose-500'
                        }`}>
                          {linePercent}%
                        </span>
                      </div>

                      {/* Barra de Progresso Vermelha / Verde */}
                      <div className="w-full h-1.5 bg-[#1f1f28] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            linePercent >= 70 ? 'bg-emerald-500' : linePercent >= 35 ? 'bg-orange-500' : 'bg-rose-600'
                          }`}
                          style={{ width: `${Math.max(linePercent, 4)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-[#71717a] font-medium pt-0.5">
                        <span>{lineProduced.toLocaleString()} un ({lineCompletedOps.length} OPs)</span>
                        <span>meta {lineTarget.toLocaleString()} un</span>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>

          {/* 4.2 BARRA DE FILTROS PCP (Estilo Exato do Formulário de Filtros da Imagem) */}
          <div className="bg-[#0f0f14] border border-[#22222b] rounded-2xl p-4 shadow-lg space-y-4">
            
            {/* Linha 1: Input de Busca + Dropdowns de Linha e Situação + Filtros de Prioridade */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              
              {/* BUSCAR PRODUTO / LOTE */}
              <div className="md:col-span-4 space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider block">
                  BUSCAR PRODUTO / LOTE / OP
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Ex: SHAMPOO ou 40236"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full h-9 bg-[#16161d] border border-[#292936] rounded-xl pl-9 pr-3 text-xs text-white placeholder-[#52525b] focus:outline-none focus:border-blue-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* INDÚSTRIA / LINHA */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider block">
                  LINHA
                </label>
                <select
                  value={selectedLineFilter}
                  onChange={(e) => setSelectedLineFilter(e.target.value)}
                  className="w-full h-9 bg-[#16161d] border border-[#292936] rounded-xl px-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Todas as Linhas</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* SITUAÇÃO OP */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider block">
                  SITUAÇÃO OP
                </label>
                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value)}
                  className="w-full h-9 bg-[#16161d] border border-[#292936] rounded-xl px-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Todas as Situações</option>
                  <option value="in_progress">Em Produção</option>
                  <option value="paused">Pausada</option>
                  <option value="pending">Fila / Pendente</option>
                  <option value="completed">Concluída</option>
                </select>
              </div>

              {/* PRIORIDADE (Botões de Alternância Pills) */}
              <div className="md:col-span-4 space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider block">
                    PRIORIDADE
                  </label>
                  {(searchTerm || selectedLineFilter !== 'all' || selectedStatusFilter !== 'all' || selectedPriorityFilter !== 'Todas') && (
                    <button
                      onClick={handleClearFilters}
                      className="text-[10px] text-[#a1a1aa] hover:text-rose-400 font-bold flex items-center gap-1 transition-colors"
                      title="Limpar todos os filtros"
                    >
                      <X className="w-3 h-3" />
                      <span>Limpar</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                  {['Todas', 'Crítico', 'Atenção', 'Normal'].map((pri) => (
                    <button
                      key={pri}
                      onClick={() => setSelectedPriorityFilter(pri)}
                      className={`px-3 py-1 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
                        selectedPriorityFilter === pri
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-[#181820] text-[#71717a] hover:text-[#d4d4d8] border border-[#262633]'
                      }`}
                    >
                      {pri}
                    </button>
                  ))}
                </div>
              </div>

            </div>

          </div>

          {/* 4.3 TABELA FAROL DE OPS — STATUS DE PRODUÇÃO E GARGALOS */}
          <div className="bg-[#0f0f14] border border-[#22222b] rounded-2xl shadow-xl overflow-hidden">
            
            {/* Título da Tabela */}
            <div className="p-4 border-b border-[#1f1f28] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
                  FAROL DE OPS — STATUS DE PRODUÇÃO E GARGALOS
                </h3>
                <span className="text-xs font-bold text-blue-400 bg-blue-950/60 border border-blue-900/40 px-2 py-0.5 rounded-lg">
                  {filteredOps.length} OP(s)
                </span>
                {INTEGRATIONS_ARE_MOCKED && (
                  <span
                    className="inline-flex items-center gap-1 bg-amber-950/80 text-amber-300 border border-amber-700/60 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide cursor-help"
                    title="Integração Farol / EstoqueMais em modo simulado. Valores fictícios para testes."
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    Farol Simulado
                  </span>
                )}
              </div>

              <button
                onClick={() => onNavigateTab('ops')}
                className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <span>Ver Todas na Fila</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tabela de Dados */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#14141c] text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] border-b border-[#20202a]">
                    <th className="py-3 px-4">PRODUTO</th>
                    <th className="py-3 px-3">LOTE / OP</th>
                    <th className="py-3 px-3 text-right">QTD PLANEJADA</th>
                    <th className="py-3 px-3 text-right">PRODUZIDO</th>
                    <th className="py-3 px-3">PROGRESSO</th>
                    <th className="py-3 px-3">LINHA</th>
                    <th className="py-3 px-3 text-center">SITUAÇÃO</th>
                    <th className="py-3 px-3 text-center bg-[#092e20]/40 text-[#34d399]">
                      <div className="flex items-center justify-center gap-1">
                        <span>STATUS ME</span>
                        {INTEGRATIONS_ARE_MOCKED && (
                          <span
                            className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-1 py-0.2 rounded text-[9px] font-bold"
                            title="Dado de embalagem simulado — integração com estoque pendente"
                          >
                            Simulado
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center bg-[#092e20]/40 text-[#34d399]">STATUS MP</th>
                    <th className="py-3 px-3 text-center bg-[#1e1b4b]/40 text-[#818cf8]">TEMPO PARADO</th>
                    <th className="py-3 px-3 text-center">PRIORIDADE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1c1c25] text-xs">
                  {filteredOps.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-[#71717a]">
                        <Box className="w-8 h-8 text-[#3f3f46] mx-auto mb-2" />
                        <p className="text-sm font-bold text-[#a1a1aa]">Nenhuma Ordem de Produção encontrada</p>
                        <p className="text-xs mt-0.5">Tente ajustar os filtros ou cadastrar uma nova OP.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredOps.map((op) => {
                      const line = lines.find((l) => l.id === op.lineId);
                      const progress = op.plannedQuantity > 0 ? Math.min(Math.round((op.producedQuantity / op.plannedQuantity) * 100), 100) : 0;
                      
                      // Status ME / MP
                      const isMEAvailable = op.packageAvailability !== 0;
                      const isMPAvailable = op.status !== 'paused' || op.packageAvailability !== 0;

                      // Dias ou Tempo Parado
                      const isPaused = op.status === 'paused';

                      return (
                        <tr
                          key={op.id}
                          className="hover:bg-[#15151e] transition-colors group cursor-default"
                        >
                          {/* PRODUTO */}
                          <td className="py-3.5 px-4 font-bold text-white max-w-[220px]">
                            <div className="truncate" title={op.product}>
                              {op.product}
                            </div>
                          </td>

                          {/* LOTE / OP */}
                          <td className="py-3.5 px-3 font-mono font-bold text-blue-400">
                            OP #{op.number}
                          </td>

                          {/* QTD PLANEJADA */}
                          <td className="py-3.5 px-3 font-mono font-bold text-right text-[#d4d4d8]">
                            {op.plannedQuantity.toLocaleString()} un
                          </td>

                          {/* PRODUZIDO */}
                          <td className="py-3.5 px-3 font-mono font-bold text-right text-emerald-400">
                            {op.producedQuantity.toLocaleString()} un
                          </td>

                          {/* PROGRESSO */}
                          <td className="py-3.5 px-3 min-w-[120px]">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] text-[#71717a]">
                                <span className="font-bold text-white">{progress}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#20202b] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    progress >= 100
                                      ? 'bg-emerald-500'
                                      : progress >= 50
                                      ? 'bg-blue-500'
                                      : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* LINHA */}
                          <td className="py-3.5 px-3 font-semibold text-[#a1a1aa] whitespace-nowrap">
                            {line ? line.name : <span className="text-[#52525b] italic">Fila Geral</span>}
                          </td>

                          {/* SITUAÇÃO */}
                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            {op.status === 'in_progress' ? (
                              <span className="bg-blue-950 text-blue-400 border border-blue-800/60 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                                EM PRODUÇÃO
                              </span>
                            ) : op.status === 'paused' ? (
                              <span className="bg-amber-950 text-amber-400 border border-amber-800/60 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                                PAUSADA
                              </span>
                            ) : op.status === 'completed' ? (
                              <span className="bg-emerald-950 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                                CONCLUÍDA
                              </span>
                            ) : (
                              <span className="bg-[#1f1f28] text-[#a1a1aa] border border-[#2c2c38] px-2 py-0.5 rounded text-[10px] font-black uppercase">
                                FILA
                              </span>
                            )}
                          </td>

                          {/* STATUS ME (Material de Embalagem) */}
                          <td className="py-3.5 px-3 text-center whitespace-nowrap bg-[#092e20]/10">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isMEAvailable
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                                : 'bg-red-950/80 text-red-300 border border-red-800/50'
                            }`}>
                              {isMEAvailable ? 'Separada' : 'Aguardando ME'}
                            </span>
                          </td>

                          {/* STATUS MP (Matéria-Prima) */}
                          <td className="py-3.5 px-3 text-center whitespace-nowrap bg-[#092e20]/10">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isMPAvailable
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                                : 'bg-amber-950/80 text-amber-300 border border-amber-800/50'
                            }`}>
                              {isMPAvailable ? 'Disponível' : 'Aguardando separação'}
                            </span>
                          </td>

                          {/* DIAS / TEMPO PARADO */}
                          <td className="py-3.5 px-3 text-center whitespace-nowrap bg-[#1e1b4b]/10">
                            <div className="flex items-center justify-center gap-1.5">
                              {isPaused ? (
                                <>
                                  <div className="w-8 h-1 bg-red-500 rounded-full" />
                                  <span className="text-[11px] font-bold font-mono text-red-400">12 min</span>
                                </>
                              ) : (
                                <span className="text-[10px] text-[#52525b] font-mono">—</span>
                              )}
                            </div>
                          </td>

                          {/* PRIORIDADE */}
                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              op.priority === 'Crítica'
                                ? 'bg-red-950 text-red-400 border border-red-800/60 animate-pulse'
                                : op.priority === 'Alta'
                                ? 'bg-orange-950 text-orange-400 border border-orange-800/60'
                                : op.priority === 'Baixa'
                                ? 'bg-[#1a1a24] text-[#71717a] border border-[#272736]'
                                : 'bg-blue-950/70 text-blue-400 border border-blue-800/40'
                            }`}>
                              {op.priority || 'Normal'}
                            </span>
                          </td>

                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Rodapé da Tabela com Resumo de Totais */}
            <div className="p-3 bg-[#121219] border-t border-[#1f1f28] flex items-center justify-between text-xs text-[#71717a]">
              <div>
                Exibindo <strong>{filteredOps.length}</strong> de <strong>{ops.length}</strong> ordens de produção
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span>Volume Filtrado: <strong className="text-white">{filteredOps.reduce((acc, o) => acc + o.plannedQuantity, 0).toLocaleString()} un</strong></span>
                <span>Produzido: <strong className="text-emerald-400">{filteredOps.reduce((acc, o) => acc + o.producedQuantity, 0).toLocaleString()} un</strong></span>
              </div>
            </div>

          </div>
        </>
      ) : (
        /* ========================================================================= */
        /* 4.4 SEÇÃO: CURVA A (PARETO DE PRODUTOS E CLASSIFICAÇÃO ABC) */
        /* ========================================================================= */
        <div className="space-y-6 pt-2 animate-in fade-in duration-150">
          <div className="bg-[#0f0f14] border border-[#22222b] rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#1f1f28] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-400" />
                  Classificação ABC de Produtos (Pareto 80/20)
                </h3>
                <p className="text-xs text-[#71717a]">
                  Os produtos Classe A representam o núcleo estratégico da demanda da fábrica Ybera.
                </p>
              </div>
              <span className="text-xs font-bold text-blue-400 bg-blue-950/60 border border-blue-900/40 px-2.5 py-1 rounded-lg">
                {curvaAData.length} Produtos Analisados
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#14141c] border border-emerald-500/30 p-4 rounded-xl">
                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">CLASSE A (ALTO IMPACTO)</span>
                <p className="text-2xl font-black text-white mt-1">
                  {curvaAData.filter(p => p.category === 'A').length} Produtos
                </p>
                <p className="text-[11px] text-[#71717a] mt-1">Representam até 70% do volume total planejado da fábrica.</p>
              </div>

              <div className="bg-[#14141c] border border-blue-500/30 p-4 rounded-xl">
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">CLASSE B (MÉDIO IMPACTO)</span>
                <p className="text-2xl font-black text-white mt-1">
                  {curvaAData.filter(p => p.category === 'B').length} Produtos
                </p>
                <p className="text-[11px] text-[#71717a] mt-1">Representam os próximos 20% do volume da carteira.</p>
              </div>

              <div className="bg-[#14141c] border border-zinc-700/50 p-4 rounded-xl">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">CLASSE C (CAUDA LONGA)</span>
                <p className="text-2xl font-black text-white mt-1">
                  {curvaAData.filter(p => p.category === 'C').length} Produtos
                </p>
                <p className="text-[11px] text-[#71717a] mt-1">Representam os últimos 10% do volume com menor rotatividade.</p>
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#14141c] text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] border-b border-[#20202a]">
                    <th className="py-3 px-4">RANKING</th>
                    <th className="py-3 px-4">PRODUTO</th>
                    <th className="py-3 px-3 text-right">VOL. PLANEJADO</th>
                    <th className="py-3 px-3 text-right">VOL. PRODUZIDO</th>
                    <th className="py-3 px-3 text-center">PARTICIPAÇÃO %</th>
                    <th className="py-3 px-3 text-center">ACUMULADO %</th>
                    <th className="py-3 px-3 text-center">CLASSE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1c1c25] text-xs">
                  {curvaAData.map((prod, idx) => (
                    <tr key={idx} className="hover:bg-[#161622] transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#71717a]">
                        #{idx + 1}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {prod.product}
                      </td>
                      <td className="py-3 px-3 font-mono text-right text-[#d4d4d8] font-bold">
                        {prod.planned.toLocaleString()} un
                      </td>
                      <td className="py-3 px-3 font-mono text-right text-emerald-400 font-bold">
                        {prod.produced.toLocaleString()} un
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-[#a1a1aa]">
                        {prod.sharePct}%
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-blue-400">
                        {prod.cumPct}%
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          prod.category === 'A'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            : prod.category === 'B'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800/60'
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        }`}>
                          CLASSE {prod.category}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
