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
  Sparkles
} from 'lucide-react';
import { getAllOPs, createOP, updateOP } from '../services/db';
import { ProductionOrder } from '../types';

export function PesagemScreen() {
  const { profile, signOut } = useAuthStore();

  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modal Nova OSM
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [osmNumber, setOsmNumber] = useState('');
  const [productName, setProductName] = useState('');
  const [batchCount, setBatchCount] = useState('1');
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

      const allOps = await getAllOPs();
      setOps(allOps);
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

  // Criar nova OSM
  const handleOpenModal = () => {
    setOsmNumber('');
    setProductName('');
    setBatchCount('1');
    setObservation('');
    setIsModalOpen(true);
  };

  const handleCreateOSM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const trimmedNumber = osmNumber.trim();
    const trimmedProduct = productName.trim();
    const batches = parseInt(batchCount, 10);

    if (!trimmedNumber) {
      showToast('Informe o número da OSM (ex: 310-450).', 'error');
      return;
    }
    if (!trimmedProduct) {
      showToast('Informe o nome do Produto/Granel.', 'error');
      return;
    }
    if (isNaN(batches) || batches < 1) {
      showToast('A quantidade de bateladas deve ser de no mínimo 1.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Criar a OP como OSM de Pesagem
      const newOp = await createOP({
        tipoDocumento: 'OSM',
        setor: 'Pesagem',
        unidade: 'Qtd',
        number: trimmedNumber,
        product: trimmedProduct,
        plannedQuantity: batches,
        priority: 'Normal',
        lineId: 'area-pesagem',
        scheduledShift: 'Manhã',
        scheduledDate: todayStr,
        granel: observation.trim() || undefined,
      });

      // 2. Atualizar status para concluído e atribuir produzida = planejada no ato
      await updateOP(newOp.id, {
        producedQuantity: batches,
        status: 'completed',
        leaderId: profile.uid,
      });

      showToast(`OSM ${trimmedNumber} registrada com sucesso!`, 'success');
      setIsModalOpen(false);
      await fetchData(true);
    } catch (err: any) {
      console.error('Erro ao registrar OSM:', err);
      showToast('Erro ao registrar OSM. Tente novamente.', 'error');
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

      {/* CORPO PRINCIPAL */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
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

          <Button
            onClick={handleOpenModal}
            className="h-11 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-lg shadow-purple-950/40 flex items-center gap-2 w-full sm:w-auto justify-center transition-all transform active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>+ Nova OSM</span>
          </Button>
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
            <Button
              onClick={handleOpenModal}
              className="h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-2"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Registrar Primeira OSM</span>
            </Button>
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
                      <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-950/70 border border-purple-800/50 px-2 py-0.5 rounded-md">
                        OSM Série 300
                      </span>
                      <h2 className="font-mono text-xl font-black text-white mt-1 group-hover:text-purple-300 transition-colors">
                        {op.number}
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 flex items-center gap-1.5 shadow-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Registrado</span>
                    </span>
                  </div>

                  {/* Detalhes do Produto */}
                  <div>
                    <div className="text-xs text-[#a1a1aa]">Produto / Granel:</div>
                    <div className="text-sm font-bold text-[#f4f4f5] mt-0.5 line-clamp-2">
                      {op.product}
                    </div>
                  </div>

                  {/* Informações da Batelada */}
                  <div className="bg-[#121215] border border-[#232328] rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-300">
                        <Boxes className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-[10px] text-[#a1a1aa] font-medium">Bateladas</div>
                        <div className="font-mono font-black text-sm text-purple-200">
                          {batches} <span className="text-[11px] text-purple-400 font-sans font-bold">Qtd</span>
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
              {totalBateladasHoje} {totalBateladasHoje === 1 ? 'batelada total' : 'bateladas totais'}
            </span>
          </div>

          <div className="text-[11px] text-[#71717a] font-mono">
            Área de Pesagem • Sincronizado com Supabase
          </div>
        </div>
      </footer>

      {/* MODAL NOVA OSM */}
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
              Cadastre uma nova batelada pesada na área de pesagem (Série 300).
            </p>
          </DialogHeader>

          <form onSubmit={handleCreateOSM} className="space-y-4 mt-2">
            {/* Número da OSM */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8]">
                Número da OSM <span className="text-purple-400">*</span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: 310-450"
                value={osmNumber}
                onChange={(e) => setOsmNumber(e.target.value)}
                required
                autoFocus
                className="mt-1 bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-mono text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* Produto / Granel */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8]">
                Produto / Granel <span className="text-purple-400">*</span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: Shampoo 2L Granel"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                required
                className="mt-1 bg-[#121215] border-[#27272a] focus:border-purple-500 text-white text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
            </div>

            {/* Quantidade de Bateladas */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-[#d4d4d8]">
                  Quantidade de Bateladas <span className="text-purple-400">*</span>
                </Label>
                <span className="text-[10px] text-purple-400 font-mono font-bold bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/40">
                  Unidade: Qtd
                </span>
              </div>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="1"
                value={batchCount}
                onChange={(e) => setBatchCount(e.target.value)}
                required
                className="mt-1 bg-[#121215] border-[#27272a] focus:border-purple-500 text-white font-mono text-sm placeholder:text-[#52525b] h-10 rounded-xl"
              />
              <p className="text-[11px] text-[#71717a] mt-1">
                Cada batelada equivale a ~1.000 kg de granel pesado.
              </p>
            </div>

            {/* Observação */}
            <div>
              <Label className="text-xs font-semibold text-[#d4d4d8]">
                Observação <span className="text-[#71717a] font-normal">(Opcional)</span>
              </Label>
              <textarea
                placeholder="Ex: Granel lote A, temperatura controlada..."
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={2}
                className="mt-1 w-full bg-[#121215] border border-[#27272a] focus:border-purple-500 focus:outline-none rounded-xl p-3 text-xs text-white placeholder:text-[#52525b] resize-none"
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
