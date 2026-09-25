import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
  Scale,
  Plus,
  LogOut,
  CheckCircle2,
  Clock,
  Boxes,
  RefreshCw,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  Package,
  Layers,
  Sparkles,
  BarChart3,
  TrendingUp,
  History,
  Building2,
  Tag,
  FileText,
  Hash,
  Pencil,
  Trash2
} from 'lucide-react';
import { getAllOPs, createOP, updateOP, deleteOP, getLines, getLeaders, getMonthlyGoals, getRecentEvents } from '../services/db';
import { ProductionOrder, ProductionLine, UserProfile, MonthlyGoal, ProductionEvent } from '../types';
import { DailyProductionHistory } from '../components/DailyProductionHistory';
import { getIndustriaBadgeClass, isManualExitEligible } from '../lib/industria';

interface PesagemScreenProps {
  embedded?: boolean;
  /** Usado pelo Simulador de Treinamento — esconde a aba "Histórico &
   * Gráficos", que não faz sentido sobre dados fictícios da simulação. */
  hideDashboardTabs?: boolean;
}

export function PesagemScreen({ embedded = false, hideDashboardTabs = false }: PesagemScreenProps = {}) {
  const { profile, signOut } = useAuthStore();

  const [activeViewTab, setActiveViewTab] = useState<'registro' | 'historico'>('registro');

  // Em modo treinamento (hideDashboardTabs) só existe a aba de registro —
  // garante que nunca fique "preso" na aba de histórico escondida.
  useEffect(() => {
    if (hideDashboardTabs && activeViewTab !== 'registro') {
      setActiveViewTab('registro');
    }
  }, [hideDashboardTabs, activeViewTab]);
  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modal Nova Ordem de Serviço (OSM) ou Edição
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<ProductionOrder | null>(null);
  const [deleteModalOp, setDeleteModalOp] = useState<ProductionOrder | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [osmDate, setOsmDate] = useState(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [industria, setIndustria] = useState<'Ybera' | 'Carvalho' | 'Macpaul'>('Ybera');
  const [osmNumber, setOsmNumber] = useState('');
  const [productName, setProductName] = useState('');
  const [batchLot, setBatchLot] = useState('');
  const [observation, setObservation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de "Saída Manual" — exclusivo para OSMs de indústrias que raramente
  // passam pela Manipulação da Ybera (Carvalho / Macpaul). Permite ao líder
  // de Pesagem encerrar a OSM diretamente, sem depender de alguém iniciar e
  // finalizar a manipulação.
  const [manualExitOp, setManualExitOp] = useState<ProductionOrder | null>(null);
  const [manualExitDate, setManualExitDate] = useState('');
  const [isManualExitSubmitting, setIsManualExitSubmitting] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

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

      const [allOps, allLines, allLeaders, allGoals, allEvents] = await Promise.all([
        getAllOPs(),
        getLines(),
        getLeaders(),
        getMonthlyGoals(new Date().getFullYear()),
        getRecentEvents(),
      ]);

      // Uma chamada mais nova já assumiu — descarta esta resposta desatualizada.
      if (requestId !== fetchRequestIdRef.current) return;

      setOps(allOps);
      setLines(allLines);
      setLeaders(allLeaders);
      setGoals(allGoals);
      setEvents(allEvents);
    } catch (err) {
      console.error('Erro ao carregar dados de pesagem:', err);
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
      .channel('pesagem-realtime-' + profile.uid)
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

  // Filtrar OSMs de Pesagem registradas hoje pelo líder (ou do setor Pesagem de hoje)
  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Função auxiliar: uma OSM "é de hoje" se a data agendada ou a data de
  // criação baterem com o dia local atual.
  const isOpFromToday = useCallback((op: ProductionOrder, referenceDateStr?: string) => {
    if (op.scheduledDate === todayStr) return true;
    const dateToCheck = referenceDateStr || op.createdAt;
    if (!dateToCheck) return false;
    const d = new Date(dateToCheck);
    if (isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}` === todayStr;
  }, [todayStr]);

  // Conjunto de números/lotes de OSM que já foram encaminhados adiante —
  // seja pelo fluxo normal (Manipulação inicia a partir da OSM de Pesagem)
  // seja por Saída Manual (que também cria sua própria linha com
  // setor 'Manipulação', ver handleConfirmManualExit). Mesma lógica já usada
  // na tela de Manipulação (availablePesagemOps) — serve pra saber quando uma
  // OSM de Pesagem deixou de estar pendente.
  const manipulatedOsmNumbers = useMemo(() => {
    const set = new Set<string>();
    ops.forEach(op => {
      if (op.setor === 'Manipulação') {
        if (op.number) set.add(op.number);
        if (op.lote) set.add(op.lote);
      }
    });
    return set;
  }, [ops]);

  // Estoque/fila de Pesagem: TODAS as OSMs ainda pendentes (setor 'Pesagem',
  // sem uma OSM de Manipulação correspondente ainda), independente do dia em
  // que foram registradas.
  //
  // Bug corrigido: antes essa lista só mostrava as OSMs de HOJE
  // (isOpFromToday) — assim que o dia virava, uma OSM que ainda não tinha
  // sido levada adiante pela Manipulação (nem tinha recebido Saída Manual)
  // simplesmente sumia da tela, e o líder de Pesagem perdia o acesso pra
  // editar, excluir ou dar Saída Manual nela. Agora ela só sai da lista
  // quando de fato deixa de estar pendente — vira um estoque de verdade, não
  // um registro "só de hoje".
  const pesagemQueueOps = useMemo(() => {
    return ops.filter(op => {
      // OPs importadas do histórico (id "imp-...") nunca devem virar backlog
      // "pendente pra sempre": o número/lote delas quase nunca bate com o de
      // uma OSM de Manipulação histórica (a importação leu as duas abas da
      // planilha separadamente, com granularidade diferente), então ficariam
      // acumuladas aqui como se estivessem pendentes, sem nunca ter estado de
      // verdade. Mesma regra já usada na tela de Manipulação.
      if (op.id && op.id.startsWith('imp-')) return false;

      // Uma OSM só deve continuar aparecendo na lista principal da Pesagem
      // enquanto o setor dela ainda for 'Pesagem' (ou não tiver setor
      // definido, para compatibilidade com registros antigos que não tinham
      // essa coluna preenchida).
      //
      // Bug corrigido antes deste: `op.tipoDocumento === 'OSM'` sozinho já
      // era suficiente para passar nesse filtro — só que a OSM criada na
      // Manipulação (ao iniciar/finalizar) também nasce com
      // tipoDocumento 'OSM' (só o setor muda para 'Manipulação'). Então,
      // sempre que o leaderId dessa nova linha batesse com o usuário logado
      // na tela de Pesagem (ex.: mesma conta usada para mais de um setor),
      // a OSM finalizada na Manipulação reaparecia AQUI TAMBÉM, duplicando
      // o número da OSM na tela. Agora, uma vez que o setor muda para
      // 'Manipulação' (ou qualquer outro que não seja 'Pesagem'), a OSM
      // nunca mais volta a aparecer na lista principal — ela some daqui e
      // passa a aparecer apenas no "Mini Histórico" de finalizadas, abaixo.
      const isPesagemSetor = op.setor === 'Pesagem';
      const isLegacyOsmSemSetor = !op.setor && op.tipoDocumento === 'OSM';
      if (!isPesagemSetor && !isLegacyOsmSemSetor) return false;

      if (isPesagemSetor) {
        // Já foi encaminhada adiante (Manipulação iniciou, ou já recebeu
        // Saída Manual)? Se sim, não é mais pendente — sai da fila.
        return !manipulatedOsmNumbers.has(op.number) && !manipulatedOsmNumbers.has(op.lote || '');
      }

      // Registro antigo sem setor: mantém a regra anterior (mostra se foi
      // criado pelo próprio líder logado, ou sem líder definido) — e continua
      // restrito ao dia, já que esse formato legado nunca teve "setor" pra
      // marcar quando foi encaminhado, então não dá pra saber com segurança
      // se ainda está pendente ou já foi resolvido há muito tempo.
      const matchesLeader = !op.leaderId || op.leaderId === profile?.uid;
      return matchesLeader && isOpFromToday(op);
    }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [ops, manipulatedOsmNumbers, isOpFromToday, profile]);

  // Mini Histórico: OSMs registradas pela Pesagem que já foram finalizadas —
  // seja pela Manipulação (fluxo normal) ou por "saída manual" dada pelo
  // próprio líder de Pesagem (ver handleManualExit). É aqui que uma OSM
  // "some" da lista principal para reaparecer de forma compacta, sem
  // duplicar o card original.
  const finishedTodayOps = useMemo(() => {
    return ops.filter(op => {
      if (op.setor !== 'Manipulação' || op.status !== 'completed') return false;
      const refDate = op.completedAt || op.scheduledDate || op.createdAt;
      return isOpFromToday(op, refDate);
    }).sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime());
  }, [ops, isOpFromToday]);

  // Total em estoque — quantas OSMs de Pesagem estão pendentes agora,
  // registradas hoje ou em dias anteriores.
  const totalOsmsEstoque = useMemo(() => {
    return pesagemQueueOps.length;
  }, [pesagemQueueOps]);

  // Criar nova Ordem de Produção / OSM
  const handleOpenModal = () => {
    setEditingOp(null);
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setOsmDate(`${year}-${month}-${day}`);
    setIndustria('Ybera');
    setOsmNumber('');
    setProductName('');
    setBatchLot('');
    setObservation('');
    setIsModalOpen(true);
  };

  // Editar Ordem de Produção / OSM existente
  const handleOpenEditModal = (op: ProductionOrder) => {
    setEditingOp(op);
    const targetDate = op.scheduledDate || (op.createdAt ? op.createdAt.split('T')[0] : todayStr);
    setOsmDate(targetDate);
    setIndustria((op.industria as 'Ybera' | 'Carvalho' | 'Macpaul') || 'Ybera');
    setOsmNumber(op.number || '');
    setProductName(op.product || '');
    setBatchLot(op.lote || '');
    setObservation(op.granel || op.observation || '');
    setIsModalOpen(true);
  };

  // Abrir confirmação de exclusão
  const handleOpenDeleteModal = (op: ProductionOrder) => {
    setDeleteModalOp(op);
  };

  // Confirmar exclusão da OSM
  const handleConfirmDelete = async () => {
    if (!deleteModalOp) return;
    setIsDeleting(true);
    try {
      await deleteOP(deleteModalOp.id);
      showToast(`Ordem de Produção ${deleteModalOp.number} excluída com sucesso!`, 'success');
      setDeleteModalOp(null);
      await fetchData(true);
    } catch (err: any) {
      console.error('Erro ao excluir ordem:', err);
      showToast('Erro ao excluir a OSM. Tente novamente.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveOSM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const trimmedNumber = osmNumber.trim();
    const trimmedProduct = productName.trim();
    const trimmedLot = batchLot.trim();
    const targetDate = osmDate || todayStr;

    if (!targetDate) {
      showToast('Informe a Data.', 'error');
      return;
    }
    if (!trimmedNumber) {
      showToast('Informe a Ordem de Produção.', 'error');
      return;
    }
    if (!trimmedProduct) {
      showToast('Informe o Nome.', 'error');
      return;
    }
    if (!trimmedLot) {
      showToast('Informe o Lote.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingOp) {
        // Atualização da OSM existente — NÃO envia plannedQuantity/producedQuantity
        // aqui: a quantidade em Kg agora só é preenchida pelo líder de Manipulação
        // ao finalizar a OSM, então editar aqui não deve sobrescrever esse valor.
        await updateOP(editingOp.id, {
          number: trimmedNumber,
          product: trimmedProduct,
          lote: trimmedLot,
          scheduledDate: targetDate,
          // Sempre string (nunca undefined): se undefined, updateOP ignora o campo
          // e o valor antigo de "granel" permanece no banco — isso impedia limpar
          // a observação ao editar.
          granel: observation.trim(),
          industria: industria,
        });

        showToast(`Ordem de Produção ${trimmedNumber} atualizada com sucesso!`, 'success');
      } else {
        // Criação de nova OSM já como completed — pesagem conclui no ato do registro.
        // A quantidade em Kg fica zerada por enquanto: quem preenche o Kg
        // manipulado é o líder de Manipulação, ao finalizar a OSM.
        await createOP({
          tipoDocumento: 'OSM',
          setor: 'Pesagem',
          unidade: 'Kg',
          number: trimmedNumber,
          product: trimmedProduct,
          lote: trimmedLot,
          plannedQuantity: 0,
          producedQuantity: 0,
          status: 'completed',
          leaderId: profile.uid,
          priority: 'Normal',
          lineId: 'area-pesagem',
          scheduledShift: 'Manhã',
          scheduledDate: targetDate,
          granel: observation.trim() || undefined,
          industria: industria,
        });

        showToast(`Ordem de Produção ${trimmedNumber} registrada com sucesso!`, 'success');
      }

      setIsModalOpen(false);
      setEditingOp(null);
      await fetchData(true);
    } catch (err: any) {
      console.error('Erro ao salvar ordem:', err);
      showToast(editingOp ? 'Erro ao atualizar ordem. Tente novamente.' : 'Erro ao registrar ordem. Tente novamente.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Abrir modal de Saída Manual (Carvalho / Macpaul) — agora é só uma
  // confirmação: mostra os dados do produto e a data de saída (hoje, por
  // padrão), sem pedir Kg nem turno (o líder de Pesagem não tem essa
  // informação pra preencher, e não é mais necessária aqui).
  const handleOpenManualExit = (op: ProductionOrder) => {
    setManualExitOp(op);
    setManualExitDate(todayStr);
  };

  // Confirmar Saída Manual: cria diretamente a OSM de Manipulação já
  // finalizada (setor 'Manipulação', status 'completed'), pulando o passo de
  // iniciar/finalizar pela tela de Manipulação. Isso reaproveita o mesmo
  // formato de dado que o fluxo normal gera, então a OSM aparece
  // corretamente no Mini Histórico da Pesagem e em "OPs Finalizadas na
  // Manipulação" — deixando claro para os dois times que essa OSM já foi
  // encerrada, sem duplicar nada na lista principal da Pesagem.
  const handleConfirmManualExit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !manualExitOp) return;

    if (!manualExitDate) {
      showToast('Informe a data de saída.', 'error');
      return;
    }

    // Turno não é mais perguntado ao líder — detecta automaticamente pela
    // hora atual, só pra manter a OSM classificada nos relatórios por turno.
    const detectedShift: 'Manhã' | 'Tarde' = new Date().getHours() < 12 ? 'Manhã' : 'Tarde';

    setIsManualExitSubmitting(true);
    try {
      await createOP({
        tipoDocumento: 'OSM',
        setor: 'Manipulação',
        unidade: 'Kg',
        number: manualExitOp.number,
        product: manualExitOp.product,
        lote: manualExitOp.lote,
        plannedQuantity: manualExitOp.plannedQuantity || 0,
        producedQuantity: manualExitOp.producedQuantity || 0,
        status: 'completed',
        leaderId: profile.uid,
        priority: 'Normal',
        lineId: 'area-manipulacao',
        scheduledShift: detectedShift,
        scheduledDate: manualExitDate,
        industria: manualExitOp.industria,
        granel: manualExitOp.granel || manualExitOp.observation,
      });

      showToast(`Saída manual da OSM ${manualExitOp.number} registrada com sucesso!`, 'success');
      setManualExitOp(null);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao registrar saída manual:', err);
      showToast('Erro ao registrar saída manual.', 'error');
    } finally {
      setIsManualExitSubmitting(false);
    }
  };

  return (
    <div className={embedded ? "w-full text-[#f4f4f5] flex flex-col font-sans space-y-4" : "min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col font-sans selection:bg-purple-500/30"}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-3 ${
            toastMessage.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-800'
              : 'bg-purple-950/90 text-purple-200 border-purple-800'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* CABEÇALHO (Apenas se standalone) */}
      {!embedded && (
        <header className="bg-[#121216] border-b border-[#27272a] px-4 lg:px-8 py-3.5 sticky top-0 z-30 flex items-center justify-between gap-4">
          {/* Identificação da Aplicação e Área */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400 shadow-inner shrink-0">
              <Scale className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-black text-lg tracking-tight text-white truncate">GPanel Factory</span>
                <span className="hidden sm:flex text-[11px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-950/90 text-purple-300 border border-purple-700/60 shadow-sm items-center gap-1 shrink-0">
                  <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                  Área de Pesagem
                </span>
              </div>
              <p className="text-xs text-[#a1a1aa] flex items-center gap-2 truncate">
                <span>Turno Único (Manhã)</span>
              </p>
            </div>
          </div>

          {/* Informações do Líder e Ações */}
          <div className="flex items-center gap-3">
            {/* Relógio em tempo real */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18181b] border border-[#27272a] text-xs text-[#d4d4d8] font-mono">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>{currentTime.toLocaleTimeString('pt-BR')}</span>
            </div>

            {/* Dados do Usuário */}
            <div className="text-right hidden md:block">
              <div className="text-xs font-bold text-white flex items-center justify-end gap-1.5">
                <span>{profile?.name || 'Líder de Pesagem'}</span>
              </div>
              <div className="text-[11px] text-[#a1a1aa]">{profile?.cargo || 'Líder de Pesagem'}</div>
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
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
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

      {/* BARRA DE NAVEGAÇÃO DE ABAS */}
      <div className={`bg-[#121216]/95 border border-[#27272a] px-4 lg:px-6 py-2.5 z-20 backdrop-blur-md ${embedded ? 'rounded-2xl shadow-md' : 'sticky top-[65px] border-b'}`}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveViewTab('registro')}
              className={`w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === 'registro'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>Registro de OPs</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                activeViewTab === 'registro'
                  ? 'bg-purple-800 text-white'
                  : 'bg-[#27272a] text-[#a1a1aa]'
              }`}>
                {pesagemQueueOps.length}
              </span>
            </button>

            {!hideDashboardTabs && (
              <button
                type="button"
                onClick={() => setActiveViewTab('historico')}
                className={`w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                  activeViewTab === 'historico'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
                    : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
                }`}
              >
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span>Histórico & Gráficos</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans lowercase font-bold ${
                  activeViewTab === 'historico'
                    ? 'bg-purple-800 text-purple-200'
                    : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/40'
                }`}>
                  diário & mensal
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 text-xs shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-[#27272a]/60">
            <span className="text-[#71717a]">Em estoque na Pesagem:</span>
            <span className="font-mono font-bold text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-800/40 whitespace-nowrap">
              {totalOsmsEstoque.toLocaleString('pt-BR')} OP{totalOsmsEstoque !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* CORPO PRINCIPAL */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        {activeViewTab === 'historico' ? (
          <div className="space-y-6">
            <DailyProductionHistory
              ops={ops}
              lines={lines}
              leaders={leaders}
              goals={goals}
              events={events}
              defaultSectorFilter="Pesagem"
              defaultDailyChartMode="osms"
              pesagemOnly={true}
            />
          </div>
        ) : (
          <>
            {/* Barra Superior da Seção: Título e Botão de Ação */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-[#141418] border border-[#27272a] p-4 sm:p-5 rounded-2xl shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-5 h-5 text-purple-400 shrink-0" />
                  <h1 className="text-base sm:text-xl font-bold text-white tracking-tight">Estoque de OPs de Pesagem</h1>
                </div>
                <p className="text-xs text-[#a1a1aa] mt-1 line-clamp-2 sm:line-clamp-none">
                  Registre as bateladas pesadas de granel para disponibilização à equipe de Manipulação. OPs pendentes ficam aqui até serem encaminhadas, mesmo de dias anteriores.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto shrink-0">
                <Button
                  variant="outline"
                  onClick={() => setActiveViewTab('historico')}
                  className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border-[#27272a] bg-[#18181b] hover:bg-[#27272a] text-purple-300 hover:text-white text-xs font-bold flex items-center justify-center gap-2 w-full sm:w-auto whitespace-nowrap cursor-pointer"
                >
                  <BarChart3 className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Ver Histórico & Gráficos</span>
                </Button>

                <Button
                  onClick={handleOpenModal}
                  className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-purple-950/40 flex items-center justify-center gap-2 w-full sm:w-auto whitespace-nowrap transition-all transform active:scale-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5] shrink-0" />
                  <span>Nova OP</span>
                </Button>
              </div>
            </div>

            {/* LISTAGEM DE OPS REGISTRADAS */}
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-[#a1a1aa]">
                <RefreshCw className="w-8 h-8 text-purple-500 animate-spin mb-3" />
                <span className="text-xs font-bold uppercase tracking-wider">Carregando ordens de pesagem...</span>
              </div>
            ) : pesagemQueueOps.length === 0 ? (
              <div className="bg-[#18181b] border border-[#27272a] border-dashed rounded-2xl p-12 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-800/40 flex items-center justify-center text-purple-400 mb-4">
                  <Scale className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">Nenhuma OP em estoque</h3>
                <p className="text-xs text-[#a1a1aa] max-w-md mb-6">
                  Inicie os registros do turno clicando no botão abaixo para adicionar as bateladas pesadas.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleOpenModal}
                    className="h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    <span>Registrar Primeira OP</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveViewTab('historico')}
                    className="h-10 px-4 rounded-xl border-[#27272a] bg-[#18181b] text-purple-300 hover:text-white text-xs font-semibold flex items-center gap-2"
                  >
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                    <span>Acessar Histórico</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pesagemQueueOps.map((op) => {
                  const opDate = op.createdAt ? new Date(op.createdAt) : null;
                  const isFromToday = isOpFromToday(op);
                  // Enquanto for de hoje, mostra só o horário (como antes). Uma
                  // vez que vira "estoque" de dia anterior, mostra a data junto
                  // — o líder precisa saber há quanto tempo essa OP está
                  // parada, já que agora ela não some mais sozinha.
                  const formattedTime = opDate
                    ? isFromToday
                      ? opDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : `${opDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${opDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : '--:--';

                  return (
                    <div
                      key={op.id}
                      id={`osm-card-${op.id}`}
                      className="bg-[#18181b] border border-[#27272a] hover:border-purple-800/60 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all hover:shadow-xl hover:shadow-purple-950/10 group"
                    >
                      {/* Linha 1: Badges à esquerda + Ações (Editar/Excluir) à direita */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {op.industria && (
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg font-sans shadow-sm border ${getIndustriaBadgeClass(op.industria)}`}>
                              {op.industria}
                            </span>
                          )}
                          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 flex items-center gap-1.5 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Registrado</span>
                          </span>
                          {!isFromToday && (
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-950/70 text-amber-300 border border-amber-800/50 flex items-center gap-1.5 shadow-sm">
                              <Calendar className="w-3 h-3" />
                              <span>Desde {opDate ? opDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '--/--'}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            id={`btn-edit-op-${op.id}`}
                            onClick={() => handleOpenEditModal(op)}
                            className="p-2 rounded-xl bg-[#27272a]/60 hover:bg-purple-950 text-[#a1a1aa] hover:text-purple-300 border border-[#3f3f46]/40 hover:border-purple-700/60 transition-all cursor-pointer shadow-sm"
                            title="Editar OP"
                            aria-label="Editar OP"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            id={`btn-delete-op-${op.id}`}
                            onClick={() => handleOpenDeleteModal(op)}
                            className="p-2 rounded-xl bg-[#27272a]/60 hover:bg-rose-950 text-[#a1a1aa] hover:text-rose-400 border border-[#3f3f46]/40 hover:border-rose-700/60 transition-all cursor-pointer shadow-sm"
                            title="Excluir OP"
                            aria-label="Excluir OP"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Linha 2: Número da OP (esquerda) + Badge Lote (direita) */}
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-mono text-2xl font-black text-white group-hover:text-purple-300 transition-colors tracking-tight">
                          {op.number}
                        </h2>
                        {op.lote ? (
                          <span className="text-xs font-mono font-bold text-white bg-purple-950/80 border border-purple-800/60 px-2.5 py-1 rounded-lg shadow-sm">
                            Lote: {op.lote}
                          </span>
                        ) : null}
                      </div>

                      {/* Linha 3: Nome / Produto */}
                      <div className="space-y-1">
                        <div className="text-xs text-[#a1a1aa] font-medium">Nome:</div>
                        <div className="text-sm font-bold text-white uppercase tracking-tight leading-snug">
                          {op.product}
                        </div>
                      </div>

                      {/* Linha 4: Bloco de Observação e Horário */}
                      <div className="bg-[#121215] border border-[#27272a]/80 rounded-2xl p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-300 shrink-0 shadow-sm">
                            <Boxes className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] text-[#a1a1aa] font-medium leading-none">Observação</div>
                            <div className={`text-xs font-bold truncate mt-1 ${(op.granel || op.observation) ? 'text-white' : 'text-[#71717a]'}`}>
                              {(op.granel && op.granel !== op.number) ? op.granel : (op.observation || 'Sem observação')}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-[11px] text-[#a1a1aa] font-medium leading-none">Horário</div>
                          <div className="font-mono text-xs font-bold text-white flex items-center gap-1 justify-end mt-1">
                            <Clock className="w-3.5 h-3.5 text-[#71717a]" />
                            <span>{formattedTime}</span>
                          </div>
                        </div>
                      </div>

                      {/* Saída Manual — só para indústrias que raramente são
                          manipuladas na própria Ybera (Carvalho / Macpaul):
                          o líder de Pesagem pode encerrar a OSM direto. */}
                      {isManualExitEligible(op.industria) && (
                        <Button
                          type="button"
                          onClick={() => handleOpenManualExit(op)}
                          className="h-10 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs shadow-md shadow-orange-950/40 flex items-center justify-center gap-1.5 transition-all transform active:scale-95"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Dar Saída Manual</span>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* MINI HISTÓRICO: OSMS FINALIZADAS (VIA MANIPULAÇÃO OU SAÍDA MANUAL) */}
            {finishedTodayOps.length > 0 && (
              <section className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-t border-[#27272a] pt-4">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Mini Histórico — OPs Finalizadas Hoje</h3>
                  </div>
                  <span className="text-xs text-[#a1a1aa] font-mono">
                    {finishedTodayOps.length} finalizada{finishedTodayOps.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {finishedTodayOps.map((op) => (
                    <div
                      key={op.id}
                      className="bg-[#141418] border border-[#27272a] rounded-xl p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-sm text-white">{op.number}</span>
                          {op.industria && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${getIndustriaBadgeClass(op.industria)}`}>
                              {op.industria}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#a1a1aa] truncate max-w-[180px] mt-0.5">
                          {op.product}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-black text-sm text-emerald-400">
                          {(Number(op.producedQuantity) || 0).toLocaleString('pt-BR')} Kg
                        </div>
                        <div className="text-[10px] text-emerald-500 flex items-center gap-1 justify-end font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Concluído</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* MODAL NOVA ORDEM DE PRODUÇÃO / OP (OU EDITAR) */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);
          if (!open) setEditingOp(null);
        }}
      >
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400 mb-2">
              {editingOp ? <Pencil className="w-5 h-5" /> : <Scale className="w-5 h-5" />}
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              {editingOp ? 'Editar Ordem de Produção (OP)' : 'Nova Ordem de Produção (OP)'}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              {editingOp
                ? 'Atualize as informações da pesagem registrada.'
                : 'Cadastre uma nova pesagem na área de pesagem.'}
            </p>
          </DialogHeader>

          <form onSubmit={handleSaveOSM} className="space-y-3.5 mt-3">
            {/* 1. Data */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <span>Data <span className="text-purple-400">*</span></span>
              </Label>
              <Input
                type="date"
                value={osmDate}
                onChange={(e) => setOsmDate(e.target.value)}
                required
                className="bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-medium text-sm h-10 rounded-xl [color-scheme:dark]"
              />
            </div>

            {/* 2. Indústria */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <Building2 className="w-3.5 h-3.5 text-purple-400" />
                <span>Indústria <span className="text-purple-400">*</span></span>
              </Label>
              <select
                value={industria}
                onChange={(e) => setIndustria(e.target.value as 'Ybera' | 'Carvalho' | 'Macpaul')}
                required
                className="w-full bg-[#121215] border border-[#27272a] focus:border-purple-500 text-white text-sm h-10 rounded-xl px-3 focus:outline-none cursor-pointer font-medium"
              >
                <option value="Ybera">Ybera</option>
                <option value="Carvalho">Carvalho</option>
                <option value="Macpaul">Macpaul</option>
              </select>
            </div>

            {/* 3. Ordem de Produção */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <Hash className="w-3.5 h-3.5 text-purple-400" />
                <span>Ordem de produção <span className="text-purple-400">*</span></span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: 310-450"
                value={osmNumber}
                onChange={(e) => setOsmNumber(e.target.value)}
                required
                className="bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-mono text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* 4. Nome */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <Package className="w-3.5 h-3.5 text-purple-400" />
                <span>Nome <span className="text-purple-400">*</span></span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: ESCOVA PROGRESSIVA - SELANTE 150G"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                required
                className="bg-[#121215] border-[#27272a] focus:border-purple-500 text-white text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* 5. Lote */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400" />
                <span>Lote <span className="text-purple-400">*</span></span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: 03260727157"
                value={batchLot}
                onChange={(e) => setBatchLot(e.target.value)}
                required
                className="bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-mono text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* 6. Observação */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                <span>Observação <span className="text-[#71717a] font-normal">(Opcional)</span></span>
              </Label>
              <textarea
                placeholder="Ex: aguardando laboratório"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={2}
                className="w-full bg-[#121215] border border-[#27272a] focus:border-purple-500 focus:outline-none rounded-xl p-3 text-xs text-white placeholder:text-[#52525b] resize-none"
              />
            </div>

            <DialogFooter className="pt-2 gap-2 flex-col sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingOp(null);
                }}
                disabled={isSubmitting}
                className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto"
              >
                Cancelar
              </Button>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{editingOp ? 'Salvando...' : 'Registrando...'}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{editingOp ? 'Salvar Alterações' : 'Confirmar Registro'}</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL CONFIRMAÇÃO DE EXCLUSÃO */}
      <Dialog open={!!deleteModalOp} onOpenChange={(open) => !open && setDeleteModalOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-sm w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-800/60 flex items-center justify-center text-rose-400 mb-2">
              <Trash2 className="w-5 h-5" />
            </div>
            <DialogTitle className="text-base font-bold text-white">
              Excluir Ordem de Produção
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa] mt-1">
              Tem certeza que deseja excluir a OP <strong className="text-white font-mono">{deleteModalOp?.number}</strong> ({deleteModalOp?.product})? Esta ação removerá o registro permanentemente.
            </p>
          </DialogHeader>

          <DialogFooter className="pt-3 gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteModalOp(null)}
              disabled={isDeleting}
              className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto text-xs"
            >
              Cancelar
            </Button>

            <Button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirmar Exclusão</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE SAÍDA MANUAL (CARVALHO / MACPAUL) */}
      <Dialog open={!!manualExitOp} onOpenChange={(open) => !open && setManualExitOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-orange-950/80 border border-orange-800/60 flex items-center justify-center text-orange-400 mb-2">
              <LogOut className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              Confirmar Saída — OSM {manualExitOp?.number}
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              Encerre esta OSM diretamente, sem passar pela Manipulação — indicado para OSMs de{' '}
              <strong className="text-white">{manualExitOp?.industria || 'outra indústria'}</strong>, que raramente
              são manipuladas na Ybera.
            </p>
          </DialogHeader>

          {manualExitOp && (
            <form onSubmit={handleConfirmManualExit} className="space-y-4 mt-2">
              {/* Dados do produto — só confirmação, nada pra preencher aqui */}
              <div className="bg-[#121215] border border-[#27272a] rounded-xl p-3 space-y-2">
                <div>
                  <div className="text-[11px] text-[#a1a1aa]">Produto / Granel</div>
                  <div className="text-xs font-bold text-white mt-0.5">{manualExitOp.product}</div>
                </div>
                <div className="flex items-center gap-4">
                  {manualExitOp.lote && (
                    <div>
                      <div className="text-[11px] text-[#a1a1aa]">Lote</div>
                      <div className="text-xs font-mono font-bold text-white mt-0.5">{manualExitOp.lote}</div>
                    </div>
                  )}
                  {manualExitOp.industria && (
                    <div>
                      <div className="text-[11px] text-[#a1a1aa]">Indústria</div>
                      <div className="text-xs font-bold text-white mt-0.5">{manualExitOp.industria}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Data de Saída */}
              <div>
                <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-orange-400" />
                  <span>Data de Saída <span className="text-orange-400">*</span></span>
                </Label>
                <Input
                  type="date"
                  value={manualExitDate}
                  onChange={(e) => setManualExitDate(e.target.value)}
                  required
                  autoFocus
                  className="bg-[#121215] border-[#27272a] focus:border-orange-500 text-white font-medium text-sm h-10 rounded-xl [color-scheme:dark]"
                />
              </div>

              <DialogFooter className="pt-3 gap-2 flex-col sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualExitOp(null)}
                  disabled={isManualExitSubmitting}
                  className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto"
                >
                  Cancelar
                </Button>

                <Button
                  type="submit"
                  disabled={isManualExitSubmitting}
                  className="h-10 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs shadow-lg shadow-orange-950/50 flex items-center justify-center gap-1.5 w-full sm:w-auto"
                >
                  {isManualExitSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Registrando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Confirmar Saída</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
