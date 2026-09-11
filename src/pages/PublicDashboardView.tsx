import React, { useState, useEffect, useCallback } from 'react';
import { 
  Factory, 
  RefreshCw, 
  Maximize2, 
  Minimize2, 
  LogIn, 
  Eye, 
  Radio, 
  ShieldCheck, 
  Clock,
  Sparkles,
  Layers
} from 'lucide-react';
import {
  getLines,
  getAllOPs,
  getRecentEvents,
  getMonthlyGoals,
  getLineDailyGoals,
  getFactoryMonthlyGoal
} from '../services/db';
import { ProductionLine, ProductionOrder, ProductionEvent, MonthlyGoal, LineDailyGoal } from '../types';
import { supabase } from '../lib/supabase';
import { HomeDashboard } from '../components/HomeDashboard';
import { useNavigate } from 'react-router-dom';

export function PublicDashboardView() {
  const navigate = useNavigate();

  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [lineDailyGoals, setLineDailyGoals] = useState<LineDailyGoal[]>([]);
  const [factoryMonthlyGoal, setFactoryMonthlyGoal] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true);
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      // Importante: NÃO buscar getLeaders/getAllUsers/getAllRotations aqui — essa
      // tela é pública, sem login, e esses dados vêm de `profiles` (nome, e-mail,
      // cargo, e até a senha temporária de quem ainda não trocou a senha). O
      // Dashboard Geral só precisa de OPs/linhas/eventos/metas para exibir os KPIs.
      const [ls, os, evts, gls, ldgs, fmg] = await Promise.all([
        getLines(),
        getAllOPs(),
        getRecentEvents(),
        getMonthlyGoals(currentYear),
        getLineDailyGoals(),
        getFactoryMonthlyGoal(currentYear, currentMonth),
      ]);
      setLines(ls || []);
      setOps(os || []);
      setEvents(evts || []);
      setGoals(gls || []);
      setLineDailyGoals(ldgs || []);
      setFactoryMonthlyGoal(fmg);
      setLastUpdated(new Date());
    } catch (err) {
      console.warn('Erro ao carregar dados do dashboard público:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // 1. Atualização periódica a cada 30 segundos (ideal para painéis e TVs)
    const intervalId = setInterval(() => {
      loadData(true);
    }, 30000);

    // 2. Realtime listener via Supabase
    const channel = supabase
      .channel('public_dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => {
        loadData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_lines' }, () => {
        loadData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_events' }, () => {
        loadData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_goals' }, () => {
        loadData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'line_daily_goals' }, () => {
        loadData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'factory_monthly_goal' }, () => {
        loadData(true);
      })
      .subscribe();

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      clearInterval(intervalId);
      supabase.removeChannel(channel);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [loadData]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((e) => {
        console.warn('Erro ao entrar em tela cheia:', e);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((e) => {
          console.warn('Erro ao sair de tela cheia:', e);
        });
      }
    }
  };

  const formattedTime = lastUpdated.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      
      {/* ── BARRA DE CABEÇALHO PÚBLICA (MODO VISUALIZADOR) ── */}
      <header className="h-16 border-b border-[#1e1e24] bg-[#0d0d11]/95 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-md">
        
        {/* Identificação do Sistema & Fábrica */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-blue-600/20 shrink-0">
            <Factory className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm sm:text-base font-black tracking-tight text-[#f4f4f5]">
                G-Panel
              </span>
              <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <Eye className="w-3 h-3 text-blue-400" />
                Somente Visualização
              </span>
              <span className="hidden md:flex text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full font-bold items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[11px] text-[#71717a] font-medium hidden sm:block">
              Dashboard Geral de Produção Industrial • PCP & Chão de Fábrica
            </p>
          </div>
        </div>

        {/* Ações Rápidas: Atualizar, Tela Cheia, Horário e Login */}
        <div className="flex items-center gap-2 sm:gap-3">
          
          {/* Indicador de última atualização */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-[#71717a] bg-[#14141a] border border-[#23232c] px-3 py-1.5 rounded-xl font-mono">
            <Clock className="w-3.5 h-3.5 text-[#a1a1aa]" />
            <span>Atualizado às {formattedTime}</span>
          </div>

          {/* Botão Atualizar Manual */}
          <button
            onClick={() => loadData(false)}
            disabled={isRefreshing}
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-[#14141a] hover:bg-[#1f1f28] border border-[#262632] text-xs font-semibold text-[#a1a1aa] hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
            title="Sincronizar dados agora"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Atualizar</span>
          </button>

          {/* Botão Alternar Tela Cheia (TV / Kiosk) */}
          <button
            onClick={toggleFullscreen}
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-[#14141a] hover:bg-[#1f1f28] border border-[#262632] text-xs font-semibold text-[#a1a1aa] hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
            title={isFullscreen ? 'Sair da Tela Cheia' : 'Modo Tela Cheia (TV)'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden md:inline">Sair Tela Cheia</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden md:inline">Tela Cheia</span>
              </>
            )}
          </button>

          {/* Botão Entrar / Fazer Login */}
          <button
            onClick={() => navigate('/login')}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-600/20 cursor-pointer"
            title="Acessar o painel administrativo com login e senha"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Entrar</span>
          </button>
        </div>
      </header>

      {/* ── CONTEÚDO PRINCIPAL DO DASHBOARD ── */}
      <main className="flex-1 p-3 sm:p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="min-h-[500px] flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest text-[#a1a1aa]">
                Carregando Dashboard Geral...
              </p>
            </div>
          ) : (
            <HomeDashboard
              lines={lines}
              ops={ops}
              leaders={[]}
              allUsers={[]}
              events={events}
              rotations={{}}
              goals={goals}
              factoryMonthlyGoal={factoryMonthlyGoal}
              lineDailyGoals={lineDailyGoals}
              isReadOnly={true}
            />
          )}
        </div>
      </main>

      {/* Rodapé sutil de aviso de segurança */}
      <footer className="py-3 px-4 border-t border-[#181820] bg-[#0b0b0e] text-center text-[11px] text-[#52525b] flex items-center justify-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>G-Panel Factory • Visualização em Modo Somente Leitura • Dados Atualizados em Tempo Real</span>
      </footer>

    </div>
  );
}
