import React, { useState, useMemo, useCallback } from 'react';
import {
  Users,
  Calendar,
  Share2,
  Eye,
  LayoutDashboard,
} from 'lucide-react';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, MonthlyGoal } from '../types';
import { groupProductionByDayAndSetor, groupProductionByMonth, saveMonthlyGoal } from '../services/db';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
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
  onNavigateTab?: (tab: 'lines' | 'ops' | 'users' | 'events' | 'daily_production') => void;
  onNewOp?: () => void;
  onOpenShareModal?: () => void;
  isReadOnly?: boolean;
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
  onOpenShareModal,
  isReadOnly = false,
}: HomeDashboardProps) {
  // Constante para indicar estimativa visual nas métricas operacionais não auditadas
  const WORK_HOURS_ARE_ESTIMATED = true;

  const currentCalendarYear = new Date().getFullYear();
  const currentCalendarMonth = new Date().getMonth() + 1;

  const currentMonthGoalFromDb = useMemo(() => {
    if (goals && goals.length > 0) {
      const found = goals.filter(g => g.year === currentCalendarYear && g.month === currentCalendarMonth);
      if (found.length > 0) {
        return found.reduce((acc, g) => acc + (g.goalQuantity || 0), 0);
      }
    }
    return 100000;
  }, [goals, currentCalendarYear, currentCalendarMonth]);

  const [customGoal, setCustomGoal] = useState<number | null>(null);
  const monthlyGoal = customGoal !== null ? customGoal : currentMonthGoalFromDb;
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [tempGoal, setTempGoal] = useState(monthlyGoal.toString());

  const handleSaveGoal = async () => {
    const val = parseInt(tempGoal, 10);
    if (!isNaN(val) && val > 0) {
      setCustomGoal(val);
      try {
        await saveMonthlyGoal({
          lineId: 'line-1',
          year: currentCalendarYear,
          month: currentCalendarMonth,
          goalQuantity: val,
        });
      } catch (err) {
        console.warn('Erro ao persistir meta mensal no Supabase:', err);
      }
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

  // 2. Meta Diária do Mês Atual
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

  // 4. Gráfico Mensal (12 Meses) com Média/Realizado e Meta
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

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-200 selection:bg-blue-600 selection:text-white">
      
      {/* ========================================================================= */}
      {/* NOVO PAINEL DE CONTROLE DE PRODUÇÃO (REFERÊNCIA PCP / OEE) */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        
        {/* ── BARRA DE TOPO DO DASHBOARD: STATUS & BOTÃO DE COMPARTILHAMENTO ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111116] border border-[#202028] p-3.5 sm:p-4 rounded-2xl shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-950/70 border border-blue-800/50 flex items-center justify-center text-blue-400 shrink-0">
              <LayoutDashboard className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                  Indicadores Globais de Fábrica
                </h2>
                <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Ao Vivo
                </span>
                {isReadOnly && (
                  <span className="text-[10px] bg-amber-950/70 text-amber-300 border border-amber-800/50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Somente Leitura
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#71717a] mt-0.5">
                Monitoramento consolidado de Pesagem, Manipulação e Linhas de Envase
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isReadOnly && onOpenShareModal && (
              <button
                id="btn-open-share-dashboard"
                type="button"
                onClick={onOpenShareModal}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600/20 to-indigo-600/20 hover:from-blue-600/30 hover:to-indigo-600/30 border border-blue-500/40 text-blue-300 hover:text-white text-xs font-bold transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                title="Gerar link de visualização para enviar a diretores ou clientes"
              >
                <Share2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Gerar Link de Visualização</span>
              </button>
            )}
          </div>
        </div>

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

        {/* ── 2. OS 6 VIBRANT CARDS DE MÉTRICAS OPERACIONAIS ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          
          {/* CARD 1: AZUL (OPs Ativas) */}
          <div className="bg-[#3b82f6] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="text-[10px] font-black uppercase tracking-wider text-blue-100">
              OPS ATIVAS
            </div>
            <div className="text-3xl sm:text-4xl font-black tracking-tight my-1">
              {ops.length}
            </div>
          </div>

          {/* CARD 2: VERMELHO (Alta Prioridade) */}
          <div className="bg-[#dc2626] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="text-[10px] font-black uppercase tracking-wider text-red-100">
              ALTA PRIORIDADE
            </div>
            <div className="text-3xl sm:text-4xl font-black tracking-tight my-1">
              {totalDelayedOpsCount}
            </div>
          </div>

          {/* CARD 3: ÂMBAR (Tempo Ocioso) */}
          <div className="bg-[#d97706] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-100 truncate">
                TEMP OCIOSO
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
          </div>

          {/* CARD 4: VERDE ESMERALDA (Tempo Trabalhado) */}
          <div className="bg-[#059669] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 truncate">
                TEMP TRABALHADO
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
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono">
              {workHoursToday}h {workMinutesToday}m
            </div>
          </div>

          {/* CARD 5: ÍNDIGO (Total Produzido) */}
          <div className="bg-[#4f46e5] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="text-[10px] font-black uppercase tracking-wider text-indigo-100 truncate">
              TOTAL PRODUZIDO
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1">
              {totalProduced.toLocaleString()}
            </div>
          </div>

          {/* CARD 6: VERDE ESMERALDA CLARO (OP Finalizadas) */}
          <div className="bg-[#10b981] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-center min-h-[100px] transition-transform hover:scale-[1.01]">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-100 truncate">
              OPS FINALIZADAS
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1">
              {completedOpsMonth.toLocaleString()}
            </div>
          </div>

        </div>

        {/* ── 3. Gráfico Mensal 12 Meses ── */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between min-h-[300px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-purple-400" />
                  Produção Mensal ({currentYear})
                </h3>
                {!isReadOnly && onNavigateTab && (
                  <button
                    onClick={() => onNavigateTab('daily_production')}
                    className="text-[10px] text-purple-400 hover:text-purple-300 font-bold bg-purple-950/70 border border-purple-800/50 hover:bg-purple-900/60 px-2 py-0.5 rounded-md transition-colors"
                  >
                    Ver Gráficos Detalhados →
                  </button>
                )}
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

      </div>

      {/* ========================================================================= */}
      {/* 4. META MENSAL DE EMISSÃO DE OPS POR LINHA */}
      {/* ========================================================================= */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
              Meta Mensal de Emissão de OPs por Linha de Produção
            </h3>
            <p className="text-[11px] text-[#71717a]">
              Acompanhamento de metas e status operacional por linha de envase
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

            return (
              <div
                key={line.id}
                onClick={() => !isReadOnly && onNavigateTab && onNavigateTab('lines')}
                className={`bg-[#121217] border border-[#22222b] rounded-2xl p-4 flex flex-col justify-between transition-all duration-150 ${
                  !isReadOnly && onNavigateTab
                    ? 'cursor-pointer hover:border-blue-500/50 hover:bg-[#15151c]'
                    : 'cursor-default'
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

    </div>
  );
}
