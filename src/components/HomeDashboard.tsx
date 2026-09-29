import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Users,
  Calendar,
  Share2,
  LayoutDashboard,
  Clock,
  FlaskConical,
  Sparkles,
  Filter,
  Boxes,
} from 'lucide-react';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, MonthlyGoal, LineDailyGoal, FactoryMonthlyGoal, WorkSession, LineHeadcount, LineChangeover } from '../types';
import { groupProductionByDayAndSetor, groupProductionByMonth, groupProductionByHour, calculateOEE, toLocalDateStr, getOpReferenceDateStr, buildPartialProductionRecords, getPartialOpsInStock, getWorkSessions, getOpenWorkSession, isPartialFinishEvent, getLineHeadcounts, getHeadcountForLineDay, computePersonHours, computeProductionByLineAndDay, getChangeovers, getOpenChangeover } from '../services/db';
import { SetupHistory } from './SetupHistory';
import { calculateProductionTime, calculateProductionRatePerHour, formatMsToHoursMinutes, getAutoShiftNow } from '../lib/productionTime';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  Tooltip,
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
  /** Meta mensal ÚNICA da fábrica (tabela factory_monthly_goal), editada via GoalsModal na Sidebar. */
  factoryMonthlyGoal?: number | null;
  /** Metas mensais da fábrica de TODOS os meses do ano — usada pra mostrar a
   * meta certa de cada mês no gráfico "Produção Mensal" (cada mês tem a sua
   * própria meta, em vez de repetir a meta do mês atual pro ano inteiro). */
  factoryMonthlyGoals?: FactoryMonthlyGoal[];
  /** Metas diárias fixas por linha (tabela line_daily_goals), editadas via GoalsModal na Sidebar. */
  lineDailyGoals?: LineDailyGoal[];
  onNavigateTab?: (tab: 'cronograma' | 'ops' | 'users' | 'events' | 'daily_production') => void;
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

/**
 * Formata um intervalo em milissegundos como um cronômetro "HH:MM:SS".
 * Usado para os timers de produção em tempo real (Manipulação, Envase, Sleeve).
 */
export function formatElapsedTimer(ms: number): string {
  const safeMs = Math.max(0, ms || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function HomeDashboard({
  lines,
  ops,
  leaders,
  allUsers,
  events,
  rotations = {},
  goals = [],
  factoryMonthlyGoal = null,
  factoryMonthlyGoals = [],
  lineDailyGoals = [],
  onNavigateTab,
  onOpenShareModal,
  isReadOnly = false,
}: HomeDashboardProps) {

  const currentCalendarYear = new Date().getFullYear();
  const currentCalendarMonth = new Date().getMonth() + 1;

  const currentMonthGoalFromDb = useMemo(() => {
    if (goals && goals.length > 0) {
      const found = goals.filter(g => g.year === currentCalendarYear && g.month === currentCalendarMonth);
      if (found.length > 0) {
        return found.reduce((acc, g) => acc + (g.goalQuantity || 0), 0);
      }
    }
    // Sem meta cadastrada = 0 (sem meta). Antes caía num valor fixo de 100.000.
    return 0;
  }, [goals, currentCalendarYear, currentCalendarMonth]);

  // Meta mensal: prioriza a meta ÚNICA da fábrica (factory_monthly_goal,
  // editada via botão "Metas de Produção" na Sidebar); só cai para o cálculo
  // legado por linha (monthly_goals) enquanto a meta da fábrica ainda não
  // tiver sido configurada. Edição acontece exclusivamente pelo GoalsModal —
  // não há mais edição inline aqui.
  const monthlyGoal = (factoryMonthlyGoal !== null && factoryMonthlyGoal !== undefined)
    ? factoryMonthlyGoal
    : currentMonthGoalFromDb;

  // Resolve a meta diária fixa de uma linha específica (line_daily_goals).
  const getLineDailyGoal = useCallback((lineId: string): number | null => {
    const found = lineDailyGoals.find(g => g.lineId === lineId);
    return found ? found.goalQuantity : null;
  }, [lineDailyGoals]);

  // ---------------- RELÓGIO PARA OS TIMERS DE PRODUÇÃO EM TEMPO REAL ----------------
  // Atualiza a cada segundo para os cronômetros de Manipulação/Envase/Sleeve
  // andarem "ao vivo" na tela, sem precisar recarregar os dados.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Encontra o horário real de início de produção de uma OP a partir do
  // evento STARTED mais recente (uma pausa/retomada não reinicia o timer,
  // pois gera um evento RESUMED, não um novo STARTED).
  const getOpStartTime = useCallback((opId: string): Date | null => {
    const startedEvents = (events || []).filter(e => e.opId === opId && e.type === 'STARTED');
    if (startedEvents.length === 0) return null;
    const latest = startedEvents.reduce((a, b) =>
      new Date(a.createdAt).getTime() > new Date(b.createdAt).getTime() ? a : b
    );
    const d = new Date(latest.createdAt);
    return isNaN(d.getTime()) ? null : d;
  }, [events]);

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

  // Divide as linhas cadastradas em dois grupos pro espelho em tempo real:
  // Reatores da Manipulação (reator-1/2/3) de um lado, Envase/Sleeve do outro
  // — pra não misturar os dois setores num grid só e confundir quem olha.
  const reactorLines = useMemo(
    () => lines.filter(l => /reator/i.test(l.id) || /reator/i.test(l.name)),
    [lines]
  );
  const envaseLines = useMemo(
    () => lines.filter(l => !(/reator/i.test(l.id) || /reator/i.test(l.name))),
    [lines]
  );

  // ---------------- CÁLCULOS DAS 8 MÉTRICAS PRINCIPAIS ----------------
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // ---------------- CONCLUSÕES PARCIAIS ----------------
  // A produção de cada conclusão parcial entra nas SOMAS e gráficos como um
  // registro virtual (partialRecords), no dia/hora em que foi apontada — mas
  // NÃO conta como OP finalizada (os contadores de OPs usam só `ops`).
  const partialRecords = useMemo(() => buildPartialProductionRecords(ops, events), [ops, events]);
  const productionOps = useMemo(() => (partialRecords.length > 0 ? [...ops, ...partialRecords] : ops), [ops, partialRecords]);

  // OPs parciais que ainda estão no estoque aguardando o resto do envase —
  // o contador some do dashboard quando não sobra nenhuma.
  const partialOpsInStock = useMemo(() => getPartialOpsInStock(ops, events), [ops, events]);

  // 1. Total Produzidos e Planejados
  const totalProduced = useMemo(() => {
    return productionOps.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
  }, [productionOps]);

  const totalPlanned = useMemo(() => {
    return ops.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);
  }, [ops]);

  // Volume do Mês Atual
  // Conta no mês em que a produção aconteceu (fechamento/parcial), não no mês
  // em que a OP foi criada.
  const opsThisMonth = useMemo(() => {
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    return productionOps.filter((o) => getOpReferenceDateStr(o).startsWith(monthKey));
  }, [productionOps, currentMonth, currentYear]);

  const monthProducedQuantity = useMemo(() => {
    return opsThisMonth.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
  }, [opsThisMonth]);

  // Porcentagem da Meta Mensal
  const monthlyGoalPercentage = useMemo(() => {
    if (monthlyGoal <= 0) return 0;
    return Math.min(Math.round((monthProducedQuantity / monthlyGoal) * 100 * 10) / 10, 100);
  }, [monthProducedQuantity, monthlyGoal]);

  const totalCompletedOps = useMemo(() => {
    return ops.filter((o) => o.status === 'completed').length;
  }, [ops]);

  // OPs realmente ativas (Card 1) — exclui as já concluídas, que não devem
  // contar como "ativas" mesmo continuando na lista de ops.
  const activeOpsCount = useMemo(() => {
    return ops.filter((o) => o.status !== 'completed').length;
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

  // 4. Tempos de Trabalho e Ociosidade (Dia e Total) - Baseados em Eventos Reais (OEE)
  // Recalculado a partir do relógio (nowTick): antes era fixado uma única vez
  // ao abrir a tela ([] nas dependências), então um dashboard deixado aberto
  // (TV da fábrica, tablet) continuava mostrando ONTEM como "Hoje" depois da
  // meia-noite. Como o valor é uma string, os cálculos que dependem dele só
  // recalculam quando o dia de fato muda.
  const todayDateStr = toLocalDateStr(new Date(nowTick).toISOString());

  const completedOpsTodayCount = useMemo(() => {
    return ops.filter((o) => {
      if (o.status !== 'completed') return false;
      // Dia LOCAL do fechamento (antes era o dia em UTC: OP fechada após as 21h caía amanhã)
      const opDate = getOpReferenceDateStr(o);
      return opDate === todayDateStr && /^4/.test(String(o.number).trim());
    }).length;
  }, [ops, todayDateStr]);

  // Métricas exatas de Tempo de HOJE (calculadas a partir dos eventos reais gravados no sistema)
  // — usadas pelo espelho de produção em tempo real (Manipulação/linhas), que
  // é sempre "agora", independente do filtro de período do dashboard.
  // ---------------- EXPEDIENTE (Iniciar / Encerrar expediente) ----------------
  // Com o expediente, o ocioso de cada linha passa a ser "tempo de expediente
  // − tempo trabalhado": uma OP pausada no fim do dia não conta mais como
  // parada a noite inteira. Enquanto a tabela work_sessions não existir, vem
  // lista vazia e cada dia usa só o trecho entre o 1º e o último trabalho.
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getWorkSessions().then(list => { if (!cancelled) setWorkSessions(list); }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Trocas de produto (botão "Iniciar troca" do líder de Envase)
  const [changeovers, setChangeovers] = useState<LineChangeover[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getChangeovers().then(list => { if (!cancelled) setChangeovers(list); }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Equipe por linha (colaboradores presentes e faltas), informada pelo líder
  const [headcounts, setHeadcounts] = useState<LineHeadcount[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getLineHeadcounts().then(list => { if (!cancelled) setHeadcounts(list); }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const todayProductionTime = useMemo(() => {
    return calculateProductionTime(events, ops, lines, {
      targetDate: todayDateStr,
      referenceTime: nowTick,
      workSessions,
      changeovers,
    });
  }, [events, ops, lines, todayDateStr, nowTick, workSessions, changeovers]);

  // Total de pausas registradas hoje
  const totalTodayPausesCount = useMemo(() => {
    return Object.values(todayProductionTime.byLine).reduce((acc, l: any) => acc + (l?.pauseCount || 0), 0);
  }, [todayProductionTime]);

  // ---------------- FILTRO DE PERÍODO: DIA / MÊS / ANO / GERAL ----------------
  // Controla o Índice de Ociosidade, o Tempo Trabalhado e os componentes do
  // OEE (cards 3, 4, 6 e os 3 retângulos) — o espelho em tempo real acima
  // continua sempre "hoje".
  const [dashboardPeriod, setDashboardPeriod] = useState<'dia' | 'mes' | 'ano' | 'geral'>('dia');

  // Mês exibido quando o filtro é "Mês" (0 = Janeiro ... 11 = Dezembro, sempre
  // do ano corrente) — por padrão o mês atual, mas pode ser trocado pelo
  // dropdown ao lado do filtro ou clicando numa barra do gráfico "Produção
  // Mensal" mais abaixo.
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());

  const PERIOD_LABELS: Record<typeof dashboardPeriod, string> = {
    dia: 'Hoje',
    mes: 'Mês',
    ano: 'Ano',
    geral: 'Geral',
  };

  // Data de início do período + quantos dias de turno (8h) já se passaram
  // nele — é a base do Índice de Ociosidade (% das horas de turno perdidas).
  const periodDateRange = useMemo(() => {
    const now = new Date();

    if (dashboardPeriod === 'dia') {
      return { rangeStart: todayDateStr, rangeEnd: todayDateStr, days: 1 };
    }

    if (dashboardPeriod === 'mes') {
      // Usa o mês escolhido no dropdown (padrão: mês atual) em vez de sempre
      // o mês corrente — permite ver Ago/26, Jul/26 etc. sem trocar pra "Geral".
      const year = now.getFullYear();
      const rangeStart = `${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
      const isCurrentMonth = selectedMonth === now.getMonth();
      const lastDayOfMonth = new Date(year, selectedMonth + 1, 0).getDate();
      const rangeEnd = isCurrentMonth
        ? todayDateStr
        : `${year}-${String(selectedMonth + 1).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
      const days = isCurrentMonth ? now.getDate() : lastDayOfMonth;
      return { rangeStart, rangeEnd, days };
    }

    if (dashboardPeriod === 'ano') {
      const rangeStart = `${now.getFullYear()}-01-01`;
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const daysElapsed = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return { rangeStart, rangeEnd: todayDateStr, days: daysElapsed };
    }

    // Geral: sem limite de início — conta a partir do primeiro registro (OP ou evento) até hoje
    let earliestMs: number | null = null;
    for (const op of ops) {
      const t = op.createdAt ? new Date(op.createdAt).getTime() : NaN;
      if (!isNaN(t) && (earliestMs === null || t < earliestMs)) earliestMs = t;
    }
    for (const ev of events) {
      const t = ev.createdAt ? new Date(ev.createdAt).getTime() : NaN;
      if (!isNaN(t) && (earliestMs === null || t < earliestMs)) earliestMs = t;
    }
    const daysElapsed = earliestMs !== null
      ? Math.max(1, Math.floor((now.getTime() - earliestMs) / (1000 * 60 * 60 * 24)) + 1)
      : 1;
    return { rangeStart: undefined, rangeEnd: undefined, days: daysElapsed };
  }, [dashboardPeriod, selectedMonth, todayDateStr, ops, events]);

  // ---------------- RENDIMENTO DO ENVASE (segue o filtro Dia / Mês / Ano / Geral) ----------------
  // Rendimento de cada OP = produzido ÷ esperado, limitado a 100% (quem passa
  // do esperado conta como 100%, nunca mais). O rendimento do período é
  // PONDERADO pela quantidade: soma do produzido de cada OP (limitado ao
  // esperado dela) ÷ soma do esperado. Ex.: 956 de 1.000 + 120 de 100 + 4.000
  // de 5.000 → (956 + 100 + 4.000) ÷ 6.100 = 82,9%.
  // - Conta cada OP de Envase CONCLUÍDA no período (dia em que foi fechada).
  // - Conclusões parciais entram na própria OP: produzido = parciais + final;
  //   esperado = parciais + saldo final (= o planejado original).
  // - Só Envase/Sleev (unidades): Pesagem e Manipulação (Kg) ficam de fora.
  const rendimento = useMemo(() => {
    const partialQtyByOp = new Map<string, number>();
    for (const ev of events || []) {
      if (!ev.opId || !isPartialFinishEvent(ev)) continue;
      const q = Number(ev.quantity) || 0;
      if (q > 0) partialQtyByOp.set(String(ev.opId), (partialQtyByOp.get(String(ev.opId)) || 0) + q);
    }
    let producedCapped = 0;
    let expected = 0;
    let opsCount = 0;
    for (const op of ops) {
      if (op.status !== 'completed') continue;
      if (op.setor === 'Pesagem' || op.setor === 'Manipulação' || op.tipoDocumento === 'OSM') continue;
      if (op.lineId && /reator|pesagem|manipula/i.test(op.lineId)) continue;
      if (dashboardPeriod !== 'geral') {
        const day = getOpReferenceDateStr(op);
        if (!day) continue;
        if (periodDateRange.rangeStart && day < periodDateRange.rangeStart) continue;
        if (periodDateRange.rangeEnd && day > periodDateRange.rangeEnd) continue;
      }
      const partialQty = partialQtyByOp.get(String(op.id)) || 0;
      const opExpected = (Number(op.plannedQuantity) || 0) + partialQty;
      if (opExpected <= 0) continue;
      const opProduced = (Number(op.producedQuantity) || 0) + partialQty;
      producedCapped += Math.min(Math.max(opProduced, 0), opExpected);
      expected += opExpected;
      opsCount += 1;
    }
    const pct = expected > 0 ? Math.round((producedCapped / expected) * 1000) / 10 : null;
    return { produced: producedCapped, expected, pct, opsCount };
  }, [ops, events, dashboardPeriod, periodDateRange]);

  // Métricas de Tempo do PERÍODO selecionado (Dia/Mês/Ano/Geral)
  const periodProductionTime = useMemo(() => {
    return calculateProductionTime(events, ops, lines, {
      rangeStart: periodDateRange.rangeStart,
      rangeEnd: periodDateRange.rangeEnd,
      referenceTime: nowTick,
      workSessions,
      changeovers,
    });
  }, [events, ops, lines, periodDateRange, nowTick, workSessions, changeovers]);

  // ---------------- EQUIPE DO ENVASE NO PERÍODO ----------------
  // Absenteísmo = faltas ÷ (presentes + faltas), usando a equipe vigente
  // (último registro) de cada linha em cada dia do período.
  // Produtividade = unidades produzidas ÷ horas-pessoa trabalhadas: cada trecho
  // de trabalho da linha vale o nº de colaboradores presentes naquele horário.
  // Só entram dias/trechos com equipe informada — nada é estimado.
  const teamMetrics = useMemo(() => {
    const inPeriod = (day: string) =>
      dashboardPeriod === 'geral' ||
      ((!periodDateRange.rangeStart || day >= periodDateRange.rangeStart) &&
        (!periodDateRange.rangeEnd || day <= periodDateRange.rangeEnd));
    const envaseIds = new Set(envaseLines.map(l => l.id));

    // Absenteísmo: último registro de cada linha em cada dia
    const lastByLineDay = new Map<string, LineHeadcount>();
    for (const h of headcounts) {
      if (!envaseIds.has(h.lineId)) continue;
      const day = toLocalDateStr(h.recordedAt);
      if (!inPeriod(day)) continue;
      const key = `${h.lineId}|${day}`;
      const cur = lastByLineDay.get(key);
      if (!cur || new Date(h.recordedAt).getTime() >= new Date(cur.recordedAt).getTime()) lastByLineDay.set(key, h);
    }
    let present = 0;
    let absent = 0;
    for (const h of lastByLineDay.values()) {
      present += h.present;
      absent += h.absent;
    }
    const absenteeismPct = present + absent > 0 ? Math.round((absent / (present + absent)) * 1000) / 10 : null;

    // Produtividade: produção (eventos) ÷ horas-pessoa (trechos de trabalho × equipe)
    const productionByLine = computeProductionByLineAndDay(events, ops);
    let personMs = 0;
    let producedWithTeam = 0;
    for (const lineId of envaseIds) {
      const working: Array<[number, number]> = periodProductionTime.intervals
        .filter(iv => iv.type === 'WORKING' && iv.lineId === lineId)
        .map(iv => [iv.startMs, iv.endMs] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const r of working) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      const ph = computePersonHours(merged, headcounts, lineId);
      personMs += ph.personMs;
      // Só a produção dos dias em que a equipe foi informada entra na conta
      const daysWithTeam = new Set(headcounts.filter(h => h.lineId === lineId).map(h => toLocalDateStr(h.recordedAt)));
      for (const [day, qty] of Object.entries(productionByLine[lineId] || {})) {
        if (inPeriod(day) && daysWithTeam.has(day)) producedWithTeam += qty;
      }
    }
    const personHours = personMs / (60 * 60 * 1000);
    const unitsPerPersonHour = personHours > 0 ? Math.round(producedWithTeam / personHours) : null;

    return { present, absent, absenteeismPct, unitsPerPersonHour, personHours, lineDays: lastByLineDay.size };
  }, [headcounts, envaseLines, dashboardPeriod, periodDateRange, events, ops, periodProductionTime]);

  // Duração de um turno de trabalho (8h) — multiplicada pelos dias do
  // período para virar a base do Índice de Ociosidade (% das horas perdidas)
  const WORKDAY_MS = 8 * 60 * 60 * 1000;
  const periodWorkdayMs = WORKDAY_MS * Math.max(1, periodDateRange.days);

  // Tempo Trabalhado / Ocioso: MÉDIA entre as linhas de produção (Envase 1,
  // Envase 2 e Sleeve) em vez da soma das 3 — somar inflaria o resultado
  // (3 linhas trabalhando ao mesmo tempo não significa "24h trabalhadas no
  // dia"), enquanto a média representa o comportamento típico de uma linha.
  const avgLineProductionTime = useMemo(() => {
    // Só as linhas de Envase/Sleeve — os reatores da Manipulação têm outro
    // ritmo (e o próprio card diz "média entre Envase 1, Envase 2 e Sleeve").
    const lineIds = envaseLines.map(l => l.id);

    let sumWorkingMs = 0;
    let sumIdleMs = 0;
    let sumSessionMs = 0;
    let sumOvertimeMs = 0;
    let sumChangeoverMs = 0;
    let matchedLines = 0;
    for (const lineId of lineIds) {
      const metrics = periodProductionTime.byLine[lineId];
      if (metrics && (metrics.workingMs > 0 || metrics.idleMs > 0)) {
        sumWorkingMs += metrics.workingMs;
        sumIdleMs += metrics.idleMs;
        sumSessionMs += metrics.sessionMs || 0;
        sumOvertimeMs += metrics.overtimeMs || 0;
        sumChangeoverMs += metrics.changeoverMs || 0;
        matchedLines += 1;
      }
    }

    if (matchedLines > 0) {
      return {
        avgWorkingMs: sumWorkingMs / matchedLines,
        avgIdleMs: sumIdleMs / matchedLines,
        avgSessionMs: sumSessionMs / matchedLines,
        avgOvertimeMs: sumOvertimeMs / matchedLines,
        avgChangeoverMs: sumChangeoverMs / matchedLines,
      };
    }

    // Nenhuma OP do período foi atribuída a uma linha cadastrada (comum nos
    // meses importados do histórico — a granularidade de "qual linha/equipe"
    // não foi capturada na importação, só o setor). Nesse caso, em vez de
    // mostrar 0h/0% (Índice de Ociosidade zerado enganoso), usamos a MÉDIA
    // por recurso (setor + turno: ex. "Pesagem|Manhã", "Envase|Tarde") em vez
    // do total bruto da fábrica — somar Pesagem + Manipulação + Envase como
    // se fosse 1 recurso só inflava o total acima das horas de calendário do
    // próprio período (ex.: "3226h trabalhadas" num mês de 730h).
    const resourceEntries = Object.values(periodProductionTime.byResource || {}) as { workingMs: number; idleMs: number }[];
    if (resourceEntries.length === 0) return { avgWorkingMs: 0, avgIdleMs: 0, avgSessionMs: 0, avgOvertimeMs: 0, avgChangeoverMs: 0 };

    const totalResourceWorkingMs = resourceEntries.reduce((sum, r) => sum + (r.workingMs || 0), 0);
    const totalResourceIdleMs = resourceEntries.reduce((sum, r) => sum + (r.idleMs || 0), 0);
    return {
      avgWorkingMs: totalResourceWorkingMs / resourceEntries.length,
      avgIdleMs: totalResourceIdleMs / resourceEntries.length,
      avgSessionMs: 0,
      avgOvertimeMs: 0,
      avgChangeoverMs: 0,
    };
  }, [envaseLines, periodProductionTime]);

  // Índice de Ociosidade: % das horas de turno do período perdidas em paradas (média das 3 linhas), capado em 100%
  // Base: o EXPEDIENTE real das linhas no período (inclui hora extra). Só cai
  // pro turno fixo de 8h/dia quando não há expediente calculado (histórico
  // importado sem linha).
  const idlenessIndexPercent = useMemo(() => {
    const base = avgLineProductionTime.avgSessionMs > 0 ? avgLineProductionTime.avgSessionMs : periodWorkdayMs;
    return Math.min(100, Math.round((avgLineProductionTime.avgIdleMs / base) * 1000) / 10);
  }, [avgLineProductionTime, periodWorkdayMs]);

  // Disponibilidade OEE recalculada sobre os mesmos valores médios (trabalhado vs. ocioso)
  const avgLineDisponibilidade = useMemo(() => {
    const total = avgLineProductionTime.avgWorkingMs + avgLineProductionTime.avgIdleMs;
    if (total <= 0) return 0;
    return Math.round((avgLineProductionTime.avgWorkingMs / total) * 1000) / 10;
  }, [avgLineProductionTime]);

  // OPs e eventos restritos ao período selecionado (Dia/Mês/Ano) — usados nos
  // componentes do OEE (Performance e Qualidade dependem de quais OPs contam).
  // Em "Geral" não há corte: entra o histórico inteiro.
  const periodOpsAndEvents = useMemo(() => {
    if (dashboardPeriod === 'geral') return { periodOps: ops, periodEvents: events };

    const startStr = periodDateRange.rangeStart || todayDateStr;
    const endStr = periodDateRange.rangeEnd || todayDateStr;
    // Compara sempre no dia LOCAL — `split('T')[0]` pegava o dia em UTC e
    // jogava tudo que fechava depois das 21h (turno da noite) pro dia seguinte.
    const inRange = (dateStr?: string) => {
      if (!dateStr) return false;
      const d = toLocalDateStr(dateStr);
      return d >= startStr && d <= endStr;
    };

    const periodOps = ops.filter(op => {
      const d = getOpReferenceDateStr(op);
      return !!d && d >= startStr && d <= endStr;
    });
    const periodEvents = events.filter(ev => inRange(ev.createdAt));
    return { periodOps, periodEvents };
  }, [ops, events, dashboardPeriod, periodDateRange, todayDateStr]);

  // OPs Finalizadas (Card 5) restritas ao período selecionado no filtro do
  // dashboard (Dia/Mês/Ano/Geral), usando o mesmo recorte do OEE.
  const completedOpsPeriod = useMemo(() => {
    return periodOpsAndEvents.periodOps.filter(
      (o) => o.status === 'completed' && /^4/.test(String(o.number).trim())
    ).length;
  }, [periodOpsAndEvents]);

  // ---------------- OEE (OVERALL EQUIPMENT EFFECTIVENESS) ----------------
  // Disponibilidade × Performance × Qualidade — cálculo já existente em
  // services/db.ts (calculateOEE), agora exibido no card 6 e nos 3 retângulos
  // de componentes logo abaixo dos cards, recalculado dentro do período do filtro.
  // OEE das LINHAS DE ENVASE: fica de fora a Pesagem (OSM nasce concluída com
  // produzido 0 e derrubava a Performance) e a Manipulação (Kg, reatores),
  // pra não misturar unidades e setores numa conta só.
  const isEnvaseLineOp = useCallback((op: ProductionOrder) => {
    if (op.setor === 'Pesagem' || op.setor === 'Manipulação') return false;
    if (op.tipoDocumento === 'OSM') return false;
    if (op.lineId && /reator|pesagem|manipula/i.test(op.lineId)) return false;
    return true;
  }, []);

  const oeeMetrics = useMemo(
    () => calculateOEE(periodOpsAndEvents.periodOps.filter(isEnvaseLineOp), periodOpsAndEvents.periodEvents, workSessions),
    [periodOpsAndEvents, isEnvaseLineOp, workSessions]
  );

  const oeeDisponibilidadePct = oeeMetrics.disponibilidade !== null
    ? Math.round(oeeMetrics.disponibilidade * 1000) / 10
    : null;
  const oeePerformancePct = oeeMetrics.performance !== null
    ? Math.round(oeeMetrics.performance * 1000) / 10
    : null;
  const oeeQualidadePct = oeeMetrics.qualidade !== null
    ? Math.round(oeeMetrics.qualidade * 1000) / 10
    : null;
  const oeeOverallPct = oeeMetrics.oee !== null
    ? Math.round(oeeMetrics.oee * 1000) / 10
    : null;

  // Faixa de cor do card 6 conforme a referência clássica de OEE:
  // ≥85% classe mundial, ≥60% aceitável, abaixo disso baixo desempenho.
  const oeeTier = useMemo(() => {
    if (oeeOverallPct === null) return { bg: 'bg-[#3f3f46]', label: 'Sem dados suficientes' };
    if (oeeOverallPct >= 85) return { bg: 'bg-[#10b981]', label: 'Classe mundial' };
    if (oeeOverallPct >= 60) return { bg: 'bg-[#d97706]', label: 'Aceitável' };
    return { bg: 'bg-[#dc2626]', label: 'Baixo desempenho' };
  }, [oeeOverallPct]);

  // Tendência mensal dos 3 componentes do OEE no ano corrente — só usada no
  // modo "Geral" do filtro de período, para responder "como foi durante o
  // mês/ano" em vez de só o instantâneo de hoje.
  const MONTH_LABELS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const oeeTrendData = useMemo(() => {
    if (dashboardPeriod !== 'geral') return [];

    const result: { monthName: string; disponibilidade: number | null; performance: number | null; qualidade: number | null }[] = [];
    for (let m = 0; m <= currentMonth; m++) {
      const monthKey = `${currentYear}-${String(m + 1).padStart(2, '0')}`;
      const monthOps = ops.filter(op => getOpReferenceDateStr(op).startsWith(monthKey));
      const monthEvents = events.filter(ev => {
        if (!ev.createdAt) return false;
        const d = new Date(ev.createdAt);
        return !isNaN(d.getTime()) && d.getFullYear() === currentYear && d.getMonth() === m;
      });
      const metrics = calculateOEE(monthOps.filter(isEnvaseLineOp), monthEvents, workSessions);
      result.push({
        monthName: MONTH_LABELS_SHORT[m],
        disponibilidade: metrics.disponibilidade !== null ? Math.round(metrics.disponibilidade * 1000) / 10 : null,
        performance: metrics.performance !== null ? Math.round(metrics.performance * 1000) / 10 : null,
        qualidade: metrics.qualidade !== null ? Math.round(metrics.qualidade * 1000) / 10 : null,
      });
    }
    return result;
  }, [dashboardPeriod, ops, events, currentYear, currentMonth, isEnvaseLineOp, workSessions]);

  // Métricas de Tempo TOTAIS acumuladas
  const totalProductionTime = useMemo(() => {
    return calculateProductionTime(events, ops, lines, {
      referenceTime: nowTick,
    });
  }, [events, ops, lines, nowTick]);

  // ---------------- NOVO PAINEL DE CONTROLE DE PRODUÇÃO: CÁLCULOS ----------------
  
  // 1. KPIs de Volume por Setor — apenas UM número, restrito ao período
  // selecionado no filtro do dashboard (Dia/Mês/Ano/Geral), usando o mesmo
  // recorte já aplicado ao OEE (periodOpsAndEvents).
  const sectorKpis = useMemo(() => {
    let pesagemQtd = 0;
    let manipQtd = 0;
    let envaseQtd = 0;

    // Produção das conclusões parciais do período (só soma quantidade — não é OSM/OP nova)
    const startStr = periodDateRange.rangeStart || '';
    const endStr = periodDateRange.rangeEnd || '9999-12-31';
    const periodPartials = partialRecords.filter(r => {
      if (dashboardPeriod === 'geral') return true;
      const d = getOpReferenceDateStr(r);
      return d >= startStr && d <= endStr;
    });

    for (const op of [...periodOpsAndEvents.periodOps, ...periodPartials]) {
      const qty = Number(op.producedQuantity || 0);
      const s = op.setor;
      if (s === 'Pesagem') {
        // Pesagem não produz Kg/Un (isso fica zerado até a Manipulação finalizar
        // a OSM) — aqui "Qtd" é a contagem de OSMs que a Pesagem adicionou.
        pesagemQtd += 1;
      } else if (s === 'Manipulação') {
        manipQtd += qty;
      } else if (s === 'Envase') {
        envaseQtd += qty;
      } else {
        // Fallback setor geral / não especificado -> somar no Envase (padrão de saída final)
        envaseQtd += qty;
      }
    }

    return {
      pesagem: { valor: pesagemQtd, unidade: 'Qtd' },
      manipulacao: { valor: manipQtd, unidade: 'Kg' },
      envase: { valor: envaseQtd, unidade: 'Un' },
    };
  }, [periodOpsAndEvents, partialRecords, periodDateRange, dashboardPeriod]);

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
    const grouped = groupProductionByMonth(productionOps, currentYear);

    return grouped.map((item, idx) => {
      // Média Anterior REAL: média do realizado dos meses anteriores do ano
      // que tiveram produção. Antes era 85% da meta — um número inventado.
      const previousWithData = grouped.slice(0, idx).filter(g => g.quantity > 0);
      const mediaAnterior = previousWithData.length > 0
        ? Math.round(previousWithData.reduce((acc, g) => acc + g.quantity, 0) / previousWithData.length)
        : null;
      // Meta ÚNICA da fábrica daquele mês primeiro; senão a meta legada por
      // linha (monthly_goals) daquele mês. Mês sem meta cadastrada fica SEM
      // meta (antes repetia a meta do mês atual, que nunca foi a meta dele).
      let goalVal: number | null = null;
      const gForMonth = goals && goals.length > 0
        ? goals.filter(g => g.year === currentYear && g.month === (item.month + 1))
        : [];
      if (gForMonth.length > 0) {
        goalVal = gForMonth.reduce((sum, g) => sum + g.goalQuantity, 0);
      }
      const factoryGoalForMonth = factoryMonthlyGoals.find(
        g => g.year === currentYear && g.month === (item.month + 1)
      );
      if (factoryGoalForMonth) {
        goalVal = factoryGoalForMonth.goalQuantity;
      }
      return {
        monthName: item.label,
        month: item.month,
        realizado: item.quantity,
        mediaAnterior,
        meta: goalVal,
        isCurrent: item.month === currentMonth,
      };
    });
  }, [productionOps, goals, factoryMonthlyGoals, currentYear, currentMonth]);

  // 4b. Gráfico "por hora" (0h–23h) — usado quando o filtro de período é
  // "Dia", no lugar do gráfico de 12 meses (que não faz sentido pro recorte
  // de um único dia).
  const hourlyChartData = useMemo(() => {
    return groupProductionByHour(productionOps, todayDateStr);
  }, [productionOps, todayDateStr]);

  // 4c. Gráfico "por dia" do mês selecionado — usado quando o filtro de
  // período é "Mês", no lugar do gráfico de 12 meses (que também não faz
  // sentido pro recorte de um único mês: cada barra já seria só um ponto).
  const dailyChartData = useMemo(() => {
    const byDaySetor = groupProductionByDayAndSetor(productionOps, selectedMonth + 1, currentYear);
    const totalsByDay = new Map<number, number>();
    for (const row of byDaySetor) {
      totalsByDay.set(row.day, (totalsByDay.get(row.day) || 0) + row.quantity);
    }
    const daysInSelectedMonth = new Date(currentYear, selectedMonth + 1, 0).getDate();
    return Array.from({ length: daysInSelectedMonth }, (_, i) => {
      const day = i + 1;
      return {
        day,
        label: String(day).padStart(2, '0'),
        quantity: totalsByDay.get(day) || 0,
      };
    });
  }, [productionOps, selectedMonth, currentYear]);

  // Renderiza o card de "produção em tempo real" de uma linha/reator — usado
  // tanto pra Envase/Sleeve quanto pra cada reator da Manipulação (mesmo
  // estilo do envase, conforme pedido). `hideOee` esconde a linha de
  // Trab/Ocioso/OEE no rodapé do card (usada pros reatores, onde essa métrica
  // agregada por "linha" ainda não se aplica direito).
  const renderProductionLineCard = (line: ProductionLine, opts: { hideOee?: boolean } = {}) => {
    const { hideOee = false } = opts;
    const lineOps = ops.filter((o) => o.lineId === line.id);
    const lineMetrics = todayProductionTime.byLine[line.id];

    // OP ativa da linha agora
    // OP da linha agora: em produção OU pausada. Antes a pausada só aparecia
    // se a linha ainda guardasse o currentOpId — quando não guardava, o card
    // dizia "Parada / Nenhuma OP" enquanto o chão de fábrica mostrava a OP pausada.
    const currentFromLine = line.currentOpId ? ops.find(o => o.id === line.currentOpId && o.status !== 'completed') : undefined;
    const activeLineOp = currentFromLine
      || lineOps.find(o => o.status === 'in_progress')
      || lineOps.find(o => o.status === 'paused')
      || null;
    const isPausedNow = activeLineOp?.status === 'paused';
    // Desde quando está pausada + motivo (último evento PAUSED da OP)
    const lastPauseEvent = isPausedNow && activeLineOp
      ? (events || [])
          .filter(e => e.opId === activeLineOp.id && e.type === 'PAUSED')
          .reduce<ProductionEvent | null>((latest, e) =>
            !latest || new Date(e.createdAt).getTime() > new Date(latest.createdAt).getTime() ? e : latest, null)
      : null;
    const pausedSinceMs = lastPauseEvent ? new Date(lastPauseEvent.createdAt).getTime() : NaN;
    // Expediente da linha hoje: aberto / encerrado / não iniciado
    const openSession = getOpenWorkSession(workSessions, line.id);
    const lastSessionToday = workSessions
      .filter(ws => ws.lineId === line.id && toLocalDateStr(ws.startedAt) === todayDateStr)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const autoSession = !openSession ? getAutoShiftNow(line.id, ops, workSessions, nowTick) : null;
    const sessionLabel = openSession
      ? `Expediente aberto desde ${hhmm(openSession.startedAt)}${toLocalDateStr(openSession.startedAt) !== todayDateStr ? ' (ontem ou antes — não foi encerrado)' : ''}`
      : autoSession?.active && autoSession.startMs
      ? `Expediente automático desde ${hhmm(new Date(autoSession.startMs).toISOString())}`
      : lastSessionToday
      ? `Expediente encerrado às ${hhmm(lastSessionToday.endedAt)}`
      : 'Expediente não iniciado';
    const teamToday = /reator/i.test(line.id) ? null : getHeadcountForLineDay(headcounts, line.id, todayDateStr);
    const openLineChangeover = getOpenChangeover(changeovers, line.id);
    const changeoverTodayMs = todayProductionTime.byLine[line.id]?.changeoverMs || 0;
    const sessionLabelClass = openSession
      ? (toLocalDateStr(openSession.startedAt) !== todayDateStr ? 'text-rose-400' : 'text-emerald-400')
      : autoSession?.active ? 'text-emerald-400'
      : lastSessionToday ? 'text-[#a1a1aa]' : 'text-[#52525b]';

    const start = activeLineOp ? getOpStartTime(activeLineOp.id) : null;
    const produced = activeLineOp?.producedQuantity || 0;
    const planned = activeLineOp?.plannedQuantity || 0;
    // Pode passar de 100% quando o rendimento da linha supera a meta prevista da OP
    const percent = planned > 0 ? Math.round((produced / planned) * 100) : 0;
    const isSleeve = /sleeve/i.test(line.name);
    const sleeveRate = isSleeve ? calculateProductionRatePerHour(produced, lineMetrics?.workingMs || 0) : null;

    return (
      <div
        key={line.id}
        onClick={() => !isReadOnly && onNavigateTab && onNavigateTab('cronograma')}
        className={`bg-[#121217] border border-[#22222b] rounded-2xl p-4 flex flex-col justify-between transition-all duration-150 ${
          !isReadOnly && onNavigateTab
            ? 'cursor-pointer hover:border-blue-500/50 hover:bg-[#15151c]'
            : 'cursor-default'
        }`}
      >
        <div>
          {/* Cabeçalho do Card */}
          <div className="border-b border-[#1f1f28] pb-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-black text-white uppercase tracking-wider truncate min-w-0">
                {line.name}
              </h4>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
                openLineChangeover && !activeLineOp
                  ? 'text-orange-300 bg-orange-950/80'
                  : isPausedNow
                  ? 'text-amber-300 bg-amber-950/80'
                  : activeLineOp ? 'text-emerald-400 bg-emerald-950/80' : 'text-[#71717a] bg-[#1a1a22]'
              }`}>
                {openLineChangeover && !activeLineOp ? 'Em setup' : isPausedNow ? 'Pausada' : activeLineOp ? 'Produzindo' : 'Parada'}
              </span>
            </div>
            <p className={`text-[10px] font-semibold mt-1 truncate ${sessionLabelClass}`} title={sessionLabel}>
              {sessionLabel}
            </p>
            {!/reator/i.test(line.id) && (
              <p className="text-[10px] font-semibold mt-0.5 truncate text-[#a1a1aa]">
                {teamToday
                  ? <>Equipe: <span className="text-white">{teamToday.present}</span>{teamToday.absent > 0 && <span className="text-amber-300"> · {teamToday.absent} falta(s)</span>}</>
                  : <span className="text-[#52525b]">Equipe não informada</span>}
              </p>
            )}
            {!/reator/i.test(line.id) && (openLineChangeover || changeoverTodayMs >= 60000) && (
              <p className="text-[10px] font-semibold mt-0.5 truncate text-orange-300">
                {openLineChangeover
                  ? `Em setup desde ${new Date(openLineChangeover.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                  : `Setup hoje: ${formatMsToHoursMinutes(changeoverTodayMs)}`}
              </p>
            )}
          </div>

          {activeLineOp ? (
            <div className="py-3 space-y-3">
              <div className="p-2 rounded-lg bg-[#181824] border border-[#262638]">
                <span className="font-mono font-bold text-blue-400 text-[11px]">OP {activeLineOp.number}</span>
                <p className="text-[#f4f4f5] font-medium text-xs truncate mt-1" title={activeLineOp.product}>
                  {activeLineOp.product}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#71717a] flex items-center gap-1"><Clock className="w-3 h-3" /> Timer</span>
                <span className="font-mono font-black text-white text-sm tabular-nums">
                  {start ? formatElapsedTimer(nowTick - start.getTime()) : '--:--:--'}
                </span>
              </div>

              {/* Há quanto tempo a OP está pausada, e por quê */}
              {isPausedNow && (
                <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-800/50 space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-amber-300 font-bold">Pausada há</span>
                    <span className="font-mono font-black text-amber-200 tabular-nums">
                      {!isNaN(pausedSinceMs) ? formatElapsedTimer(nowTick - pausedSinceMs) : '--:--:--'}
                    </span>
                  </div>
                  {lastPauseEvent && (
                    <p className="text-[10px] text-amber-200/80 truncate" title={[lastPauseEvent.reason, lastPauseEvent.observation].filter(Boolean).join(' — ')}>
                      desde {new Date(lastPauseEvent.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {lastPauseEvent.reason ? ` • ${lastPauseEvent.reason}` : ''}
                      {lastPauseEvent.observation ? ` • ${lastPauseEvent.observation}` : ''}
                    </p>
                  )}
                </div>
              )}

              {/* MOSTRADOR DE QUANTIDADE: DEDICADO DO SLEEV (Apenas produção por hora) VS PADRÃO */}
              {isSleeve ? (
                <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-black text-purple-300 tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      Produção por Hora (Sleev)
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-200 border border-purple-700/60 uppercase">
                      Rendimento
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 pt-0.5">
                    <span className="text-2xl font-black font-mono text-white tracking-tight">
                      {sleeveRate?.producedPerHour.toLocaleString('pt-BR') || 0}
                    </span>
                    <span className="text-xs font-bold font-mono text-purple-300">un/h</span>
                  </div>
                  <div className="text-[9.5px] text-[#a1a1aa] font-medium pt-0.5">
                    Métrica: {produced.toLocaleString('pt-BR')} un ÷ {sleeveRate?.workingHours && sleeveRate.workingHours > 0 ? `${sleeveRate.workingHours.toFixed(1)}h trab.` : 'tempo trab.'}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#71717a]">Produzido</span>
                  <span className="font-bold text-white">{produced.toLocaleString()} un</span>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-[11px] text-[#52525b]">
              Nenhuma OP em produção nesta linha
            </div>
          )}
        </div>

        {/* Rodapé do Card: % da produção da OP ativa + Barra de Progresso + OEE */}
        <div className="pt-2.5 border-t border-[#1f1f28] space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-bold text-[#71717a] uppercase tracking-wider truncate">
              {isSleeve ? 'Rendimento Sleev' : 'Meta da OP'}
            </span>
            {isSleeve ? (
              <span className="text-sm font-black text-purple-400 font-mono">
                {sleeveRate?.producedPerHour.toLocaleString('pt-BR')} un/h
              </span>
            ) : (
              <span className={`text-base font-black ${
                percent > 100 ? 'text-cyan-400' : percent >= 70 ? 'text-emerald-400' : percent >= 35 ? 'text-orange-400' : 'text-rose-500'
              }`}>
                {percent}%
              </span>
            )}
          </div>

          <div className="w-full h-1.5 bg-[#1f1f28] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isSleeve
                  ? 'bg-purple-500'
                  : percent > 100 ? 'bg-cyan-500' : percent >= 70 ? 'bg-emerald-500' : percent >= 35 ? 'bg-orange-500' : 'bg-rose-600'
              }`}
              style={{ width: `${activeLineOp ? Math.min(Math.max(percent, 4), 100) : 0}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-[#71717a] font-medium pt-0.5">
            {isSleeve ? (
              <>
                <span className="text-purple-300 font-mono font-bold">{sleeveRate?.producedPerHour.toLocaleString('pt-BR')} un/h</span>
                <span>{lineMetrics?.workingFormatted || '0h 00m'} trab.</span>
              </>
            ) : (
              <>
                <span>{produced.toLocaleString()} un</span>
                <span>{isSleeve ? 'concluído no envase' : 'previsto'} {planned.toLocaleString()} un</span>
              </>
            )}
          </div>

          {/* Linha OEE de Hoje: Tempo Trabalhado vs Ocioso (escondida quando hideOee) */}
          {!hideOee && (
            <div className="px-2 py-1.5 rounded-lg bg-[#0e0e14] border border-[#1c1c26] flex items-center justify-between text-[10px] font-mono">
              <span title="Tempo trabalhado nesta linha hoje">
                Trab: <strong className="text-purple-300 font-bold">{lineMetrics?.workingFormatted || '0h 00m'}</strong>
              </span>
              <span className="text-[#3f3f46]">|</span>
              <span title="Tempo ocioso / paradas nesta linha hoje">
                Ocioso: <strong className="text-amber-300 font-bold">{lineMetrics?.idleFormatted || '0h 00m'}</strong>
              </span>
              <span className="text-[#3f3f46]">|</span>
              <span title="Disponibilidade OEE da linha hoje" className="text-emerald-400 font-bold">
                {lineMetrics?.disponibilidade ?? 0}%
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

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
              <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                Indicadores Globais de Fábrica
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro de Período: controla Índice de Ociosidade, Tempo Trabalhado e OEE abaixo */}
            <div className="flex items-center gap-1 bg-[#0e0e12] border border-[#202028] rounded-xl p-1" title="Período usado no Índice de Ociosidade, Tempo Trabalhado e OEE">
              <Filter className="w-3 h-3 text-[#52525b] ml-1 mr-0.5 shrink-0" />
              {(['dia', 'mes', 'ano', 'geral'] as const).map(period => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setDashboardPeriod(period)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    dashboardPeriod === period
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-[#71717a] hover:text-white hover:bg-[#1a1a22]'
                  }`}
                >
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>

            {/* Dropdown de mês — só aparece com o filtro "Mês" ativo, para
                ver a produção de um mês específico sem precisar ir pro "Geral" */}
            {dashboardPeriod === 'mes' && (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-[#0e0e12] border border-[#202028] rounded-xl px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#a1a1aa] hover:text-white focus:text-white focus:outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer"
                title="Escolher o mês exibido no filtro &quot;Mês&quot;"
              >
                {MONTH_LABELS_SHORT.map((label, idx) => (
                  <option key={idx} value={idx}>{label}/{currentYear}</option>
                ))}
              </select>
            )}

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
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.pesagem.valor.toLocaleString('pt-BR')}
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
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.manipulacao.valor.toLocaleString('pt-BR')}
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
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="my-3">
              <div className="text-2xl sm:text-3xl font-black text-[#f4f4f5] tracking-tight font-mono">
                {sectorKpis.envase.valor.toLocaleString('pt-BR')}
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
              {activeOpsCount}
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

          {/* CARD 3: ÂMBAR (Índice de Ociosidade) */}
          <div className="bg-[#d97706] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[105px] transition-transform hover:scale-[1.01]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-100 truncate">
                ÍNDICE DE OCIOSIDADE
              </span>
              <span
                className="bg-amber-950/60 text-amber-200 border border-amber-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 font-mono"
                title={`% das horas de turno (8h/dia) perdidas em paradas no período — média entre Envase 1, Envase 2 e Sleeve`}
              >
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono">
              {idlenessIndexPercent}%
            </div>
            <div className="text-[10px] text-amber-100/90 font-medium truncate flex items-center justify-between pt-0.5 border-t border-amber-500/30">
              <span>Média ociosa do período</span>
              <span className="font-mono font-bold">{formatMsToHoursMinutes(avgLineProductionTime.avgIdleMs)}</span>
            </div>
            {avgLineProductionTime.avgChangeoverMs >= 60000 && (
              <div
                className="text-[10px] text-amber-100/90 font-medium truncate flex items-center justify-between pt-0.5"
                title="Parte do tempo ocioso que foi setup (botão Setup), média por linha de Envase"
              >
                <span>dos quais setup</span>
                <span className="font-mono font-bold">{formatMsToHoursMinutes(avgLineProductionTime.avgChangeoverMs)}</span>
              </div>
            )}
          </div>

          {/* CARD 4: LILÁS PASTEL (Tempo Trabalhado) */}
          <div className="bg-[#9157CD] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[105px] transition-transform hover:scale-[1.01]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-100 truncate">
                TEMP TRABALHADO
              </span>
              <span
                className="bg-purple-950/60 text-purple-200 border border-purple-400/40 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 font-mono"
                title="Média de tempo efetivamente trabalhado no período entre Envase 1, Envase 2 e Sleeve"
              >
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono">
              {formatMsToHoursMinutes(avgLineProductionTime.avgWorkingMs)}
            </div>
            <div className="text-[10px] text-purple-100/90 font-medium truncate flex items-center justify-between pt-0.5 border-t border-purple-400/30">
              <span title="Disponibilidade = Tempo Trabalhado / (Tempo Trabalhado + Tempo Ocioso), média das 3 linhas">Disponibilidade OEE</span>
              <span className="font-mono font-bold">{avgLineDisponibilidade}%</span>
            </div>
            {avgLineProductionTime.avgOvertimeMs >= 60000 && (
              <div
                className="text-[10px] text-purple-100/90 font-medium truncate flex items-center justify-between pt-0.5"
                title="Tempo de expediente fora da jornada padrão (seg–qui 7h–17h, sex 7h–16h), média por linha"
              >
                <span>Hora extra (média/linha)</span>
                <span className="font-mono font-bold">{formatMsToHoursMinutes(avgLineProductionTime.avgOvertimeMs)}</span>
              </div>
            )}
          </div>

          {/* CARD 5: VERDE ESMERALDA CLARO (OP Finalizadas) */}
          <div className="bg-[#10b981] text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[105px] transition-transform hover:scale-[1.01]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 truncate">
                OPS FINALIZADAS
              </span>
              <span
                className="bg-emerald-950/60 text-emerald-200 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 font-mono"
                title="Total de OPs concluídas dentro do período selecionado"
              >
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1">
              {completedOpsPeriod.toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-100/90 font-medium truncate flex items-center justify-between pt-0.5 border-t border-emerald-500/30">
              <span>Concluídas hoje</span>
              <span className="font-mono font-bold">{completedOpsTodayCount} OP(s)</span>
            </div>
            {/* Contador de OPs parciais no estoque — só aparece quando existe alguma.
                Não entram no total de finalizadas; somem daqui quando forem finalizadas de vez. */}
            {partialOpsInStock.length > 0 && (
              <div
                className="mt-1.5 text-[10px] font-bold flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-amber-400/90 text-amber-950"
                title={`OPs com conclusão parcial aguardando o restante do envase: ${partialOpsInStock.map(o => o.number).join(', ')}`}
              >
                <span className="truncate">Parciais no estoque</span>
                <span className="font-mono">{partialOpsInStock.length} OP(s)</span>
              </div>
            )}
          </div>

          {/* CARD 6: OEE (Overall Equipment Effectiveness) — cor muda conforme a faixa */}
          <div className={`${oeeTier.bg} text-white p-4 rounded-2xl shadow-lg flex flex-col justify-between min-h-[105px] transition-transform hover:scale-[1.01]`}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/80 truncate">
                OEE
              </span>
              <span
                className="bg-black/25 text-white border border-white/25 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 font-mono"
                title="OEE = Disponibilidade × Performance × Qualidade, calculado dentro do período selecionado"
              >
                {PERIOD_LABELS[dashboardPeriod]}
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black tracking-tight my-1 font-mono">
              {oeeOverallPct !== null ? `${oeeOverallPct}%` : '—'}
            </div>
            <div className="text-[10px] text-white/80 font-medium truncate flex items-center justify-between pt-0.5 border-t border-white/25">
              <span>{oeeTier.label}</span>
              <span className="font-mono font-bold">D×P×Q</span>
            </div>
          </div>

        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── RENDIMENTO: produzido ÷ esperado das OPs concluídas, no período do filtro ── */}
        <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">Rendimento do Envase</h3>
              <span className="bg-[#1a1a22] text-[#d4d4d8] border border-[#2c2c3c] px-1.5 py-0.5 rounded text-[9px] font-bold font-mono">
                {PERIOD_LABELS[dashboardPeriod]}{dashboardPeriod === 'mes' ? ` · ${MONTH_LABELS_SHORT[selectedMonth]}` : ''}
              </span>
            </div>
            <p className="text-[11px] text-[#71717a]">
              Produzido ÷ esperado de cada OP de Envase concluída (máx. 100% por OP), ponderado pela quantidade
            </p>
          </div>
          <div className="sm:text-right">
            <div className={`text-3xl sm:text-4xl font-black font-mono tracking-tight ${
              rendimento.pct === null ? 'text-[#52525b]'
                : rendimento.pct >= 95 ? 'text-emerald-400'
                : rendimento.pct >= 85 ? 'text-amber-400'
                : 'text-rose-400'
            }`}>
              {rendimento.pct !== null ? `${rendimento.pct.toLocaleString('pt-BR')}%` : '—'}
            </div>
            <div className="text-[11px] text-[#a1a1aa] font-mono">
              {rendimento.pct !== null
                ? `${rendimento.produced.toLocaleString('pt-BR')} de ${rendimento.expected.toLocaleString('pt-BR')} · ${rendimento.opsCount} OP(s)`
                : 'Nenhuma OP concluída no período'}
            </div>
          </div>
        </div>

        {/* ── EQUIPE DO ENVASE: absenteísmo e produtividade por pessoa, no período do filtro ── */}
        <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">Equipe do Envase</h3>
            <span className="bg-[#1a1a22] text-[#d4d4d8] border border-[#2c2c3c] px-1.5 py-0.5 rounded text-[9px] font-bold font-mono">
              {PERIOD_LABELS[dashboardPeriod]}{dashboardPeriod === 'mes' ? ` · ${MONTH_LABELS_SHORT[selectedMonth]}` : ''}
            </span>
          </div>
          {teamMetrics.lineDays === 0 ? (
            <p className="text-[11px] text-[#71717a] py-2">Nenhuma equipe informada no período.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-[#71717a]">Absenteísmo</div>
                <div className={`text-2xl sm:text-3xl font-black font-mono tracking-tight mt-0.5 ${
                  (teamMetrics.absenteeismPct ?? 0) === 0 ? 'text-emerald-400' : (teamMetrics.absenteeismPct ?? 0) <= 5 ? 'text-amber-400' : 'text-rose-400'
                }`}>
                  {teamMetrics.absenteeismPct !== null ? `${teamMetrics.absenteeismPct.toLocaleString('pt-BR')}%` : '—'}
                </div>
                <div className="text-[11px] text-[#a1a1aa] font-mono">
                  {teamMetrics.absent} falta(s) de {teamMetrics.present + teamMetrics.absent}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-[#71717a]">Produtividade</div>
                <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight mt-0.5 text-blue-300">
                  {teamMetrics.unitsPerPersonHour !== null ? teamMetrics.unitsPerPersonHour.toLocaleString('pt-BR') : '—'}
                </div>
                <div className="text-[11px] text-[#a1a1aa] font-mono">
                  un por pessoa/hora{teamMetrics.personHours > 0 ? ` · ${Math.round(teamMetrics.personHours).toLocaleString('pt-BR')} h-pessoa` : ''}
                </div>
              </div>
            </div>
          )}
        </div>

        </div>

        {/* ── 2.1 COMPONENTES DO OEE: DISPONIBILIDADE / PERFORMANCE / QUALIDADE ── */}
        <div className="space-y-2">
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
              Componentes do OEE
            </h3>
            <p className="text-[11px] text-[#71717a]">
              Overall Equipment Effectiveness = Disponibilidade × Performance × Qualidade • Período: <span className="text-[#a1a1aa] font-semibold">{PERIOD_LABELS[dashboardPeriod]}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Disponibilidade — Azul */}
            <div className="bg-[#18181b] border border-blue-800/40 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shadow-[0_0_8px_rgba(59,130,246,0.8)] shrink-0"></span>
                  Disponibilidade
                </span>
                <span className="text-2xl font-black text-blue-400 font-mono shrink-0">
                  {oeeDisponibilidadePct !== null ? `${oeeDisponibilidadePct}%` : '—'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, oeeDisponibilidadePct ?? 0))}%` }}
                />
              </div>
              <p className="text-[10px] text-[#71717a]">Tempo real produzindo ÷ tempo planejado (descontadas as paradas)</p>
            </div>

            {/* Performance — Laranja */}
            <div className="bg-[#18181b] border border-orange-800/40 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-orange-400 flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-orange-500 inline-block shadow-[0_0_8px_rgba(249,115,22,0.8)] shrink-0"></span>
                  Performance
                </span>
                <span className="text-2xl font-black text-orange-400 font-mono shrink-0">
                  {oeePerformancePct !== null ? `${oeePerformancePct}%` : '—'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, oeePerformancePct ?? 0))}%` }}
                />
              </div>
              <p className="text-[10px] text-[#71717a]">Quantidade produzida ÷ quantidade planejada das OPs</p>
            </div>

            {/* Qualidade — Verde */}
            <div className="bg-[#18181b] border border-emerald-800/40 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shadow-[0_0_8px_rgba(16,185,129,0.8)] shrink-0"></span>
                  Qualidade
                </span>
                <span className="text-2xl font-black text-emerald-400 font-mono shrink-0">
                  {oeeQualidadePct !== null ? `${oeeQualidadePct}%` : '—'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, oeeQualidadePct ?? 0))}%` }}
                />
              </div>
              <p className="text-[10px] text-[#71717a]">(Produzido − rejeitado) ÷ produzido</p>
            </div>
          </div>

          {/* No modo "Geral", mostra a evolução mensal dos 3 componentes juntos —
              responde "como foi durante o mês/ano" além do instantâneo de hoje. */}
          {dashboardPeriod === 'geral' && (
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-[#a1a1aa]">
                  Evolução Mensal — Disponibilidade × Performance × Qualidade ({currentYear})
                </h4>
              </div>
              {oeeTrendData.length === 0 ? (
                <p className="text-[11px] text-[#52525b] text-center py-8">Sem dados suficientes ainda neste ano.</p>
              ) : (
                <div className="h-[220px] w-full overflow-x-auto">
                  <div className="h-full min-w-[500px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oeeTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="monthName" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis stroke="#71717a" fontSize={10} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                          formatter={(value: any, name: any) => [
                            value === null ? 'Sem dados' : `${value}%`,
                            name === 'disponibilidade' ? 'Disponibilidade' : name === 'performance' ? 'Performance' : 'Qualidade',
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '10px' }}
                          formatter={(value) => (value === 'disponibilidade' ? 'Disponibilidade' : value === 'performance' ? 'Performance' : 'Qualidade')}
                        />
                        <Line type="monotone" dataKey="disponibilidade" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="performance" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="qualidade" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 3. Gráfico de produção — muda de acordo com o filtro de período
              (Dia/Mês/Ano/Geral) escolhido lá em cima: em "Dia" mostra a
              produção hora a hora de hoje; em "Mês" mostra dia a dia do mês
              selecionado; em "Ano"/"Geral" mantém o comparativo dos 12 meses
              de sempre. ── */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-4 flex flex-col justify-between min-h-[300px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-purple-400" />
                  {dashboardPeriod === 'dia' && 'Produção por Hora (Hoje)'}
                  {dashboardPeriod === 'mes' && `Produção por Dia (${MONTH_LABELS_SHORT[selectedMonth]}/${currentYear})`}
                  {(dashboardPeriod === 'ano' || dashboardPeriod === 'geral') && `Produção Mensal (${currentYear})`}
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
                {dashboardPeriod === 'dia' && 'Volume realizado em cada hora do dia (00h–23h)'}
                {dashboardPeriod === 'mes' && 'Volume realizado em cada dia do mês selecionado'}
                {(dashboardPeriod === 'ano' || dashboardPeriod === 'geral') && 'Comparativo de 12 meses: volume realizado vs média histórica e meta de cada mês'}
              </p>
            </div>
            {(dashboardPeriod === 'ano' || dashboardPeriod === 'geral') && (
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#a1a1aa] font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#52525b]"></span> Média Anterior
                </span>
                <span className="flex items-center gap-1 text-red-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500"></span> Realizado
                </span>
                <span className="flex items-center gap-1 text-blue-400 font-bold">
                  <svg width="14" height="10" viewBox="0 0 14 10" className="shrink-0">
                    <line x1="0" y1="5" x2="14" y2="5" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 2" />
                    <circle cx="7" cy="5" r="2.5" fill="#3b82f6" />
                  </svg>
                  Meta (por mês)
                </span>
              </div>
            )}
          </div>

          {/* Em telas estreitas os 12 meses (ou 24h/31 dias) ficam ilegíveis
              se espremidos no container — deixamos o gráfico com uma largura
              mínima e o container rola horizontalmente em vez de comprimir
              as barras. */}
          <div className="h-[210px] w-full overflow-x-auto">
            <div className="h-full min-w-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                {dashboardPeriod === 'dia' ? (
                  <BarChart data={hourlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={9} tickLine={false} interval={1} />
                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                      formatter={(value: any) => [`${Number(value || 0).toLocaleString('pt-BR')} un`, 'Realizado']}
                      labelFormatter={(label) => `Hora ${label}`}
                    />
                    <Bar dataKey="quantity" fill="#ef4444" radius={[4, 4, 0, 0]} name="Realizado" />
                  </BarChart>
                ) : dashboardPeriod === 'mes' ? (
                  <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={9} tickLine={false} interval={selectedMonth === currentMonth ? 1 : 2} />
                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                      formatter={(value: any) => [`${Number(value || 0).toLocaleString('pt-BR')} un`, 'Realizado']}
                      labelFormatter={(label) => `Dia ${label}`}
                    />
                    <Bar dataKey="quantity" radius={[4, 4, 0, 0]} name="Realizado">
                      {dailyChartData.map((entry) => (
                        <Cell
                          key={entry.day}
                          fill={selectedMonth === currentMonth && entry.day === new Date().getDate() ? '#f97316' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  // ComposedChart (não BarChart) porque a Meta aqui é uma
                  // linha com um valor DIFERENTE por mês (dataKey="meta"),
                  // não uma única reta repetindo a meta do mês atual pro ano
                  // inteiro.
                  <ComposedChart
                    data={monthlyChartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    onClick={(state: any) => {
                      // Clicar num mês abre o filtro "Mês" já naquele mês específico
                      const clickedMonth = state?.activePayload?.[0]?.payload?.month;
                      if (typeof clickedMonth === 'number') {
                        setSelectedMonth(clickedMonth);
                        setDashboardPeriod('mes');
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="monthName" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '11px', color: '#f4f4f5' }}
                      formatter={(value: any, name: any) => [
                        value === null || value === undefined
                          ? (name === 'meta' ? 'sem meta cadastrada' : 'sem dados')
                          : `${Number(value).toLocaleString('pt-BR')} un`,
                        name === 'realizado' ? 'Realizado' : name === 'mediaAnterior' ? 'Média Anterior' : name === 'meta' ? 'Meta do mês' : name
                      ]}
                    />
                    <Bar dataKey="mediaAnterior" fill="#3f3f46" radius={[4, 4, 0, 0]} name="Média Anterior" />
                    <Bar dataKey="realizado" radius={[4, 4, 0, 0]} name="Realizado">
                      {monthlyChartData.map((entry) => (
                        <Cell
                          key={entry.month}
                          fill={entry.isCurrent ? '#f97316' : '#ef4444'}
                          cursor="pointer"
                        />
                      ))}
                    </Bar>
                    {/* Meta: um ponto por mês, com o valor real daquele mês
                        (factory_monthly_goal), em vez de uma reta única. */}
                    <Line
                      type="monotone"
                      dataKey="meta"
                      name="Meta"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={{ r: 3.5, fill: '#3b82f6', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 4. PRODUÇÃO EM TEMPO REAL — DUAS PARTES SEPARADAS: ENVASE E MANIPULAÇÃO   */}
      {/* (separadas pra não ficar confuso pra quem não entende o sistema)         */}
      {/* ========================================================================= */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              Produção em Tempo Real
              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ao vivo
              </span>
            </h3>
            <p className="text-[11px] text-[#71717a]">
              Espelho do que está sendo produzido agora, separado por setor
            </p>
          </div>

          <div className="text-[11px] text-[#a1a1aa] font-medium">
            <strong className="text-white">{ops.length} OPs no total</strong> •{' '}
            <strong className="text-emerald-400">{monthProducedQuantity.toLocaleString()} un entregues</strong> (todo o volume já apontado no mês) •{' '}
            {monthlyGoal > 0
              ? <>meta combinada <strong className="text-white">{monthlyGoal.toLocaleString()} un</strong></>
              : <span className="text-[#71717a]">sem meta mensal cadastrada</span>}
          </div>
        </div>

        {/* ---------------------- PARTE 1: ENVASE (+ SLEEVE) ---------------------- */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-black text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-blue-400" />
            Envase
          </h4>
          {envaseLines.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {envaseLines.map((line) => renderProductionLineCard(line))}
            </div>
          ) : (
            <div className="py-6 text-center text-[11px] text-[#52525b] bg-[#121217] border border-[#22222b] rounded-2xl">
              Nenhuma linha de envase cadastrada
            </div>
          )}
        </div>

        {/* Setups do Envase no período do filtro */}
        <SetupHistory
          changeovers={changeovers}
          ops={ops}
          lines={lines}
          users={[...(allUsers || []), ...(leaders || [])]}
          rangeStart={periodDateRange.rangeStart}
          rangeEnd={periodDateRange.rangeEnd}
          periodLabel={`${PERIOD_LABELS[dashboardPeriod]}${dashboardPeriod === 'mes' ? ` · ${MONTH_LABELS_SHORT[selectedMonth]}` : ''}`}
          nowMs={nowTick}
        />

        {/* ---------------------- PARTE 2: MANIPULAÇÃO (REATORES) ---------------------- */}
        <div className="space-y-2 pt-1">
          <h4 className="text-[11px] font-black text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
            Manipulação
          </h4>
          {reactorLines.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {reactorLines.map((line) => renderProductionLineCard(line, { hideOee: true }))}
            </div>
          ) : (
            <div className="py-6 text-center text-[11px] text-[#52525b] bg-[#121217] border border-[#22222b] rounded-2xl">
              Nenhum reator cadastrado
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
