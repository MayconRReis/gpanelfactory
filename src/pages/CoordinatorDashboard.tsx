import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { signOut } from '../services/auth';
import { LogOut } from 'lucide-react';
import { getLines, getAllOPs, subscribeToLines, subscribeToOPs } from '../services/db';
import { ProductionLine, ProductionOrder } from '../types';
import { useNavigate } from 'react-router-dom';

export function CoordinatorDashboard() {
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [ops, setOps] = useState<ProductionOrder[]>([]);

  // Carregar dados iniciais e setup do realtime
  useEffect(() => {
    const fetchInitial = async () => {
      const ls = await getLines();
      setLines(ls);
      const os = await getAllOPs();
      setOps(os);
    };
    fetchInitial();

    // Setup Supabase Realtime listeners
    const unsubscribeLines = subscribeToLines((updatedLines) => {
      setLines(updatedLines);
    });

    const unsubscribeOps = subscribeToOPs((updatedOps) => {
      setOps(updatedOps);
    });

    return () => {
      unsubscribeLines();
      unsubscribeOps();
    };
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const totalPlanned = ops
    .filter((op) => op.status === 'in_progress' || op.status === 'completed' || op.status === 'paused')
    .reduce((acc, op) => acc + op.plannedQuantity, 0);
  const totalProduced = ops.reduce((acc, op) => acc + op.producedQuantity, 0);

  const activeOpsCount = ops.filter((op) => op.status === 'in_progress').length;
  const pausedOpsCount = ops.filter((op) => op.status === 'paused').length;

  return (
    <div className="h-screen bg-[#0a0a0c] text-[#f4f4f5] flex flex-col font-sans overflow-hidden">
      <header className="h-16 border-b border-[#27272a] bg-[#121214] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 px-3 py-1 rounded text-xs font-black tracking-tighter">GYP</div>
          <h1 className="text-lg font-bold tracking-tight uppercase hidden md:block">Gestão de Produção e Operação</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 border-[#27272a]">
            <div className="text-right">
              <p className="text-xs font-medium">{profile?.name}</p>
              <p className="text-[10px] text-[#71717a] uppercase font-bold tracking-widest">Coordenador Geral</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#3f3f46] flex items-center justify-center text-xs font-bold uppercase">
              {profile?.name?.substring(0, 2) || 'CG'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#27272a]"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-[#18181b] border border-[#27272a] p-4 rounded-xl flex flex-col justify-between h-24 shadow-sm">
            <span className="text-[10px] uppercase text-[#a1a1aa] tracking-widest font-bold">Produção Hoje</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black">{totalProduced}</span>
              <span className="text-xs text-[#71717a]">/ {totalPlanned || 0} un</span>
            </div>
          </div>
          <div className="bg-[#18181b] border border-[#27272a] p-4 rounded-xl flex flex-col justify-between h-24 shadow-sm">
            <span className="text-[10px] uppercase text-[#a1a1aa] tracking-widest font-bold">Tempo Produtivo (Em dev)</span>
            <div className="flex items-baseline gap-2 text-blue-400">
              <span className="text-2xl font-black">--:--</span>
              <span className="text-xs">HH:MM</span>
            </div>
          </div>
          <div className="bg-[#18181b] border border-[#27272a] p-4 rounded-xl flex flex-col justify-between h-24 shadow-sm">
            <span className="text-[10px] uppercase text-[#a1a1aa] tracking-widest font-bold">OPs Ativas</span>
            <div className="flex items-baseline gap-2 text-green-500">
              <span className="text-2xl font-black">{activeOpsCount}</span>
            </div>
          </div>
          <div
            className={`bg-[#18181b] p-4 rounded-xl flex flex-col justify-between h-24 shadow-sm border ${
              pausedOpsCount > 0 ? 'border-red-500/30 shadow-[inset_0_0_12px_rgba(239,68,68,0.05)]' : '[#27272a]'
            }`}
          >
            <span
              className={`text-[10px] uppercase tracking-widest font-bold ${
                pausedOpsCount > 0 ? 'text-[#ef4444]' : 'text-[#a1a1aa]'
              }`}
            >
              Linhas Pausadas
            </span>
            <div className={`flex items-baseline gap-2 ${pausedOpsCount > 0 ? 'text-red-500' : 'text-[#f4f4f5]'}`}>
              <span className="text-2xl font-black">{pausedOpsCount}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 mt-8">
          <h2 className="text-sm uppercase tracking-widest font-bold text-[#71717a]">Monitoramento de Linhas (Real-time)</h2>
          <div className="text-[10px] bg-[#27272a] px-2 py-1 rounded text-[#a1a1aa] font-bold tracking-widest">VISÃO GERAL</div>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-hidden">
          {lines.map((line) => {
            const currentOp = line.currentOpId ? ops.find((o) => o.id === line.currentOpId) : null;

            let statusColor = 'border-l-[#27272a]';
            let statusBadge = '';

            if (line.status === 'active') {
              statusColor = 'border-l-green-500';
              statusBadge = 'bg-green-500/10 text-green-500';
            } else if (line.status === 'paused') {
              statusColor = 'border-l-orange-500';
              statusBadge = 'bg-orange-500/10 text-orange-500';
            }

            return (
              <div key={line.id} className={`bg-[#18181b] border-l-4 ${statusColor} border border-[#27272a] p-4 flex items-center gap-6`}>
                <div className="flex flex-col w-32">
                  <span className="text-[10px] text-[#71717a] font-bold uppercase">{line.name}</span>
                  <span className="text-xl font-black">{line.status === 'idle' ? 'LIVRE' : 'EM USO'}</span>
                </div>

                <div className="flex-1 border-x border-[#27272a] px-6">
                  {currentOp ? (
                    <>
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <span className="text-xs text-[#a1a1aa]">OP {currentOp.number} • </span>
                          <span className="text-sm font-bold">{currentOp.product}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 rounded uppercase ${statusBadge}`}>
                          {currentOp.status === 'in_progress' ? 'PRODUZINDO' : 'PAUSADA'}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#27272a] rounded-full overflow-hidden">
                        <div
                          className={`h-full ${line.status === 'active' ? 'bg-green-500' : 'bg-orange-500'}`}
                          style={{
                            width: `${Math.min(
                              (currentOp.producedQuantity / currentOp.plannedQuantity) * 100,
                              100
                            )}%`,
                          }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] mt-1 text-[#71717a]">
                        <span>
                          {currentOp.producedQuantity} / {currentOp.plannedQuantity} un
                        </span>
                        <span>{((currentOp.producedQuantity / currentOp.plannedQuantity) * 100).toFixed(1)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-[#71717a] italic py-3">Nenhuma OP ativa no momento</div>
                  )}
                </div>

                <div className="w-32 text-right">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold">Status</span>
                  <p
                    className={`text-sm font-bold uppercase ${
                      line.status === 'active'
                        ? 'text-green-500'
                        : line.status === 'paused'
                          ? 'text-orange-500'
                          : 'text-[#71717a]'
                    }`}
                  >
                    {line.status}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
