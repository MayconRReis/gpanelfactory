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
  Scale,
  FlaskConical,
} from 'lucide-react';
import { UserProfile, DashboardTab } from '../types';
import { getUserAllowedTabs, getUserRule, ACCESS_RULES } from '../lib/permissions';

export type { DashboardTab };

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
  const userRule = getUserRule(profile);
  const ruleConfig = ACCESS_RULES[userRule] || ACCESS_RULES.operador;
  const allowedTabs = getUserAllowedTabs(profile);

  const canCreateOp = allowedTabs.includes('ops') || userRule === 'admin' || userRule === 'pcp';

  // Todos os itens do menu unificado do GPanel Factory
  const allMenuItems = [
    {
      id: 'home' as DashboardTab,
      label: 'Dashboard Geral',
      icon: LayoutDashboard,
      badge: null,
      description: 'Visão Executiva, Farol & OEE',
      section: 'GERAL',
    },
    {
      id: 'pesagem' as DashboardTab,
      label: 'Pesagem',
      icon: Scale,
      badge: null,
      description: 'Matérias-Primas & OSMs',
      section: 'PROCESSOS',
    },
    {
      id: 'manipulacao' as DashboardTab,
      label: 'Manipulação',
      icon: FlaskConical,
      badge: null,
      description: 'Granéis & Reatores',
      section: 'PROCESSOS',
    },
    {
      id: 'envase' as DashboardTab,
      label: 'Chão de Fábrica',
      icon: Factory,
      badge: null,
      description: 'Linhas & Apontamento',
      section: 'PROCESSOS',
    },
    {
      id: 'lines' as DashboardTab,
      label: 'Linhas de Envase',
      icon: Layers,
      badge: linesCount > 0 ? `${linesCount}` : null,
      subBadge: activeLinesCount > 0 ? `${activeLinesCount} ativas` : null,
      description: 'Monitoramento ao Vivo',
      section: 'GESTÃO & PCP',
    },
    {
      id: 'daily_production' as DashboardTab,
      label: 'Histórico & Gráficos',
      icon: BarChart3,
      badge: null,
      description: 'Produção Diária & Mensal',
      section: 'GESTÃO & PCP',
    },
    {
      id: 'ops' as DashboardTab,
      label: 'Estoque de OPs',
      icon: Package,
      badge: opsCount > 0 ? `${opsCount}` : null,
      description: 'Fila de OPs & CSV',
      section: 'GESTÃO & PCP',
    },
    {
      id: 'rotations' as DashboardTab,
      label: 'Escala Semanal',
      icon: CalendarDays,
      badge: null,
      description: 'Alocação de Líderes',
      section: 'GESTÃO & PCP',
    },
    {
      id: 'users' as DashboardTab,
      label: 'Equipe & Acessos',
      icon: ShieldCheck,
      badge: usersCount > 0 ? `${usersCount}` : null,
      alertBadge: pendingCount > 0 ? `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}` : null,
      description: 'Regras de Acesso (Rules)',
      section: 'ADMINISTRAÇÃO',
    },
    {
      id: 'events' as DashboardTab,
      label: 'Auditoria',
      icon: History,
      badge: null,
      description: 'Log de Eventos & Paradas',
      section: 'ADMINISTRAÇÃO',
    },
  ];

  // Filtra as telas com base nas Rules do perfil do usuário
  // (Lembrando que 'home' SEMPRE está incluída)
  const visibleMenuItems = allMenuItems.filter((item) => allowedTabs.includes(item.id));

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
                  FACTORY
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

      {/* Quick Action Button (Nova OP) - apenas se usuário tem permissão */}
      {canCreateOp && (
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
      )}

      {/* Navigation Menu com Rules */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5 no-scrollbar">
        <div className="px-2 pb-1">
          {(!isCollapsed || isMobileView) && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#52525b]">
                Navegação
              </p>
              <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded ${ruleConfig.badgeClass}`}>
                {ruleConfig.shortName}
              </span>
            </div>
          )}
        </div>

        {visibleMenuItems.map((item) => {
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
                {profile?.name?.substring(0, 2) || 'GP'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#f4f4f5] truncate leading-tight">
                  {profile?.name || 'Colaborador'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-[#a1a1aa] font-medium truncate">
                    {profile?.cargo || ruleConfig.name}
                  </span>
                </div>
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
              title={`${profile?.name || 'Colaborador'} (${profile?.cargo || ruleConfig.name})`}
            >
              {profile?.name?.substring(0, 2) || 'GP'}
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
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex bg-[#0c0c10] border-r border-[#1e1e24] flex-col justify-between transition-all duration-300 select-none z-30 shrink-0 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {content(false)}
      </aside>

      {/* Mobile Drawer Navigation */}
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
