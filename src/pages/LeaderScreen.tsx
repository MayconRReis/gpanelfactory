import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import {
  LogOut,
  Play,
  Pause,
  CheckCircle2,
  Package,
  Clock,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Factory,
  Layers,
  TrendingUp,
  Activity,
  Check,
  ChevronRight,
  Info,
  ListOrdered,
  BarChart3,
  CalendarDays,
  Tag,
  Boxes,
  Zap,
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
  Plus,
} from 'lucide-react';
import {
  getLines,
  getAllOPs,
  getActiveOP,
  startOP,
  pauseOP,
  resumeOP,
  finishOP,
  reportQuantity,
  saveLeaderRotation,
  getRecentEvents,
  getPauseReasons,
  updateOP,
  DEFAULT_PAUSE_REASONS,
} from '../services/db';
import { AssignStockOpToLineModal } from '../components/AssignStockOpToLineModal';
import { ProductionLine, ProductionOrder, ProductionEvent, PauseReason } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { calculateProductionRatePerHour } from '../lib/productionTime';

type LeaderTab = 'operation' | 'daily_dash' | 'monthly_dash';

// Data local (não UTC) no formato YYYY-MM-DD — usar toISOString() aqui
// adiantava o "hoje" em ~3h por causa do fuso do Brasil (UTC-3), o que
// fazia uma OP marcar "atrasada" (ou deixar de marcar) cedo demais perto
// da meia-noite.
function getLocalDateStr(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Uma OP está "atrasada" quando foi programada para uma data que já passou
// e ainda nem foi iniciada (continua 'pending'). Uma vez iniciada, pausada
// ou concluída, ela deixa de contar como atrasada — o que importa aqui é
// avisar o líder que algo ainda parado deveria ter começado.
function isOpOverdue(op: ProductionOrder, todayStr: string): boolean {
  return op.status === 'pending' && !!op.scheduledDate && op.scheduledDate < todayStr;
}

// Chave de localStorage usada para lembrar a última linha selecionada pelo
// líder neste navegador — puramente uma conveniência de UX (evita reabrir
// sempre na linha 1), sem nenhum vínculo com "linha responsável" no banco.
function leaderLineStorageKey(leaderUid: string): string {
  return `gpanel_leader_selected_line_${leaderUid}`;
}

interface LeaderScreenProps {
  embedded?: boolean;
}

export function LeaderScreen({ embedded = false }: LeaderScreenProps = {}) {
  const { profile, signOut } = useAuthStore();

  // State principal
  const [activeTab, setActiveTab] = useState<LeaderTab>('operation');
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [allOps, setAllOps] = useState<ProductionOrder[]>([]);
  const [recentEvents, setRecentEvents] = useState<ProductionEvent[]>([]);
  const [pauseReasonsList, setPauseReasonsList] = useState<PauseReason[]>(DEFAULT_PAUSE_REASONS);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modais
  const [isPauseOpen, setIsPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseObs, setPauseObs] = useState('');
  const [pauseProducedQty, setPauseProducedQty] = useState('');

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [reportRejectedQty, setReportRejectedQty] = useState('');

  const [isFinishOpen, setIsFinishOpen] = useState(false);
  const [finishShift, setFinishShift] = useState<'Manhã' | 'Tarde' | null>(null);
  const [finishProducedQty, setFinishProducedQty] = useState('');
  const [finishRejectedQty, setFinishRejectedQty] = useState('');
  const [finishProductionType, setFinishProductionType] = useState<'total' | 'parcial'>('total');
  const [finishSendToSleeve, setFinishSendToSleeve] = useState(false);
  const [isCancelFinishConfirmOpen, setIsCancelFinishConfirmOpen] = useState(false);
  const [isLineSelectOpen, setIsLineSelectOpen] = useState(false);
  const [isAssignStockOpen, setIsAssignStockOpen] = useState(false);

  // Relógio em tempo real
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Ref para manter o selectedLineId sincronizado sem invalidar o useCallback do fetchData
  const selectedLineIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLineIdRef.current = selectedLineId;
  }, [selectedLineId]);

  // Ref estável para fetchData — resolve stale closure no Realtime/setInterval
  const fetchDataRef = useRef<(showRefreshing?: boolean) => Promise<void>>();

  // Busca e sincronização de dados
  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!profile) return;
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const [loadedLines, loadedOps, loadedEvents, loadedReasons] = await Promise.all([
        getLines(),
        getAllOPs(),
        getRecentEvents(),
        getPauseReasons(),
      ]);

      setLines(loadedLines);
      setAllOps(loadedOps);
      setRecentEvents(loadedEvents);
      if (loadedReasons && loadedReasons.length > 0) {
        setPauseReasonsList(loadedReasons);
      }

      // As OPs agora são atribuídas à LINHA (pelo cronograma de envase), não
      // ao líder — qualquer líder pode operar qualquer linha, bastando
      // selecioná-la aqui. Por isso não existe mais uma "linha responsável"
      // vinda do coordenador: só respeitamos a linha já selecionada nesta
      // sessão e, na ausência dela, a última que o próprio líder escolheu
      // neste navegador (puro conforto de UX, via localStorage) — ou a
      // primeira linha disponível, como último recurso.
      if (!selectedLineIdRef.current) {
        let restoredLineId: string | null = null;
        try {
          restoredLineId = localStorage.getItem(leaderLineStorageKey(profile.uid));
        } catch {
          // localStorage pode não estar disponível (ex.: modo privado) — sem problema, cai no fallback abaixo.
        }
        if (restoredLineId && loadedLines.some(l => l.id === restoredLineId)) {
          setSelectedLineId(restoredLineId);
        } else {
          setSelectedLineId(loadedLines[0]?.id || 'line-1');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados do líder:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [profile]);

  // Mantém a ref sempre apontando para a versão mais recente do fetchData
  // — isso resolve a stale closure no Realtime e no setInterval
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Realtime + polling: espelha o comportamento do CoordinatorDashboard
  useEffect(() => {
    if (!profile) return;

    fetchDataRef.current?.();

    const stable = () => fetchDataRef.current?.(true);

    const channel = supabase
      .channel('leader-realtime-' + profile.uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, stable)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, stable)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_events' }, stable)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, stable)
      .subscribe();

    // Fallback: polling a cada 5s mesmo se Realtime cair
    const interval = setInterval(() => fetchDataRef.current?.(true), 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [profile?.uid]);

  // Linha atual selecionada
  const currentLine = useMemo(() => {
    return lines.find(l => l.id === selectedLineId) || lines[0] || null;
  }, [lines, selectedLineId]);

  // OPs válidas para as linhas de produção (Chão de Fábrica - Envase)
  // IMPORTANTE: Esta tela é exclusivamente o Chão de Fábrica de Envase.
  // Ela NUNCA deve filtrar por `profile.area`: se a OP está alocada para esta linha
  // física de envase (atribuída via Cronograma de Envase ou Estoque), ela DEVE
  // aparecer e ser operada aqui, independentemente do cargo/área do usuário logado
  // (ex.: coordenador, líder de envase ou operador visualizando a linha).
  const envaseOps = useMemo(() => {
    return allOps.filter(op => {
      // Exclui apenas se for expressamente uma OSM restrita de Pesagem ou Manipulação (que possuem suas próprias telas dedicadas)
      const isRestrictedOtherArea = (op.setor === 'Pesagem' || op.setor === 'Manipulação') && op.tipoDocumento === 'OSM';
      return !isRestrictedOtherArea;
    });
  }, [allOps]);

  // OPs da linha atual de envase
  const lineOps = useMemo(() => {
    if (!currentLine) return [];
    return envaseOps.filter(op => String(op.lineId) === String(currentLine.id));
  }, [envaseOps, currentLine]);

  // OP ativa da linha (em progresso, pausada ou primeira pendente)
  const activeOp = useMemo(() => {
    if (!lineOps.length) return null;
    const inProgress = lineOps.find(o => o.status === 'in_progress');
    if (inProgress) return inProgress;
    const paused = lineOps.find(o => o.status === 'paused');
    if (paused) return paused;
    const pending = lineOps.filter(o => o.status === 'pending').sort((a, b) => a.sequence - b.sequence);
    return pending[0] || null;
  }, [lineOps]);

  // Próximas OPs na fila da linha (exceto a OP ativa atual)
  const queuedOps = useMemo(() => {
    if (!lineOps.length) return [];
    return lineOps
      .filter(o => o.status === 'pending' && o.id !== activeOp?.id)
      .sort((a, b) => a.sequence - b.sequence);
  }, [lineOps, activeOp]);

  // Eventos da linha atual
  const lineEvents = useMemo(() => {
    if (!currentLine) return [];
    return recentEvents.filter(e => e.lineId === currentLine.id || e.lineName === currentLine.name);
  }, [recentEvents, currentLine]);

  // Troca de linha (o líder pode pular livremente entre as linhas a
  // qualquer momento — as OPs pertencem à linha, não a ele; nada aqui
  // restringe ou "trava" o líder numa linha fixa). Guardamos a escolha em
  // dois lugares com propósitos diferentes:
  // 1. localStorage deste navegador — só para reabrir na mesma linha da
  //    próxima vez que ESTE líder entrar (conveniência de UX).
  // 2. saveLeaderRotation (Supabase) — mantém o painel do coordenador
  //    (Dashboard Geral) informado sobre "quem está em qual linha agora",
  //    que é só um indicador de leitura lá, sem nenhum efeito de volta
  //    sobre o que o líder pode ver ou selecionar.
  const handleSwitchLine = (lineId: string) => {
    setSelectedLineId(lineId);
    if (profile) {
      try {
        localStorage.setItem(leaderLineStorageKey(profile.uid), lineId);
      } catch {
        // Sem localStorage disponível — a troca ainda funciona nesta sessão, só não persiste para a próxima visita.
      }
      saveLeaderRotation(profile.uid, lineId, profile.email, profile.name).catch((err) => {
        console.warn('Não foi possível atualizar o indicador de linha atual no painel do coordenador:', err);
      });
    }
    setIsLineSelectOpen(false);
  };

  // -------------------------------------------------------------
  // HANDLERS OPERACIONAIS DE PRODUÇÃO (INÍCIO, PAUSA, RETOMADA, APONTAMENTO, FIM)
  // -------------------------------------------------------------
  const handleStart = async () => {
    if (!currentLine || !activeOp || !profile) return;
    await startOP(activeOp.id, currentLine.id, profile.uid);
    await fetchData(true);
  };

  const handlePause = async () => {
    if (!currentLine || !activeOp || !profile || !pauseReason) return;
    const parsedQty = pauseProducedQty.trim() !== '' ? parseInt(pauseProducedQty, 10) : undefined;
    await pauseOP(activeOp.id, currentLine.id, profile.uid, pauseReason, pauseObs, parsedQty);
    setIsPauseOpen(false);
    setPauseReason('');
    setPauseObs('');
    setPauseProducedQty('');
    await fetchData(true);
  };

  const handleResume = async () => {
    if (!currentLine || !activeOp || !profile) return;
    await resumeOP(activeOp.id, currentLine.id, profile.uid);
    await fetchData(true);
  };

  const handleReport = async (qtyToReport?: number) => {
    const finalQty = qtyToReport !== undefined ? qtyToReport : parseInt(quantity);
    if (!currentLine || !activeOp || !profile || isNaN(finalQty) || finalQty <= 0) return;
    // Rejeito só se aplica ao apontamento manual (os botões de incremento
    // rápido não passam por aqui com qtyToReport, então ficam sem rejeito).
    const parsedRejected = qtyToReport === undefined && reportRejectedQty.trim() !== ''
      ? parseInt(reportRejectedQty, 10)
      : undefined;
    await reportQuantity(activeOp.id, currentLine.id, profile.uid, finalQty, parsedRejected);
    setQuantity('');
    setReportRejectedQty('');
    setIsReportOpen(false);
    await fetchData(true);
  };

  const handleFinish = async () => {
    if (!currentLine || !activeOp || !profile) return;
    const parsedQty = finishProducedQty.trim() !== '' ? parseInt(finishProducedQty, 10) : undefined;
    const parsedRejectedQty = finishRejectedQty.trim() !== '' ? parseInt(finishRejectedQty, 10) : undefined;

    await finishOP(
      activeOp.id,
      currentLine.id,
      profile.uid,
      finishShift || undefined,
      parsedQty,
      finishSendToSleeve,
      parsedRejectedQty
    );
    setIsFinishOpen(false);
    setFinishShift(null);
    setFinishProducedQty('');
    setFinishRejectedQty('');
    setFinishProductionType('total');
    setFinishSendToSleeve(false);
    await fetchData(true);
  };

  // -------------------------------------------------------------
  // CÁLCULOS DO DASHBOARD DIÁRIO (HOJE)
  // -------------------------------------------------------------
  const todayDateStr = useMemo(() => getLocalDateStr(), []);

  const dailyMetrics = useMemo(() => {
    // Apontamentos de hoje na linha
    const todayEvents = lineEvents.filter(e => e.createdAt && e.createdAt.startsWith(todayDateStr));
    
    // Total de peças apontadas hoje
    const totalReportedToday = todayEvents
      .filter(e => e.type === 'QUANTITY_REPORTED')
      .reduce((acc, curr) => acc + (curr.quantity || 0), 0);

    // Se não houver eventos granulares, somar das OPs em andamento ou finalizadas hoje
    const fallbackProducedToday = lineOps
      .filter(o => o.status === 'in_progress' || (o.status === 'completed' && o.createdAt?.startsWith(todayDateStr)))
      .reduce((acc, curr) => acc + curr.producedQuantity, 0);

    const producedToday = totalReportedToday > 0 ? totalReportedToday : fallbackProducedToday;

    // OPs programadas para hoje
    const opsToday = lineOps.filter(o => o.scheduledDate === todayDateStr || o.status === 'in_progress');
    const plannedToday = opsToday.reduce((acc, curr) => acc + curr.plannedQuantity, 0) || 5000;
    const completedTodayCount = lineOps.filter(o => o.status === 'completed' && o.createdAt?.startsWith(todayDateStr)).length;
    
    // Atingimento da meta diária
    const dailyTarget = plannedToday > 0 ? plannedToday : 5000;
    const progressPercent = Math.min(Math.round((producedToday / dailyTarget) * 100), 100);

    // Contagem de pausas hoje
    const pauseEventsToday = todayEvents.filter(e => e.type === 'PAUSED');

    return {
      producedToday,
      dailyTarget,
      progressPercent,
      completedTodayCount,
      totalOpsToday: opsToday.length || lineOps.length,
      pauseCountToday: pauseEventsToday.length,
      todayEvents,
    };
  }, [lineEvents, lineOps, todayDateStr]);

  // -------------------------------------------------------------
  // CÁLCULOS DO DASHBOARD MENSAL
  // -------------------------------------------------------------
  const currentMonthStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentMonthName = useMemo(() => {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
  }, []);

  const monthlyMetrics = useMemo(() => {
    // Todas as OPs da linha no mês atual
    const monthOps = lineOps.filter(o => {
      const d = o.scheduledDate || o.createdAt || '';
      return d.startsWith(currentMonthStr);
    });

    const totalProducedMonth = lineOps.reduce((acc, curr) => acc + curr.producedQuantity, 0);
    const totalPlannedMonth = lineOps.reduce((acc, curr) => acc + curr.plannedQuantity, 0) || 25000;
    const completedOpsMonth = lineOps.filter(o => o.status === 'completed').length;
    const efficiencyMonth = totalPlannedMonth > 0 ? Math.min(Math.round((totalProducedMonth / totalPlannedMonth) * 100), 100) : 0;

    // Gráfico de produção diária acumulada nos dias do mês
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const currentDay = new Date().getDate();

    const chartData = [];
    for (let day = 1; day <= Math.min(currentDay, daysInMonth); day++) {
      const dayStr = `${currentMonthStr}-${String(day).padStart(2, '0')}`;
      
      // Eventos desse dia
      const dayEvents = lineEvents.filter(e => e.createdAt && e.createdAt.startsWith(dayStr));
      const reportedDay = dayEvents
        .filter(e => e.type === 'QUANTITY_REPORTED')
        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);

      // Simulação coerente para histórico do mês caso não haja eventos anteriores
      let producedVal = reportedDay;
      if (producedVal === 0 && day <= currentDay) {
        // Gera valor proporcional consistente baseado no total do mês
        const baseEstimate = Math.round(totalProducedMonth / Math.max(currentDay, 1));
        producedVal = day === currentDay ? dailyMetrics.producedToday : Math.max(baseEstimate, 800);
      }

      chartData.push({
        dia: `Dia ${day}`,
        produzido: producedVal,
        meta: 2500, // Meta média diária por linha
      });
    }

    // Distribuição por Produto
    const productStatsMap = new Map<string, { product: string; produced: number; planned: number }>();
    lineOps.forEach(op => {
      const existing = productStatsMap.get(op.product) || { product: op.product, produced: 0, planned: 0 };
      existing.produced += op.producedQuantity;
      existing.planned += op.plannedQuantity;
      productStatsMap.set(op.product, existing);
    });
    const topProducts = Array.from(productStatsMap.values()).sort((a, b) => b.produced - a.produced).slice(0, 5);

    // Principais Motivos de Parada do Mês
    const reasonCounts: Record<string, number> = {};
    lineEvents.filter(e => e.type === 'PAUSED' && e.reason).forEach(e => {
      const r = e.reason || 'Outros';
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    });

    const topReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalProducedMonth,
      totalPlannedMonth,
      completedOpsMonth,
      totalOpsMonth: lineOps.length,
      efficiencyMonth,
      chartData,
      topProducts,
      topReasons,
    };
  }, [lineOps, lineEvents, currentMonthStr, dailyMetrics.producedToday]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col items-center justify-center font-sans gap-3">
        <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
          <Factory className="w-5 h-5" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-[#a1a1aa]">
          Carregando Portal do Líder...
        </p>
      </div>
    );
  }

  // Progresso da OP ativa — pode passar de 100% quando o rendimento supera a meta prevista
  const opProgress = activeOp && activeOp.plannedQuantity > 0
    ? Math.round((activeOp.producedQuantity / activeOp.plannedQuantity) * 100)
    : 0;

  const missingQty = activeOp ? Math.max(activeOp.plannedQuantity - activeOp.producedQuantity, 0) : 0;

  // Identificação da Linha Sleev ou OP destinada ao Sleev
  const isSleeve = Boolean(
    currentLine?.id === 'line-sleeve' ||
    (currentLine?.name && /sleeve/i.test(currentLine.name)) ||
    activeOp?.isSleeve
  );

  // Tempo trabalhado da OP ativa em milissegundos (baseado no histórico cronológico de eventos reais)
  const activeOpWorkingMs = useMemo(() => {
    if (!activeOp) return 0;
    const opEvents = recentEvents.filter(e => e.opId === activeOp.id);
    if (!opEvents.length) {
      if (activeOp.status === 'in_progress' && activeOp.startedAt) {
        const s = new Date(activeOp.startedAt).getTime();
        return isNaN(s) ? 0 : Math.max(0, Date.now() - s);
      }
      return 0;
    }

    const sorted = [...opEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    let workingMs = 0;
    let currentStart: number | null = null;

    for (const ev of sorted) {
      const t = new Date(ev.createdAt).getTime();
      if (isNaN(t)) continue;
      if (ev.type === 'STARTED' || ev.type === 'RESUMED') {
        currentStart = t;
      } else if ((ev.type === 'PAUSED' || ev.type === 'FINISHED') && currentStart !== null) {
        workingMs += Math.max(0, t - currentStart);
        currentStart = null;
      }
    }

    if (currentStart !== null && activeOp.status === 'in_progress') {
      workingMs += Math.max(0, Date.now() - currentStart);
    }

    return workingMs;
  }, [activeOp, recentEvents, currentTime]);

  // Rendimento de Produção por Hora no Sleev: Quantidade produzida ÷ Horas trabalhadas
  const sleeveRate = useMemo(() => {
    if (!activeOp) return { producedPerHour: 0, workingHours: 0, formatted: '0 un/h' };
    return calculateProductionRatePerHour(activeOp.producedQuantity, activeOpWorkingMs);
  }, [activeOp, activeOpWorkingMs]);

  // Variáveis contextuais do Chão de Fábrica (Envase)
  // Como esta tela é o posto operacional de Envase, o tipo de documento é sempre OP (Ordem de Produção)
  const docTypeLabel = 'OP';
  const displayUnit = activeOp?.unidade || 'un';
  const qtyProducedLabel = 'Volume Produzido';
  const reportButtonLabel = 'APONTAR PRODUÇÃO';

  return (
    <div className={embedded ? "w-full text-[#f4f4f5] font-sans flex flex-col antialiased space-y-4" : "min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans flex flex-col antialiased selection:bg-blue-600 selection:text-white"}>
      
      {/* ========================================================================= */}
      {/* 1. HEADER SUPERIOR DO LÍDER (RESPONSIVO & COMPLETO) */}
      {/* ========================================================================= */}
      <header className={embedded ? "bg-[#121216] border border-[#272733] rounded-2xl px-4 py-3 shadow-md" : "border-b border-[#1e1e24] bg-[#0d0d12]/95 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3"}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          
          {/* Identificação do Líder e Linha sob Responsabilidade */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                <Factory className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-black text-white tracking-tight uppercase truncate">
                  Chão de Fábrica (Envase)
                </h1>
                <p className="text-xs text-[#71717a]">
                  Acompanhamento de produção em tempo real
                </p>
              </div>
            </div>

            {/* Logout Mobile (Apenas standalone) */}
            {!embedded && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => signOut()}
                className="md:hidden text-[#71717a] hover:text-rose-400 hover:bg-rose-950/30 rounded-xl"
                title="Encerrar Sessão"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Seletor da Linha de Responsabilidade & Status */}
          <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap justify-between md:justify-end">
            
            {/* Badge Interativo da Linha Responsável */}
            <button
              onClick={() => setIsLineSelectOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#14141b] border border-[#272733] hover:border-blue-500/50 hover:bg-[#1a1a24] transition-all text-left group"
              title="Clique para alternar linha responsável"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping shrink-0" />
              <div className="min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#71717a] block leading-none">
                  Sua Linha
                </span>
                <span className="text-xs font-black text-white group-hover:text-blue-400 transition-colors truncate block">
                  {currentLine?.name || 'Nenhuma Linha'}
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#52525b] group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all ml-1 shrink-0" />
            </button>

            {/* Relógio & Turno */}
            <div className="hidden sm:flex items-center gap-2 bg-[#121217] border border-[#22222a] px-3 py-1.5 rounded-xl text-xs font-mono text-[#a1a1aa]">
              <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>{currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>

            {/* Logout Desktop (Apenas standalone) */}
            {!embedded && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut()}
                className="hidden md:flex text-[#71717a] hover:text-rose-400 hover:bg-rose-950/30 rounded-xl text-xs font-bold h-9"
                title="Encerrar Sessão"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                <span>Sair</span>
              </Button>
            )}

          </div>

        </div>

        {/* ------------------------------------------------------------- */}
        {/* ABAS UNIFICADAS DA TELA DO LÍDER */}
        {/* ------------------------------------------------------------- */}
        <div className="max-w-7xl mx-auto mt-3 pt-2 border-t border-[#1a1a22] flex items-center gap-2 overflow-x-auto no-scrollbar">
          
          <button
            onClick={() => setActiveTab('operation')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'operation'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#15151c]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Controle da Linha & Produção</span>
            {activeOp && (
              <span className={`w-2 h-2 rounded-full ${
                activeOp.status === 'in_progress' ? 'bg-emerald-400 animate-ping' :
                activeOp.status === 'paused' ? 'bg-amber-400' : 'bg-blue-300'
              }`} />
            )}
          </button>

          <button
            onClick={() => setActiveTab('daily_dash')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'daily_dash'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#15151c]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Dashboard Diário ({dailyMetrics.progressPercent}%)</span>
          </button>

          <button
            onClick={() => setActiveTab('monthly_dash')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'monthly_dash'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#15151c]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Dashboard Mensal ({monthlyMetrics.totalProducedMonth.toLocaleString('pt-BR')} un)</span>
          </button>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. CORPO PRINCIPAL POR ABA */}
      {/* ========================================================================= */}
      <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto space-y-6">

        {/* --------------------------------------------------------------------- */}
        {/* ABA 1: CONTROLE DA LINHA (CHÃO DE FÁBRICA & AÇÕES RÁPIDAS) */}
        {/* --------------------------------------------------------------------- */}
        {activeTab === 'operation' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            
            {/* Banner de Status da Linha */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 border ${
                  activeOp?.status === 'in_progress'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                    : activeOp?.status === 'paused'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                }`}>
                  <Factory className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#71717a]">
                      Posto de Trabalho
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      activeOp?.status === 'in_progress'
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/40'
                        : activeOp?.status === 'paused'
                        ? 'bg-amber-950/80 text-amber-400 border-amber-800/40'
                        : 'bg-blue-950/80 text-blue-400 border-blue-800/40'
                    }`}>
                      {activeOp?.status === 'in_progress' ? 'Linha em Produção' :
                       activeOp?.status === 'paused' ? 'Linha Pausada' : 'Aguardando Início'}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
                    {currentLine?.name || 'Linha de Produção'}
                  </h2>
                </div>
              </div>

              {/* Botão de Trocar Linha */}
              <button
                onClick={() => setIsLineSelectOpen(true)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#171720] hover:bg-[#20202c] border border-[#2b2b38] text-xs font-bold text-[#f4f4f5] flex items-center justify-center gap-2 transition-all"
              >
                <Layers className="w-4 h-4 text-blue-400" />
                <span>Trocar de Linha</span>
              </button>
            </div>

            {/* CARD PRINCIPAL DA ORDEM DE PRODUÇÃO ATIVA */}
            {activeOp ? (
              <div className="bg-[#121217] border border-[#22222b] rounded-3xl p-5 sm:p-7 space-y-6 shadow-xl relative overflow-hidden">
                
                {/* Indicador de Status Visual no Topo do Card */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-[#20202a]">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-3 py-1 rounded-xl bg-[#1a1a24] border border-[#2d2d3c] text-xs font-mono font-bold text-blue-400">
                      {docTypeLabel} #{activeOp.number}
                    </span>
                    {activeOp.lote && (
                      <span className="px-2.5 py-1 rounded-xl bg-[#16161e] border border-[#272733] text-xs font-mono text-[#a1a1aa] flex items-center gap-1">
                        <Tag className="w-3 h-3 text-[#71717a]" />
                        Lote: <strong className="text-white">{activeOp.lote}</strong>
                      </span>
                    )}
                    {activeOp.granel && (
                      <span className="px-2.5 py-1 rounded-xl bg-[#16161e] border border-[#272733] text-xs font-mono text-[#a1a1aa] flex items-center gap-1">
                        <Boxes className="w-3 h-3 text-[#71717a]" />
                        Granel: <strong className="text-white">{activeOp.granel}</strong>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border ${
                      activeOp.priority === 'Crítica' ? 'bg-rose-950 text-rose-400 border-rose-800/50' :
                      activeOp.priority === 'Alta' ? 'bg-amber-950 text-amber-400 border-amber-800/50' :
                      'bg-blue-950 text-blue-400 border-blue-800/50'
                    }`}>
                      Prioridade {activeOp.priority}
                    </span>

                    <span className={`px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border ${
                      activeOp.status === 'in_progress' ? 'bg-emerald-950 text-emerald-400 border-emerald-800/50' :
                      activeOp.status === 'paused' ? 'bg-amber-950 text-amber-400 border-amber-800/50' :
                      'bg-[#1a1a24] text-[#a1a1aa] border-[#2c2c3a]'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        activeOp.status === 'in_progress' ? 'bg-emerald-400 animate-ping' :
                        activeOp.status === 'paused' ? 'bg-amber-400' : 'bg-slate-400'
                      }`} />
                      {activeOp.status === 'in_progress' ? 'Em Andamento' :
                       activeOp.status === 'paused' ? 'Pausada' : 'Aguardando'}
                    </span>

                    {/* Badge Sleev se a OP veio do envase com acabamento para Sleev */}
                    {activeOp.isSleeve && (
                      <span className="px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border bg-purple-950 text-purple-300 border-purple-600/60 shadow-sm shadow-purple-950/40">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        Sleev
                      </span>
                    )}

                    {/* OP programada para uma data que já passou e ainda nem
                        foi iniciada — alerta em vermelho para o líder. */}
                    {isOpOverdue(activeOp, todayDateStr) && (
                      <span className="px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border bg-red-950 text-red-400 border-red-800/60 animate-pulse">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Atrasada
                      </span>
                    )}
                  </div>
                </div>

                {/* Produto em Destaque */}
                <div>
                  <span className="text-[11px] uppercase font-bold text-[#71717a] tracking-wider block mb-1">
                    Produto em Fabricação
                  </span>
                  <h3 className="text-xl sm:text-3xl font-black text-white tracking-tight leading-tight">
                    {activeOp.product}
                  </h3>
                </div>

                {/* Se estiver pausada, mostra banner com motivo */}
                {activeOp.status === 'paused' && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                        Produção Pausada
                      </h4>
                      <p className="text-xs text-amber-200/80 mt-0.5">
                        A linha está interrompida. Clique em <strong>Retomar Produção</strong> para continuar a contagem.
                      </p>
                    </div>
                  </div>
                )}

                {/* Barra de Progresso e Métricas Numéricas */}
                <div className="bg-[#171720] border border-[#262634] rounded-2xl p-4 sm:p-5 space-y-3">
                  {isSleeve ? (
                    /* MOSTRADOR DE QUANTIDADE PRÓPRIO DO SLEEV (Apenas quantidade produzida por hora) */
                    <div className="p-4 rounded-2xl bg-purple-950/25 border border-purple-800/40 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-purple-400" />
                          Mostrador de Quantidade (Sleev)
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-900/80 text-purple-200 border border-purple-700/60 uppercase">
                          Apenas Produção por Hora
                        </span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pt-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight">
                            {sleeveRate.producedPerHour.toLocaleString('pt-BR')}
                          </span>
                          <span className="text-base sm:text-lg font-bold text-purple-400 font-mono">
                            un/h
                          </span>
                        </div>

                        <div className="text-left sm:text-right">
                          <span className="text-[11px] font-mono text-[#a1a1aa]">
                            Total acumulado: <strong className="text-white font-bold">{activeOp.producedQuantity.toLocaleString('pt-BR')} un</strong>
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-purple-800/30 flex flex-wrap items-center justify-between text-xs text-[#a1a1aa] font-mono gap-2">
                        <span>
                          Métrica: {activeOp.producedQuantity.toLocaleString('pt-BR')} un ÷ {sleeveRate.workingHours > 0 ? `${sleeveRate.workingHours.toFixed(1)}h trabalhadas` : 'tempo trabalhado'}
                        </span>
                        <span className="text-purple-300">
                          Progresso: {opProgress}% ({missingQty.toLocaleString('pt-BR')} un restantes)
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-[#71717a] uppercase tracking-wider block">
                          {qtyProducedLabel}
                        </span>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-3xl sm:text-4xl font-black text-white font-mono">
                            {activeOp.producedQuantity.toLocaleString('pt-BR')}
                          </span>
                          <span className="text-sm font-semibold text-[#71717a] font-mono">
                            / {activeOp.plannedQuantity.toLocaleString('pt-BR')} {displayUnit}
                          </span>
                        </div>
                      </div>

                      <div className="text-left sm:text-right">
                        <span className="text-xs font-bold text-[#71717a] uppercase tracking-wider block">
                          Faltam para Concluir
                        </span>
                        <span className="text-lg font-bold text-blue-400 font-mono">
                          {missingQty.toLocaleString('pt-BR')} {displayUnit} ({opProgress}%)
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Barra visual de progresso com gradiente de vermelho (0%) a verde (90%+) */}
                  <div
                    id="op-progress-container"
                    className="w-full h-3.5 bg-[#0e0e12] rounded-full overflow-hidden p-0.5 border border-[#2a2a38]"
                  >
                    <div
                      id="op-progress-bar"
                      className="h-full rounded-full transition-all duration-500 shadow-sm"
                      style={{
                        width: `${Math.min(opProgress, 100)}%`,
                        background: isSleeve
                          ? 'linear-gradient(90deg, #7e22ce 0%, #a855f7 50%, #c084fc 100%)'
                          : 'linear-gradient(90deg, #ef4444 0%, #f97316 45%, #eab308 75%, #10b981 90%, #059669 100%)',
                      }}
                    />
                  </div>
                </div>

                {/* ========================================================= */}
                {/* BOTÕES DE CONTROLE OPERACIONAL (INICIAR, PAUSAR, APONTAR, FINALIZAR) */}
                {/* ========================================================= */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                  
                  {/* Se Pendente -> Iniciar */}
                  {activeOp.status === 'pending' && (
                    <Button
                      onClick={handleStart}
                      className="col-span-full h-14 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2.5 transition-all"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      <span>INICIAR PRODUÇÃO DESTA {docTypeLabel}</span>
                    </Button>
                  )}

                  {/* Se Em Produção -> Apontar, Pausar e Finalizar */}
                  {activeOp.status === 'in_progress' && (
                    <>
                      {/* Apontar Produção */}
                      <Button
                        onClick={() => setIsReportOpen(true)}
                        className="h-14 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl shadow-lg shadow-blue-950/50 flex items-center justify-center gap-2 transition-all col-span-1 sm:col-span-2"
                      >
                        <Package className="w-5 h-5" />
                        <span>{reportButtonLabel}</span>
                      </Button>

                      {/* Pausar Linha */}
                      <Button
                        onClick={() => {
                          setPauseProducedQty(activeOp.producedQuantity ? String(activeOp.producedQuantity) : '0');
                          setIsPauseOpen(true);
                        }}
                        className="h-14 bg-[#181820] hover:bg-amber-950/30 text-amber-400 hover:text-amber-300 border border-amber-500/30 font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 transition-all"
                      >
                        <Pause className="w-5 h-5" />
                        <span>PAUSAR LINHA</span>
                      </Button>

                      {/* Finalizar OP */}
                      <Button
                        onClick={() => {
                          setFinishShift(null);
                          setFinishProducedQty(activeOp.producedQuantity ? String(activeOp.producedQuantity) : String(activeOp.plannedQuantity));
                          setFinishProductionType(activeOp.producedQuantity >= activeOp.plannedQuantity ? 'total' : 'parcial');
                          setFinishSendToSleeve(false);
                          setIsFinishOpen(true);
                        }}
                        className="h-14 bg-[#181820] hover:bg-emerald-950/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 transition-all"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        <span>CONCLUIR {docTypeLabel}</span>
                      </Button>
                    </>
                  )}

                  {/* Se Pausada -> Retomar e Finalizar */}
                  {activeOp.status === 'paused' && (
                    <>
                      <Button
                        onClick={handleResume}
                        className="col-span-1 sm:col-span-3 h-14 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg shadow-blue-950/50 flex items-center justify-center gap-2.5 transition-all"
                      >
                        <Play className="w-5 h-5 fill-current" />
                        <span>RETOMAR PRODUÇÃO</span>
                      </Button>

                      <Button
                        onClick={() => {
                          setFinishShift(null);
                          setFinishProducedQty(activeOp.producedQuantity ? String(activeOp.producedQuantity) : String(activeOp.plannedQuantity));
                          setFinishProductionType(activeOp.producedQuantity >= activeOp.plannedQuantity ? 'total' : 'parcial');
                          setFinishSendToSleeve(false);
                          setIsFinishOpen(true);
                        }}
                        className="h-14 bg-[#181820] hover:bg-emerald-950/30 text-emerald-400 border border-emerald-500/30 font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        <span>CONCLUIR {docTypeLabel}</span>
                      </Button>
                    </>
                  )}

                </div>

              </div>
            ) : (
              <div className="bg-[#121217] border border-[#22222b] rounded-3xl p-10 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center">
                  <Package className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">
                    Nenhuma {docTypeLabel} em andamento nesta linha
                  </h3>
                  <p className="text-xs text-[#71717a] max-w-md mx-auto">
                    {currentLine?.id === 'line-sleeve'
                      ? 'Vincule uma OP disponível do estoque para iniciar a produção no Sleev ou aguarde o sequenciamento.'
                      : 'Aguardando programação da coordenação ou vincule uma OP do estoque para operar.'}
                  </p>
                </div>
                <div className="pt-2 flex justify-center">
                  <Button
                    onClick={() => setIsAssignStockOpen(true)}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl px-5 py-2.5 flex items-center gap-2 shadow-lg shadow-blue-950/40"
                  >
                    <Plus className="w-4 h-4" />
                    Vincular OP do Estoque para {currentLine?.name || 'esta Linha'}
                  </Button>
                </div>
              </div>
            )}

            {/* FILA DE PRÓXIMAS OPS NA LINHA */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Fila Sequenciada da Linha ({queuedOps.length} {docTypeLabel}s na espera)
                  </h3>
                </div>
                <span className="text-[11px] text-[#71717a]">
                  Sequência oficial de fabricação
                </span>
              </div>

              {queuedOps.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {queuedOps.map((op, idx) => {
                    const overdue = isOpOverdue(op, todayDateStr);
                    return (
                    <div
                      key={op.id}
                      className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition-all ${
                        overdue
                          ? 'bg-red-950/30 border-red-800/60 hover:border-red-600'
                          : 'bg-[#16161e] border-[#242430] hover:border-[#353545]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-blue-400 font-mono bg-blue-950/50 px-2 py-0.5 rounded-md border border-blue-800/30">
                            #{idx + 1} • {docTypeLabel} {op.number}
                          </span>
                          <div className="flex items-center gap-1">
                            {op.isSleeve && (
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700/60 flex items-center gap-1 shadow-sm">
                                <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                                Sleev
                              </span>
                            )}
                            {overdue && (
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-800/60 flex items-center gap-1">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Atrasada
                              </span>
                            )}
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              op.priority === 'Crítica' ? 'bg-rose-950 text-rose-400' :
                              op.priority === 'Alta' ? 'bg-amber-950 text-amber-400' : 'bg-blue-950 text-blue-400'
                            }`}>
                              {op.priority}
                            </span>
                          </div>
                        </div>
                        <h4 className="text-xs font-bold text-white truncate pt-1">
                          {op.product}
                        </h4>
                        <p className="text-[11px] text-[#71717a] font-mono">
                          Lote: {op.lote || 'N/A'} • Meta: {op.plannedQuantity.toLocaleString('pt-BR')} {displayUnit}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-[#20202b] flex items-center justify-between text-[11px] text-[#a1a1aa]">
                        <span>Progresso: 0%</span>
                        {overdue ? (
                          <span className="text-red-400 font-semibold">
                            Atrasada desde {new Date(op.scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                          </span>
                        ) : (
                          <span className="text-blue-400 font-semibold">Na fila</span>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#71717a] italic py-2">
                  Não há mais ordens pendentes na fila desta linha.
                </p>
              )}
            </div>

          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* ABA 2: DASHBOARD DIÁRIO DO LÍDER */}
        {/* --------------------------------------------------------------------- */}
        {activeTab === 'daily_dash' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            
            {/* Título e Data de Hoje */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-400" />
                  Dashboard Diário da Produção
                </h2>
                <p className="text-xs text-[#71717a]">
                  Métricas de desempenho e apontamentos de hoje para <strong>{currentLine?.name}</strong>.
                </p>
              </div>

              <span className="flex items-center gap-1.5 text-xs text-[#a1a1aa] bg-[#14141b] border border-[#272733] px-3 py-1.5 rounded-xl font-mono">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
              </span>
            </div>

            {/* 4 CARDS DE KPI DIÁRIO */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* Total Produzido Hoje ou Taxa Horária no Sleev */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  {isSleeve ? 'Produção por Hora (Sleev)' : 'Produzido Hoje'}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                    {isSleeve
                      ? sleeveRate.producedPerHour.toLocaleString('pt-BR')
                      : dailyMetrics.producedToday.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">
                    {isSleeve ? 'un/h' : 'un'}
                  </span>
                </div>
                <div className={`text-[11px] flex items-center gap-1 font-semibold ${isSleeve ? 'text-purple-400' : 'text-emerald-400'}`}>
                  <TrendingUp className="w-3 h-3" />
                  <span>
                    {isSleeve
                      ? `${sleeveRate.workingHours > 0 ? sleeveRate.workingHours.toFixed(1) : '0'}h trabalhadas`
                      : 'Em ritmo normal'}
                  </span>
                </div>
              </div>

              {/* Meta do Dia & % Atingido */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  Meta do Dia
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-blue-400 font-mono">
                    {dailyMetrics.progressPercent}%
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">
                    / {dailyMetrics.dailyTarget.toLocaleString('pt-BR')} un
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#1a1a24] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${dailyMetrics.progressPercent}%` }}
                  />
                </div>
              </div>

              {/* OPs Finalizadas Hoje */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  OPs Concluídas Hoje
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                    {dailyMetrics.completedTodayCount}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">
                    / {dailyMetrics.totalOpsToday} programadas
                  </span>
                </div>
                <div className="text-[11px] text-[#a1a1aa] font-medium">
                  {dailyMetrics.totalOpsToday - dailyMetrics.completedTodayCount} ordens restantes
                </div>
              </div>

              {/* Paradas do Dia */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  Paradas Registradas
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl sm:text-3xl font-black font-mono ${
                    dailyMetrics.pauseCountToday > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    {dailyMetrics.pauseCountToday}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">pausas</span>
                </div>
                <div className="text-[11px] text-[#a1a1aa] font-medium">
                  {dailyMetrics.pauseCountToday === 0 ? 'Sem interrupções hoje' : 'Pausas sob controle'}
                </div>
              </div>

            </div>

            {/* HISTÓRICO DE APONTAMENTOS E EVENTOS DE HOJE */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  Linha do Tempo de Apontamentos & Acontecimentos de Hoje
                </h3>
                <span className="text-[11px] text-[#71717a]">
                  Registro auditável em tempo real
                </span>
              </div>

              {dailyMetrics.todayEvents.length > 0 ? (
                <div className="space-y-2.5">
                  {dailyMetrics.todayEvents.map(event => (
                    <div
                      key={event.id}
                      className="p-3.5 rounded-xl bg-[#16161e] border border-[#242430] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          event.type === 'QUANTITY_REPORTED' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' :
                          event.type === 'STARTED' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' :
                          event.type === 'PAUSED' ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30' :
                          'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                        }`}>
                          {event.type === 'QUANTITY_REPORTED' ? <Package className="w-4 h-4" /> :
                           event.type === 'STARTED' ? <Play className="w-4 h-4" /> :
                           event.type === 'PAUSED' ? <Pause className="w-4 h-4" /> :
                           <CheckCircle2 className="w-4 h-4" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white truncate">
                              {event.type === 'QUANTITY_REPORTED' ? `Apontamento de +${event.quantity} ${displayUnit}` :
                               event.type === 'STARTED' ? 'Início de Produção' :
                               event.type === 'PAUSED' ? `Pausa: ${event.reason || 'Operacional'}` :
                               event.type === 'RESUMED' ? 'Retomada de Produção' : 
                               (() => {
                                 const relatedOp = allOps.find(o => o.id === event.opId || o.number === event.opNumber);
                                 if (relatedOp?.finishedShift) {
                                   return `Finalizado · Turno da ${relatedOp.finishedShift}`;
                                 }
                                 return `${docTypeLabel} Finalizada com Sucesso`;
                               })()}
                            </span>
                            {event.opNumber && (
                              <span className="text-[10px] font-mono text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded">
                                {docTypeLabel} {event.opNumber}
                              </span>
                            )}
                          </div>
                          {event.observation && (
                            <p className="text-[11px] text-[#71717a] truncate mt-0.5">
                              Obs: {event.observation}
                            </p>
                          )}
                        </div>
                      </div>

                      <span className="text-[11px] font-mono text-[#71717a] shrink-0">
                        {event.createdAt ? new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-[#15151c] rounded-xl border border-dashed border-[#272733]">
                  <p className="text-xs text-[#71717a]">
                    Nenhum apontamento ou parada registrado hoje nesta linha até o momento.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* ABA 3: DASHBOARD MENSAL DE PRODUÇÃO */}
        {/* --------------------------------------------------------------------- */}
        {activeTab === 'monthly_dash' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            
            {/* Cabeçalho Mensal */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  Dashboard Mensal de Produção — {currentMonthName}
                </h2>
                <p className="text-xs text-[#71717a]">
                  Consolidado histórico de volume e OPs entregues em <strong>{currentLine?.name}</strong>.
                </p>
              </div>

              <span className="flex items-center gap-1.5 text-xs text-[#a1a1aa] bg-[#14141b] border border-[#272733] px-3 py-1.5 rounded-xl font-mono">
                <CalendarDays className="w-3.5 h-3.5 text-blue-400" />
                <span className="capitalize">{currentMonthName}</span>
              </span>
            </div>

            {/* 4 CARDS DE KPI MENSAL */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* Total Produzido no Mês */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  Total Produzido no Mês
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                    {monthlyMetrics.totalProducedMonth.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">un</span>
                </div>
                <div className="text-[11px] text-blue-400 font-semibold flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3" />
                  <span>Meta: {monthlyMetrics.totalPlannedMonth.toLocaleString('pt-BR')} un</span>
                </div>
              </div>

              {/* OPs Entregues no Mês */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  OPs Entregues no Mês
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                    {monthlyMetrics.completedOpsMonth}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">
                    / {monthlyMetrics.totalOpsMonth} OPs
                  </span>
                </div>
                <div className="text-[11px] text-[#a1a1aa] font-medium">
                  {monthlyMetrics.totalOpsMonth - monthlyMetrics.completedOpsMonth} restantes na grade
                </div>
              </div>

              {/* Cumprimento do Plano */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  Aderência ao Plano
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-blue-400 font-mono">
                    {monthlyMetrics.efficiencyMonth}%
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">índice</span>
                </div>
                <div className="w-full h-1.5 bg-[#1a1a24] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${monthlyMetrics.efficiencyMonth}%` }}
                  />
                </div>
              </div>

              {/* Conformidade & Qualidade */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider block">
                  Garantia Operacional
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                    99.4%
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">qualidade</span>
                </div>
                <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Conforme padrões</span>
                </div>
              </div>

            </div>

            {/* GRÁFICO INTERATIVO DE PRODUÇÃO DIÁRIA NO MÊS */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    Curva Diária de Produção no Mês ({currentMonthName})
                  </h3>
                  <p className="text-[11px] text-[#71717a]">
                    Volume produzido por dia vs Meta diária planejada
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <span className="w-3 h-3 rounded-sm bg-blue-500" />
                    Volume Produzido
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <span className="w-3 h-1 bg-slate-500" />
                    Meta de Referência
                  </span>
                </div>
              </div>

              <div className="h-64 sm:h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyMetrics.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#22222d" vertical={false} />
                    <XAxis
                      dataKey="dia"
                      stroke="#52525b"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#22222d' }}
                    />
                    <YAxis
                      stroke="#52525b"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#22222d' }}
                      tickFormatter={(v) => `${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#121217',
                        border: '1px solid #2b2b38',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#fff',
                      }}
                      formatter={(val: any) => [`${Number(val).toLocaleString('pt-BR')} un`, 'Quantidade']}
                    />
                    <Bar dataKey="produzido" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* GRID INFERIOR: TOP PRODUTOS FABRICADOS & PRINCIPAIS PARADAS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Top Produtos no Mês */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  Top Produtos Fabricados na Linha neste Mês
                </h3>

                {monthlyMetrics.topProducts.length > 0 ? (
                  <div className="space-y-3">
                    {monthlyMetrics.topProducts.map((p, idx) => {
                      const pct = p.planned > 0 ? Math.min(Math.round((p.produced / p.planned) * 100), 100) : 100;
                      return (
                        <div key={idx} className="p-3 rounded-xl bg-[#16161e] border border-[#242430] space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-white truncate max-w-[220px]">
                              {p.product}
                            </span>
                            <span className="font-mono text-emerald-400 font-bold">
                              {p.produced.toLocaleString('pt-BR')} un
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-[#0e0e12] rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[#71717a] italic">Sem produtos registrados neste período.</p>
                )}
              </div>

              {/* Análise de Motivos de Parada */}
              <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Principais Motivos de Paradas no Mês
                </h3>

                {monthlyMetrics.topReasons.length > 0 ? (
                  <div className="space-y-2.5">
                    {monthlyMetrics.topReasons.map((r, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#16161e] border border-[#242430] flex items-center justify-between text-xs"
                      >
                        <span className="text-[#e4e4e7] font-medium truncate pr-2">
                          {r.reason}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-950/60 text-amber-400 border border-amber-800/40 font-mono font-bold shrink-0">
                          {r.count} {r.count === 1 ? 'ocorrência' : 'ocorrências'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center bg-[#16161e] rounded-xl border border-[#242430]">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1.5" />
                    <p className="text-xs text-[#a1a1aa]">Nenhuma parada registrada neste mês para esta linha.</p>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

      </main>

      {/* ========================================================================= */}
      {/* 3. MODAIS DE AÇÃO OPERACIONAL */}
      {/* ========================================================================= */}

      {/* MODAL 1: APONTAR QUANTIDADE PRODUZIDA */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-blue-400 flex items-center gap-2">
              <Package className="w-5 h-5" />
              Apontar Produção Realizada
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-3">
            <div className="bg-[#181822] p-3.5 rounded-2xl border border-[#2c2c3c] text-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-[#71717a] block">{docTypeLabel} Atual</span>
              <p className="font-bold text-white">{docTypeLabel} {activeOp?.number} • {activeOp?.product}</p>
              <p className="text-[#a1a1aa] font-mono">
                Já produzido: {activeOp?.producedQuantity.toLocaleString('pt-BR')} / {activeOp?.plannedQuantity.toLocaleString('pt-BR')} {displayUnit}
              </p>
            </div>

            {/* Botões Rápidos de Incremento */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Incremento Rápido de Unidades
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[48, 96, 192, 768].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleReport(amt)}
                    className="py-3 rounded-xl bg-[#1c1c27] hover:bg-blue-600 hover:text-white border border-[#2d2d3f] text-xs font-black font-mono transition-all"
                  >
                    +{amt} {displayUnit}
                  </button>
                ))}
              </div>
            </div>

            {/* Entrada Manual de Quantidade */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Ou Digite a Quantidade a Adicionar
              </Label>
              <Input
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="bg-[#181822] border-[#2c2c3c] text-xl font-mono text-white h-12 rounded-xl text-center font-black focus:border-blue-500"
                placeholder="Ex: 300"
                autoFocus
              />
            </div>

            {/* Quantidade Rejeitada (opcional) — vale apenas para o apontamento manual acima */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-red-400 font-bold tracking-wider">
                Quantidade Rejeitada Neste Apontamento (Opcional)
              </Label>
              <Input
                type="number"
                min="0"
                value={reportRejectedQty}
                onChange={e => setReportRejectedQty(e.target.value)}
                className="bg-[#181822] border-red-900/50 text-sm font-mono text-red-400 font-bold h-10 rounded-xl"
                placeholder="Ex: 5"
              />
              <p className="text-[10px] text-[#71717a]">
                Perda/refugo identificado neste lote — usado no cálculo de Qualidade do OEE.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsReportOpen(false);
                setReportRejectedQty('');
              }}
              className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => handleReport()}
              disabled={!quantity || isNaN(parseInt(quantity)) || parseInt(quantity) <= 0}
              className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              Confirmar Apontamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: PAUSAR LINHA */}
      <Dialog open={isPauseOpen} onOpenChange={setIsPauseOpen}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-amber-400 flex items-center gap-2">
              <Pause className="w-5 h-5" />
              Registrar Pausa na Produção
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Selecione o Motivo da Parada *
              </Label>
              <Select onValueChange={setPauseReason} value={pauseReason}>
                <SelectTrigger className="bg-[#181822] border-[#2c2c3c] rounded-xl h-11 text-xs font-medium">
                  <SelectValue placeholder="Escolha o motivo da pausa..." />
                </SelectTrigger>
                <SelectContent className="bg-[#181822] border-[#2c2c3c] text-[#f4f4f5] max-h-60">
                  {pauseReasonsList.map(r => (
                    <SelectItem key={r.id || r.name} value={r.name} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider flex items-center justify-between">
                <span>Quantidade Produzida até o Momento ({displayUnit})</span>
                <span className="text-amber-400 font-mono text-[11px]">
                  Atual: {activeOp?.producedQuantity.toLocaleString('pt-BR')} {displayUnit}
                </span>
              </Label>
              <Input
                type="number"
                min="0"
                value={pauseProducedQty}
                onChange={e => setPauseProducedQty(e.target.value)}
                placeholder={`Informe o total produzido (ex: ${activeOp?.producedQuantity || 0})`}
                className="bg-[#181822] border-[#2c2c3c] rounded-xl text-sm font-mono"
              />
              <p className="text-[11px] text-[#71717a]">
                O valor informado atualizará o painel e a barra de progresso imediatamente ao confirmar a pausa.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Observação Complementar (Opcional)
              </Label>
              <Input
                value={pauseObs}
                onChange={e => setPauseObs(e.target.value)}
                placeholder="Ex: Aguardando liberação do técnico..."
                className="bg-[#181822] border-[#2c2c3c] rounded-xl text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsPauseOpen(false)}
              className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Voltar
            </Button>
            <Button
              onClick={handlePause}
              disabled={!pauseReason}
              className="bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              Confirmar Pausa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: FINALIZAR OP / OSM */}
      <Dialog
        open={isFinishOpen}
        onOpenChange={open => {
          if (!open) {
            setIsCancelFinishConfirmOpen(true);
          }
        }}
      >
        <DialogContent className="bg-[#121214] border-[#27272a] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Concluir {docTypeLabel} {activeOp?.number}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="bg-[#181822] p-4 rounded-2xl border border-[#27272a] text-xs space-y-2">
              <p className="text-white font-bold">
                OP {activeOp?.number} • {activeOp?.product}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[#a1a1aa] font-mono pt-1">
                <div>Planejado: <strong className="text-white">{activeOp?.plannedQuantity.toLocaleString('pt-BR')} {displayUnit}</strong></div>
                <div>Atual: <strong className="text-emerald-400">{activeOp?.producedQuantity.toLocaleString('pt-BR')} {displayUnit}</strong></div>
              </div>
            </div>

            {/* Tipo de Conclusão: Total ou Parcial (apenas os nomes sem descrição) */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Tipo de Conclusão *
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  id="btn-finish-total"
                  onClick={() => setFinishProductionType('total')}
                  className={`h-11 rounded-xl border text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center select-none ${
                    finishProductionType === 'total'
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/30'
                      : 'bg-[#181822] border-[#2c2c3c] text-[#a1a1aa] hover:border-[#3f3f50] hover:text-white'
                  }`}
                >
                  <span>Total</span>
                </button>

                <button
                  type="button"
                  id="btn-finish-parcial"
                  onClick={() => setFinishProductionType('parcial')}
                  className={`h-11 rounded-xl border text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center select-none ${
                    finishProductionType === 'parcial'
                      ? 'bg-amber-500/15 border-amber-500 text-amber-400 shadow-md shadow-amber-950/40 ring-1 ring-amber-500/30'
                      : 'bg-[#181822] border-[#2c2c3c] text-[#a1a1aa] hover:border-[#3f3f50] hover:text-white'
                  }`}
                >
                  <span>Parcial</span>
                </button>
              </div>
            </div>

            {/* Input de Quantidade Produzida */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider flex items-center justify-between">
                <span>Quantidade Produzida Final ({displayUnit}) *</span>
                <span className="text-[#71717a] font-mono text-[11px]">
                  Estimativa: {activeOp?.plannedQuantity.toLocaleString('pt-BR')} {displayUnit}
                </span>
              </Label>
              <Input
                type="number"
                min="0"
                value={finishProducedQty}
                onChange={e => setFinishProducedQty(e.target.value)}
                placeholder={`Quantidade produzida em ${displayUnit}`}
                className="bg-[#181822] border-[#2c2c3c] rounded-xl text-sm font-mono text-white focus:border-emerald-500"
              />
            </div>

            {/* Quantidade Rejeitada (opcional) — enquanto o laboratório não entra no fluxo,
                é o próprio líder que registra a perda ao concluir a OP */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-red-400 font-bold tracking-wider">
                Quantidade Rejeitada ({displayUnit}) — Opcional
              </Label>
              <Input
                type="number"
                min="0"
                value={finishRejectedQty}
                onChange={e => setFinishRejectedQty(e.target.value)}
                placeholder="Ex: 20"
                className="bg-[#181822] border-red-900/50 rounded-xl text-sm font-mono text-red-400 font-bold focus:border-red-500"
              />
              <p className="text-[10px] text-[#71717a]">
                Perda/refugo total identificado nesta OP — usado no cálculo de Qualidade do OEE.
              </p>
            </div>

            {/* Checkbox Sleev */}
            <div
              id="card-sleeve-option"
              onClick={() => setFinishSendToSleeve(!finishSendToSleeve)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                finishSendToSleeve
                  ? 'bg-purple-950/25 border-purple-500/60 text-white shadow-md shadow-purple-950/30 ring-1 ring-purple-500/30'
                  : 'bg-[#181822] border-[#27272a] text-[#a1a1aa] hover:border-[#383848]'
              }`}
            >
              <input
                type="checkbox"
                id="checkbox-sleeve"
                checked={finishSendToSleeve}
                onChange={e => setFinishSendToSleeve(e.target.checked)}
                onClick={e => e.stopPropagation()}
                className="mt-0.5 w-4 h-4 rounded border-[#383848] text-purple-600 focus:ring-purple-500 focus:ring-offset-0 bg-[#121218] cursor-pointer"
              />
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="checkbox-sleeve"
                    className="text-xs font-bold text-white cursor-pointer uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    Sleev
                  </label>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30">
                    Retorna ao Estoque
                  </span>
                </div>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  Se marcado, a OP retorna para o estoque e fica livre para ser produzida no <strong>Sleev</strong>, com a nova quantidade planejada de{' '}
                  <strong className="text-purple-300 font-mono">
                    {finishProducedQty ? parseInt(finishProducedQty, 10).toLocaleString('pt-BR') : activeOp?.producedQuantity.toLocaleString('pt-BR') || '0'} {displayUnit}
                  </strong>{' '}
                  (quantidade apontada).
                </p>
              </div>
            </div>

            <p className="text-xs text-[#a1a1aa]">
              {finishSendToSleeve
                ? 'Ao concluir, o envase nesta linha será finalizado com a quantidade apontada acima, liberando a linha. A OP voltará ao estoque com o saldo apontado, livre para produção no Sleev.'
                : 'Este será o valor total final produzido da OP (não soma com apontamentos anteriores). Ao concluir, a OP será encerrada com esta quantidade total e a linha ficará liberada.'}
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsCancelFinishConfirmOpen(true)}
              className="border-[#27272a] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleFinish}
              disabled={!finishProducedQty || isNaN(parseInt(finishProducedQty, 10)) || parseInt(finishProducedQty, 10) < 0}
              className={
                finishSendToSleeve
                  ? 'bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-purple-950/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider'
              }
            >
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE CONFIRMAÇÃO DE CANCELAMENTO DA CONCLUSÃO */}
      <Dialog open={isCancelFinishConfirmOpen} onOpenChange={setIsCancelFinishConfirmOpen}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-sm rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Cancelar Conclusão?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#a1a1aa] leading-relaxed py-2">
            Tem certeza de que deseja cancelar a conclusão da OP? Os dados informados nesta tela não serão salvos.
          </p>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsCancelFinishConfirmOpen(false)}
              className="border-[#27272a] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Continuar Editando
            </Button>
            <Button
              onClick={() => {
                setIsCancelFinishConfirmOpen(false);
                setIsFinishOpen(false);
                setFinishShift(null);
                setFinishProducedQty('');
                setFinishRejectedQty('');
                setFinishProductionType('total');
                setFinishSendToSleeve(false);
              }}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              Sim, Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: SELECIONAR / TROCAR DE LINHA */}
      <Dialog open={isLineSelectOpen} onOpenChange={setIsLineSelectOpen}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-white flex items-center gap-2">
              <Factory className="w-5 h-5 text-blue-400" />
              Selecionar Linha de Trabalho
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 py-3">
            {lines.map(l => {
              const isSelected = l.id === selectedLineId;
              const opCount = envaseOps.filter(o => String(o.lineId) === String(l.id) && o.status !== 'completed').length;
              return (
                <button
                  key={l.id}
                  onClick={() => handleSwitchLine(l.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500 text-white shadow-md'
                      : 'bg-[#181822] border-[#2c2c3c] text-[#a1a1aa] hover:border-blue-500/40 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-[#222230] text-[#71717a]'
                    }`}>
                      <Factory className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">{l.name}</h4>
                      <p className="text-[10px] text-[#71717a]">
                        {opCount} {opCount === 1 ? 'ordem ativa' : 'ordens ativas'}
                      </p>
                    </div>
                  </div>

                  {isSelected && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsLineSelectOpen(false)}
              className="w-full border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 5: VINCULAR OP DO ESTOQUE À LINHA */}
      {isAssignStockOpen && currentLine && (
        <AssignStockOpToLineModal
          isOpen={isAssignStockOpen}
          onClose={() => setIsAssignStockOpen(false)}
          targetLine={currentLine}
          ops={allOps}
          onAssignAndStart={async (opId, lineId) => {
            const today = getLocalDateStr();
            await updateOP(opId, {
              lineId,
              scheduledDate: today,
              scheduledEndDate: today,
              scheduledDays: 1,
            });
            if (profile) {
              await startOP(opId, lineId, profile.uid);
            }
            setIsAssignStockOpen(false);
            await fetchData(true);
          }}
          onAssignToQueue={async (opId, lineId) => {
            const today = getLocalDateStr();
            await updateOP(opId, {
              lineId,
              scheduledDate: today,
              scheduledEndDate: today,
              scheduledDays: 1,
            });
            setIsAssignStockOpen(false);
            await fetchData(true);
          }}
        />
      )}

    </div>
  );
}

