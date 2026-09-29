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
  XCircle,
  Sunrise,
  Sunset,
  Users,
  RefreshCcw,
} from 'lucide-react';
import {
  getLines,
  getAllOPs,
  getActiveOP,
  startOP,
  pauseOP,
  resumeOP,
  finishOP,
  cancelOP,
  reportQuantity,
  saveLeaderRotation,
  getRecentEvents,
  getAllUsers,
  getPauseReasons,
  updateOP,
  DEFAULT_PAUSE_REASONS,
  getWorkSessions,
  startWorkSession,
  endWorkSession,
  getOpenWorkSession,
  getLineDailyGoals,
  computeProductionByLineAndDay,
  toLocalDateStr,
  getOpReferenceDateStr,
  getLineHeadcounts,
  recordLineHeadcount,
  getHeadcountForLineDay,
  getChangeovers,
  getOpenChangeover,
  startChangeover,
  endChangeover,
} from '../services/db';
import { AssignStockOpToLineModal } from '../components/AssignStockOpToLineModal';
import { GranelBadge } from '../components/GranelBadge';
import { ProductionLine, ProductionOrder, ProductionEvent, PauseReason, WorkSession, LineDailyGoal, LineHeadcount, LineChangeover, UserProfile } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  ResponsiveContainer,
  ReferenceLine,
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
import { calculateProductionRatePerHour, getAutoShiftNow } from '../lib/productionTime';

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
  /** Usado pelo Simulador de Treinamento (ver TrainingSimulator.tsx) para
   * mostrar só a aba operacional (Controle da Linha), sem os dashboards
   * diário/mensal — que não fazem sentido sobre dados fictícios. */
  hideDashboardTabs?: boolean;
}

export function LeaderScreen({ embedded = false, hideDashboardTabs = false }: LeaderScreenProps = {}) {
  const { profile, signOut } = useAuthStore();

  // State principal
  const [activeTab, setActiveTab] = useState<LeaderTab>('operation');
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [allOps, setAllOps] = useState<ProductionOrder[]>([]);
  const [recentEvents, setRecentEvents] = useState<ProductionEvent[]>([]);

  // Nomes dos usuários (líderes e coordenadores) para mostrar quem fez cada
  // apontamento na linha do tempo.
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  useEffect(() => {
    let cancelled = false;
    getAllUsers().then(list => { if (!cancelled) setAllUsers(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const responsibleFor = useCallback((leaderId?: string | null): { name: string; isCoordinator: boolean } | null => {
    if (!leaderId) return null;
    const u = allUsers.find(x => x.uid === leaderId);
    if (u) return { name: u.name, isCoordinator: u.role === 'coordinator' };
    if (profile && profile.uid === leaderId) return { name: profile.name, isCoordinator: profile.role === 'coordinator' };
    return null;
  }, [allUsers, profile]);
  const [pauseReasonsList, setPauseReasonsList] = useState<PauseReason[]>(DEFAULT_PAUSE_REASONS);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modais
  const [isPauseOpen, setIsPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseObs, setPauseObs] = useState('');

  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isCancellingOp, setIsCancellingOp] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [reportRejectedQty, setReportRejectedQty] = useState('');

  const [isFinishOpen, setIsFinishOpen] = useState(false);
  const [finishShift, setFinishShift] = useState<'Manhã' | 'Tarde' | null>(null);
  const [finishProducedQty, setFinishProducedQty] = useState('');
  const [finishLostQty, setFinishLostQty] = useState('');
  const [finishProductionType, setFinishProductionType] = useState<'total' | 'parcial'>('total');
  const [finishSendToSleeve, setFinishSendToSleeve] = useState(false);
  const [isCancelFinishConfirmOpen, setIsCancelFinishConfirmOpen] = useState(false);
  const [isLineSelectOpen, setIsLineSelectOpen] = useState(false);
  const [isAssignStockOpen, setIsAssignStockOpen] = useState(false);
  // Expediente (Iniciar / Encerrar expediente da linha)
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [lineDailyGoals, setLineDailyGoals] = useState<LineDailyGoal[]>([]);
  const [isEndShiftOpen, setIsEndShiftOpen] = useState(false);
  const [isShiftBusy, setIsShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  // Equipe da linha (colaboradores presentes e faltas)
  const [headcounts, setHeadcounts] = useState<LineHeadcount[]>([]);
  const [teamDialogMode, setTeamDialogMode] = useState<'start' | 'edit' | null>(null);
  const [teamPresent, setTeamPresent] = useState('');
  const [teamAbsent, setTeamAbsent] = useState('0');
  const [teamError, setTeamError] = useState<string | null>(null);
  // Troca de produto (botão "Iniciar troca")
  const [changeovers, setChangeovers] = useState<LineChangeover[]>([]);
  const [isChangeoverBusy, setIsChangeoverBusy] = useState(false);
  const [changeoverError, setChangeoverError] = useState<string | null>(null);
  const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);

  // Relógio em tempo real
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Em modo treinamento (hideDashboardTabs) só existe a aba operacional —
  // garante que nunca fique "preso" numa aba de dashboard escondida.
  useEffect(() => {
    if (hideDashboardTabs && activeTab !== 'operation') {
      setActiveTab('operation');
    }
  }, [hideDashboardTabs, activeTab]);

  // Ref para manter o selectedLineId sincronizado sem invalidar o useCallback do fetchData
  const selectedLineIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLineIdRef.current = selectedLineId;
  }, [selectedLineId]);

  // Ref estável para fetchData — resolve stale closure no Realtime/setInterval
  const fetchDataRef = useRef<(showRefreshing?: boolean) => Promise<void>>();

  // Um evento Realtime pode chegar enquanto o fetch anterior ainda está no ar
  // (ex.: finishOP grava em várias tabelas, cada uma dispara seu próprio
  // postgres_changes). Sem controle, essas chamadas correm em paralelo e a
  // que resolver por último "ganha" — se por azar de rede for a mais antiga,
  // ela sobrescreve a tela com dados já desatualizados. Este contador marca
  // qual é a chamada mais recente; uma resposta só é aplicada se ainda for a
  // mais nova quando chegar, então a tela sempre converge pro estado real
  // mais atual, nunca fica "presa" numa versão anterior.
  const fetchRequestIdRef = useRef(0);

  // Busca e sincronização de dados
  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!profile) return;
    const requestId = ++fetchRequestIdRef.current;
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const [loadedLines, loadedOps, loadedEvents, loadedReasons, loadedSessions, loadedLineGoals, loadedHeadcounts, loadedChangeovers] = await Promise.all([
        getLines(),
        getAllOPs(),
        getRecentEvents(),
        getPauseReasons(),
        getWorkSessions(3),
        getLineDailyGoals().catch(() => [] as LineDailyGoal[]),
        getLineHeadcounts(3),
        getChangeovers(3),
      ]);

      // Uma chamada mais nova já assumiu enquanto esperávamos — descarta esta
      // resposta desatualizada em vez de sobrescrever dados mais recentes.
      if (requestId !== fetchRequestIdRef.current) return;

      // Tela do Envase: só linhas de Envase/Sleeve. Os reatores (reator-1/2/3)
      // entraram na tabela de linhas por causa da Manipulação e apareciam aqui
      // pro líder de Envase escolher — eles são operados só na tela da Manipulação.
      const envaseLinesOnly = loadedLines.filter(l => !/reator/i.test(l.id) && !/reator/i.test(l.name));
      setLines(envaseLinesOnly);
      setAllOps(loadedOps);
      setRecentEvents(loadedEvents);
      setWorkSessions(loadedSessions);
      setLineDailyGoals(loadedLineGoals || []);
      setHeadcounts(loadedHeadcounts || []);
      setChangeovers(loadedChangeovers || []);
      if (loadedReasons && loadedReasons.length > 0) {
        // "Intervalo" precisa sempre existir: é a pausa de almoço/café que
        // não conta como ociosidade (até 1h por pausa).
        const hasBreak = loadedReasons.some(r => /^\s*intervalo/i.test(r.name || ''));
        setPauseReasonsList(hasBreak ? loadedReasons : [{ id: 'intervalo', name: 'Intervalo' }, ...loadedReasons]);
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
        const chosenLineId = (restoredLineId && envaseLinesOnly.some(l => l.id === restoredLineId))
          ? restoredLineId
          : (envaseLinesOnly[0]?.id || 'line-1');
        setSelectedLineId(chosenLineId);

        // IMPORTANTE: no banco, a permissão do líder para atualizar uma OP
        // (iniciar, pausar, apontar, finalizar) é concedida pela política de
        // RLS "Coordinators or assigned leaders can update OPs", que só
        // libera a escrita quando `line_id = get_leader_assigned_line(auth.uid())`
        // — e essa função lê a linha atual do líder na tabela `rotations`.
        // Antes, essa tabela só era atualizada quando o líder trocava de
        // linha manualmente (handleSwitchLine); quando a linha era apenas
        // restaurada do localStorage ou escolhida por padrão (like aqui),
        // o Supabase nunca ficava sabendo em qual linha o líder estava —
        // então toda tentativa de iniciar/pausar/finalizar uma OP era
        // aceita apenas localmente (otimista) e depois silenciosamente
        // rejeitada pelo banco, revertendo assim que a tela recarregasse.
        // Por isso replicamos aqui a mesma gravação feita em handleSwitchLine.
        // (saveLeaderRotation já ignora sozinha o modo de treinamento.)
        saveLeaderRotation(profile.uid, chosenLineId, profile.email, profile.name).catch((err) => {
          console.warn('Não foi possível sincronizar a linha atual do líder com o Supabase:', err);
        });
      }
    } catch (error) {
      console.error('Erro ao carregar dados do líder:', error);
    } finally {
      // Idem: só desliga o indicador de carregamento se ainda formos a
      // chamada mais recente — senão apagaríamos o "carregando" de uma
      // chamada mais nova que ainda está em andamento.
      if (requestId === fetchRequestIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
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

    // Nota: "production_orders" e "production_events" são VIEWS sobre "ops" e
    // "events" — o Supabase Realtime só emite postgres_changes para tabelas
    // físicas (com REPLICA IDENTITY), então assinar o nome da view nunca
    // disparava nada. Mantemos só as tabelas reais.
    const channel = supabase
      .channel('leader-realtime-' + profile.uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, stable)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, stable)
      .subscribe();

    // Fallback: polling a cada 15s mesmo se o Realtime cair (o Realtime agora
    // cobre de fato as mudanças, então isso é só uma rede de segurança)
    const interval = setInterval(() => fetchDataRef.current?.(true), 15000);

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
  // ---------------- EXPEDIENTE DA LINHA ----------------
  // O expediente diz ao dashboard quando a linha estava "valendo": parada
  // dentro do expediente conta como ociosidade; fora dele, não. A OP pausada
  // no fim do dia deixa de virar ociosidade a noite inteira.
  const openShift = useMemo(
    () => (currentLine ? getOpenWorkSession(workSessions, currentLine.id) : null),
    [workSessions, currentLine]
  );

  // Expediente automático: nos dias de jornada, linha com OP no dia começa o
  // expediente sozinha às 7h e termina no fim da jornada se ninguém encerrar.
  const currentMinuteKey = Math.floor(currentTime.getTime() / 60000);
  const autoShift = useMemo(
    () => (currentLine && !openShift
      ? getAutoShiftNow(currentLine.id, allOps, workSessions, currentMinuteKey * 60000)
      : { active: false, startMs: null as number | null, endMs: null as number | null }),
    [currentLine, openShift, allOps, workSessions, currentMinuteKey]
  );
  const shiftActive = !!openShift || autoShift.active;
  const shiftStartedAtMs: number | null = openShift ? new Date(openShift.startedAt).getTime() : autoShift.startMs;

  // "Iniciar Expediente" abre o formulário da equipe (colaboradores e faltas);
  // o expediente só abre quando o líder confirma.
  const handleStartShift = () => {
    if (!currentLine || !profile) return;
    setShiftError(null);
    setTeamError(null);
    setTeamPresent('');
    setTeamAbsent('0');
    setTeamDialogMode('start');
  };

  const openTeamEditor = () => {
    setTeamError(null);
    setTeamPresent(todayTeam ? String(todayTeam.present) : '');
    setTeamAbsent(todayTeam ? String(todayTeam.absent) : '0');
    setTeamDialogMode('edit');
  };

  const handleConfirmTeam = async () => {
    if (!currentLine || !profile || !teamDialogMode) return;
    const present = parseInt(teamPresent, 10);
    const absent = teamAbsent.trim() === '' ? 0 : parseInt(teamAbsent, 10);
    if (isNaN(present) || present < 1) {
      setTeamError('Informe quantos colaboradores estão trabalhando na linha (mínimo 1).');
      return;
    }
    if (isNaN(absent) || absent < 0) {
      setTeamError('Informe as faltas (0 se ninguém faltou).');
      return;
    }
    setIsShiftBusy(true);
    setTeamError(null);
    if (teamDialogMode === 'start' && !openShift) {
      const res = await startWorkSession([currentLine.id], profile.uid);
      if (res.error) {
        setIsShiftBusy(false);
        setTeamError(`Não foi possível iniciar o expediente: ${res.error}`);
        return;
      }
    }
    const resTeam = await recordLineHeadcount(currentLine.id, present, absent, profile.uid);
    setIsShiftBusy(false);
    if (resTeam.error) {
      setTeamError(`Não foi possível gravar a equipe: ${resTeam.error}`);
      await fetchData(true);
      return;
    }
    setTeamDialogMode(null);
    await fetchData(true);
  };

  // Iniciar/retomar uma OP com o expediente fechado abre o expediente
  // sozinho — assim esquecer de apertar "Iniciar expediente" não perde a manhã.
  const ensureShiftOpen = async () => {
    if (!currentLine || !profile || openShift) return;
    const res = await startWorkSession([currentLine.id], profile.uid);
    if (res.error) console.warn('[LeaderScreen] Expediente não aberto automaticamente:', res.error);
  };

  const handleEndShift = async () => {
    if (!currentLine || !profile) return;
    setIsShiftBusy(true);
    setShiftError(null);
    // OP ainda rodando: pausa com o motivo "Fim de Expediente" antes de encerrar
    if (activeOp && activeOp.status === 'in_progress') {
      await pauseOP(activeOp.id, currentLine.id, profile.uid, 'Fim de Expediente', 'Pausa automática ao encerrar o expediente');
    }
    if (openChangeover) await handleEndChangeover(null);
    const res = await endWorkSession([currentLine.id], profile.uid, {
      autoStartIso: !openShift && autoShift.active && autoShift.startMs ? new Date(autoShift.startMs).toISOString() : null,
    });
    setIsShiftBusy(false);
    if (res.error) {
      setShiftError(`Não foi possível encerrar o expediente: ${res.error}`);
      return;
    }
    setIsEndShiftOpen(false);
    await fetchData(true);
  };

  // ---------------- TROCA DE PRODUTO ----------------
  const openChangeover = useMemo(
    () => (currentLine ? getOpenChangeover(changeovers, currentLine.id) : null),
    [changeovers, currentLine]
  );

  const handleStartChangeover = async (setupType: 'same' | 'different') => {
    if (!currentLine || !profile) return;
    setIsChangeoverBusy(true);
    setChangeoverError(null);
    // OP que acabou de ser finalizada nesta linha (pra registro)
    const lastFinished = recentEvents
      .filter(e => e.type === 'FINISHED' && (e.lineId === currentLine.id || e.lineName === currentLine.name))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const res = await startChangeover(currentLine.id, profile.uid, lastFinished?.opId || null, setupType);
    setIsChangeoverBusy(false);
    if (res.error) setChangeoverError(`Não foi possível iniciar o setup: ${res.error}`);
    else setIsSetupDialogOpen(false);
    await fetchData(true);
  };

  const handleEndChangeover = async (nextOpId?: string | null) => {
    if (!currentLine || !profile) return;
    const res = await endChangeover(currentLine.id, profile.uid, nextOpId || null);
    if (res.error) console.warn('[LeaderScreen] Não foi possível encerrar o setup:', res.error);
  };

  const handleStart = async () => {
    if (!currentLine || !activeOp || !profile) return;
    await ensureShiftOpen();
    // Iniciar a próxima OP encerra a troca de produto aberta
    if (openChangeover) await handleEndChangeover(activeOp.id);
    await startOP(activeOp.id, currentLine.id, profile.uid);
    await fetchData(true);
  };

  const handlePause = async () => {
    if (!currentLine || !activeOp || !profile || !pauseReason) return;
    // A quantidade não é mais pedida na pausa — o apontamento é feito só pelo botão próprio
    await pauseOP(activeOp.id, currentLine.id, profile.uid, pauseReason, pauseObs);
    setIsPauseOpen(false);
    setPauseReason('');
    setPauseObs('');
    await fetchData(true);
  };

  const handleResume = async () => {
    if (!currentLine || !activeOp || !profile) return;
    await ensureShiftOpen();
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
    const res = await reportQuantity(activeOp.id, currentLine.id, profile.uid, finalQty, parsedRejected);
    if (res && res.ok === false) {
      // Não foi gravado — mantém o formulário aberto com o valor (o aviso aparece no topo)
      await fetchData(true);
      return;
    }
    setQuantity('');
    setReportRejectedQty('');
    setIsReportOpen(false);
    await fetchData(true);
  };

  const handleFinish = async () => {
    if (!currentLine || !activeOp || !profile) return;
    const parsedQty = finishProducedQty.trim() !== '' ? parseInt(finishProducedQty, 10) : undefined;
    const parsedLostQty = finishLostQty.trim() !== '' ? parseInt(finishLostQty, 10) : undefined;

    const res = await finishOP(
      activeOp.id,
      currentLine.id,
      profile.uid,
      finishShift || undefined,
      parsedQty,
      finishSendToSleeve,
      parsedLostQty,
      finishProductionType === 'parcial'
    );
    if (res && res.ok === false) {
      await fetchData(true);
      return;
    }
    setIsFinishOpen(false);
    setFinishShift(null);
    setFinishProducedQty('');
    setFinishLostQty('');
    setFinishProductionType('total');
    setFinishSendToSleeve(false);
    await fetchData(true);
  };

  const handleCancelOp = async () => {
    if (!currentLine || !activeOp) return;
    setIsCancellingOp(true);
    setCancelError(null);
    try {
      const res = await cancelOP(activeOp.id, currentLine.id);
      if (res.success) {
        setIsCancelOpen(false);
        await fetchData(true);
      } else {
        setCancelError(res.message || 'Não foi possível cancelar esta OP.');
      }
    } finally {
      setIsCancellingOp(false);
    }
  };

  // -------------------------------------------------------------
  // CÁLCULOS DO DASHBOARD DIÁRIO (HOJE)
  // -------------------------------------------------------------
  // Dia de hoje acompanhando o relógio da tela (vira sozinho à meia-noite)
  const todayDateStr = useMemo(
    () => getLocalDateStr(currentTime),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate()]
  );

  // SETUP (troca de produto): só depois de finalizar uma OP — a linha está
  // parada, o expediente está valendo e o último evento da linha hoje foi um
  // FINISHED (ninguém iniciou outra OP depois).
  const setupAvailable = useMemo(() => {
    const lineIdle = !activeOp || activeOp.status === 'pending';
    if (!lineIdle || !shiftActive) return false;
    const todays = lineEvents
      .filter(e => e.createdAt && toLocalDateStr(e.createdAt) === todayDateStr && ['STARTED', 'RESUMED', 'FINISHED', 'CANCELLED'].includes(e.type))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return todays.length > 0 && todays[0].type === 'FINISHED';
  }, [activeOp, shiftActive, lineEvents, todayDateStr]);

  // Produção REAL desta linha por dia (a partir dos apontamentos, pausas e
  // conclusões gravados). Nada é estimado: dia sem registro = 0.
  const productionByDay = useMemo(() => {
    if (!currentLine) return {} as Record<string, number>;
    return computeProductionByLineAndDay(recentEvents, allOps)[currentLine.id] || {};
  }, [recentEvents, allOps, currentLine]);

  // Meta diária da linha cadastrada em "Metas de Produção" (line_daily_goals).
  // Sem meta cadastrada = sem meta (não inventamos um número).
  const lineDailyGoal = useMemo(() => {
    if (!currentLine) return null;
    const found = lineDailyGoals.find(g => g.lineId === currentLine.id);
    return found && found.goalQuantity > 0 ? found.goalQuantity : null;
  }, [lineDailyGoals, currentLine]);

  // Equipe informada hoje nesta linha (último registro do dia)
  const todayTeam = useMemo(
    () => (currentLine ? getHeadcountForLineDay(headcounts, currentLine.id, todayDateStr) : null),
    [headcounts, currentLine, todayDateStr]
  );

  const dailyMetrics = useMemo(() => {
    // Eventos de hoje na linha (dia LOCAL — o createdAt vem em UTC)
    const todayEvents = lineEvents.filter(e => e.createdAt && toLocalDateStr(e.createdAt) === todayDateStr);

    const producedToday = productionByDay[todayDateStr] || 0;

    // OPs do dia nesta linha: programadas pra hoje, em andamento/pausadas ou fechadas hoje
    const isClosedToday = (o: ProductionOrder) => o.status === 'completed' && !!o.completedAt && toLocalDateStr(o.completedAt) === todayDateStr;
    const opsToday = lineOps.filter(o =>
      o.scheduledDate === todayDateStr || o.status === 'in_progress' || o.status === 'paused' || isClosedToday(o)
    );
    const plannedToday = opsToday.reduce((acc, curr) => acc + (curr.plannedQuantity || 0), 0);
    const completedTodayCount = lineOps.filter(isClosedToday).length;

    // Meta do dia: a meta diária cadastrada da linha; sem ela, o planejado das OPs do dia; sem nenhum dos dois, 0 (sem meta)
    const dailyTarget = lineDailyGoal ?? plannedToday;
    const progressPercent = dailyTarget > 0 ? Math.min(Math.round((producedToday / dailyTarget) * 100), 100) : 0;

    const pauseEventsToday = todayEvents.filter(e => e.type === 'PAUSED');

    return {
      producedToday,
      dailyTarget,
      targetSource: lineDailyGoal !== null ? 'meta' as const : (plannedToday > 0 ? 'planejado' as const : 'nenhuma' as const),
      progressPercent,
      completedTodayCount,
      totalOpsToday: opsToday.length,
      pauseCountToday: pauseEventsToday.length,
      todayEvents,
    };
  }, [lineEvents, lineOps, todayDateStr, productionByDay, lineDailyGoal]);

  // -------------------------------------------------------------
  // CÁLCULOS DO DASHBOARD MENSAL
  // -------------------------------------------------------------
  const currentMonthStr = todayDateStr.slice(0, 7);

  const currentMonthName = useMemo(() => {
    const [y, m] = currentMonthStr.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  }, [currentMonthStr]);

  const monthlyMetrics = useMemo(() => {
    // OPs da linha que pertencem a este mês (fechadas no mês; abertas pelo dia programado)
    const monthOps = lineOps.filter(o => getOpReferenceDateStr(o).startsWith(currentMonthStr));
    const completedMonthOps = monthOps.filter(o => o.status === 'completed');

    // Produzido no mês = soma real dos dias do mês (inclui parciais e OPs ainda abertas)
    const totalProducedMonth = Object.entries(productionByDay)
      .filter(([day]) => day.startsWith(currentMonthStr))
      .reduce((acc, [, qty]) => acc + Number(qty || 0), 0);
    const totalPlannedMonth = monthOps.reduce((acc, curr) => acc + (curr.plannedQuantity || 0), 0);
    const completedOpsMonth = completedMonthOps.length;

    // Aderência ao plano: produzido ÷ planejado das OPs CONCLUÍDAS no mês
    const plannedCompleted = completedMonthOps.reduce((acc, o) => acc + (o.plannedQuantity || 0), 0);
    const producedCompleted = completedMonthOps.reduce((acc, o) => acc + (o.producedQuantity || 0), 0);
    const efficiencyMonth = plannedCompleted > 0 ? Math.min(Math.round((producedCompleted / plannedCompleted) * 100), 100) : 0;

    // Qualidade real: (produzido − perdido) ÷ produzido das OPs concluídas no mês
    const rejectedCompleted = completedMonthOps.reduce((acc, o) => acc + (o.rejectedQuantity || 0), 0);
    const qualityMonth = producedCompleted > 0
      ? Math.round(((producedCompleted - rejectedCompleted) / producedCompleted) * 1000) / 10
      : null;

    // Gráfico de produção diária do mês — só valores registrados
    const [y, m] = currentMonthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lastDay = todayDateStr.startsWith(currentMonthStr) ? Number(todayDateStr.slice(8, 10)) : daysInMonth;
    const chartData: Array<{ dia: string; produzido: number; meta: number | null }> = [];
    for (let day = 1; day <= Math.min(lastDay, daysInMonth); day++) {
      const dayStr = `${currentMonthStr}-${String(day).padStart(2, '0')}`;
      chartData.push({
        dia: `Dia ${day}`,
        produzido: productionByDay[dayStr] || 0,
        meta: lineDailyGoal,
      });
    }

    // Distribuição por Produto (OPs concluídas no mês)
    const productStatsMap = new Map<string, { product: string; produced: number; planned: number }>();
    completedMonthOps.forEach(op => {
      const existing = productStatsMap.get(op.product) || { product: op.product, produced: 0, planned: 0 };
      existing.produced += op.producedQuantity || 0;
      existing.planned += op.plannedQuantity || 0;
      productStatsMap.set(op.product, existing);
    });
    const topProducts = Array.from(productStatsMap.values()).sort((a, b) => b.produced - a.produced).slice(0, 5);

    // Principais Motivos de Parada do Mês
    const reasonCounts: Record<string, number> = {};
    lineEvents
      .filter(e => e.type === 'PAUSED' && e.reason && toLocalDateStr(e.createdAt).startsWith(currentMonthStr))
      .forEach(e => {
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
      totalOpsMonth: monthOps.length,
      efficiencyMonth,
      qualityMonth,
      chartData,
      topProducts,
      topReasons,
    };
  }, [lineOps, lineEvents, currentMonthStr, todayDateStr, productionByDay, lineDailyGoal]);

  // Tempo trabalhado da OP ativa em milissegundos (baseado no histórico cronológico de eventos reais)
  //
  // IMPORTANTE: estes dois useMemo precisam ficar ANTES do "if (loading) return"
  // logo abaixo — React exige que TODOS os Hooks de um componente sejam
  // chamados na MESMA ordem em TODO render (Rules of Hooks). Como o `loading`
  // começa `true` e vira `false` assim que os dados carregam, ter hooks
  // DEPOIS desse early return fazia o componente chamar menos hooks no
  // primeiro render (loading=true) e mais hooks no render seguinte
  // (loading=false) — exatamente o erro "Rendered more hooks than during
  // the previous render" que o React acusa nesse caso.
  const activeOpWorkingMs = useMemo(() => {
    if (!activeOp) return 0;
    const opEvents = recentEvents.filter(e => e.opId === activeOp.id);
    // Sem eventos da OP não há como saber o tempo trabalhado — mostra 0 em vez de estimar
    if (!opEvents.length) return 0;

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
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm font-black text-white tracking-tight uppercase truncate">
                    Envase
                  </h1>
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
            
            {/* Início / fim de expediente da linha */}
              {shiftActive && shiftStartedAtMs ? (
                <button
                  onClick={() => { setShiftError(null); setIsEndShiftOpen(true); }}
                  disabled={isShiftBusy}
                  title={openShift
                    ? `Expediente aberto desde ${new Date(shiftStartedAtMs).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                    : 'Expediente iniciado automaticamente no horário da jornada'}
                  className="px-3 py-1.5 rounded-xl bg-rose-950/50 hover:bg-rose-900/50 border border-rose-800/50 text-xs font-bold text-rose-200 flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                >
                  <Sunset className="w-4 h-4 text-rose-400" />
                  <span>Encerrar Expediente</span>
                  <span className="font-mono text-[10px] text-rose-300/80">
                    (desde {new Date(shiftStartedAtMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{!openShift ? ' · automático' : ''})
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleStartShift}
                  disabled={isShiftBusy}
                  title="O expediente começa sozinho às 7h nas linhas com OP no dia. Use este botão para começar antes (hora extra) ou para reabrir depois de encerrar."
                  className="px-3 py-1.5 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/50 border border-emerald-800/50 text-xs font-bold text-emerald-200 flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                >
                  <Sunrise className="w-4 h-4 text-emerald-400" />
                  <span>{isShiftBusy ? 'Iniciando...' : 'Iniciar Expediente'}</span>
                </button>
              )}

            {/* SETUP (troca de produto) */}
            {openChangeover ? (() => {
              const elapsed = Math.max(0, currentTime.getTime() - new Date(openChangeover.startedAt).getTime());
              const hh = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
              const mm = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
              const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
              return (
                <button
                  onClick={async () => { setIsChangeoverBusy(true); await handleEndChangeover(null); setIsChangeoverBusy(false); await fetchData(true); }}
                  disabled={isChangeoverBusy}
                  title={`Setup${openChangeover.setupType === 'same' ? ' (mesmo tipo de produto)' : openChangeover.setupType === 'different' ? ' (produto diferente)' : ''} desde ${new Date(openChangeover.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Termina sozinho ao iniciar a próxima OP.`}
                  className="px-3 py-1.5 rounded-xl bg-orange-950/60 hover:bg-orange-900/60 border border-orange-700/60 text-xs font-bold text-orange-200 flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                >
                  <RefreshCcw className="w-4 h-4 text-orange-400 animate-spin [animation-duration:3s]" />
                  <span>Setup</span>
                  <span className="font-mono text-[11px] text-white tabular-nums">{hh}:{mm}:{ss}</span>
                  <span className="text-[10px] text-orange-300/80">· Encerrar</span>
                </button>
              );
            })() : (
              <button
                onClick={() => { setChangeoverError(null); setIsSetupDialogOpen(true); }}
                disabled={!setupAvailable || isChangeoverBusy}
                title={setupAvailable ? 'Marcar o tempo de preparo da linha para a próxima OP' : 'Disponível depois de finalizar uma OP, com a linha parada'}
                className="px-3 py-1.5 rounded-xl bg-orange-950/40 hover:bg-orange-900/50 border border-orange-800/50 text-xs font-bold text-orange-200 flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCcw className="w-4 h-4 text-orange-400" />
                <span>Setup</span>
              </button>
            )}

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

          {!hideDashboardTabs && (
            <>
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
            </>
          )}

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
            
            {openShift && new Date(openShift.startedAt).toDateString() !== new Date().toDateString() && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-2xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-200">
                  O expediente desta linha foi aberto em {new Date(openShift.startedAt).toLocaleDateString('pt-BR')} e não foi encerrado.
                  Encerre e inicie um novo expediente para hoje.
                </p>
              </div>
            )}
            {/* Equipe da linha hoje */}
            {shiftActive && (
              todayTeam ? (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#121217] border border-[#22222b] rounded-2xl px-4 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-[#d4d4d8]">
                    <Users className="w-4 h-4 text-blue-400" />
                    <span>
                      Equipe: <strong className="text-white">{todayTeam.present} colaborador(es)</strong>
                      {' · '}
                      <strong className={todayTeam.absent > 0 ? 'text-amber-300' : 'text-[#a1a1aa]'}>{todayTeam.absent} falta(s)</strong>
                    </span>
                    <span className="text-[10px] text-[#71717a] font-mono">
                      desde {new Date(todayTeam.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button
                    onClick={openTeamEditor}
                    className="px-3 py-1.5 rounded-lg bg-[#171720] hover:bg-[#20202c] border border-[#2b2b38] text-[11px] font-bold text-[#f4f4f5]"
                  >
                    Alterar equipe
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-950/40 border border-amber-800/50 rounded-2xl px-4 py-3">
                  <p className="text-xs text-amber-200 flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400 shrink-0" />
                    Informe quantos colaboradores estão na linha hoje e quantos faltaram.
                  </p>
                  <button
                    onClick={openTeamEditor}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 text-[11px] font-black"
                  >
                    Informar equipe
                  </button>
                </div>
              )
            )}

            {changeoverError && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-2xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-200">{changeoverError}</p>
              </div>
            )}

            {shiftError && !isEndShiftOpen && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-2xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-200">{shiftError}</p>
              </div>
            )}

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
                        <GranelBadge granel={activeOp.granel} ops={allOps} className="ml-1" />
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

                {/* Cancelar OP iniciada por engano — só aparece enquanto nada
                    foi produzido/apontado nela ainda, pra nunca descartar
                    produção real por engano. */}
                {(activeOp.status === 'in_progress' || activeOp.status === 'paused') && activeOp.producedQuantity === 0 && (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCancelOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-rose-400/80 hover:text-rose-300 hover:bg-rose-950/20 transition-all"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancelar (iniciada por engano)
                    </button>
                  </div>
                )}

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
                        {op.granel && (
                          <p className="text-[11px] text-[#71717a] font-mono flex items-center gap-1.5 flex-wrap">
                            Granel: {op.granel}
                            <GranelBadge granel={op.granel} ops={allOps} />
                          </p>
                        )}
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
                    {dailyMetrics.targetSource === 'nenhuma'
                      ? 'sem meta cadastrada'
                      : `/ ${dailyMetrics.dailyTarget.toLocaleString('pt-BR')} un${dailyMetrics.targetSource === 'planejado' ? ' (planejado do dia)' : ''}`}
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
                  {dailyMetrics.pauseCountToday === 0 ? 'Sem interrupções hoje' : `${dailyMetrics.pauseCountToday} pausa(s) registrada(s) hoje`}
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
                            {(() => {
                              // Número da OP (o evento às vezes só traz o id interno)
                              const relatedOp = allOps.find(o => o.id === event.opId);
                              const opLabel = relatedOp?.number || event.opNumber;
                              return opLabel ? (
                                <span className="text-[10px] font-mono text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded shrink-0">
                                  {docTypeLabel} {opLabel}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          {(() => {
                            const who = responsibleFor(event.leaderId);
                            return (
                              <p className="text-[11px] mt-0.5 flex items-center gap-1">
                                <span className="text-[#71717a]">por</span>
                                {who ? (
                                  <>
                                    <strong className="text-[#d4d4d8]">{who.name}</strong>
                                    {who.isCoordinator && (
                                      <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-indigo-950/70 text-indigo-300 border border-indigo-800/50">Coordenação</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[#52525b]">responsável não registrado</span>
                                )}
                              </p>
                            );
                          })()}
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
                  <span>Planejado no mês: {monthlyMetrics.totalPlannedMonth.toLocaleString('pt-BR')} un</span>
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
                    {monthlyMetrics.qualityMonth !== null ? `${monthlyMetrics.qualityMonth}%` : '—'}
                  </span>
                  <span className="text-xs text-[#71717a] font-mono">qualidade</span>
                </div>
                <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>
                    {monthlyMetrics.qualityMonth !== null
                      ? '(produzido − perdido) ÷ produzido das OPs concluídas'
                      : 'Sem OPs concluídas no mês'}
                  </span>
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
                    Volume registrado por dia (apontamentos, pausas e conclusões){lineDailyGoal !== null ? ' vs meta diária da linha' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <span className="w-3 h-3 rounded-sm bg-blue-500" />
                    Volume Produzido
                  </span>
                  {lineDailyGoal !== null && (
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="w-3 h-1 bg-slate-500" />
                      Meta diária ({lineDailyGoal.toLocaleString('pt-BR')} un)
                    </span>
                  )}
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
                    {lineDailyGoal !== null && (
                      <ReferenceLine y={lineDailyGoal} stroke="#64748b" strokeDasharray="5 3" />
                    )}
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
              {/^\s*intervalo/i.test(pauseReason || '') && (
                <p className="text-[11px] text-emerald-400 mt-1.5">
                  Intervalo de até 1h não conta como ociosidade. Se passar de 1h, o excedente conta.
                </p>
              )}
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

      {/* MODAL: CANCELAR OP INICIADA POR ENGANO */}
      {/* MODAL: EQUIPE DA LINHA (ao iniciar o expediente e para corrigir durante o dia) */}
      <Dialog open={teamDialogMode !== null} onOpenChange={(open) => { if (!open) setTeamDialogMode(null); }}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-emerald-300 flex items-center gap-2">
              {teamDialogMode === 'start' ? <Sunrise className="w-5 h-5" /> : <Users className="w-5 h-5" />}
              {teamDialogMode === 'start' ? 'Iniciar Expediente' : 'Equipe da Linha'} — {currentLine?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Colaboradores trabalhando na linha
              </Label>
              <Input
                type="number"
                min="1"
                inputMode="numeric"
                value={teamPresent}
                onChange={e => setTeamPresent(e.target.value)}
                placeholder="Ex: 6"
                className="bg-[#181822] border-[#2c2c3c] rounded-xl text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Faltas (integrantes da equipe que não vieram)
              </Label>
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={teamAbsent}
                onChange={e => setTeamAbsent(e.target.value)}
                placeholder="0"
                className="bg-[#181822] border-[#2c2c3c] rounded-xl text-sm font-mono"
              />
            </div>
            <p className="text-[11px] text-[#71717a]">
              {teamDialogMode === 'start'
                ? 'Se alguém entrar ou sair durante o dia, use "Alterar equipe" — o horário de cada mudança fica registrado.'
                : 'A mudança vale a partir de agora; o que foi informado antes continua registrado.'}
            </p>
            {teamError && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-300">{teamError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setTeamDialogMode(null)}
              className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Voltar
            </Button>
            <Button
              onClick={handleConfirmTeam}
              disabled={isShiftBusy}
              className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              {isShiftBusy ? 'Salvando...' : teamDialogMode === 'start' ? 'Iniciar Expediente' : 'Salvar Equipe'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: ENCERRAR EXPEDIENTE */}
      {/* DIÁLOGO DO SETUP: tipo da troca */}
      <Dialog open={isSetupDialogOpen} onOpenChange={(open) => { setIsSetupDialogOpen(open); if (!open) setChangeoverError(null); }}>
        <DialogContent className="bg-[#121217] border-[#22222b] text-white max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-orange-300 flex items-center gap-2">
              <RefreshCcw className="w-5 h-5" />
              Iniciar Setup — {currentLine?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-[#d4d4d8]">
              O setup marca o tempo de preparo da linha para a próxima OP. Ele termina sozinho quando você iniciar a próxima OP.
            </p>
            <p className="text-xs font-bold text-[#a1a1aa] uppercase tracking-wider">Qual é o tipo de troca?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => handleStartChangeover('same')}
                disabled={isChangeoverBusy}
                className="p-4 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/50 text-left disabled:opacity-60"
              >
                <div className="text-sm font-black text-emerald-300">Mesmo tipo de produto</div>
                <div className="text-[11px] text-emerald-200/70 mt-0.5">Troca mais rápida</div>
              </button>
              <button
                onClick={() => handleStartChangeover('different')}
                disabled={isChangeoverBusy}
                className="p-4 rounded-xl bg-orange-950/40 hover:bg-orange-900/50 border border-orange-800/50 text-left disabled:opacity-60"
              >
                <div className="text-sm font-black text-orange-300">Produto diferente</div>
                <div className="text-[11px] text-orange-200/70 mt-0.5">Troca mais demorada</div>
              </button>
            </div>
            {changeoverError && (
              <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">{changeoverError}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEndShiftOpen} onOpenChange={(open) => { setIsEndShiftOpen(open); if (!open) setShiftError(null); }}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-rose-300 flex items-center gap-2">
              <Sunset className="w-5 h-5" />
              Encerrar Expediente — {currentLine?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <p className="text-sm text-[#d4d4d8]">
              O expediente desta linha começou às{' '}
              <strong className="text-white">
                {shiftStartedAtMs ? new Date(shiftStartedAtMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </strong>{!openShift && autoShift.active ? ' (automático)' : ''}. A partir de agora, o tempo parado não conta mais como ociosidade.
            </p>
            {activeOp?.status === 'in_progress' && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-lg px-3 py-2">
                A {docTypeLabel} <strong>{activeOp.number}</strong> ainda está em produção — ela será pausada com o motivo "Fim de Expediente". Faça o apontamento da quantidade antes, se ainda não fez.
              </p>
            )}
            {shiftError && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-300">{shiftError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsEndShiftOpen(false)}
              className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Voltar
            </Button>
            <Button
              onClick={handleEndShift}
              disabled={isShiftBusy}
              className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              {isShiftBusy ? 'Encerrando...' : 'Encerrar Expediente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCancelOpen} onOpenChange={(open) => { setIsCancelOpen(open); if (!open) setCancelError(null); }}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-rose-400 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Cancelar Início da {docTypeLabel}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <p className="text-sm text-[#d4d4d8]">
              Tem certeza que deseja cancelar o início da <strong className="text-white">{docTypeLabel} {activeOp?.number}</strong>?
            </p>
            <p className="text-xs text-[#a1a1aa]">
              Ela volta para "Aguardando" na fila desta linha, como se nunca tivesse sido iniciada — o horário de início registrado por engano é apagado e não entra nos indicadores de Disponibilidade/Ociosidade.
            </p>
            {cancelError && (
              <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-300">{cancelError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsCancelOpen(false)}
              className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold"
            >
              Voltar
            </Button>
            <Button
              onClick={handleCancelOp}
              disabled={isCancellingOp}
              className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-wider"
            >
              {isCancellingOp ? 'Cancelando...' : 'Sim, Cancelar Início'}
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
              {/* Saldo restante — só faz sentido mostrar na conclusão Parcial,
                  já que é o que sobra pra uma próxima produção desta OP. */}
              {finishProductionType === 'parcial' && activeOp && (() => {
                const informed = finishProducedQty.trim() !== '' ? parseInt(finishProducedQty, 10) : 0;
                const remainder = Math.max(0, activeOp.plannedQuantity - (isNaN(informed) ? 0 : informed));
                return (
                  <p className="text-[10px] text-amber-300 font-mono font-semibold">
                    Saldo que volta para o estoque: {remainder.toLocaleString('pt-BR')} {displayUnit}
                  </p>
                );
              })()}
            </div>

            {/* Quantidade Perdida (opcional) — enquanto o laboratório não entra no fluxo,
                é o próprio líder que registra a perda ao concluir a OP */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-red-400 font-bold tracking-wider">
                Quantidade Perdida ({displayUnit}) — Opcional
              </Label>
              <Input
                type="number"
                min="0"
                value={finishLostQty}
                onChange={e => setFinishLostQty(e.target.value)}
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
                  Se marcado, a quantidade apontada de{' '}
                  <strong className="text-purple-300 font-mono">
                    {finishProducedQty ? parseInt(finishProducedQty, 10).toLocaleString('pt-BR') : activeOp?.producedQuantity.toLocaleString('pt-BR') || '0'} {displayUnit}
                  </strong>{' '}
                  retorna ao estoque livre para acabamento no <strong>Sleev</strong>.
                </p>
              </div>
            </div>

            {/* Descrição do resultado — muda conforme Total/Parcial × Sleev,
                pra deixar claro o que vai acontecer com a OP ao confirmar. */}
            <p className="text-xs text-[#a1a1aa] leading-relaxed">
              {finishProductionType === 'total'
                ? finishSendToSleeve
                  ? 'Ao concluir, o envase nesta linha é finalizado com a quantidade apontada e a linha fica livre. A OP inteira volta ao estoque já pronta para acabamento no Sleev.'
                  : 'Esta é a quantidade final desta OP. Ao concluir, ela é encerrada definitivamente e a linha fica livre — não será mais possível envasar essa OP novamente.'
                : finishSendToSleeve
                ? 'Ao concluir, a quantidade apontada segue para o Sleev normalmente. Já o saldo que sobrar da estimativa volta ao estoque como uma nova OP pendente, pronta para um novo envase (sem passar pelo Sleev).'
                : 'A quantidade apontada é descontada da estimativa e registrada como produzida agora. O saldo que sobrar volta para o estoque como pendência, pronto para ser retomado em um novo envase desta OP.'}
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
                setFinishLostQty('');
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

