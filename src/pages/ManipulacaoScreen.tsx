import { createPortal } from 'react-dom';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import {
  FlaskConical,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  Boxes,
  RefreshCw,
  LogOut,
  AlertCircle,
  Sun,
  Moon,
  Sparkles,
  History,
  BarChart3,
  XCircle,
  Sunrise,
  Sunset,
  ClipboardCheck,
  Droplets,
  TestTube,
  ThumbsUp,
  ThumbsDown,
  Wrench,
  ShieldCheck,
  Timer,
  ListChecks,
  Undo2,
  Snowflake,
} from 'lucide-react';
import {
  getAllOPs,
  createOP,
  startOP,
  pauseOP,
  resumeOP,
  finishOP,
  getLines,
  getWorkSessions,
  startWorkSession,
  endWorkSession,
  getOpenWorkSession,
  autoCloseStaleWorkSessions,
  getRecentEvents,
  cancelOP,
  logPesagemHistory,
  getManipPhase,
  getManipOpEvents,
  recordManipulacaoPhase,
  MANIP_PHASE_REASONS,
  MANIP_PHASE_LABELS,
  isManipPhaseReason,
  ManipPhase,
  ManipConferencia,
  getManipConferencias,
  addManipConferencia,
  deleteManipConferencia,
} from '../services/db';
import { ProductionOrder, ProductionLine, PauseReason, WorkSession, ProductionEvent } from '../types';
import { DetailedDashboard } from '../components/DetailedDashboard';
import { getIndustriaBadgeClass } from '../lib/industria';
import { getAutoShiftNow, REACTOR_MEAL_BREAKS, REACTOR_WORK_SCHEDULE } from '../lib/productionTime';

interface ManipulacaoScreenProps {
  embedded?: boolean;
}

// Os 3 reatores físicos da Manipulação — mesmas linhas ('reator-1'/'reator-2'/
// 'reator-3') criadas pela migração SQL e usadas pelo Cronograma de
// Manipulação do Coordenador. Serve de fallback caso a migração ainda não
// tenha sido rodada (ou getLines() falhe), pra tela nunca ficar sem nenhum
// reator pra mostrar.
const DEFAULT_REACTOR_LINES: ProductionLine[] = [
  { id: 'reator-1', name: 'Reator 11', status: 'idle', currentOpId: null },
  { id: 'reator-2', name: 'Reator 12', status: 'idle', currentOpId: null },
  { id: 'reator-3', name: 'Reator 13', status: 'idle', currentOpId: null },
];

// Motivos de pausa específicos da Manipulação — lista própria, separada da
// tabela `pause_reasons` usada pelo Envase (LeaderScreen), já que os motivos
// de parada de um reator são diferentes dos de uma linha de envase.
// 'YYYY-MM-DD' de hoje no fuso local (toISOString daria o dia em UTC).
function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MANIPULACAO_PAUSE_REASONS: PauseReason[] = [
  { id: 'mp-1', name: 'Aguardando Laboratório' },
  { id: 'mp-2', name: 'Manutenção' },
  { id: 'mp-3', name: 'Esquentando Reator' },
  // Almoço/café: até 1h por pausa não conta como ociosidade
  { id: 'mp-4', name: 'Intervalo' },
];

export function ManipulacaoScreen({ embedded = false }: ManipulacaoScreenProps = {}) {
  const { profile, signOut } = useAuthStore();

  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>(DEFAULT_REACTOR_LINES);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Sub-abas de visualização: Operação em Tempo Real vs Dashboard de Produção (Diária & Semanal)
  const [activeViewTab, setActiveViewTab] = useState<'dashboard' | 'operacao'>('operacao');

  // Modal de Pausa
  const [pausingOp, setPausingOp] = useState<ProductionOrder | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseObs, setPauseObs] = useState('');
  const [isPauseSubmitting, setIsPauseSubmitting] = useState(false);

  // Modal de Finalização / Escolha de Turno
  const [finishingOp, setFinishingOp] = useState<ProductionOrder | null>(null);
  const [cancellingOp, setCancellingOp] = useState<ProductionOrder | null>(null);
  const [isCancellingSubmitting, setIsCancellingSubmitting] = useState(false);
  const [selectedShift, setSelectedShift] = useState<'Manhã' | 'Tarde'>('Manhã');
  const [finalKg, setFinalKg] = useState<string>('');
  const [isFinishingSubmitting, setIsFinishingSubmitting] = useState(false);

  // opId da ação (iniciar/pausar/retomar) em andamento agora — só pra
  // desabilitar o botão clicado e evitar duplo-clique, nunca a tela toda.
  const [actionBusyOpId, setActionBusyOpId] = useState<string | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  // Expediente dos reatores (work_sessions)
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  // Eventos (pra mostrar o horário REAL de início de cada manipulação)
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [isEndShiftOpen, setIsEndShiftOpen] = useState(false);
  const [isShiftBusy, setIsShiftBusy] = useState(false);

  // Linha de Conferência: pesagens conferidas (só OSM conferida pode iniciar)
  const [conferencias, setConferencias] = useState<ManipConferencia[]>([]);
  const [conferenciasError, setConferenciasError] = useState<string | null>(null);
  const [showConferidas, setShowConferidas] = useState(false);

  // Finalizar: 'manip' = fim da manipulação (Kg, vai pra amostragem);
  // 'drenagem' = fim da drenagem (encerra a OP e o reator entra em Setup)
  const [finishMode, setFinishMode] = useState<'manip' | 'drenagem'>('drenagem');

  // Histórico da OP (linha do tempo)
  const [historyOp, setHistoryOp] = useState<ProductionOrder | null>(null);

  // Filtros da lista de OPs finalizadas
  const [donePeriod, setDonePeriod] = useState<'hoje' | '7d' | 'mes' | 'todos'>('7d');
  const [doneReactor, setDoneReactor] = useState<string>('all');
  const [doneIndustria, setDoneIndustria] = useState<string>('all');
  const [doneSearch, setDoneSearch] = useState('');
  const [doneHideZero, setDoneHideZero] = useState(true);
  const [doneLimit, setDoneLimit] = useState(30);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Turno ativo detectado automaticamente pelo horário (<12h = Manhã, >=12h = Tarde)
  const currentHour = currentTime.getHours();
  const detectedShift: 'Manhã' | 'Tarde' = currentHour < 12 ? 'Manhã' : 'Tarde';

  // Relógio em tempo real
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Ref estável para fetchData
  const fetchDataRef = useRef<(showRefreshing?: boolean) => Promise<void>>();

  // Um evento Realtime pode chegar enquanto o fetch anterior ainda está no
  // ar. Sem controle, chamadas concorrentes correm em paralelo e a que
  // resolver por último "ganha" — se for a mais antiga (azar de rede), ela
  // sobrescreve a tela com dados já desatualizados. Este contador garante
  // que só a resposta da chamada mais recente é aplicada.
  const fetchRequestIdRef = useRef(0);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!profile) return;
    const requestId = ++fetchRequestIdRef.current;
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const [allOps, allLines, allSessions, allEvents, confRes] = await Promise.all([getAllOPs(), getLines(), getWorkSessions(3), getRecentEvents(), getManipConferencias()]);

      // Uma chamada mais nova já assumiu — descarta esta resposta desatualizada.
      if (requestId !== fetchRequestIdRef.current) return;

      setOps(allOps);
      setWorkSessions(allSessions);
      // Fim da jornada sem manipulação rodando: encerra o expediente sozinho
      // (OP em amostragem/CQ/ajuste/drenagem ainda ocupa o reator — conta como em produção)
      autoCloseStaleWorkSessions(
        allSessions.filter(ws => ws.lineId.startsWith('reator-')),
        allOps.map(o => (o.setor === 'Manipulação' && o.status === 'paused' && ['resfriando', 'aguardando_amostragem', 'aguardando_cq', 'em_ajuste', 'aguardando_drenagem'].includes(getManipPhase(o, allEvents).phase)) ? { ...o, status: 'in_progress' as const } : o),
        allEvents
      ).then(n => {
        if (n > 0) getWorkSessions(3).then(ws => { if (requestId === fetchRequestIdRef.current) setWorkSessions(ws); });
      }).catch(() => {});
      setEvents(allEvents);
      setConferencias(confRes.list);
      setConferenciasError(confRes.error);
      const reactorLinesFromDb = allLines.filter(l => l.id.startsWith('reator-'));
      if (reactorLinesFromDb.length > 0) setLines(reactorLinesFromDb);
    } catch (err) {
      console.error('Erro ao carregar dados de manipulação:', err);
      showToast('Erro ao carregar dados.', 'error');
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [profile]);

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Carregamento inicial e realtime
  useEffect(() => {
    if (!profile) return;

    fetchDataRef.current?.();

    // "production_orders" é uma VIEW sobre "ops" — o Realtime só emite
    // postgres_changes para a tabela física, então só precisamos de "ops".
    const channel = supabase
      .channel('manipulacao-realtime-' + profile.uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, () => {
        fetchDataRef.current?.(true);
      })
      .subscribe();

    // Fallback: o Realtime agora cobre de fato as mudanças, então isso é só
    // uma rede de segurança caso a conexão realtime caia.
    const interval = setInterval(() => {
      fetchDataRef.current?.(true);
    }, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [profile]);

  // Linhas dos reatores já ordenadas por nome (vem de `lines`, que já cai
  // pro fallback DEFAULT_REACTOR_LINES se a migração ainda não rodou).
  const reactorLines = useMemo(
    () => [...lines].sort((a, b) => a.name.localeCompare(b.name)),
    [lines]
  );

  // Todas as OPs de Manipulação (o "espaço de trabalho" real desta tela —
  // uma por OSM de Pesagem organizada num reator, ver materialização abaixo).
  const manipulacaoOps = useMemo(() => ops.filter(op => op.setor === 'Manipulação'), [ops]);

  // Conjunto de números de OSM ou lotes que já viraram uma OP de Manipulação
  // (em qualquer status) — é isso que tira uma OSM da fila do Cronograma e
  // desta tela: ela só volta a ficar "livre" se essa OP for excluída.
  const manipulatedOsmNumbers = useMemo(() => {
    const set = new Set<string>();
    manipulacaoOps.forEach(op => {
      if (op.number) {
        const num = op.number.trim();
        set.add(num);
        set.add(num.toLowerCase());
      }
      if (op.lote) {
        const lot = op.lote.trim();
        set.add(lot);
        set.add(lot.toLowerCase());
      }
    });
    return set;
  }, [manipulacaoOps]);

  // --------------------------------------------------------------------
  // MATERIALIZAÇÃO: o Cronograma de Manipulação (tela do Coordenador) só
  // organiza OSMs de Pesagem dentro das colunas dos 3 reatores (mexendo no
  // `lineId`/`scheduledDate` da própria OSM) — ele nunca cria a OP de
  // Manipulação em si. É aqui, na tela de operação, que cada OSM organizada
  // num reator e ainda não manipulada vira uma OP de Manipulação real, já
  // com status 'pending' (fila do reator), na ordem que o Coordenador
  // definiu (mesmo `sequence`). A partir daí ela segue o mesmo ciclo do
  // Envase: iniciar → pausar/retomar → finalizar, com o próximo item da
  // fila ficando disponível sozinho assim que o atual é finalizado.
  // --------------------------------------------------------------------
  const materializationCandidates = useMemo(() => {
    const seen = new Set<string>();
    return ops.filter(op => {
      if (op.id && op.id.startsWith('imp-')) return false;
      if (!op.lineId || !reactorLines.some(r => r.id === op.lineId)) return false;
      const isPesagemCompleted = (op.setor === 'Pesagem' || (!op.setor && op.tipoDocumento === 'OSM')) && op.status === 'completed';
      if (!isPesagemCompleted) return false;
      const numTrim = (op.number || '').trim();
      const lotTrim = (op.lote || '').trim();
      if (
        (numTrim && (manipulatedOsmNumbers.has(numTrim) || manipulatedOsmNumbers.has(numTrim.toLowerCase()))) ||
        (lotTrim && (manipulatedOsmNumbers.has(lotTrim) || manipulatedOsmNumbers.has(lotTrim.toLowerCase())))
      ) {
        return false;
      }
      const dedupKey = numTrim || lotTrim || op.id;
      if (seen.has(dedupKey)) return false;
      seen.add(dedupKey);
      return true;
    });
  }, [ops, reactorLines, manipulatedOsmNumbers]);

  // Evita materializar a mesma OSM duas vezes por causa de fetches
  // concorrentes (realtime + polling de 15s) enquanto o createOP ainda não
  // voltou e a lista local ainda não reflete a nova OP de Manipulação.
  const materializingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (materializationCandidates.length === 0) return;
    const toCreate = materializationCandidates.filter(op => {
      const numTrim = (op.number || '').trim();
      return !materializingRef.current.has(op.id) && (!numTrim || !materializingRef.current.has(numTrim));
    });
    if (toCreate.length === 0) return;

    toCreate.forEach(op => {
      materializingRef.current.add(op.id);
      const numTrim = (op.number || '').trim();
      if (numTrim) materializingRef.current.add(numTrim);
    });

    (async () => {
      let anyCreated = false;
      for (const pesagemOp of toCreate) {
        try {
          // A OSM de Pesagem já registra plannedQuantity/producedQuantity em
          // Kg — não é uma contagem de bateladas, então NÃO multiplicar por
          // 1000 aqui (isso já inflou o Kg planejado da Manipulação antes).
          const plannedKg = Number(pesagemOp.producedQuantity) || Number(pesagemOp.plannedQuantity) || 0;
          await createOP({
            tipoDocumento: 'OSM',
            setor: 'Manipulação',
            unidade: 'Kg',
            number: pesagemOp.number,
            product: pesagemOp.product,
            lote: pesagemOp.lote,
            plannedQuantity: plannedKg,
            producedQuantity: 0,
            status: 'pending',
            priority: 'Normal',
            lineId: pesagemOp.lineId as string,
            // Mesma ordem que o Coordenador já definiu ao organizar a fila
            // do reator no Cronograma (arrastar / setas ▲▼).
            sequence: pesagemOp.sequence || 0,
            scheduledDate: pesagemOp.scheduledDate || todayLocalStr(),
            // Propaga a indústria da OSM de origem (Ybera/Carvalho/Macpaul).
            industria: pesagemOp.industria,
          }, { reuseExisting: true });
          anyCreated = true;
        } catch (err) {
          console.error('Erro ao organizar fila de manipulação para a OSM', pesagemOp.number, err);
        }
      }
      if (anyCreated) await fetchDataRef.current?.(true);
    })();
  }, [materializationCandidates]);

  // --------------------------------------------------------------------
  // ESTADO OPERACIONAL POR REATOR — mesmo padrão do Envase (LeaderScreen):
  // OP ativa = em andamento, senão pausada, senão a próxima pendente por
  // sequence; fila = as demais pendentes.
  // --------------------------------------------------------------------
  const todayStrForQueue = currentTime.toDateString();
  // Ordem da fila por data (mesma regra do Envase): atrasadas → hoje →
  // sem data → futuras; empate pela sequência do Cronograma.
  const queueRank = (o: ProductionOrder) => {
    const today = todayLocalStr();
    const start = o.scheduledDate || '';
    if (!start) return 2;
    const end = (o.scheduledEndDate && o.scheduledEndDate >= start ? o.scheduledEndDate : start);
    if (end < today) return 0;
    if (start <= today) return 1;
    return 3;
  };
  const compareQueue = (a: ProductionOrder, b: ProductionOrder) =>
    queueRank(a) - queueRank(b) ||
    (a.scheduledDate || '').localeCompare(b.scheduledDate || '') ||
    (a.sequence || 0) - (b.sequence || 0);

  const reactorState = useMemo(() => {
    const map: Record<string, { activeOp: ProductionOrder | null; queuedOps: ProductionOrder[] }> = {};
    reactorLines.forEach(reactor => {
      const reactorOps = manipulacaoOps.filter(op => op.lineId === reactor.id && op.status !== 'completed');
      const inProgress = reactorOps.find(o => o.status === 'in_progress');
      const paused = !inProgress ? reactorOps.find(o => o.status === 'paused') : undefined;
      const pendingSorted = reactorOps
        .filter(o => o.status === 'pending')
        .sort(compareQueue);
      const activeOp = inProgress || paused || pendingSorted[0] || null;
      const queuedOps = pendingSorted.filter(o => o.id !== activeOp?.id);
      map[reactor.id] = { activeOp, queuedOps };
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactorLines, manipulacaoOps, todayStrForQueue]);

  // OPs de Manipulação em andamento/pausadas em reatores que não existem
  // mais na lista atual de `lines` (ex.: linha renomeada/removida) — só pra
  // não sumirem silenciosamente da tela.
  const orphanOps = useMemo(
    () => manipulacaoOps.filter(op => op.status !== 'completed' && (!op.lineId || !reactorLines.some(r => r.id === op.lineId))),
    [manipulacaoOps, reactorLines]
  );

  // ---------------- LINHA DE CONFERÊNCIA ----------------
  // Conferência por OP (ou pelo nº da OSM, caso a OP tenha sido recriada).
  const conferenciaFor = useCallback((op: ProductionOrder): ManipConferencia | null => {
    const byId = conferencias.find(c => c.opId === op.id);
    if (byId) return byId;
    const num = (op.number || '').trim();
    return num ? (conferencias.find(c => c.osmNumber && c.osmNumber.trim() === num) || null) : null;
  }, [conferencias]);

  // Fila da conferência: primeiro a PRÓXIMA OSM de cada reator, depois as
  // demais do cronograma (mesma ordem por data). Qualquer uma pode ser conferida.
  const conferenciaQueue = useMemo(() => {
    const pending = manipulacaoOps.filter(op => op.status === 'pending');
    const notConf = pending.filter(op => !conferenciaFor(op));
    const nextIds = new Set<string>();
    reactorLines.forEach(r => {
      const nextPending = (reactorState[r.id]?.activeOp?.status === 'pending')
        ? reactorState[r.id]?.activeOp
        : reactorState[r.id]?.queuedOps[0];
      if (nextPending) nextIds.add(nextPending.id);
    });
    const proximas = notConf
      .filter(op => nextIds.has(op.id))
      .sort((a, b) => reactorLines.findIndex(r => r.id === a.lineId) - reactorLines.findIndex(r => r.id === b.lineId));
    const demais = notConf.filter(op => !nextIds.has(op.id)).sort(compareQueue);
    const conferidas = pending.filter(op => !!conferenciaFor(op)).sort(compareQueue);
    return { proximas, demais, conferidas };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manipulacaoOps, reactorLines, reactorState, conferenciaFor, todayStrForQueue]);

  // SETUP: sempre que uma OP termina, o reator entra em setup até a próxima
  // OP ser iniciada. Conta como ociosidade (tempo parado no expediente).
  const reactorSetupSince = useMemo(() => {
    const map: Record<string, string | null> = {};
    reactorLines.forEach(r => {
      const reactorOps = manipulacaoOps.filter(op => op.lineId === r.id);
      if (reactorOps.some(op => op.status === 'in_progress' || op.status === 'paused')) { map[r.id] = null; return; }
      const lastDone = reactorOps
        .filter(op => op.status === 'completed' && op.completedAt)
        .sort((a, b) => new Date(b.completedAt as string).getTime() - new Date(a.completedAt as string).getTime())[0];
      if (!lastDone) { map[r.id] = null; return; }
      const doneMs = new Date(lastDone.completedAt as string).getTime();
      const startedAfter = events.some(e => e.lineId === r.id && e.type === 'STARTED' && new Date(e.createdAt).getTime() > doneMs);
      // Setup só vale no mesmo dia (o expediente seguinte começa "limpo")
      const sameDay = new Date(doneMs).toDateString() === new Date().toDateString();
      map[r.id] = !startedAfter && sameDay ? (lastDone.completedAt as string) : null;
    });
    return map;
  }, [reactorLines, manipulacaoOps, events]);

  const fmtDuration = (fromIso: string | null) => {
    if (!fromIso) return '';
    const mins = Math.max(0, Math.floor((currentTime.getTime() - new Date(fromIso).getTime()) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
  };

  // Cronômetro hh:mm:ss (resfriamento)
  const fmtClock = (fromIso: string | null) => {
    if (!fromIso) return '00:00:00';
    const sec = Math.max(0, Math.floor((currentTime.getTime() - new Date(fromIso).getTime()) / 1000));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  };

  // OSMs de Manipulação Concluídas
  const completedManipulacaoOps = useMemo(() => {
    return manipulacaoOps
      .filter(op => op.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime());
  }, [manipulacaoOps]);

  const doneLocalDay = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const doneIndustrias = useMemo(
    () => Array.from(new Set(completedManipulacaoOps.map(o => o.industria).filter(Boolean))) as string[],
    [completedManipulacaoOps]
  );
  const doneFiltered = useMemo(() => {
    const today = todayLocalStr();
    const from = (() => {
      if (donePeriod === 'todos') return '';
      const d = new Date();
      if (donePeriod === '7d') d.setDate(d.getDate() - 6);
      if (donePeriod === 'mes') d.setDate(1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const q = doneSearch.trim().toLowerCase();
    return completedManipulacaoOps.filter(op => {
      const day = doneLocalDay(op.completedAt || op.createdAt);
      if (donePeriod === 'hoje' && day !== today) return false;
      if (from && donePeriod !== 'hoje' && day < from) return false;
      if (doneReactor !== 'all' && op.lineId !== doneReactor) return false;
      if (doneIndustria !== 'all' && op.industria !== doneIndustria) return false;
      if (doneHideZero && !(Number(op.producedQuantity) > 0)) return false;
      if (q && !(`${op.number} ${op.product} ${op.lote || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [completedManipulacaoOps, donePeriod, doneReactor, doneIndustria, doneHideZero, doneSearch]);
  const doneHiddenZero = useMemo(
    () => (doneHideZero ? completedManipulacaoOps.filter(o => !(Number(o.producedQuantity) > 0)).length : 0),
    [completedManipulacaoOps, doneHideZero]
  );
  const doneTotalKg = doneFiltered.reduce((a, o) => a + (Number(o.producedQuantity) || 0), 0);
  useEffect(() => { setDoneLimit(30); }, [donePeriod, doneReactor, doneIndustria, doneSearch, doneHideZero]);

  // Data de hoje e total de Kg produzidos hoje na Manipulação
  // Dia LOCAL, acompanhando o relógio da tela (antes era UTC e fixado ao abrir:
  // depois das 21h o "hoje" já virava amanhã, e não virava de novo à meia-noite)
  const todayStr = useMemo(() => {
    const d = currentTime;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate()]);
  const totalKgHoje = useMemo(() => {
    return manipulacaoOps
      .filter(op => {
        if (op.status !== 'completed') return false;
        const toLocal = (v: string) => {
          const d = new Date(v);
          return isNaN(d.getTime()) ? v.split('T')[0] : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const opDate = op.completedAt ? toLocal(op.completedAt) : (op.scheduledDate || (op.createdAt ? toLocal(op.createdAt) : ''));
        return opDate === todayStr;
      })
      .reduce((acc, op) => acc + (Number(op.producedQuantity) || 0 /* só o Kg realmente apontado — nunca o planejado */), 0);
  }, [manipulacaoOps, todayStr]);

  const emAndamentoCount = useMemo(
    () => manipulacaoOps.filter(op => op.status !== 'completed').length,
    [manipulacaoOps]
  );

  // --------------------------------------------------------------------
  // AÇÕES OPERACIONAIS — mesmas funções do Envase (startOP/pauseOP/
  // resumeOP/finishOP), só que operando sobre a OP de Manipulação do
  // reator em vez da OP de Envase de uma linha.
  // --------------------------------------------------------------------
  // ---------------- EXPEDIENTE DOS REATORES ----------------
  // Um botão só abre/encerra o expediente dos 3 reatores juntos (o líder
  // da Manipulação cuida dos 3 ao mesmo tempo). Parada dentro do expediente
  // conta como ociosidade no dashboard; fora dele, não.
  const openReactorShifts = useMemo(
    () => reactorLines
      .map(r => getOpenWorkSession(workSessions, r.id))
      .filter((ws): ws is WorkSession => !!ws),
    [workSessions, reactorLines]
  );
  const explicitShiftSince = openReactorShifts.length > 0
    ? openReactorShifts.reduce((a, b) => (new Date(a.startedAt).getTime() < new Date(b.startedAt).getTime() ? a : b)).startedAt
    : null;

  // Expediente automático: reator com OP no dia começa às 5h sozinho e
  // termina no fim da jornada se ninguém encerrar.
  const currentMinuteKey = Math.floor(currentTime.getTime() / 60000);
  const autoReactorShifts = useMemo(
    () => reactorLines
      .filter(r => !getOpenWorkSession(workSessions, r.id))
      .map(r => ({ lineId: r.id, ...getAutoShiftNow(r.id, ops, workSessions, currentMinuteKey * 60000) }))
      .filter(a => a.active && a.startMs),
    [reactorLines, ops, workSessions, currentMinuteKey]
  );
  const autoShiftStartMs = autoReactorShifts.length > 0 ? Math.min(...autoReactorShifts.map(a => a.startMs as number)) : null;
  const shiftOpenSince: string | null = explicitShiftSince
    ? (autoShiftStartMs && autoShiftStartMs < new Date(explicitShiftSince).getTime() ? new Date(autoShiftStartMs).toISOString() : explicitShiftSince)
    : (autoShiftStartMs ? new Date(autoShiftStartMs).toISOString() : null);
  const shiftIsAutomatic = !explicitShiftSince && !!autoShiftStartMs;

  const handleStartShift = async () => {
    if (!profile) return;
    setIsShiftBusy(true);
    const res = await startWorkSession(reactorLines.map(r => r.id), profile.uid);
    setIsShiftBusy(false);
    if (res.error) showToast(`Não foi possível iniciar o expediente: ${res.error}`, 'error');
    else showToast('Expediente dos reatores iniciado.');
    await fetchData(true);
  };

  const handleEndShift = async () => {
    if (!profile) return;
    setIsShiftBusy(true);
    // Manipulação ainda rodando: pausa com o motivo "Fim de Expediente"
    const running = manipulacaoOps.filter(op => op.status === 'in_progress' && op.lineId && reactorLines.some(r => r.id === op.lineId));
    for (const op of running) {
      await pauseOP(op.id, op.lineId as string, profile.uid, 'Fim de Expediente', 'Pausa automática ao encerrar o expediente');
    }
    // Reatores com expediente registrado: encerra. Reatores no expediente
    // automático (sem registro): grava o trecho 5h → agora já encerrado.
    const autoIds = autoReactorShifts.map(a => a.lineId);
    const explicitIds = reactorLines.map(r => r.id).filter(id => !autoIds.includes(id));
    let res = explicitIds.length > 0 ? await endWorkSession(explicitIds, profile.uid) : { error: null as string | null };
    if (!res.error && autoIds.length > 0 && autoShiftStartMs) {
      res = await endWorkSession(autoIds, profile.uid, { autoStartIso: new Date(autoShiftStartMs).toISOString() });
    }
    setIsShiftBusy(false);
    if (res.error) {
      showToast(`Não foi possível encerrar o expediente: ${res.error}`, 'error');
      return;
    }
    setIsEndShiftOpen(false);
    showToast('Expediente dos reatores encerrado.');
    await fetchData(true);
  };

  // Iniciar/retomar com o expediente fechado abre o expediente daquele reator sozinho
  const ensureShiftOpen = async (lineId: string) => {
    if (!profile || getOpenWorkSession(workSessions, lineId)) return;
    const res = await startWorkSession([lineId], profile.uid);
    if (res.error) console.warn('[Manipulação] Expediente não aberto automaticamente:', res.error);
  };

  // Histórico da Pesagem: a "saída" normal de uma OSM é quando a Manipulação
  // a inicia no reator. Registra quem iniciou (login da Manipulação) — só
  // para OSMs que vieram da Pesagem.
  const logPesagemExit = async (op: ProductionOrder, action: 'manipulacao_started' | 'manipulacao_start_cancelled') => {
    if (!profile) return;
    const num = (op.number || '').trim();
    const lot = (op.lote || '').trim();
    const cameFromPesagem = ops.some(o =>
      (o.setor === 'Pesagem' || (!o.setor && o.tipoDocumento === 'OSM')) &&
      ((num && (o.number || '').trim() === num) || (lot && (o.lote || '').trim() === lot))
    );
    if (!cameFromPesagem) return;
    const reactorName = reactorLines.find(r => r.id === op.lineId)?.name || op.lineId || '';
    const res = await logPesagemHistory({
      action,
      op,
      collaboratorName: (profile.name || '').trim() || 'Manipulação',
      userId: profile.uid,
      userName: profile.name || null,
      details: { reactor: reactorName },
    });
    if (res.error) console.warn('[Manipulação] Histórico da Pesagem não gravado:', res.error);
  };

  const handleStart = async (op: ProductionOrder) => {
    if (!profile || !op.lineId) return;
    if (!conferenciaFor(op)) {
      showToast('Esta OSM ainda não foi conferida — confira a pesagem na Linha de Conferência antes de iniciar.', 'error');
      return;
    }
    setActionBusyOpId(op.id);
    try {
      await ensureShiftOpen(op.lineId);
      const res = await startOP(op.id, op.lineId, profile.uid);
      if (op.status === 'pending' && res?.ok !== false) await logPesagemExit(op, 'manipulacao_started');
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao iniciar manipulação:', err);
      showToast('Erro ao iniciar manipulação.', 'error');
    } finally {
      setActionBusyOpId(null);
    }
  };

  const handleOpenPauseModal = (op: ProductionOrder) => {
    setPausingOp(op);
    setPauseReason('');
    setPauseObs('');
  };

  const handleConfirmPause = async () => {
    if (!profile || !pausingOp || !pausingOp.lineId || !pauseReason) return;
    setIsPauseSubmitting(true);
    try {
      await pauseOP(pausingOp.id, pausingOp.lineId, profile.uid, pauseReason, pauseObs);
      showToast(`OP ${pausingOp.number} pausada.`);
      setPausingOp(null);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao pausar manipulação:', err);
      showToast('Erro ao pausar esta OP.', 'error');
    } finally {
      setIsPauseSubmitting(false);
    }
  };

  const handleResume = async (op: ProductionOrder) => {
    if (!profile || !op.lineId) return;
    setActionBusyOpId(op.id);
    try {
      await ensureShiftOpen(op.lineId);
      await resumeOP(op.id, op.lineId, profile.uid);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao retomar manipulação:', err);
      showToast('Erro ao retomar esta OP.', 'error');
    } finally {
      setActionBusyOpId(null);
    }
  };

  const handleOpenFinishModal = (op: ProductionOrder, mode: 'manip' | 'drenagem' = 'drenagem') => {
    setFinishMode(mode);
    setFinishingOp(op);
    // Na drenagem já vem o Kg apontado ao finalizar a manipulação
    const manipKg = mode === 'drenagem' ? getManipPhase(op, events).manipKg : null;
    const suggestedKg = manipKg && manipKg > 0 ? manipKg : (mode === 'drenagem' ? Number(op.plannedQuantity) || 0 : 0);
    setFinalKg(suggestedKg > 0 ? String(suggestedKg) : '');
    setSelectedShift(detectedShift);
  };

  // ---------------- FASES: AMOSTRAGEM / CQ / DRENAGEM ----------------
  const runPhaseAction = async (op: ProductionOrder, fn: () => Promise<{ ok: boolean; error?: string } | void | undefined>, okMsg: string) => {
    if (!profile || !op.lineId) return;
    setActionBusyOpId(op.id);
    try {
      const res = await fn();
      if (res && (res as any).ok === false) {
        showToast((res as any).error || 'Não foi possível registrar.', 'error');
      } else {
        showToast(okMsg);
      }
      await fetchData(true);
    } catch (err) {
      console.error('Erro na fase da manipulação:', err);
      showToast('Erro ao registrar esta etapa.', 'error');
    } finally {
      setActionBusyOpId(null);
    }
  };

  // ANÁLISE: encerra a manipulação e já manda a Amostra 01 para o CQ
  // (sem pausa e sem modal — o Kg é informado só ao finalizar a drenagem).
  // Se a OP estava em RESFRIAMENTO, a Análise encerra o cronômetro do
  // resfriamento (a OP já está parada — só grava a nova fase).
  const handleAnalise = (op: ProductionOrder) => {
    if (getManipPhase(op, events).phase === 'resfriando') {
      return runPhaseAction(
        op,
        () => recordManipulacaoPhase(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.aguardandoCq, 'Resfriamento concluído · Amostra 01 enviada para análise'),
        `OP ${op.number} enviada para análise — aguardando CQ.`
      );
    }
    return runPhaseAction(
      op,
      () => pauseOP(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.aguardandoCq, 'Manipulação finalizada · Amostra 01 enviada para análise') as any,
      `OP ${op.number} enviada para análise — aguardando CQ.`
    );
  };

  // RESFRIAMENTO: encerra a manipulação e inicia o cronômetro do
  // resfriamento, que só para quando clicarem em Análise.
  const handleResfriamento = (op: ProductionOrder) => runPhaseAction(
    op,
    () => pauseOP(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.resfriamento, 'Manipulação finalizada · Resfriamento iniciado') as any,
    `OP ${op.number} em resfriamento.`
  );

  const handleCollectSample = (op: ProductionOrder) => {
    const n = getManipPhase(op, events).samples + 1;
    return runPhaseAction(op, () => recordManipulacaoPhase(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.aguardandoCq, `Amostra ${String(n).padStart(2, '0')} enviada para análise`), `Amostra ${String(n).padStart(2, '0')} enviada para análise — aguardando CQ.`);
  };

  const handleCqApproved = (op: ProductionOrder) => {
    const n = getManipPhase(op, events).samples;
    return runPhaseAction(op, () => recordManipulacaoPhase(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.aguardandoDrenagem, `CQ: aprovado — Amostra ${String(n).padStart(2, '0')} · liberado para drenagem`), 'Aprovado pelo CQ — liberado para drenagem.');
  };

  const handleCqRejected = (op: ProductionOrder) => {
    const n = getManipPhase(op, events).samples;
    return runPhaseAction(op, () => recordManipulacaoPhase(op.id, op.lineId as string, profile!.uid, MANIP_PHASE_REASONS.emAjuste, `CQ: não aprovado — Amostra ${String(n).padStart(2, '0')} · ajuste iniciado`), 'Não aprovado — reator em ajuste.');
  };

  const handleStartDrain = (op: ProductionOrder) => runPhaseAction(op, async () => {
    await ensureShiftOpen(op.lineId as string);
    return resumeOP(op.id, op.lineId as string, profile!.uid);
  }, `Drenagem da OP ${op.number} iniciada.`);

  // ---------------- CONFERÊNCIA ----------------
  // Um clique confirma que a pesagem foi conferida (quem clicou fica registrado).
  const handleConferir = async (op: ProductionOrder) => {
    if (!profile) return;
    setActionBusyOpId(op.id);
    try {
      const res = await addManipConferencia({
        opId: op.id,
        osmNumber: (op.number || '').trim(),
        lote: (op.lote || '').trim(),
        reactorId: op.lineId || '',
        items: {},
        operador: profile.name || '',
        observacao: '',
        conferidoPor: profile.uid,
        conferidoNome: profile.name || '',
      });
      if (!res.ok) {
        showToast(res.error || 'Não foi possível registrar a conferência.', 'error');
        return;
      }
      showToast(`OSM ${op.number} conferida — liberada para iniciar no reator.`);
      await fetchData(true);
    } finally {
      setActionBusyOpId(null);
    }
  };

  const handleUndoConferencia = async (conf: ManipConferencia) => {
    const res = await deleteManipConferencia(conf.id);
    if (!res.ok) showToast(`Não foi possível desfazer: ${res.error}`, 'error');
    else showToast(`Conferência da OSM ${conf.osmNumber} desfeita.`);
    await fetchData(true);
  };

  const handleConfirmFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !finishingOp || !finishingOp.lineId) return;

    const kgNum = parseFloat(finalKg);
    if (isNaN(kgNum) || kgNum <= 0) {
      showToast('Informe uma quantidade válida em Kg.', 'error');
      return;
    }

    setIsFinishingSubmitting(true);
    try {
      // Usa o reator real da OP (lineId) — assim que finalizada, ela some
      // desta lista de "não concluídas" e a próxima da fila do MESMO reator
      // vira a nova OP ativa automaticamente (ver reactorState acima).
      if (finishMode === 'manip') {
        // Fim da manipulação: reator fica aguardando amostragem (OP pausada
        // com o motivo da fase — não conta como tempo trabalhando).
        const res = await pauseOP(finishingOp.id, finishingOp.lineId, profile.uid, MANIP_PHASE_REASONS.aguardandoAmostragem, `Manipulação finalizada · ${kgNum.toLocaleString('pt-BR')} kg`, kgNum);
        if (res && (res as any).ok === false) {
          showToast('Não foi possível finalizar a manipulação.', 'error');
          return;
        }
        showToast(`Manipulação da OP ${finishingOp.number} finalizada — aguardando amostragem.`, 'success');
        setFinishingOp(null);
        await fetchData(true);
        return;
      }

      await finishOP(finishingOp.id, finishingOp.lineId, profile.uid, selectedShift, kgNum);

      showToast(`Drenagem finalizada — OP ${finishingOp.number} concluída. Reator em setup.`, 'success');
      setFinishingOp(null);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao finalizar OP:', err);
      showToast('Erro ao finalizar OP.', 'error');
    } finally {
      setIsFinishingSubmitting(false);
    }
  };

  // Cancelar uma manipulação INICIADA POR ENGANO — mesma regra do Envase:
  // a OP volta pra "Pronta pra Iniciar" no mesmo lugar da fila do reator e o
  // horário de início registrado por engano deixa de contar nos indicadores.
  // Nada é excluído. Só vale enquanto nenhum Kg foi apontado.
  const handleConfirmCancel = async () => {
    if (!cancellingOp || !cancellingOp.lineId) return;
    setIsCancellingSubmitting(true);
    try {
      const res = await cancelOP(cancellingOp.id, cancellingOp.lineId, 'Início cancelado (iniciado por engano)');
      if (!res.success) {
        showToast(res.message || 'Não foi possível cancelar o início desta OP.', 'error');
        return;
      }
      await logPesagemExit(cancellingOp, 'manipulacao_start_cancelled');
      showToast(`Início da OP ${cancellingOp.number} cancelado — ela voltou para a fila do reator.`);
      setCancellingOp(null);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao cancelar início da manipulação:', err);
      showToast((err as any)?.message || 'Erro ao cancelar o início desta OP.', 'error');
    } finally {
      setIsCancellingSubmitting(false);
    }
  };

  // Card da OP ativa de um reator — Iniciar / Pausar / Retomar / Finalizar,
  // no mesmo estilo visual usado antes (bloco de observação/horário etc.).
  // Visual de cada fase do reator
  const PHASE_STYLE: Record<ManipPhase, { border: string; badge: string; icon: React.ReactNode }> = {
    aguardando_inicio: { border: 'border-[#27272a]', badge: 'bg-[#1a1a22] text-[#a1a1aa] border-[#2c2c3c]', icon: <Clock className="w-3 h-3" /> },
    manipulando: { border: 'border-cyan-500/50 shadow-lg shadow-cyan-950/20', badge: 'bg-cyan-950/90 text-cyan-300 border-cyan-800/60', icon: <FlaskConical className="w-3 h-3 text-cyan-400 animate-pulse" /> },
    pausada: { border: 'border-amber-500/50 shadow-lg shadow-amber-950/20', badge: 'bg-amber-950/90 text-amber-300 border-amber-800/60', icon: <Pause className="w-3 h-3 text-amber-400" /> },
    resfriando: { border: 'border-blue-400/50 shadow-lg shadow-blue-950/20', badge: 'bg-blue-950/90 text-blue-200 border-blue-800/60', icon: <Snowflake className="w-3 h-3 text-blue-300 animate-pulse" /> },
    aguardando_amostragem: { border: 'border-violet-500/50 shadow-lg shadow-violet-950/20', badge: 'bg-violet-950/90 text-violet-300 border-violet-800/60', icon: <TestTube className="w-3 h-3 text-violet-400" /> },
    aguardando_cq: { border: 'border-sky-500/50 shadow-lg shadow-sky-950/20', badge: 'bg-sky-950/90 text-sky-300 border-sky-800/60', icon: <ShieldCheck className="w-3 h-3 text-sky-400 animate-pulse" /> },
    em_ajuste: { border: 'border-orange-500/50 shadow-lg shadow-orange-950/20', badge: 'bg-orange-950/90 text-orange-300 border-orange-800/60', icon: <Wrench className="w-3 h-3 text-orange-400" /> },
    aguardando_drenagem: { border: 'border-emerald-500/50 shadow-lg shadow-emerald-950/20', badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-800/60', icon: <ThumbsUp className="w-3 h-3 text-emerald-400" /> },
    drenando: { border: 'border-teal-500/50 shadow-lg shadow-teal-950/20', badge: 'bg-teal-950/90 text-teal-300 border-teal-800/60', icon: <Droplets className="w-3 h-3 text-teal-400 animate-pulse" /> },
    drenagem_pausada: { border: 'border-amber-500/50 shadow-lg shadow-amber-950/20', badge: 'bg-amber-950/90 text-amber-300 border-amber-800/60', icon: <Pause className="w-3 h-3 text-amber-400" /> },
    encerrado: { border: 'border-[#27272a]', badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-800/60', icon: <CheckCircle2 className="w-3 h-3" /> },
  };

  // min-w-0 + quebra de linha: com 4 colunas o card fica estreito e os
  // botões não podem vazar para fora dele.
  const btnBase = 'shrink min-h-10 h-auto py-2 min-w-0 whitespace-normal leading-tight text-center rounded-xl text-white font-bold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all transform active:scale-95 [&>svg]:shrink-0';

  // Card da OP ativa de um reator — botões conforme a FASE do fluxo:
  // Iniciar → Finalizar manipulação → Coletar amostra → Aprovado/Reprovado
  // (→ ajuste → nova amostra) → Iniciar drenagem → Finalizar drenagem.
  const renderActiveCard = (op: ProductionOrder) => {
    const isBusy = actionBusyOpId === op.id;
    const info = getManipPhase(op, events);
    const phase = info.phase;
    const style = PHASE_STYLE[phase];
    const conf = conferenciaFor(op);
    const opEvents = getManipOpEvents(op.id, events);
    const firstStart = opEvents.find(e => e.type === 'STARTED')?.createdAt || null;
    const formattedTime = firstStart
      ? new Date(firstStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '--:--';
    const manipFinished = opEvents.some(e => e.type === 'PAUSED' && isManipPhaseReason(e.reason));
    const canCancelStart = (phase === 'manipulando' || phase === 'pausada') && !manipFinished && !(Number(op.producedQuantity) > 0);
    const sampleLabel = info.samples > 0 ? `Amostra ${String(info.samples).padStart(2, '0')}` : '';

    return (
      <div className={`rounded-2xl p-4 flex flex-col gap-3 transition-all border-2 bg-[#18181b] ${style.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {op.industria && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg font-sans shadow-sm border ${getIndustriaBadgeClass(op.industria)}`}>
                {op.industria}
              </span>
            )}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 shadow-sm ${style.badge}`}>
              {style.icon}
              <span>{phase === 'aguardando_inicio' && !conf ? 'Aguardando conferência' : MANIP_PHASE_LABELS[phase]}</span>
            </span>
            {phase !== 'aguardando_inicio' && info.since && (
              <span className="text-[10px] font-mono text-[#71717a]" title="Tempo nesta etapa">há {fmtDuration(info.since)}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => setHistoryOp(op)}
              title="Histórico da OP"
              className="h-7 w-7 shrink-0 rounded-lg bg-transparent hover:bg-[#27272a] text-[#a1a1aa] hover:text-white border border-[#27272a] flex items-center justify-center transition-all p-0"
            >
              <History className="w-3.5 h-3.5" />
            </Button>
            {canCancelStart && (
              <Button
                onClick={() => setCancellingOp(op)}
                title="Cancelar início (iniciada por engano)"
                className="h-7 w-7 shrink-0 rounded-lg bg-transparent hover:bg-rose-950/30 text-rose-400/70 hover:text-rose-300 border border-rose-500/20 flex items-center justify-center transition-all p-0"
              >
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-xl font-black text-white tracking-tight">{op.number}</h3>
          {op.lote ? (
            <span className="text-[11px] font-mono font-bold text-cyan-200 bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-lg shadow-sm">
              Lote: {op.lote}
            </span>
          ) : null}
        </div>

        <div className="space-y-0.5">
          <div className="text-[11px] text-[#a1a1aa] font-medium">Nome:</div>
          <div className="text-xs font-bold text-white uppercase tracking-tight leading-snug">{op.product}</div>
        </div>

        <div className="bg-[#121215] border border-[#27272a]/80 rounded-xl p-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-300 shrink-0">
              <Boxes className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-[#a1a1aa] font-medium leading-none">Observação</div>
              <div className={`text-[11px] font-bold truncate mt-1 ${(op.granel || op.observation) ? 'text-white' : 'text-[#71717a]'}`}>
                {(op.granel && op.granel !== op.number) ? op.granel : (op.observation || 'Sem observação')}
              </div>
            </div>
          </div>
          {op.status !== 'pending' && (
            <div className="text-right shrink-0">
              <div className="text-[10px] text-[#a1a1aa] font-medium leading-none">Início</div>
              <div className="font-mono text-[11px] font-bold text-white flex items-center gap-1 justify-end mt-1">
                <Clock className="w-3 h-3 text-[#71717a]" />
                <span>{formattedTime}</span>
              </div>
            </div>
          )}
        </div>

        {/* Conferência / Kg manipulado / amostras */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          {conf ? (
            <span className="px-2 py-0.5 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 flex items-center gap-1" title={`Conferida por ${conf.conferidoNome || '—'}`}>
              <ClipboardCheck className="w-3 h-3" />
              Conferida {new Date(conf.conferidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : op.status === 'pending' && (
            <span className="px-2 py-0.5 rounded-lg bg-rose-950/50 text-rose-300 border border-rose-800/40 flex items-center gap-1">
              <ClipboardCheck className="w-3 h-3" />
              Não conferida
            </span>
          )}
          {manipFinished && info.manipKg ? (
            <span className="px-2 py-0.5 rounded-lg bg-[#121215] text-white border border-[#27272a] font-mono font-bold">
              {Number(info.manipKg).toLocaleString('pt-BR')} kg
            </span>
          ) : null}
          {sampleLabel && (
            <span className="px-2 py-0.5 rounded-lg bg-sky-950/50 text-sky-300 border border-sky-800/40 flex items-center gap-1">
              <TestTube className="w-3 h-3" />
              {sampleLabel}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-stretch gap-2">
          {phase === 'aguardando_inicio' && (
            conf ? (
              <Button onClick={() => handleStart(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-cyan-600 hover:bg-cyan-500 shadow-cyan-950/40 ${btnBase}`}>
                {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                <span>Iniciar Manipulação</span>
              </Button>
            ) : (
              <>
                <Button onClick={() => handleConferir(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-violet-600 hover:bg-violet-500 shadow-violet-950/40 ${btnBase}`} title="Confirmar que esta pesagem foi conferida">
                  {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
                  <span>Conferido</span>
                </Button>
              </>
            )
          )}

          {phase === 'manipulando' && (
            <>
              <Button onClick={() => handleResfriamento(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-blue-600 hover:bg-blue-500 shadow-blue-950/40 ${btnBase}`} title="Produto precisa resfriar antes da análise">
                {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Snowflake className="w-4 h-4" />}
                <span>Resfriamento</span>
              </Button>
              <Button onClick={() => handleAnalise(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-sky-600 hover:bg-sky-500 shadow-sky-950/40 ${btnBase}`}>
                {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                <span>Análise</span>
              </Button>
            </>
          )}

          {phase === 'resfriando' && (
            <>
              <div className="w-full bg-blue-950/40 border border-blue-800/50 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-blue-200 flex items-center gap-1.5">
                  <Snowflake className="w-3.5 h-3.5 text-blue-300" />
                  Resfriando
                </span>
                <span className="font-mono text-lg font-black text-white tabular-nums" title="Tempo de resfriamento">{fmtClock(info.since)}</span>
              </div>
              <Button onClick={() => handleAnalise(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-sky-600 hover:bg-sky-500 shadow-sky-950/40 ${btnBase}`}>
                {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                <span>Análise</span>
              </Button>
            </>
          )}

          {(phase === 'pausada' || phase === 'drenagem_pausada') && (
            <Button onClick={() => handleResume(op)} disabled={isBusy} className={`${phase === 'pausada' ? 'flex-1 basis-[7.5rem]' : 'px-3'} bg-cyan-600 hover:bg-cyan-500 shadow-cyan-950/40 ${btnBase}`}>
              {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{phase === 'pausada' ? 'Retomar manipulação' : 'Retomar'}</span>
            </Button>
          )}

          {(phase === 'aguardando_amostragem' || phase === 'em_ajuste') && (
            <Button onClick={() => handleCollectSample(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-violet-600 hover:bg-violet-500 shadow-violet-950/40 ${btnBase}`}>
              {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              <span>{phase === 'em_ajuste' ? 'Nova análise' : 'Análise'}</span>
            </Button>
          )}

          {phase === 'aguardando_cq' && (
            <>
              <Button onClick={() => handleCqRejected(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-rose-600 hover:bg-rose-500 shadow-rose-950/40 ${btnBase}`}>
                <ThumbsDown className="w-4 h-4" />
                <span>Reprovado</span>
              </Button>
              <Button onClick={() => handleCqApproved(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/40 ${btnBase}`}>
                <ThumbsUp className="w-4 h-4" />
                <span>Aprovado</span>
              </Button>
            </>
          )}

          {phase === 'aguardando_drenagem' && (
            <Button onClick={() => handleStartDrain(op)} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-teal-600 hover:bg-teal-500 shadow-teal-950/40 ${btnBase}`}>
              {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Droplets className="w-4 h-4" />}
              <span>Iniciar drenagem</span>
            </Button>
          )}

          {(phase === 'drenando' || phase === 'drenagem_pausada') && (
            <Button onClick={() => handleOpenFinishModal(op, 'drenagem')} disabled={isBusy} className={`flex-1 basis-[7.5rem] bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/40 ${btnBase}`}>
              <CheckCircle2 className="w-4 h-4" />
              <span>Finalizar drenagem</span>
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Card de uma OSM na Linha de Conferência
  const renderConferenciaItem = (op: ProductionOrder, highlight: boolean) => {
    const reactorName = reactorLines.find(r => r.id === op.lineId)?.name || '—';
    const late = queueRank(op) === 0;
    return (
      <div key={op.id} className={`rounded-xl border p-2.5 space-y-2 ${highlight ? 'bg-[#18181b] border-violet-500/40' : 'bg-[#0e0e12] border-[#1f1f26]'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-black text-sm text-white">{op.number}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 shrink-0">{reactorName}</span>
        </div>
        <div className="text-[10px] text-[#a1a1aa] uppercase truncate">{op.product}</div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[10px] font-mono ${late ? 'text-rose-300' : 'text-[#71717a]'}`}>
            {op.lote ? `Lote ${op.lote} · ` : ''}{op.scheduledDate ? new Date(op.scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'sem data'}{late ? ' · atrasada' : ''}
          </span>
          <Button onClick={() => handleConferir(op)} disabled={actionBusyOpId === op.id} className="h-7 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold flex items-center gap-1">
            {actionBusyOpId === op.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
            Conferido
          </Button>
        </div>
      </div>
    );
  };

  // Linha do tempo da OP (modal Histórico)
  // Tempos de cada etapa da OSM, a partir dos eventos:
  // manipulação (rodando antes da Análise), análise/CQ/ajuste (parada nas
  // etapas do CQ), drenagem (rodando depois da Análise) e pausas comuns.
  const computeStages = (op: ProductionOrder) => {
    const evs = getManipOpEvents(op.id, events);
    let runStart: number | null = null;
    let phaseStart: number | null = null;
    let pauseStart: number | null = null;
    let afterAnalysis = false;
    let manipMs = 0, coolMs = 0, cqMs = 0, drainMs = 0, pauseMs = 0;
    let phaseIsCool = false;
    const closePhase = (t: number) => {
      if (phaseStart === null) return;
      if (phaseIsCool) coolMs += t - phaseStart; else cqMs += t - phaseStart;
      phaseStart = null;
    };
    let first: number | null = null, last: number | null = null;
    for (const e of evs) {
      const t = new Date(e.createdAt).getTime();
      if (isNaN(t)) continue;
      if (e.type === 'STARTED' || e.type === 'RESUMED') {
        if (first === null && e.type === 'STARTED') first = t;
        closePhase(t);
        if (pauseStart !== null) { pauseMs += t - pauseStart; pauseStart = null; }
        runStart = t;
      } else if (e.type === 'PAUSED') {
        if (runStart !== null) { (afterAnalysis ? (drainMs += t - runStart) : (manipMs += t - runStart)); runStart = null; }
        if (isManipPhaseReason(e.reason)) {
          if (pauseStart !== null) { pauseMs += t - pauseStart; pauseStart = null; }
          afterAnalysis = true;
          // Cada fase fecha a anterior: o resfriamento conta à parte da análise/CQ
          closePhase(t);
          phaseStart = t;
          phaseIsCool = e.reason === MANIP_PHASE_REASONS.resfriamento;
        } else if (pauseStart === null && phaseStart === null) {
          pauseStart = t;
        }
      } else if (e.type === 'FINISHED') {
        if (runStart !== null) { (afterAnalysis ? (drainMs += t - runStart) : (manipMs += t - runStart)); runStart = null; }
        closePhase(t);
        if (pauseStart !== null) { pauseMs += t - pauseStart; pauseStart = null; }
        last = t;
      }
    }
    const samples = evs.filter(e => e.type === 'PAUSED' && e.reason === MANIP_PHASE_REASONS.aguardandoCq).length;
    const rejected = evs.filter(e => e.type === 'PAUSED' && e.reason === MANIP_PHASE_REASONS.emAjuste).length;
    return { first, last: last ?? (op.completedAt ? new Date(op.completedAt).getTime() : null), manipMs, coolMs, cqMs, drainMs, pauseMs, samples, rejected };
  };
  const fmtMs = (ms: number) => {
    if (!(ms > 0)) return '—';
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
  };

  const buildHistory = (op: ProductionOrder) => {
    const evs = getManipOpEvents(op.id, events);
    const rows: { at: string; text: string; tone: string }[] = [];
    const conf = conferenciaFor(op);
    if (conf) rows.push({ at: conf.conferidoEm, text: `Pesagem conferida${conf.conferidoNome ? ` por ${conf.conferidoNome}` : ''}`, tone: 'text-emerald-300' });
    let manipFinished = false;
    let inDrain = false;
    evs.forEach(e => {
      if (e.type === 'STARTED') rows.push({ at: e.createdAt, text: 'Manipulação iniciada', tone: 'text-cyan-300' });
      else if (e.type === 'PAUSED') {
        if (e.reason === MANIP_PHASE_REASONS.resfriamento) { manipFinished = true; rows.push({ at: e.createdAt, text: 'Manipulação finalizada', tone: 'text-white' }); rows.push({ at: e.createdAt, text: 'Resfriamento iniciado', tone: 'text-blue-300' }); }
        else if (e.reason === MANIP_PHASE_REASONS.aguardandoAmostragem) { manipFinished = true; rows.push({ at: e.createdAt, text: e.observation || 'Manipulação finalizada', tone: 'text-white' }); rows.push({ at: e.createdAt, text: 'Aguardando amostragem', tone: 'text-violet-300' }); }
        else if (e.reason === MANIP_PHASE_REASONS.aguardandoCq) { manipFinished = true; rows.push({ at: e.createdAt, text: `${e.observation || 'Amostra enviada para análise'} · aguardando CQ`, tone: 'text-sky-300' }); }
        else if (e.reason === MANIP_PHASE_REASONS.emAjuste) { manipFinished = true; rows.push({ at: e.createdAt, text: e.observation || 'CQ: não aprovado · em ajuste', tone: 'text-orange-300' }); }
        else if (e.reason === MANIP_PHASE_REASONS.aguardandoDrenagem) { manipFinished = true; rows.push({ at: e.createdAt, text: e.observation || 'CQ: aprovado · liberado para drenagem', tone: 'text-emerald-300' }); }
        else rows.push({ at: e.createdAt, text: `${inDrain ? 'Drenagem pausada' : 'Pausada'}${e.reason ? ` — ${e.reason}` : ''}${e.observation ? ` · ${e.observation}` : ''}`, tone: 'text-amber-300' });
      } else if (e.type === 'RESUMED') {
        if (manipFinished && !inDrain) { inDrain = true; rows.push({ at: e.createdAt, text: 'Drenagem iniciada', tone: 'text-teal-300' }); }
        else rows.push({ at: e.createdAt, text: inDrain ? 'Drenagem retomada' : 'Manipulação retomada', tone: 'text-cyan-300' });
      } else if (e.type === 'FINISHED') {
        rows.push({ at: e.createdAt, text: `Drenagem finalizada${e.quantity ? ` · ${Number(e.quantity).toLocaleString('pt-BR')} kg` : ''} — OP concluída`, tone: 'text-emerald-300' });
        rows.push({ at: e.createdAt, text: 'Reator em setup', tone: 'text-[#a1a1aa]' });
      }
    });
    return rows.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
  };

  return (
    <div className={embedded ? "w-full text-[#f4f4f5] flex flex-col font-sans space-y-4" : "min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col font-sans selection:bg-cyan-500/30"}>
      {/* Toast Notification — renderizado direto no <body> (portal) e acima de
          tudo, para nunca ficar escondido atrás de uma janela aberta */}
      {toastMessage && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed top-4 right-4 z-[9999] max-w-[calc(100vw-32px)] sm:max-w-md px-4 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-3 ${
            toastMessage.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-800'
              : 'bg-cyan-950/90 text-cyan-200 border-cyan-800'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>,
        document.body
      )}

      {/* CABEÇALHO (Apenas se standalone) */}
      {!embedded && (
        <header className="bg-[#121216] border-b border-[#27272a] px-4 lg:px-8 py-3.5 sticky top-0 z-30 flex items-center justify-between gap-4">
          {/* Identificação da Aplicação e Área */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 shadow-inner shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-black text-lg tracking-tight text-white truncate">Painel Industrial</span>
                <span className="hidden sm:flex text-[11px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 shadow-sm items-center gap-1 shrink-0">
                  <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                  Área de Manipulação
                </span>
              </div>
              <p className="text-xs text-[#a1a1aa] flex items-center gap-2 truncate">
                <span>Execução de Granéis</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline font-mono text-cyan-300">Unidade: Kg</span>
              </p>
            </div>
          </div>

          {/* Informações do Líder, Turno Ativo e Ações */}
          <div className="flex items-center gap-3">
            {/* Badge de Turno Ativo Automático */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold ${
                detectedShift === 'Manhã'
                  ? 'bg-blue-950/70 text-blue-300 border-blue-800/50'
                  : 'bg-amber-950/70 text-amber-300 border-amber-800/50'
              }`}
            >
              {detectedShift === 'Manhã' ? (
                <Sun className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Turno: {detectedShift}</span>
            </div>

            {/* Relógio em tempo real */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18181b] border border-[#27272a] text-xs text-[#d4d4d8] font-mono">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>{currentTime.toLocaleTimeString('pt-BR')}</span>
            </div>

            {/* Dados do Usuário */}
            <div className="text-right hidden lg:block">
              <div className="text-xs font-bold text-white flex items-center justify-end gap-1.5">
                <span>{profile?.name || 'Líder de Manipulação'}</span>
              </div>
              <div className="text-[11px] text-[#a1a1aa]">{profile?.cargo || 'Líder de Manipulação'}</div>
            </div>

            {/* Botão Atualizar Manual */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="h-9 w-9 p-0 rounded-xl bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </Button>

            {/* Botão Logout */}
            <Button
              size="sm"
              variant="outline"
              onClick={signOut}
              className="h-9 px-3 rounded-xl bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-rose-400 hover:border-rose-900/60 hover:bg-rose-950/20 text-xs font-semibold flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </header>
      )}

      {/* BARRA DE NAVEGAÇÃO DE ABAS (OPERACIONAL VS DASHBOARD DE PRODUÇÃO) */}
      <div className={`bg-[#121216]/95 border border-[#27272a] px-4 lg:px-6 py-2.5 z-20 backdrop-blur-md ${embedded ? 'rounded-2xl shadow-md' : 'sticky top-[65px] border-b'}`}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveViewTab('operacao')}
              className={`w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === 'operacao'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
              }`}
            >
              <FlaskConical className="w-4 h-4 shrink-0" />
              <span>OPERAÇÃO</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                activeViewTab === 'operacao'
                  ? 'bg-cyan-800 text-white'
                  : 'bg-[#27272a] text-[#a1a1aa]'
              }`}>
                {emAndamentoCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveViewTab('dashboard')}
              className={`w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === 'dashboard'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span>DASHBOARD</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans lowercase font-bold ${
                activeViewTab === 'dashboard'
                  ? 'bg-cyan-800 text-cyan-200'
                  : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/40'
              }`}>
                detalhado
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* CORPO PRINCIPAL */}
      <main className={`flex-1 w-full mx-auto flex flex-col gap-8 ${embedded ? 'p-0 max-w-full' : 'max-w-6xl p-4 sm:p-6 lg:p-8'}`}>
        {activeViewTab === 'dashboard' ? (
          // Dashboard da Manipulação — mesmo modelo do Dashboard Detalhado, só com os reatores
          <DetailedDashboard ops={ops} lines={lines} events={events} sector="Manipulação" />
        ) : (
          <>
            {/* OS 3 REATORES — cada um com sua OP ativa (iniciar/pausar/
                finalizar) e a fila do que o Coordenador já organizou pelo
                Cronograma. Qualquer líder de plantão mexe em qualquer um. */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <h2 className="text-lg font-bold text-white tracking-tight">Reatores</h2>
                </div>
                <div className="flex items-center gap-3">
                  {(() => {
                    const h = currentTime.getHours();
                    const meal = REACTOR_MEAL_BREAKS.find(b => h >= b.start && h < b.end);
                    return meal && REACTOR_WORK_SCHEDULE[currentTime.getDay()] ? (
                      <span className="px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-xs font-bold text-emerald-300" title="Pausa automática — não conta como ociosidade">
                        {meal.label} · {meal.start}h–{meal.end}h
                      </span>
                    ) : null;
                  })()}
                  {shiftOpenSince ? (
                    <button
                      onClick={() => setIsEndShiftOpen(true)}
                      disabled={isShiftBusy}
                      className="px-3 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-900/50 border border-rose-800/50 text-xs font-bold text-rose-200 flex items-center gap-2 transition-all disabled:opacity-60"
                    >
                      <Sunset className="w-4 h-4 text-rose-400" />
                      Encerrar Expediente
                      <span className="font-mono text-[10px] text-rose-300/80">
                          (desde {new Date(shiftOpenSince).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{shiftIsAutomatic ? ' · automático' : ''})
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={handleStartShift}
                      disabled={isShiftBusy}
                      title="O expediente dos reatores começa sozinho às 5h e vai até as 23h (almoço 12h–13h e janta 20h–21h não contam como ociosidade). Use este botão para começar antes (hora extra) ou para reabrir depois de encerrar."
                      className="px-3 py-2 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/50 border border-emerald-800/50 text-xs font-bold text-emerald-200 flex items-center gap-2 transition-all disabled:opacity-60"
                    >
                      <Sunrise className="w-4 h-4 text-emerald-400" />
                      {isShiftBusy ? 'Iniciando...' : 'Iniciar Expediente'}
                    </button>
                  )}
                </div>
              </div>
              {shiftOpenSince && new Date(shiftOpenSince).toDateString() !== new Date().toDateString() && (
                <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/40 rounded-xl px-3 py-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-200">
                    O expediente dos reatores foi aberto em {new Date(shiftOpenSince).toLocaleDateString('pt-BR')} e não foi encerrado. Encerre e inicie um novo para hoje.
                  </p>
                </div>
              )}

              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#a1a1aa]">
                  <RefreshCw className="w-6 h-6 text-cyan-500 animate-spin mb-2" />
                  <span className="text-xs">Carregando reatores...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
                  {/* LINHA DE CONFERÊNCIA — confere a pesagem antes do reator
                      poder iniciar. Próximas de cada reator em cima; qualquer
                      OSM do cronograma pode ser conferida. Não conta tempo de reator. */}
                  <div className="bg-[#121215] border border-violet-900/50 rounded-2xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-4 h-4 text-violet-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-wide">Conferência</h3>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-950/70 text-violet-300 border border-violet-800/40">
                        {conferenciaQueue.proximas.length + conferenciaQueue.demais.length}
                      </span>
                    </div>
                    {conferenciasError && /does not exist|relation|manipulacao_conferencias/i.test(conferenciasError) && (
                      <p className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-800/40 rounded-lg px-2 py-1.5">
                        Tabela de conferência não encontrada — rode sql/add_conferencia_manipulacao.sql no Supabase.
                      </p>
                    )}
                    {conferenciaQueue.proximas.length === 0 && conferenciaQueue.demais.length === 0 ? (
                      <p className="text-[11px] text-[#52525b] text-center py-8">Nenhuma pesagem aguardando conferência.</p>
                    ) : (
                      <>
                        {conferenciaQueue.proximas.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-violet-300 font-semibold uppercase tracking-wide">Próximas dos reatores</p>
                            {conferenciaQueue.proximas.map(op => renderConferenciaItem(op, true))}
                          </div>
                        )}
                        {conferenciaQueue.demais.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <p className="text-[10px] text-[#71717a] font-semibold uppercase tracking-wide">Demais no cronograma ({conferenciaQueue.demais.length})</p>
                            {conferenciaQueue.demais.map(op => renderConferenciaItem(op, false))}
                          </div>
                        )}
                      </>
                    )}
                    {conferenciaQueue.conferidas.length > 0 && (
                      <div className="pt-1 space-y-1.5">
                        <button type="button" onClick={() => setShowConferidas(v => !v)} className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide hover:text-emerald-300">
                          {showConferidas ? '▾' : '▸'} Conferidas aguardando início ({conferenciaQueue.conferidas.length})
                        </button>
                        {showConferidas && conferenciaQueue.conferidas.map(op => {
                          const c = conferenciaFor(op);
                          const canUndo = !!c && (c.conferidoPor === profile?.uid);
                          return (
                            <div key={op.id} className="flex items-center justify-between gap-2 bg-[#0e0e12] border border-emerald-900/40 rounded-lg px-2.5 py-1.5">
                              <div className="min-w-0">
                                <div className="font-mono font-bold text-[11px] text-white">{op.number}</div>
                                <div className="text-[10px] text-[#71717a] truncate">
                                  {reactorLines.find(r => r.id === op.lineId)?.name || '—'} · {c?.conferidoNome || '—'} {c ? new Date(c.conferidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </div>
                              {canUndo && c && (
                                <button type="button" onClick={() => handleUndoConferencia(c)} title="Desfazer conferência" className="h-6 w-6 rounded-md text-[#a1a1aa] hover:text-rose-300 hover:bg-rose-950/30 flex items-center justify-center shrink-0">
                                  <Undo2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {reactorLines.map((reactor) => {
                    const { activeOp, queuedOps } = reactorState[reactor.id] || { activeOp: null, queuedOps: [] };
                    const setupSince = reactorSetupSince[reactor.id];
                    return (
                      <div key={reactor.id} className="bg-[#121215] border border-[#27272a] rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FlaskConical className="w-4 h-4 text-cyan-400" />
                            <h3 className="text-sm font-black text-white uppercase tracking-wide">{reactor.name}</h3>
                          </div>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-800/40">
                            {queuedOps.length + (activeOp ? 1 : 0)}
                          </span>
                        </div>

                        {setupSince && (
                          <div className="flex items-center justify-between gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2" title="O reator entra em setup quando uma OP termina e sai ao iniciar a próxima. Conta como ociosidade.">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                              <Timer className="w-3.5 h-3.5" />
                              Em setup
                            </div>
                            <span className="font-mono text-[11px] text-amber-200">{fmtDuration(setupSince)}</span>
                          </div>
                        )}

                        {!activeOp ? (
                          <p className="text-[11px] text-[#52525b] text-center py-8">
                            Reator livre — nenhuma OSM organizada aqui no Cronograma.
                          </p>
                        ) : (
                          renderActiveCard(activeOp)
                        )}

                        {queuedOps.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <p className="text-[10px] text-[#71717a] font-semibold uppercase tracking-wide">
                              Próximas na fila ({queuedOps.length})
                            </p>
                            {queuedOps.map((op) => (
                              <div
                                key={op.id}
                                className="flex items-center justify-between gap-2 bg-[#0e0e12] border border-[#1f1f26] rounded-lg px-2.5 py-1.5"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono font-bold text-[11px] text-white shrink-0">{op.number}</span>
                                  <span className="text-[10px] text-[#71717a] truncate">{op.product}</span>
                                </div>
                                {op.industria && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border shrink-0 ${getIndustriaBadgeClass(op.industria)}`}>
                                    {op.industria}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {orphanOps.length > 0 && (
                <div className="pt-2 space-y-2">
                  <p className="text-[11px] text-[#71717a]">
                    OPs de Manipulação sem reator válido (linha renomeada/removida):
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {orphanOps.map((op) => renderActiveCard(op))}
                  </div>
                </div>
              )}
            </section>

            {/* HISTÓRICO DE OPS FINALIZADAS NA MANIPULAÇÃO — com filtros */}
            {completedManipulacaoOps.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-[#27272a]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">OPs Finalizadas na Manipulação</h3>
                  </div>
                  <span className="text-xs text-[#a1a1aa] font-mono">
                    {doneFiltered.length} de {completedManipulacaoOps.length} · {doneTotalKg.toLocaleString('pt-BR')} kg
                  </span>
                </div>

                {/* Filtros */}
                <div className="bg-[#121215] border border-[#27272a] rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Mês'], ['todos', 'Todas']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setDonePeriod(k)}
                        className={`h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${donePeriod === k ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`}>
                        {l}
                      </button>
                    ))}
                    <span className="w-px h-6 bg-[#27272a] mx-1" />
                    <button type="button" onClick={() => setDoneReactor('all')}
                      className={`h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${doneReactor === 'all' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`}>
                      Todos os reatores
                    </button>
                    {reactorLines.map(r => (
                      <button key={r.id} type="button" onClick={() => setDoneReactor(r.id)}
                        className={`h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${doneReactor === r.id ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                    <Input value={doneSearch} onChange={e => setDoneSearch(e.target.value)} placeholder="Buscar OP, produto ou lote"
                      className="h-9 bg-[#0b0b0e] border-[#25252c] rounded-lg text-xs" />
                    <select value={doneIndustria} onChange={e => setDoneIndustria(e.target.value)}
                      className="h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-xs text-white">
                      <option value="all">Todas as indústrias</option>
                      {doneIndustrias.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                    <label className="h-9 flex items-center gap-2 px-3 rounded-lg bg-[#0b0b0e] border border-[#25252c] text-[11px] text-[#d4d4d8] cursor-pointer">
                      <input type="checkbox" checked={doneHideZero} onChange={e => setDoneHideZero(e.target.checked)} className="accent-cyan-500" />
                      Ocultar sem Kg{doneHiddenZero > 0 ? ` (${doneHiddenZero})` : ''}
                    </label>
                  </div>
                </div>

                {doneFiltered.length === 0 ? (
                  <p className="text-xs text-[#71717a] text-center py-6">Nenhuma OP finalizada com esses filtros.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {doneFiltered.slice(0, doneLimit).map((op) => {
                        const finishedKg = Number(op.producedQuantity) || 0;
                        const shift = op.finishedShift || op.scheduledShift || 'Manhã';
                        const reactorName = reactorLines.find(r => r.id === op.lineId)?.name;
                        const doneAt = op.completedAt ? new Date(op.completedAt) : null;
                        return (
                          <button
                            type="button"
                            key={op.id}
                            onClick={() => setHistoryOp(op)}
                            title="Ver detalhes da manipulação"
                            className="text-left bg-[#141418] border border-[#27272a] hover:border-cyan-700/60 hover:bg-[#17171d] rounded-xl p-4 flex items-center justify-between gap-3 transition-all"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono font-bold text-sm text-white">{op.number}</span>
                                <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${shift === 'Manhã' ? 'bg-blue-950/60 text-blue-300 border-blue-800/40' : 'bg-amber-950/60 text-amber-300 border-amber-800/40'}`}>
                                  {shift}
                                </span>
                                {op.industria && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${getIndustriaBadgeClass(op.industria)}`}>{op.industria}</span>
                                )}
                              </div>
                              <div className="text-xs text-[#a1a1aa] truncate max-w-[200px] mt-0.5">{op.product}</div>
                              <div className="text-[10px] text-[#71717a] mt-0.5">
                                {reactorName && <span className="text-cyan-500/80">{reactorName} · </span>}
                                {doneAt ? `${doneAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${doneAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—'}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`font-mono font-black text-sm ${finishedKg > 0 ? 'text-emerald-400' : 'text-[#52525b]'}`}>
                                {finishedKg.toLocaleString('pt-BR')} Kg
                              </div>
                              <div className="text-[10px] text-[#a1a1aa] flex items-center gap-1 justify-end mt-1">
                                <History className="w-3 h-3" /> Detalhes
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {doneFiltered.length > doneLimit && (
                      <div className="text-center">
                        <button type="button" onClick={() => setDoneLimit(l => l + 30)}
                          className="h-9 px-4 rounded-lg bg-[#16161e] border border-[#26262f] text-xs font-bold text-[#d4d4d8] hover:text-white">
                          Mostrar mais ({doneFiltered.length - doneLimit} restantes)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* MODAL: ENCERRAR EXPEDIENTE DOS REATORES */}
      <Dialog open={isEndShiftOpen} onOpenChange={setIsEndShiftOpen}>
        <DialogContent className="bg-[#131318] border-[#272733] text-[#f4f4f5] max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wider text-sm font-black text-rose-300 flex items-center gap-2">
              <Sunset className="w-5 h-5" />
              Encerrar Expediente — Reatores
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <p className="text-sm text-[#d4d4d8]">
              Encerra o expediente dos 3 reatores. A partir de agora, o tempo parado não conta mais como ociosidade.
            </p>
            {manipulacaoOps.some(op => op.status === 'in_progress') && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-lg px-3 py-2">
                Há manipulação em processo — ela será pausada com o motivo "Fim de Expediente".
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsEndShiftOpen(false)} className="border-[#2c2c3c] hover:bg-[#1f1f2a] text-[#a1a1aa] rounded-xl text-xs font-bold">
              Voltar
            </Button>
            <Button onClick={handleEndShift} disabled={isShiftBusy} className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-wider">
              {isShiftBusy ? 'Encerrando...' : 'Encerrar Expediente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: PAUSAR OP */}
      <Dialog open={!!pausingOp} onOpenChange={(open) => !open && setPausingOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400 mb-2">
              <Pause className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              Pausar OP {pausingOp?.number}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">Selecione o motivo da parada desta manipulação.</p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                Motivo da Parada *
              </Label>
              <Select onValueChange={setPauseReason} value={pauseReason}>
                <SelectTrigger className="bg-[#121215] border-[#27272a] rounded-xl h-11 text-xs font-medium">
                  <SelectValue placeholder="Escolha o motivo da pausa..." />
                </SelectTrigger>
                <SelectContent className="bg-[#121215] border-[#27272a] text-[#f4f4f5] max-h-60">
                  {MANIPULACAO_PAUSE_REASONS.map(r => (
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
                Observação (Opcional)
              </Label>
              <Input
                value={pauseObs}
                onChange={(e) => setPauseObs(e.target.value)}
                placeholder="Ex: Aguardando liberação do técnico..."
                className="bg-[#121215] border-[#27272a] rounded-xl text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-1 gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPausingOp(null)}
              disabled={isPauseSubmitting}
              className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto"
            >
              Voltar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPause}
              disabled={isPauseSubmitting || !pauseReason}
              className="h-10 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg shadow-amber-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              {isPauseSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Pausando...</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Confirmar Pausa</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE FINALIZAÇÃO E ESCOLHA DE TURNO */}
      <Dialog open={!!finishingOp} onOpenChange={(open) => !open && setFinishingOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 mb-2">
              <FlaskConical className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              {finishMode === 'manip' ? 'Finalizar manipulação' : 'Finalizar drenagem'} · OP {finishingOp?.number}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              {finishMode === 'manip'
                ? 'Informe o Kg manipulado. O reator passa para "Aguardando amostragem".'
                : 'Confirme o Kg drenado e o turno. A OP é concluída e o reator entra em setup.'}
            </p>
          </DialogHeader>

          {finishingOp && (
            <form onSubmit={handleConfirmFinish} className="space-y-4 mt-2">
              {/* Produto */}
              <div className="bg-[#121215] border border-[#27272a] rounded-xl p-3">
                <div className="text-[11px] text-[#a1a1aa]">Produto / Granel</div>
                <div className="text-xs font-bold text-white mt-0.5">{finishingOp.product}</div>
              </div>

              {/* Quantidade em Kg */}
              <div>
                <Label className="text-xs font-semibold text-[#d4d4d8]">
                  {finishMode === 'manip' ? 'Quantidade manipulada (Kg)' : 'Quantidade final (Kg)'} <span className="text-cyan-400">*</span>
                </Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={finalKg}
                  onChange={(e) => setFinalKg(e.target.value)}
                  required
                  autoFocus
                  className="mt-1 bg-[#121215] border-[#27272a] focus:border-cyan-500 text-white font-mono text-sm h-10 rounded-xl"
                />
              </div>

              {/* Seleção de Turno: Manhã ou Tarde (só ao encerrar a OP) */}
              <div className={finishMode === 'manip' ? 'hidden' : ''}>
                <Label className="text-xs font-semibold text-[#d4d4d8] mb-2 block">
                  Turno de Conclusão <span className="text-cyan-400">*</span>
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedShift('Manhã')}
                    className={`p-3 rounded-xl border text-center flex flex-col items-center justify-center gap-1.5 transition-all ${
                      selectedShift === 'Manhã'
                        ? 'bg-blue-950/80 border-blue-500 text-blue-200 ring-2 ring-blue-500/30'
                        : 'bg-[#121215] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                    }`}
                  >
                    <Sun className={`w-5 h-5 ${selectedShift === 'Manhã' ? 'text-blue-400' : 'text-[#71717a]'}`} />
                    <span className="text-xs font-bold">Turno Manhã</span>
                    <span className="text-[10px] opacity-70">Até as 12h</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedShift('Tarde')}
                    className={`p-3 rounded-xl border text-center flex flex-col items-center justify-center gap-1.5 transition-all ${
                      selectedShift === 'Tarde'
                        ? 'bg-amber-950/80 border-amber-500 text-amber-200 ring-2 ring-amber-500/30'
                        : 'bg-[#121215] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                    }`}
                  >
                    <Moon className={`w-5 h-5 ${selectedShift === 'Tarde' ? 'text-amber-400' : 'text-[#71717a]'}`} />
                    <span className="text-xs font-bold">Turno Tarde</span>
                    <span className="text-[10px] opacity-70">Após as 12h</span>
                  </button>
                </div>
              </div>

              <DialogFooter className="pt-3 gap-2 flex-col sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFinishingOp(null)}
                  disabled={isFinishingSubmitting}
                  className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto"
                >
                  Cancelar
                </Button>

                <Button
                  type="submit"
                  disabled={isFinishingSubmitting}
                  className="h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
                >
                  {isFinishingSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Concluindo...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{finishMode === 'manip' ? 'Finalizar manipulação' : 'Concluir OP'}</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: HISTÓRICO DA OP */}
      <Dialog open={!!historyOp} onOpenChange={(open) => !open && setHistoryOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-lg w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-cyan-400" />
              Manipulação · OP {historyOp?.number}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              {historyOp?.product} · {reactorLines.find(r => r.id === historyOp?.lineId)?.name || '—'}
            </p>
          </DialogHeader>
          {historyOp && (() => {
            const st = computeStages(historyOp);
            const conf = conferenciaFor(historyOp);
            const kg = Number(historyOp.producedQuantity) || 0;
            const planned = Number(historyOp.plannedQuantity) || 0;
            const hm = (ms: number | null) => (ms ? `${new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—');
            const cell = (label: string, value: React.ReactNode, tone = 'text-white') => (
              <div className="bg-[#121215] border border-[#27272a] rounded-lg px-2.5 py-2">
                <div className="text-[9px] uppercase font-bold text-[#71717a]">{label}</div>
                <div className={`text-xs font-bold font-mono ${tone}`}>{value}</div>
              </div>
            );
            return (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {cell('Kg final', `${kg.toLocaleString('pt-BR')} kg`, kg > 0 ? 'text-emerald-400' : 'text-[#71717a]')}
                  {cell('Planejado', planned > 0 ? `${planned.toLocaleString('pt-BR')} kg` : '—')}
                  {cell('Lote', historyOp.lote || '—')}
                  {cell('Início', hm(st.first))}
                  {cell('Fim', hm(st.last))}
                  {cell('Duração total', st.first && st.last ? fmtMs(st.last - st.first) : '—')}
                </div>
                <div className={`grid gap-1.5 ${st.coolMs > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
                  {cell('Manipulação', fmtMs(st.manipMs), 'text-cyan-300')}
                  {st.coolMs > 0 && cell('Resfriamento', fmtMs(st.coolMs), 'text-blue-300')}
                  {cell('Análise / CQ', fmtMs(st.cqMs), 'text-sky-300')}
                  {cell('Drenagem', fmtMs(st.drainMs), 'text-teal-300')}
                  {cell('Pausas', fmtMs(st.pauseMs), 'text-amber-300')}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="px-2 py-0.5 rounded-md bg-[#121215] border border-[#27272a] text-[#d4d4d8]">Amostras: <strong>{st.samples || '—'}</strong>{st.rejected > 0 && <span className="text-orange-300"> · {st.rejected} reprovada(s)</span>}</span>
                  <span className="px-2 py-0.5 rounded-md bg-[#121215] border border-[#27272a] text-[#d4d4d8]">Turno: <strong>{historyOp.finishedShift || historyOp.scheduledShift || '—'}</strong></span>
                  {historyOp.industria && <span className="px-2 py-0.5 rounded-md bg-[#121215] border border-[#27272a] text-[#d4d4d8]">Indústria: <strong>{historyOp.industria}</strong></span>}
                  <span className="px-2 py-0.5 rounded-md bg-[#121215] border border-[#27272a] text-[#d4d4d8]">Conferida: <strong>{conf ? `${conf.conferidoNome || '—'} · ${new Date(conf.conferidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'não registrada'}</strong></span>
                </div>
                {!st.first && (
                  <p className="text-[11px] text-[#71717a]">OSM sem registros de início/fim no app (ex.: importada do histórico) — só os dados do cadastro estão disponíveis.</p>
                )}
                <div className="text-[10px] uppercase font-bold text-[#71717a] pt-1">Linha do tempo</div>
              </div>
            );
          })()}
          {historyOp && (() => {
            const rows = buildHistory(historyOp);
            if (rows.length === 0) return <p className="text-xs text-[#71717a] py-6 text-center">Nenhum registro ainda.</p>;
            return (
              <div className="max-h-[60vh] overflow-y-auto pr-1 py-2">
                <ol className="relative border-l border-[#27272a] ml-2 space-y-3">
                  {rows.map((r, i) => (
                    <li key={i} className="ml-4">
                      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-[#3f3f46] border border-[#18181b]" />
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-[#a1a1aa] shrink-0">
                          {new Date(r.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {new Date(r.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`text-xs font-semibold ${r.tone}`}>{r.text}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHistoryOp(null)} className="h-9 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: CANCELAR OP DE MANIPULAÇÃO */}
      <Dialog open={!!cancellingOp} onOpenChange={(open) => !open && setCancellingOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Cancelar Início da Manipulação
            </DialogTitle>
          </DialogHeader>

          {cancellingOp && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-[#d4d4d8]">
                A OP <strong className="text-white">{cancellingOp.number}</strong> foi iniciada por engano?
              </p>
              <p className="text-xs text-[#a1a1aa]">
                Ela volta para "Pronta pra Iniciar" no mesmo lugar da fila deste reator, como se nunca tivesse sido iniciada — o horário de início registrado por engano não entra nos indicadores. Nada é excluído.
              </p>
            </div>
          )}

          <DialogFooter className="pt-1 gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancellingOp(null)}
              disabled={isCancellingSubmitting}
              className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto"
            >
              Voltar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmCancel}
              disabled={isCancellingSubmitting}
              className="h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              {isCancellingSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Cancelando...</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Sim, Cancelar Início</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
