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
  Hash
} from 'lucide-react';
import { getAllOPs, createOP, getLines, getLeaders, getMonthlyGoals, getRecentEvents } from '../services/db';
import { ProductionOrder, ProductionLine, UserProfile, MonthlyGoal, ProductionEvent } from '../types';
import { DailyProductionHistory } from '../components/DailyProductionHistory';

export function PesagemScreen() {
  const { profile, signOut } = useAuthStore();

  const [activeViewTab, setActiveViewTab] = useState<'registro' | 'historico'>('registro');
  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modal Nova Ordem de Serviço (OSM)
  const [isModalOpen, setIsModalOpen] = useState(false);
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
  const [batchCount, setBatchCount] = useState('');
  const [observation, setObservation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!profile) return;
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
      setOps(allOps);
      setLines(allLines);
      setLeaders(allLeaders);
      setGoals(allGoals);
      setEvents(allEvents);
    } catch (err) {
      console.error('Erro ao carregar dados de pesagem:', err);
      showToast('Erro ao carregar dados.', 'error');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Carregamento inicial e realtime
  useEffect(() => {
    if (!profile) return;

    fetchDataRef.current?.();

    const channel = supabase
      .channel('pesagem-realtime-' + profile.uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => {
        fetchDataRef.current?.(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, () => {
        fetchDataRef.current?.(true);
      })
      .subscribe();

    const interval = setInterval(() => {
      fetchDataRef.current?.(true);
    }, 5000);

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

  const todayPesagemOps = useMemo(() => {
    return ops.filter(op => {
      const isPesagem = op.setor === 'Pesagem' || op.tipoDocumento === 'OSM';
      if (!isPesagem) return false;

      // Verificar se foi criada hoje
      let isToday = false;
      if (op.scheduledDate === todayStr) {
        isToday = true;
      } else if (op.createdAt) {
        const createdDate = new Date(op.createdAt);
        if (!isNaN(createdDate.getTime())) {
          const cYear = createdDate.getFullYear();
          const cMonth = String(createdDate.getMonth() + 1).padStart(2, '0');
          const cDay = String(createdDate.getDate()).padStart(2, '0');
          if (`${cYear}-${cMonth}-${cDay}` === todayStr) {
            isToday = true;
          }
        }
      }

      // Se foi criada pelo líder ou setor Pesagem
      const matchesLeader = !op.leaderId || op.leaderId === profile?.uid;
      return isPesagem && (isToday || op.status === 'completed') && (op.setor === 'Pesagem' || matchesLeader);
    }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [ops, todayStr, profile]);

  // Resumo do dia
  const totalBateladasHoje = useMemo(() => {
    return todayPesagemOps.reduce((acc, op) => acc + (Number(op.producedQuantity) || Number(op.plannedQuantity) || 0), 0);
  }, [todayPesagemOps]);

  // Criar nova Ordem de Produção / OSM
  const handleOpenModal = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setOsmDate(`${year}-${month}-${day}`);
    setIndustria('Ybera');
    setOsmNumber('');
    setProductName('');
    setBatchLot('');
    setBatchCount('');
    setObservation('');
    setIsModalOpen(true);
  };

  const handleCreateOSM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const trimmedNumber = osmNumber.trim();
    const trimmedProduct = productName.trim();
    const trimmedLot = batchLot.trim();
    const qty = parseFloat(batchCount.replace(',', '.')) || 0;
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
    if (isNaN(qty) || qty <= 0) {
      showToast('A quantidade deve ser maior que zero (Kg).', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Criar a OP como OSM/OP de Pesagem
      // Cria OSM já como completed — pesagem conclui no ato do registro
      await createOP({
        tipoDocumento: 'OSM',
        setor: 'Pesagem',
        unidade: 'Kg',
        number: trimmedNumber,
        product: trimmedProduct,
        lote: trimmedLot,
        plannedQuantity: qty,
        producedQuantity: qty,
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
      setIsModalOpen(false);
      await fetchData(true);
    } catch (err: any) {
      console.error('Erro ao registrar ordem:', err);
      showToast('Erro ao registrar ordem. Tente novamente.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col font-sans selection:bg-purple-500/30">
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

      {/* CABEÇALHO */}
      <header className="bg-[#121216] border-b border-[#27272a] px-4 lg:px-8 py-3.5 sticky top-0 z-30 flex items-center justify-between gap-4">
        {/* Identificação da Aplicação e Área */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400 shadow-inner">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg tracking-tight text-white">GPanel Factory</span>
              <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-950/90 text-purple-300 border border-purple-700/60 shadow-sm flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                Área de Pesagem
              </span>
            </div>
            <p className="text-xs text-[#a1a1aa] flex items-center gap-2">
              <span>Turno Único (Manhã)</span>
              <span>•</span>
              <span className="font-mono text-purple-300">Série 300</span>
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

      {/* BARRA DE NAVEGAÇÃO DE ABAS */}
      <div className="bg-[#121216]/95 border-b border-[#27272a] px-4 lg:px-8 py-2.5 sticky top-[65px] z-20 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveViewTab('registro')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                activeViewTab === 'registro'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Registro de OSMs</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                activeViewTab === 'registro'
                  ? 'bg-purple-800 text-white'
                  : 'bg-[#27272a] text-[#a1a1aa]'
              }`}>
                {todayPesagemOps.length}
              </span>
            </button>

            <button
              onClick={() => setActiveViewTab('historico')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                activeViewTab === 'historico'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
                  : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a20]'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Histórico & Gráficos</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans lowercase font-bold ${
                activeViewTab === 'historico'
                  ? 'bg-purple-800 text-purple-200'
                  : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/40'
              }`}>
                diário & mensal
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="hidden sm:inline text-[#71717a]">Hoje na Pesagem:</span>
            <span className="font-mono font-bold text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-800/40">
              {totalBateladasHoje.toLocaleString('pt-BR')} Kg
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#141418] border border-[#27272a] p-5 rounded-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-purple-400" />
                  <h1 className="text-xl font-bold text-white tracking-tight">Registro de OSMs do Dia</h1>
                </div>
                <p className="text-xs text-[#a1a1aa] mt-1">
                  Registre as bateladas pesadas de granel para disponibilização à equipe de Manipulação.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  variant="outline"
                  onClick={() => setActiveViewTab('historico')}
                  className="h-11 px-4 rounded-xl border-[#27272a] bg-[#18181b] hover:bg-[#27272a] text-purple-300 hover:text-white text-xs font-bold flex items-center gap-2"
                >
                  <BarChart3 className="w-4 h-4 text-purple-400" />
                  <span>Ver Histórico & Gráficos</span>
                </Button>

                <Button
                  onClick={handleOpenModal}
                  className="h-11 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-lg shadow-purple-950/40 flex items-center gap-2 flex-1 sm:flex-initial justify-center transition-all transform active:scale-95"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>+ Nova OSM</span>
                </Button>
              </div>
            </div>

            {/* LISTAGEM DE OSMS REGISTRADAS */}
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-[#a1a1aa]">
                <RefreshCw className="w-8 h-8 text-purple-500 animate-spin mb-3" />
                <span className="text-xs font-bold uppercase tracking-wider">Carregando ordens de pesagem...</span>
              </div>
            ) : todayPesagemOps.length === 0 ? (
              <div className="bg-[#18181b] border border-[#27272a] border-dashed rounded-2xl p-12 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-800/40 flex items-center justify-center text-purple-400 mb-4">
                  <Scale className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">Nenhuma OSM registrada hoje</h3>
                <p className="text-xs text-[#a1a1aa] max-w-md mb-6">
                  Inicie os registros do turno clicando no botão abaixo para adicionar as bateladas pesadas.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleOpenModal}
                    className="h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    <span>Registrar Primeira OSM</span>
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
                {todayPesagemOps.map((op) => {
                  const batches = Number(op.producedQuantity) || Number(op.plannedQuantity) || 1;
                  const formattedTime = op.createdAt
                    ? new Date(op.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    : '--:--';

                  return (
                    <div
                      key={op.id}
                      className="bg-[#18181b] border border-[#27272a] hover:border-purple-800/60 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all hover:shadow-xl hover:shadow-purple-950/10 group"
                    >
                      {/* Topo do Card: Número e Status */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-950/70 border border-purple-800/50 px-2 py-0.5 rounded-md">
                              OSM Série 300
                            </span>
                            {op.industria && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-950/60 text-purple-300 border border-purple-800/50 font-sans">
                                {op.industria}
                              </span>
                            )}
                          </div>
                          <h2 className="font-mono text-xl font-black text-white mt-1 group-hover:text-purple-300 transition-colors">
                            {op.number}
                          </h2>
                        </div>
                        <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 flex items-center gap-1.5 shadow-sm">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Registrado</span>
                        </span>
                      </div>

                      {/* Detalhes do Produto / Nome e Lote */}
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-[#a1a1aa]">Nome:</div>
                          {op.lote && (
                            <span className="text-[10px] font-mono font-bold text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/40">
                              Lote: {op.lote}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-[#f4f4f5] mt-0.5 line-clamp-2">
                          {op.product}
                        </div>
                      </div>

                      {/* Informações de Quantidade */}
                      <div className="bg-[#121215] border border-[#232328] rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-300">
                            <Boxes className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="text-[10px] text-[#a1a1aa] font-medium">Quantidade</div>
                            <div className="font-mono font-black text-sm text-purple-200">
                              {batches.toLocaleString('pt-BR')} <span className="text-[11px] text-purple-400 font-sans font-bold">{op.unidade || 'Kg'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[10px] text-[#71717a]">Horário</div>
                          <div className="font-mono text-xs text-[#d4d4d8] flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3 text-[#a1a1aa]" />
                            <span>{formattedTime}</span>
                          </div>
                        </div>
                      </div>

                      {/* Observação (se houver) */}
                      {op.granel && op.granel !== op.number && (
                        <div className="text-[11px] text-[#a1a1aa] bg-[#141417] px-2.5 py-1.5 rounded-lg border border-[#222227] italic truncate">
                          Obs: {op.granel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* RODAPÉ INFORMATIVO */}
      <footer className="bg-[#121216] border-t border-[#27272a] px-4 py-3.5 text-center text-xs text-[#a1a1aa] sticky bottom-0 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-white">
              {todayPesagemOps.length} {todayPesagemOps.length === 1 ? 'OSM registrada' : 'OSMs registradas'} hoje
            </span>
            <span>•</span>
            <span className="font-bold text-purple-300">
              {totalBateladasHoje.toLocaleString('pt-BR')} Kg no total
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[#71717a] font-mono">
            <button
              type="button"
              onClick={() => setActiveViewTab(activeViewTab === 'registro' ? 'historico' : 'registro')}
              className="text-purple-400 hover:text-purple-300 underline underline-offset-2 transition-colors cursor-pointer"
            >
              {activeViewTab === 'registro' ? 'Alternar para Histórico & Gráficos →' : '← Voltar ao Registro de OSMs'}
            </button>
            <span>•</span>
            <span>Área de Pesagem • Supabase</span>
          </div>
        </div>
      </footer>

      {/* MODAL NOVA ORDEM DE PRODUÇÃO / OSM */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400 mb-2">
              <Scale className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              Nova Ordem de Serviço (OSM)
            </DialogTitle>
            <p className="text-xs text-[#a1a1aa]">
              Cadastre uma nova pesagem na área de pesagem (Série 300).
            </p>
          </DialogHeader>

          <form onSubmit={handleCreateOSM} className="space-y-3.5 mt-3">
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

            {/* 6. Quantidade */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-purple-400" />
                  <span>Quantidade <span className="text-purple-400">*</span></span>
                </Label>
                <span className="text-[10px] text-purple-400 font-mono font-bold bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">
                  Unidade: Kg
                </span>
              </div>
              <Input
                type="number"
                min="0.01"
                step="any"
                placeholder="Ex: 1000"
                value={batchCount}
                onChange={(e) => setBatchCount(e.target.value)}
                required
                className="bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-mono text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* 7. Observação */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8] flex items-center gap-1.5 mb-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                <span>Observação <span className="text-[#71717a] font-normal">(Opcional)</span></span>
              </Label>
              <textarea
                placeholder="Ex: adicionado 15kg alcool ceto"
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
                onClick={() => setIsModalOpen(false)}
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
                    <span>Registrando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirmar Registro</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
