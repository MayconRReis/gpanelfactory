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
  getRecentEvents,
  cancelOP,
  logPesagemHistory,
} from '../services/db';
import { ProductionOrder, ProductionLine, PauseReason, WorkSession, ProductionEvent } from '../types';
import { ManipulacaoDashboard } from '../components/ManipulacaoDashboard';
import { getIndustriaBadgeClass } from '../lib/industria';
import { getAutoShiftNow } from '../lib/productionTime';

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

      const [allOps, allLines, allSessions, allEvents] = await Promise.all([getAllOPs(), getLines(), getWorkSessions(3), getRecentEvents()]);

      // Uma chamada mais nova já assumiu — descarta esta resposta desatualizada.
      if (requestId !== fetchRequestIdRef.current) return;

      setOps(allOps);
      setWorkSessions(allSessions);
      setEvents(allEvents);
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
  const reactorState = useMemo(() => {
    const map: Record<string, { activeOp: ProductionOrder | null; queuedOps: ProductionOrder[] }> = {};
    reactorLines.forEach(reactor => {
      const reactorOps = manipulacaoOps.filter(op => op.lineId === reactor.id && op.status !== 'completed');
      const inProgress = reactorOps.find(o => o.status === 'in_progress');
      const paused = !inProgress ? reactorOps.find(o => o.status === 'paused') : undefined;
      const pendingSorted = reactorOps
        .filter(o => o.status === 'pending')
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      const activeOp = inProgress || paused || pendingSorted[0] || null;
      const queuedOps = pendingSorted.filter(o => o.id !== activeOp?.id);
      map[reactor.id] = { activeOp, queuedOps };
    });
    return map;
  }, [reactorLines, manipulacaoOps]);

  // OPs de Manipulação em andamento/pausadas em reatores que não existem
  // mais na lista atual de `lines` (ex.: linha renomeada/removida) — só pra
  // não sumirem silenciosamente da tela.
  const orphanOps = useMemo(
    () => manipulacaoOps.filter(op => op.status !== 'completed' && (!op.lineId || !reactorLines.some(r => r.id === op.lineId))),
    [manipulacaoOps, reactorLines]
  );

  // OSMs de Manipulação Concluídas
  const completedManipulacaoOps = useMemo(() => {
    return manipulacaoOps
      .filter(op => op.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime());
  }, [manipulacaoOps]);

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

  // Expediente automático: reator com OP no dia começa às 7h sozinho e
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
    // automático (sem registro): grava o trecho 7h → agora já encerrado.
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

  const handleOpenFinishModal = (op: ProductionOrder) => {
    setFinishingOp(op);
    setFinalKg('');
    setSelectedShift(detectedShift);
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
      await finishOP(finishingOp.id, finishingOp.lineId, profile.uid, selectedShift, kgNum);

      showToast(`OP ${finishingOp.number} finalizada no turno da ${selectedShift}!`, 'success');
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
  const renderActiveCard = (op: ProductionOrder) => {
    const isBusy = actionBusyOpId === op.id;
    // Horário real de início = 1º evento STARTED da OP. Antes caía no horário
    // em que a OP foi CRIADA (quando entrou na fila do reator), mostrando um
    // "Início" que nunca aconteceu.
    // (desconsidera inícios que foram cancelados por engano)
    const lastCancelMs = events
      .filter(e => e.opId === op.id && e.type === 'CANCELLED')
      .reduce((max, e) => Math.max(max, new Date(e.createdAt).getTime()), -Infinity);
    const startEvents = events.filter(e => e.opId === op.id && e.type === 'STARTED' && new Date(e.createdAt).getTime() > lastCancelMs);
    const firstStart = startEvents.length > 0
      ? startEvents.reduce((a, b) => (new Date(a.createdAt).getTime() < new Date(b.createdAt).getTime() ? a : b)).createdAt
      : null;
    const formattedTime = firstStart
      ? new Date(firstStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '--:--';

    return (
      <div
        className={`rounded-2xl p-4 flex flex-col gap-3 transition-all border-2 ${
          op.status === 'in_progress'
            ? 'bg-[#18181b] border-cyan-500/50 shadow-lg shadow-cyan-950/20'
            : op.status === 'paused'
            ? 'bg-[#18181b] border-amber-500/50 shadow-lg shadow-amber-950/20'
            : 'bg-[#18181b] border-[#27272a]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {op.industria && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg font-sans shadow-sm border ${getIndustriaBadgeClass(op.industria)}`}>
                {op.industria}
              </span>
            )}
            {op.status === 'in_progress' ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-cyan-950/90 text-cyan-300 border border-cyan-800/60 flex items-center gap-1 shadow-sm">
                <FlaskConical className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span>Em Processo</span>
              </span>
            ) : op.status === 'paused' ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-950/90 text-amber-300 border border-amber-800/60 flex items-center gap-1 shadow-sm">
                <Pause className="w-3 h-3 text-amber-400" />
                <span>Pausada</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-[#1a1a22] text-[#a1a1aa] border border-[#2c2c3c] flex items-center gap-1 shadow-sm">
                <Clock className="w-3 h-3" />
                <span>Pronta pra Iniciar</span>
              </span>
            )}
          </div>
          {/* Cancelar início: só pra OP já iniciada (em processo/pausada) e sem Kg apontado */}
          {(op.status === 'in_progress' || op.status === 'paused') && !(Number(op.producedQuantity) > 0) && (
            <Button
              onClick={() => setCancellingOp(op)}
              title="Cancelar início (iniciada por engano)"
              className="h-7 w-7 shrink-0 rounded-lg bg-transparent hover:bg-rose-950/30 text-rose-400/70 hover:text-rose-300 border border-rose-500/20 flex items-center justify-center transition-all p-0"
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          )}
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

        <div className="flex items-center gap-2">
          {op.status === 'pending' && (
            <Button
              onClick={() => handleStart(op)}
              disabled={isBusy}
              className="flex-1 h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-950/40 flex items-center justify-center gap-2 transition-all transform active:scale-95"
            >
              {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              <span>Iniciar Manipulação</span>
            </Button>
          )}
          {op.status === 'in_progress' && (
            <>
              <Button
                onClick={() => handleOpenPauseModal(op)}
                disabled={isBusy}
                className="h-10 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-md shadow-amber-950/40 flex items-center justify-center gap-1.5 transition-all"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pausar</span>
              </Button>
              <Button
                onClick={() => handleOpenFinishModal(op)}
                disabled={isBusy}
                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950/40 flex items-center justify-center gap-2 transition-all transform active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Finalizar</span>
              </Button>
            </>
          )}
          {op.status === 'paused' && (
            <>
              <Button
                onClick={() => handleResume(op)}
                disabled={isBusy}
                className="h-10 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-950/40 flex items-center justify-center gap-1.5 transition-all"
              >
                {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Retomar</span>
              </Button>
              <Button
                onClick={() => handleOpenFinishModal(op)}
                disabled={isBusy}
                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950/40 flex items-center justify-center gap-2 transition-all transform active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Finalizar</span>
              </Button>
            </>
          )}
        </div>
      </div>
    );
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
                <span className="font-black text-lg tracking-tight text-white truncate">GPanel Factory</span>
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
                diária & semanal
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* CORPO PRINCIPAL */}
      <main className={`flex-1 w-full mx-auto flex flex-col gap-8 ${embedded ? 'p-0 max-w-full' : 'max-w-6xl p-4 sm:p-6 lg:p-8'}`}>
        {activeViewTab === 'dashboard' ? (
          <ManipulacaoDashboard
            ops={ops}
            onRefresh={() => fetchData(true)}
            isRefreshing={isRefreshing}
          />
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
                      title="O expediente começa sozinho às 7h nos reatores com OP no dia. Use este botão para começar antes (hora extra) ou para reabrir depois de encerrar."
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
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                  {reactorLines.map((reactor) => {
                    const { activeOp, queuedOps } = reactorState[reactor.id] || { activeOp: null, queuedOps: [] };
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

            {/* HISTÓRICO DE OPS FINALIZADAS NA MANIPULAÇÃO */}
            {completedManipulacaoOps.length > 0 && (
              <section className="space-y-4 pt-4 border-t border-[#27272a]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">OPs Finalizadas na Manipulação</h3>
                  </div>
                  <span className="text-xs text-[#a1a1aa] font-mono">
                    {completedManipulacaoOps.length} concluídas
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {completedManipulacaoOps.map((op) => {
                    const finishedKg = Number(op.producedQuantity) || 0;
                    const shift = op.finishedShift || op.scheduledShift || 'Manhã';
                    const reactorName = reactorLines.find(r => r.id === op.lineId)?.name;

                    return (
                      <div
                        key={op.id}
                        className="bg-[#141418] border border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-sm text-white">{op.number}</span>
                            <span
                              className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${
                                shift === 'Manhã'
                                  ? 'bg-blue-950/60 text-blue-300 border-blue-800/40'
                                  : 'bg-amber-950/60 text-amber-300 border-amber-800/40'
                              }`}
                            >
                              {shift}
                            </span>
                            {op.industria && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${getIndustriaBadgeClass(op.industria)}`}>
                                {op.industria}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#a1a1aa] truncate max-w-[180px] mt-0.5">
                            {op.product}
                          </div>
                          {reactorName && (
                            <div className="text-[10px] text-cyan-500/80 mt-0.5">{reactorName}</div>
                          )}
                        </div>

                        <div className="text-right">
                          <div className="font-mono font-black text-sm text-emerald-400">
                            {finishedKg.toLocaleString('pt-BR')} Kg
                          </div>
                          <div className="text-[10px] text-emerald-500 flex items-center gap-1 justify-end font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Concluído</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              Finalizar OP {finishingOp?.number}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              Confirme a quantidade de granel manipulada e selecione o turno de encerramento.
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
                  Quantidade Manipulada Final (Kg) <span className="text-cyan-400">*</span>
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

              {/* Seleção de Turno: Manhã ou Tarde */}
              <div>
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
                      <span>Confirmar Finalização</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
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
