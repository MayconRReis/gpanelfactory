import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { supabase } from '../lib/supabase';
import { LogOut, Play, Pause, CheckCircle, Package } from 'lucide-react';
import { getLeaderRotation, getLines, getActiveOP, startOP, pauseOP, resumeOP, finishOP, reportQuantity } from '../services/db';
import { ProductionLine, ProductionOrder } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { seedDatabase } from '../services/seed'; // Temporary for MVP init

const PAUSE_REASONS = [
  'Falta de insumo',
  'Falta de embalagem',
  'Máquina entupida',
  'Manutenção',
  'Problema operacional',
  'Troca de produto',
  'Limpeza',
  'Qualidade',
  'Aguardando orientação',
  'Outro'
];

export function LeaderScreen() {
  const { profile } = useAuthStore();
  const [line, setLine] = useState<ProductionLine | null>(null);
  const [op, setOp] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Modals state
  const [isPauseOpen, setIsPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseObs, setPauseObs] = useState('');
  
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [quantity, setQuantity] = useState('');

  const [isFinishOpen, setIsFinishOpen] = useState(false);

  const fetchData = async () => {
    if (!profile) return;
    try {
      setLoading(true);
      const lineId = await getLeaderRotation(profile.uid);
      if (lineId) {
        const lines = await getLines();
        const myLine = lines.find(l => l.id === lineId) || null;
        setLine(myLine);
        if (myLine) {
          const myOp = await getActiveOP(myLine.id);
          setOp(myOp);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile]);

  // Handlers
  const handleStart = async () => {
    if (!line || !op || !profile) return;
    await startOP(op.id, line.id, profile.uid);
    await fetchData();
  };

  const handlePause = async () => {
    if (!line || !op || !profile || !pauseReason) return;
    await pauseOP(op.id, line.id, profile.uid, pauseReason, pauseObs);
    setIsPauseOpen(false);
    await fetchData();
  };

  const handleResume = async () => {
    if (!line || !op || !profile) return;
    await resumeOP(op.id, line.id, profile.uid);
    await fetchData();
  };

  const handleReport = async () => {
    if (!line || !op || !profile || !quantity) return;
    await reportQuantity(op.id, line.id, profile.uid, parseInt(quantity));
    setQuantity('');
    setIsReportOpen(false);
    await fetchData();
  };

  const handleFinish = async () => {
    if (!line || !op || !profile) return;
    await finishOP(op.id, line.id, profile.uid);
    setIsFinishOpen(false);
    await fetchData();
  };

  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex items-center justify-center font-sans">Carregando...</div>;
  }

  if (!line) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col items-center justify-center p-4 font-sans">
        <p className="mb-4">Você não está alocado em nenhuma linha nesta semana.</p>
        {import.meta.env.DEV && profile?.role === 'coordinator' && (
          <Button onClick={seedDatabase}>[DEV] Popular Banco de Dados</Button>
        )}
        <Button variant="ghost" onClick={() => supabase.auth.signOut()} className="mt-4">Sair</Button>
      </div>
    );
  }

  const progress = op ? (op.producedQuantity / op.plannedQuantity) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-xl p-8 text-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[#71717a] uppercase tracking-widest text-[10px] font-bold flex-1 text-left">Líder: {profile?.name}</h2>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()} className="text-[#71717a] hover:text-[#f4f4f5]">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        <h1 className="text-sm uppercase tracking-widest font-bold text-[#f4f4f5] mb-6">Sua Responsabilidade Hoje</h1>
        
        <div className="bg-green-500/10 text-green-500 text-4xl font-black py-8 rounded-xl mb-8 border border-green-500/20 shadow-[inset_0_0_20px_rgba(34,197,94,0.05)] tracking-tighter">
          {line.name.toUpperCase()}
        </div>

        {op ? (
          <>
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-[#71717a] mb-4 text-left">Produção Atual</h3>
            
            <div className="bg-[#121214] border border-[#27272a] p-5 rounded-xl text-left mb-8">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <span className="text-xs text-[#a1a1aa] font-mono">OP {op.number} • </span>
                  <span className="text-sm font-bold block mt-1">{op.product}</span>
                </div>
                <span className={`px-2 py-1 text-[10px] rounded font-bold uppercase tracking-wider ${
                  op.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
                  op.status === 'paused' ? 'bg-orange-500/10 text-orange-400' :
                  'bg-[#27272a] text-[#a1a1aa]'
                }`}>
                  {op.status === 'in_progress' ? 'Produzindo' : 
                   op.status === 'paused' ? 'Pausada' : 'Aguardando'}
                </span>
              </div>
              
              <div className="mt-4">
                <div className="w-full h-2 bg-[#27272a] rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(progress, 100)}%` }}></div>
                </div>
                <div className="flex justify-between text-[10px] mt-2 text-[#71717a] font-mono font-bold">
                  <span>{op.producedQuantity} / {op.plannedQuantity} un</span>
                  <span>{progress.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              {op.status === 'pending' ? (
                <Button onClick={handleStart} className="col-span-2 h-14 bg-green-600 hover:bg-green-500 text-white font-bold uppercase tracking-widest text-[11px] shadow-[0_0_10px_rgba(34,197,94,0.2)] rounded-lg">
                  <Play className="w-4 h-4 mr-2" /> INICIAR PRODUÇÃO
                </Button>
              ) : op.status === 'in_progress' ? (
                <>
                  <Button onClick={() => setIsPauseOpen(true)} className="h-14 bg-[#18181b] border border-orange-500/30 text-orange-500 hover:bg-orange-500/10 font-bold uppercase tracking-widest text-[11px] shadow-[inset_0_0_10px_rgba(249,115,22,0.05)] rounded-lg">
                    <Pause className="w-4 h-4 mr-2" /> PAUSAR
                  </Button>
                  <Button onClick={() => setIsReportOpen(true)} className="h-14 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest text-[11px] shadow-[0_0_10px_rgba(37,99,235,0.2)] rounded-lg">
                    <Package className="w-4 h-4 mr-2" /> APONTAR
                  </Button>
                  <Button onClick={() => setIsFinishOpen(true)} className="col-span-2 h-14 mt-2 bg-[#18181b] border border-[#27272a] text-[#f4f4f5] hover:bg-[#27272a] font-bold uppercase tracking-widest text-[11px] rounded-lg">
                    <CheckCircle className="w-4 h-4 mr-2" /> FINALIZAR OP
                  </Button>
                </>
              ) : op.status === 'paused' ? (
                <Button onClick={handleResume} className="col-span-2 h-14 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest text-[11px] shadow-[0_0_10px_rgba(37,99,235,0.2)] rounded-lg">
                  <Play className="w-4 h-4 mr-2" /> RETOMAR PRODUÇÃO
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="bg-[#121214] border border-[#27272a] p-8 rounded-xl text-center mb-8">
            <p className="text-[#a1a1aa] text-sm">Nenhuma OP programada para esta linha no momento.</p>
          </div>
        )}

      </div>

      {/* Pausar Modal */}
      <Dialog open={isPauseOpen} onOpenChange={setIsPauseOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5]">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-widest text-sm font-bold text-orange-500">Registrar Pausa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold">Motivo</Label>
              <Select onValueChange={setPauseReason}>
                <SelectTrigger className="bg-[#121214] border-[#27272a]">
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5]">
                  {PAUSE_REASONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold">Observação (Opcional)</Label>
              <Input 
                value={pauseObs}
                onChange={e => setPauseObs(e.target.value)}
                className="bg-[#121214] border-[#27272a]"
              />
            </div>
            <Button onClick={handlePause} disabled={!pauseReason} className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold uppercase tracking-widest text-[11px]">
              Confirmar Pausa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Apontar Modal */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5]">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-widest text-sm font-bold text-blue-400">Apontar Produção</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-[#a1a1aa] font-bold">Quantidade Produzida</Label>
              <Input 
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="bg-[#121214] border-[#27272a] font-mono text-xl"
                placeholder="Ex: 500"
              />
            </div>
            <Button onClick={handleReport} disabled={!quantity || isNaN(parseInt(quantity))} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest text-[11px]">
              Confirmar Apontamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Finalizar Modal */}
      <Dialog open={isFinishOpen} onOpenChange={setIsFinishOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5]">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-widest text-sm font-bold text-green-500">Finalizar Ordem</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[#a1a1aa] mb-6">Você tem certeza que deseja finalizar a OP {op?.number}? Esta ação não pode ser desfeita.</p>
            <div className="flex gap-4">
              <Button onClick={() => setIsFinishOpen(false)} variant="outline" className="flex-1 border-[#27272a] hover:bg-[#27272a] hover:text-white uppercase text-[11px] font-bold tracking-widest">
                Cancelar
              </Button>
              <Button onClick={handleFinish} className="flex-1 bg-green-600 hover:bg-green-500 text-white uppercase text-[11px] font-bold tracking-widest">
                Confirmar Finalização
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
