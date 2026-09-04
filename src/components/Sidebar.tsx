import React from 'react';
import {
  LayoutDashboard,
  Layers,
  Package,
  CalendarDays,
  ShieldCheck,
  History,
  Plus,
  RefreshCw,
  LogOut,
  Factory,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { UserProfile } from '../types';

export type DashboardTab = 'home' | 'lines' | 'daily_production' | 'ops' | 'rotations' | 'users' | 'events';

interface SidebarProps {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  linesCount: number;
  activeLinesCount: number;
  opsCount: number;
  usersCount: number;
  pendingCount: number;
  profile: UserProfile | null;
  onNewOp: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  isRefreshing: boolean;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
}

export function Sidebar({
  activeTab,
  setActiveTab,
  linesCount,
  activeLinesCount,
  opsCount,
  usersCount,
  pendingCount,
  profile,
  onNewOp,
  onRefresh,
  onSignOut,
  isRefreshing,
  isCollapsed,
  setIsCollapsed,
  mobileOpen = false,
  setMobileOpen,
}: SidebarProps) {
  const menuItems = [
    {
      id: 'home' as DashboardTab,
      label: 'Home',
      icon: LayoutDashboard,
      badge: null,
      description: 'Métricas & Desempenho',
    },
    {
      id: 'lines' as DashboardTab,
      label: 'Linhas',
      icon: Layers,
      badge: linesCount > 0 ? `${linesCount}` : null,
      subBadge: activeLinesCount > 0 ? `${activeLinesCount} ativas` : null,
      description: 'Chão de Fábrica',
    },
    {
      id: 'daily_production' as DashboardTab,
      label: 'Histórico & Gráficos',
      icon: BarChart3,
      badge: null,
      description: 'Produção Diária & Mensal',
    },
    {
      id: 'ops' as DashboardTab,
      label: 'Estoque de OPs',
      icon: Package,
      badge: opsCount > 0 ? `${opsCount}` : null,
      description: 'OPs em Estoque & CSV',
    },
    {
      id: 'rotations' as DashboardTab,
      label: 'Escala',
      icon: CalendarDays,
      badge: null,
      description: 'Alocação de Líderes',
    },
    {
      id: 'users' as DashboardTab,
      label: 'Equipe & Acessos',
      icon: ShieldCheck,
      badge: usersCount > 0 ? `${usersCount}` : null,
      alertBadge: pendingCount > 0 ? `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}` : null,
      description: 'Gestão de Usuários',
    },
    {
      id: 'events' as DashboardTab,
      label: 'Auditoria',
      icon: History,
      badge: null,
      description: 'Log de Eventos',
    },
  ];

  const handleSelectTab = (tab: DashboardTab) => {
    setActiveTab(tab);
    if (setMobileOpen) {
      setMobileOpen(false);
    }
  };

  const content = (isMobileView = false) => (
    <>
      {/* Top Branding Section */}
      <div className="p-4 border-b border-[#1e1e24] flex items-center justify-between">
        {!isCollapsed || isMobileView ? (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-blue-600 text-white font-black text-xs p-2 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)] flex items-center justify-center shrink-0">
              <Factory className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black tracking-wider text-[#f4f4f5] uppercase truncate">GPANEL</span>
                <span className="text-[9px] bg-blue-950 text-blue-400 border border-blue-800/40 px-1 py-0.2 rounded font-bold">
                  PRO
                </span>
              </div>
              <p className="text-[10px] text-[#71717a] truncate font-medium">Fábrica Guarapari • Ybera</p>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <div className="bg-blue-600 text-white font-black text-xs p-2 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)] flex items-center justify-center">
              <Factory className="w-4 h-4" />
            </div>
          </div>
        )}

        {isMobileView ? (
          <button
            onClick={() => setMobileOpen && setMobileOpen(false)}
            className="text-[#71717a] hover:text-[#f4f4f5] p-2 rounded-lg hover:bg-[#181820] transition-colors"
            title="Fechar menu"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[#71717a] hover:text-[#f4f4f5] p-1.5 rounded-lg hover:bg-[#181820] transition-colors shrink-0 ml-1"
            title={isCollapsed ? 'Expandir Menu' : 'Recolher Menu'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Quick Action Button (Nova OP) */}
      <div className="p-3 border-b border-[#18181f]">
        <button
          onClick={() => {
            onNewOp();
            if (isMobileView && setMobileOpen) setMobileOpen(false);
          }}
          className={`w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.25)] transition-all ${
            isCollapsed && !isMobileView ? 'px-0' : 'px-3'
          }`}
          title="Criar Nova Ordem de Produção"
        >
          <Plus className="w-4 h-4 shrink-0" />
          {(!isCollapsed || isMobileView) && <span>Nova OP</span>}
        </button>
      </div>

      {/* Navigation Menu */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1.5">
        <div className="px-2 pb-1.5">
          {(!isCollapsed || isMobileView) && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#52525b]">
              Menu de Navegação
            </p>
          )}
        </div>

        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleSelectTab(item.id)}
              className={`w-full rounded-xl transition-all flex items-center justify-between text-left group ${
                isCollapsed && !isMobileView ? 'p-2.5 justify-center' : 'px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-900/30'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#14141a]'
              }`}
              title={isCollapsed && !isMobileView ? item.label : undefined}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                    isActive ? 'text-white' : 'text-[#71717a] group-hover:text-blue-400'
                  }`}
                />
                {(!isCollapsed || isMobileView) && (
                  <div className="min-w-0">
                    <span className="text-xs truncate block">{item.label}</span>
                  </div>
                )}
              </div>

              {/* Badges */}
              {(!isCollapsed || isMobileView) && (
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {item.alertBadge && (
                    <span className="bg-amber-400 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse">
                      <AlertCircle className="w-2.5 h-2.5" />
                      {item.alertBadge}
                    </span>
                  )}
                  {item.badge && !item.alertBadge && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        isActive
                          ? 'bg-blue-700/60 text-white'
                          : 'bg-[#181820] text-[#71717a] border border-[#23232c]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer Profile & Actions */}
      <div className="p-3 border-t border-[#1e1e24] space-y-2 bg-[#09090c]">
        {/* User Card */}
        {!isCollapsed || isMobileView ? (
          <div className="p-2.5 rounded-xl bg-[#131318] border border-[#22222a] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center text-xs font-black shrink-0 uppercase">
                {profile?.name?.substring(0, 2) || 'CG'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#f4f4f5] truncate leading-tight">
                  {profile?.name || 'Coordenador'}
                </p>
                <p className="text-[10px] text-blue-400 font-semibold truncate mt-0.5">
                  Coordenador Geral
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onRefresh}
                title="Sincronizar dados em tempo real"
                className={`p-1.5 text-[#71717a] hover:text-white hover:bg-[#1e1e28] rounded-lg transition-colors ${
                  isRefreshing ? 'animate-spin text-blue-400' : ''
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onSignOut}
                title="Encerrar sessão"
                className="p-1.5 text-[#71717a] hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center text-xs font-black uppercase"
              title={`${profile?.name || 'Coordenador'} (Coordenador Geral)`}
            >
              {profile?.name?.substring(0, 2) || 'CG'}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onRefresh}
                title="Sincronizar"
                className={`p-1.5 text-[#71717a] hover:text-white hover:bg-[#1e1e28] rounded-lg ${
                  isRefreshing ? 'animate-spin text-blue-400' : ''
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onSignOut}
                title="Sair"
                className="p-1.5 text-[#71717a] hover:text-red-400 hover:bg-red-950/30 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar (hidden on small screens) */}
      <aside
        className={`hidden md:flex bg-[#0c0c10] border-r border-[#1e1e24] flex-col justify-between transition-all duration-300 select-none z-30 shrink-0 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {content(false)}
      </aside>

      {/* Mobile Drawer Navigation (visible when mobileOpen is true) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Dark Backdrop */}
          <div
            onClick={() => setMobileOpen && setMobileOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          />

          {/* Drawer Panel */}
          <aside className="relative w-72 max-w-[80vw] bg-[#0c0c10] border-r border-[#1e1e24] flex flex-col justify-between select-none z-50 h-full shadow-2xl animate-in slide-in-from-left duration-200">
            {content(true)}
          </aside>
        </div>
      )}
    </>
  );
}
