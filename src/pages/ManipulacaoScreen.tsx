import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
  FlaskConical,
  Play,
  CheckCircle2,
  Clock,
  Boxes,
  RefreshCw,
  LogOut,
  AlertCircle,
  Sun,
  Moon,
  Layers,
  ArrowRight,
  Sparkles,
  Scale,
  History,
  Check
} from 'lucide-react';
import { getAllOPs, createOP, updateOP, finishOP } from '../services/db';
import { ProductionOrder } from '../types';

export function ManipulacaoScreen() {
  const { profile, signOut } = useAuthStore();

  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Estado para inputs de Kg manipulados em andamento: map de opId -> string
  const [kgInputs, setKgInputs] = useState<Record<string, string>>({});

  // Modal de Finalização / Escolha de Turno
  const [finishingOp, setFinishingOp] = useState<ProductionOrder | null>(null);
  const [selectedShift, setSelectedShift] = useState<'Manhã' | 'Tarde'>('Manhã');
  const [finalKg, setFinalKg] = useState<string>('');
  const [isFinishingSubmitting, setIsFinishingSubmitting] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

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

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (!profile) return;
    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const allOps = await getAllOPs();
      setOps(allOps);
    } catch (err) {
      console.error('Erro ao carregar dados de manipulação:', err);
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
      .channel('manipulacao-realtime-' + profile.uid)
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

  // Separar as categorias de OSMs:
  // 1. OSMs criadas pela Pesagem (setor='Pesagem', status='completed')
  // 2. OSMs de Manipulação (setor='Manipulação') em andamento (status='in_progress')
  // 3. OSMs de Manipulação finalizadas (status='completed')

  const manipulacaoOps = useMemo(() => {
    return ops.filter(op => op.setor === 'Manipulação');
  }, [ops]);

  // Conjunto de números de OSM ou lotes que já foram iniciados/manipulados
  const manipulatedOsmNumbers = useMemo(() => {
    const set = new Set<string>();
    manipulacaoOps.forEach(op => {
      if (op.number) set.add(op.number);
      if (op.lote) set.add(op.lote);
    });
    return set;
  }, [manipulacaoOps]);

  // OSMs disponíveis da Pesagem (ainda não iniciadas na Manipulação)
  const availablePesagemOps = useMemo(() => {
    return ops.filter(op => {
      const isPesagemCompleted = (op.setor === 'Pesagem' || op.tipoDocumento === 'OSM') && op.status === 'completed' && op.setor !== 'Manipulação';
      if (!isPesagemCompleted) return false;
      // Não deve ter correspondente na Manipulação
      return !manipulatedOsmNumbers.has(op.number) && !manipulatedOsmNumbers.has(op.lote || '');
    }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [ops, manipulatedOsmNumbers]);

  // OSMs de Manipulação em Andamento
  const inProgressManipulacaoOps = useMemo(() => {
    return manipulacaoOps
      .filter(op => op.status === 'in_progress' || op.status === 'pending')
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [manipulacaoOps]);

  // OSMs de Manipulação Concluídas Hoje
  const completedManipulacaoOps = useMemo(() => {
    return manipulacaoOps
      .filter(op => op.status === 'completed')
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [manipulacaoOps]);

  // 1. Iniciar Manipulação a partir de uma OSM da Pesagem
  const [startingOpId, setStartingOpId] = useState<string | null>(null);

  const handleStartManipulacao = async (pesagemOp: ProductionOrder) => {
    if (!profile) return;
    setStartingOpId(pesagemOp.id);

    try {
      const batchCount = Number(pesagemOp.producedQuantity) || Number(pesagemOp.plannedQuantity) || 1;
      const plannedKg = batchCount * 1000; // Cada batelada ~ 1000kg

      const newOp = await createOP({
        tipoDocumento: 'OSM',
        setor: 'Manipulação',
        unidade: 'Kg',
        number: pesagemOp.number,
        product: pesagemOp.product,
        lote: pesagemOp.number, // vincula ao número da OSM da Pesagem
        plannedQuantity: plannedKg,
        priority: 'Normal',
        lineId: 'area-manipulacao',
        scheduledShift: detectedShift,
        scheduledDate: new Date().toISOString().split('T')[0],
      });

      await updateOP(newOp.id, {
        status: 'in_progress',
        leaderId: profile.uid,
        setor: 'Manipulação',
        unidade: 'Kg',
        lote: pesagemOp.number,
        producedQuantity: 0,
      });

      showToast(`Manipulação da OSM ${pesagemOp.number} iniciada com sucesso!`, 'success');
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao iniciar manipulação:', err);
      showToast('Erro ao iniciar manipulação.', 'error');
    } finally {
      setStartingOpId(null);
    }
  };

  // 2. Abrir modal para finalizar OSM com seleção de turno
  const handleOpenFinishModal = (op: ProductionOrder) => {
    const inputVal = kgInputs[op.id] || String(op.plannedQuantity || 1000);
    setFinishingOp(op);
    setFinalKg(inputVal);
    setSelectedShift(detectedShift);
  };

  // 3. Confirmar finalização da OSM
  const handleConfirmFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !finishingOp) return;

    const kgNum = parseFloat(finalKg);
    if (isNaN(kgNum) || kgNum <= 0) {
      showToast('Informe uma quantidade válida em Kg.', 'error');
      return;
    }

    setIsFinishingSubmitting(true);
    try {
      await finishOP(finishingOp.id, 'area-manipulacao', profile.uid, selectedShift);
      await updateOP(finishingOp.id, {
        producedQuantity: kgNum,
        finishedShift: selectedShift,
        status: 'completed',
        leaderId: profile.uid,
      });

      showToast(`OSM ${finishingOp.number} finalizada no turno da ${selectedShift}!`, 'success');
      setFinishingOp(null);
      await fetchData(true);
    } catch (err) {
      console.error('Erro ao finalizar OSM:', err);
      showToast('Erro ao finalizar OSM.', 'error');
    } finally {
      setIsFinishingSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-3 ${
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
        </div>
      )}

      {/* CABEÇALHO */}
      <header className="bg-[#121216] border-b border-[#27272a] px-4 lg:px-8 py-3.5 sticky top-0 z-30 flex items-center justify-between gap-4">
        {/* Identificação da Aplicação e Área */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 shadow-inner">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg tracking-tight text-white">GPanel Factory</span>
              <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 shadow-sm flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                Área de Manipulação
              </span>
            </div>
            <p className="text-xs text-[#a1a1aa] flex items-center gap-2">
              <span>Execução de Granéis</span>
              <span>•</span>
              <span className="font-mono text-cyan-300">Unidade: Kg</span>
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

      {/* CORPO PRINCIPAL */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-8">
        {/* SEÇÃO 1: OSMS EM ANDAMENTO (DA MANIPULAÇÃO) */}
        {inProgressManipulacaoOps.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                <h2 className="text-lg font-bold text-white tracking-tight">
                  OSMs em Andamento ({inProgressManipulacaoOps.length})
                </h2>
              </div>
              <span className="text-xs text-cyan-400 font-medium">Processo de Mistura / Homogeneização</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {inProgressManipulacaoOps.map((op) => {
                const currentKgValue = kgInputs[op.id] !== undefined ? kgInputs[op.id] : String(op.plannedQuantity || 1000);

                return (
                  <div
                    key={op.id}
                    className="bg-[#18181b] border-2 border-cyan-500/50 shadow-lg shadow-cyan-950/20 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-md">
                          Em Manipulação
                        </span>
                        <h3 className="font-mono text-xl font-black text-white mt-1">
                          {op.number}
                        </h3>
                      </div>

                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-cyan-950/90 text-cyan-300 border border-cyan-800/60 flex items-center gap-1.5">
                        <FlaskConical className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                        <span>Em Processo</span>
                      </span>
                    </div>

                    <div>
                      <div className="text-xs text-[#a1a1aa]">Produto:</div>
                      <div className="text-sm font-bold text-white mt-0.5">{op.product}</div>
                    </div>

                    {/* Entrada de Kg manipulados */}
                    <div className="bg-[#121215] border border-[#27272a] rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#d4d4d8] font-semibold">Quantidade Manipulada (Kg):</span>
                        <span className="text-[11px] font-mono text-[#a1a1aa]">
                          Planejado: {op.plannedQuantity?.toLocaleString('pt-BR')} Kg
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="10"
                          min="1"
                          value={currentKgValue}
                          onChange={(e) =>
                            setKgInputs((prev) => ({
                              ...prev,
                              [op.id]: e.target.value,
                            }))
                          }
                          className="bg-[#18181b] border-[#3f3f46] text-white font-mono font-bold text-base h-10 rounded-xl focus:border-cyan-500"
                        />
                        <span className="text-xs font-black text-cyan-400 px-2">Kg</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => handleOpenFinishModal(op)}
                      className="h-11 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-950/40 flex items-center justify-center gap-2 transition-all transform active:scale-95"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Finalizar OSM</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SEÇÃO 2: OSMS DISPONÍVEIS (DA PESAGEM) */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#27272a] pb-3">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-400" />
                <span>OSMs Disponíveis da Pesagem</span>
              </h2>
              <p className="text-xs text-[#a1a1aa] mt-0.5">
                Ordens pesadas aguardando início da manipulação e mistura.
              </p>
            </div>

            <span className="text-xs text-amber-400 font-mono font-semibold bg-amber-950/60 border border-amber-800/40 px-2.5 py-1 rounded-lg">
              {availablePesagemOps.length} disponíveis
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#a1a1aa]">
              <RefreshCw className="w-6 h-6 text-cyan-500 animate-spin mb-2" />
              <span className="text-xs">Buscando ordens da pesagem...</span>
            </div>
          ) : availablePesagemOps.length === 0 ? (
            <div className="bg-[#18181b] border border-[#27272a] border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-xl bg-amber-950/30 border border-amber-800/30 flex items-center justify-center text-amber-400 mb-3">
                <Check className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Nenhuma OSM aguardando manipulação</h4>
              <p className="text-xs text-[#a1a1aa] max-w-sm">
                Assim que o líder de Pesagem registrar uma nova OSM, ela aparecerá aqui automaticamente.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availablePesagemOps.map((op) => {
                const batchCount = Number(op.producedQuantity) || Number(op.plannedQuantity) || 1;
                const approxKg = batchCount * 1000;
                const isStarting = startingOpId === op.id;

                return (
                  <div
                    key={op.id}
                    className="bg-[#18181b] border border-[#27272a] hover:border-amber-700/50 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all hover:shadow-lg hover:shadow-amber-950/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-950/70 border border-purple-800/50 px-2 py-0.5 rounded-md">
                          Pesagem Concluída
                        </span>
                        <h3 className="font-mono text-xl font-black text-white mt-1">
                          {op.number}
                        </h3>
                      </div>

                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-950/80 text-amber-300 border border-amber-800/50 flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3 text-amber-400" />
                        <span>Aguardando Manipulação</span>
                      </span>
                    </div>

                    <div>
                      <div className="text-xs text-[#a1a1aa]">Produto:</div>
                      <div className="text-sm font-bold text-white mt-0.5 line-clamp-2">
                        {op.product}
                      </div>
                    </div>

                    <div className="bg-[#121215] border border-[#232328] rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-300">
                          <Boxes className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="text-[10px] text-[#a1a1aa]">Bateladas Pesadas</div>
                          <div className="font-mono font-black text-xs text-purple-200">
                            {batchCount} Qtd (~{approxKg.toLocaleString('pt-BR')} Kg)
                          </div>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => handleStartManipulacao(op)}
                      disabled={isStarting}
                      className="h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-950/40 flex items-center justify-center gap-1.5 transition-all transform active:scale-95"
                    >
                      {isStarting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Iniciando...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Iniciar Manipulação</span>
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SEÇÃO 3: HISTÓRICO DE OSMS FINALIZADAS NA MANIPULAÇÃO */}
        {completedManipulacaoOps.length > 0 && (
          <section className="space-y-4 pt-4 border-t border-[#27272a]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">OSMs Finalizadas na Manipulação</h3>
              </div>
              <span className="text-xs text-[#a1a1aa] font-mono">
                {completedManipulacaoOps.length} concluídas
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {completedManipulacaoOps.map((op) => {
                const finishedKg = Number(op.producedQuantity) || 0;
                const shift = op.finishedShift || op.scheduledShift || 'Manhã';

                return (
                  <div
                    key={op.id}
                    className="bg-[#141418] border border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
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
                      </div>
                      <div className="text-xs text-[#a1a1aa] truncate max-w-[180px] mt-0.5">
                        {op.product}
                      </div>
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
      </main>

      {/* MODAL DE FINALIZAÇÃO E ESCOLHA DE TURNO */}
      <Dialog open={!!finishingOp} onOpenChange={(open) => !open && setFinishingOp(null)}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-md w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 mb-2">
              <FlaskConical className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">
              Finalizar OSM {finishingOp?.number}
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
    </div>
  );
}
