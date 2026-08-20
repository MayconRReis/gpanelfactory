import * as React from 'react';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { 
  Factory, 
  LogOut, 
  RefreshCw, 
  Plus, 
  Play, 
  Pause, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Users, 
  Layers, 
  History, 
  Package, 
  Search, 
  Trash2, 
  X,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  UserCheck,
  UserX,
  Award,
  MailPlus,
  Mail,
  Copy,
  Check,
  FileSpreadsheet,
  Upload,
  Download,
  Boxes,
  Tag,
  FlaskConical,
  Database,
  Menu
} from 'lucide-react';
import { 
  getLines, 
  getAllOPs, 
  getLeaders, 
  getAllUsers,
  updateUserRole,
  updateUserStatus,
  preAuthorizeUser,
  deleteUserProfile,
  getAllRotations, 
  saveLeaderRotation, 
  createOP, 
  updateOP,
  deleteOP, 
  startOP, 
  pauseOP, 
  resumeOP, 
  finishOP, 
  getRecentEvents, 
  getPauseReasons 
} from '../services/db';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, PauseReason } from '../types';
import { supabase } from '../lib/supabase';
import { Sidebar, DashboardTab } from '../components/Sidebar';
import { HomeDashboard } from '../components/HomeDashboard';
import { CsvImportModal } from '../components/CsvImportModal';
import { AssignLineModal, getWeekRange } from '../components/AssignLineModal';
import { LayoutDashboard, CalendarDays, CalendarClock, CalendarCheck2, Calendar } from 'lucide-react';

export function CoordinatorDashboard() {
  const { profile, signOut } = useAuthStore();

  // Navigation tabs (Sidebar)
  const [activeTab, setActiveTab] = useState<DashboardTab>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Main data state
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [rotations, setRotations] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [pauseReasons, setPauseReasons] = useState<PauseReason[]>([]);

  // UI state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'pending' | 'coordinator' | 'leader'>('all');
  
  // Modal: Nova OP
  const [showNewOpModal, setShowNewOpModal] = useState(false);
  const [newOpNumber, setNewOpNumber] = useState('');
  const [newOpProduct, setNewOpProduct] = useState('');
  const [newOpLote, setNewOpLote] = useState('');
  const [newOpPlanned, setNewOpPlanned] = useState('');
  const [newOpGranel, setNewOpGranel] = useState('');
  const [newOpPriority, setNewOpPriority] = useState<'Crítica' | 'Alta' | 'Normal' | 'Baixa'>('Normal');
  const [newOpLineId, setNewOpLineId] = useState('');
  const [newOpPackage, setNewOpPackage] = useState('1000');
  const [isSubmittingOp, setIsSubmittingOp] = useState(false);

  // Modal: Importar CSV de Estoque
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);

  // Modal: Atribuir Linha & Cronograma
  const [assignModalOp, setAssignModalOp] = useState<ProductionOrder | null>(null);

  // Modal: Confirmação de Exclusão de OP
  const [deleteModalOp, setDeleteModalOp] = useState<ProductionOrder | null>(null);
  const [isDeletingOp, setIsDeletingOp] = useState(false);

  // Modal: Cadastros & Confirmações de Usuários
  const [showAuthorizeModal, setShowAuthorizeModal] = useState(false);
  const [modalUserSearch, setModalUserSearch] = useState('');

  // Modal: Pausar OP
  const [pauseModalData, setPauseModalData] = useState<{ opId: string; lineId: string; opNumber: string } | null>(null);
  const [selectedPauseReason, setSelectedPauseReason] = useState('');
  const [pauseObservation, setPauseObservation] = useState('');

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async () => {
    try {
      const [ls, os, lds, usrs, rots, evts, prs] = await Promise.all([
        getLines(),
        getAllOPs(),
        getLeaders(),
        getAllUsers(),
        getAllRotations(),
        getRecentEvents(),
        getPauseReasons(),
      ]);
      setLines(ls);
      setOps(os);
      setLeaders(lds);
      setAllUsers(usrs);
      setRotations(rots);
      setEvents(evts);
      setPauseReasons(prs);
    } catch (e) {
      console.warn('Erro ao carregar dados do coordenador:', e);
    }
  };

  useEffect(() => {
    loadData();

    // Supabase Realtime Channels
    const channel = supabase
      .channel('coordinator-realtime-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_lines' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lines' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_events' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_rotations' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rotations' }, () => loadData())
      .subscribe();

    // Fallback sync every 4 seconds
    const interval = setInterval(loadData, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    showToast('Dados de chão de fábrica sincronizados com sucesso!', 'info');
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // ---------------- USER & ROLE MANAGEMENT ACTIONS ----------------
  const handlePromoteToCoordinator = async (user: UserProfile) => {
    if (window.confirm(`Deseja promover ${user.name} (${user.email}) para o cargo de COORDENADOR GERAL?`)) {
      const ok = await updateUserRole(user.uid || user.email, 'coordinator', 'Coordenador Geral');
      if (ok) {
        showToast(`${user.name} agora possui cargo de Coordenador Geral!`);
        await loadData();
      } else {
        showToast('Falha ao atualizar cargo no Supabase.', 'error');
      }
    }
  };

  const handleDemoteToLeader = async (user: UserProfile) => {
    if (user.uid === profile?.uid) {
      showToast('Você não pode rebaixar seu próprio cargo enquanto logado.', 'error');
      return;
    }
    if (window.confirm(`Deseja alterar o cargo de ${user.name} para LÍDER DE PRODUÇÃO?`)) {
      const ok = await updateUserRole(user.uid || user.email, 'leader', 'Líder de Produção');
      if (ok) {
        showToast(`${user.name} foi redefinido para Líder de Produção.`);
        await loadData();
      } else {
        showToast('Falha ao atualizar cargo no Supabase.', 'error');
      }
    }
  };

  const handleToggleUserStatus = async (user: UserProfile) => {
    if (user.uid === profile?.uid) {
      showToast('Você não pode inativar sua própria conta.', 'error');
      return;
    }
    const newStatus = user.status === 'inactive' ? 'active' : 'inactive';
    const actionLabel = newStatus === 'active' ? 'Ativar acesso' : 'Bloquear / Inativar';

    if (window.confirm(`Deseja ${actionLabel} de ${user.name} (${user.email})?`)) {
      const ok = await updateUserStatus(user.uid || user.email, newStatus);
      if (ok) {
        showToast(`Status de ${user.name} alterado para ${newStatus === 'active' ? 'Ativo' : 'Inativo'}.`);
        await loadData();
      } else {
        showToast('Falha ao atualizar status.', 'error');
      }
    }
  };

  const handleDeleteUserRecord = async (user: UserProfile) => {
    if (user.uid === profile?.uid) {
      showToast('Você não pode excluir seu próprio perfil.', 'error');
      return;
    }
    if (window.confirm(`Deseja remover o registro do colaborador ${user.name} (${user.email})?`)) {
      await deleteUserProfile(user.uid || user.email);
      showToast(`Registro de ${user.name} removido.`);
      await loadData();
    }
  };

  const handleCopySqlForUser = (userEmail: string) => {
    const sql = `-- 1. Define papel na tabela profiles:
UPDATE public.profiles SET role = 'coordinator' WHERE email = '${userEmail}';
-- 2. Define papel nos metadados do auth:
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role": "coordinator"}'::jsonb WHERE email = '${userEmail}';
-- 3. Confirma o e-mail imediatamente:
UPDATE auth.users SET email_confirmed_at = now() WHERE email = '${userEmail}';`;
    navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    showToast('Script SQL copiado para a área de transferência!');
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const handleCopyConfirmEmailSql = (userEmail: string) => {
    const sql = `UPDATE auth.users SET email_confirmed_at = now() WHERE email = '${userEmail}';`;
    navigator.clipboard.writeText(sql);
    showToast(`SQL de confirmação para ${userEmail} copiado!`);
  };

  const handleCopyConfirmAllSql = () => {
    if (allUsers.length === 0) {
      showToast('Nenhum usuário cadastrado encontrado.', 'info');
      return;
    }
    const emails = allUsers.map(u => `'${u.email}'`).join(',\n  ');
    const sql = `-- 1. Valida todos os e-mails no Supabase Auth:
UPDATE auth.users 
SET email_confirmed_at = now() 
WHERE email IN (
  ${emails}
);

-- 2. Ativa todos os perfis na tabela public.profiles:
UPDATE public.profiles
SET status = 'active'
WHERE email IN (
  ${emails}
);`;
    navigator.clipboard.writeText(sql);
    showToast('SQL para validar e ativar todos os colaboradores copiado!');
  };

  const handleApproveUser = async (user: UserProfile, targetRole?: 'coordinator' | 'leader') => {
    const roleToSet = targetRole || user.role || 'leader';
    const okStatus = await updateUserStatus(user.uid || user.email, 'active');
    const okRole = await updateUserRole(user.uid || user.email, roleToSet);

    if (okStatus || okRole) {
      showToast(`${user.name} aprovado e ativado como ${roleToSet === 'coordinator' ? 'Coordenador' : 'Líder'}!`);
      await loadData();
    } else {
      showToast('Erro ao aprovar colaborador.', 'error');
    }
  };

  // ---------------- OP ACTIONS ----------------
  const handleOpenAssignModal = (op: ProductionOrder) => {
    setAssignModalOp(op);
  };

  const handleSaveAssignment = async (
    opId: string, 
    updates: { lineId: string | null; scheduledDate?: string; scheduledShift?: string }
  ) => {
    await updateOP(opId, {
      lineId: updates.lineId,
      scheduledDate: updates.scheduledDate,
      scheduledShift: updates.scheduledShift,
    });
    showToast('Cronograma e linha da OP atualizados com sucesso!');
    await loadData();
  };

  const handleCreateOP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpNumber.trim() || !newOpProduct.trim() || !newOpPlanned) {
      showToast('Preencha os campos obrigatórios da OP.', 'error');
      return;
    }

    setIsSubmittingOp(true);
    try {
      await createOP({
        number: newOpNumber.trim(),
        product: newOpProduct.trim(),
        lote: newOpLote.trim() || undefined,
        plannedQuantity: Number(newOpPlanned),
        granel: newOpGranel.trim() || undefined,
        priority: newOpPriority,
        lineId: newOpLineId || null,
        packageAvailability: Number(newOpPackage) || 0,
      });

      showToast(`Ordem de Produção OP ${newOpNumber} criada com sucesso no estoque!`);
      setShowNewOpModal(false);
      setNewOpNumber('');
      setNewOpProduct('');
      setNewOpLote('');
      setNewOpPlanned('');
      setNewOpGranel('');
      setNewOpPriority('Normal');
      setNewOpLineId('');
      await loadData();
    } catch {
      showToast('Falha ao registrar nova OP.', 'error');
    } finally {
      setIsSubmittingOp(false);
    }
  };

  const handleOpenDeleteModal = (op: ProductionOrder) => {
    setDeleteModalOp(op);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalOp) return;
    setIsDeletingOp(true);
    try {
      await deleteOP(deleteModalOp.id);
      showToast(`OP ${deleteModalOp.number} removida com sucesso do estoque.`);
      setDeleteModalOp(null);
      await loadData();
    } catch {
      showToast('Falha ao remover a OP do estoque.', 'error');
    } finally {
      setIsDeletingOp(false);
    }
  };

  const handleStartOP = async (op: ProductionOrder) => {
    const targetLineId = op.lineId || lines[0]?.id || 'line-1';
    await startOP(op.id, targetLineId, profile?.uid || 'coord');
    showToast(`OP ${op.number} iniciada na ${lines.find(l => l.id === targetLineId)?.name || 'linha'}!`);
    await loadData();
  };

  const handleOpenPauseModal = (op: ProductionOrder) => {
    setPauseModalData({
      opId: op.id,
      lineId: op.lineId || 'line-1',
      opNumber: op.number,
    });
    setSelectedPauseReason(pauseReasons[0]?.name || 'Manutenção Mecânica / Elétrica');
    setPauseObservation('');
  };

  const handleConfirmPause = async () => {
    if (!pauseModalData) return;
    await pauseOP(
      pauseModalData.opId,
      pauseModalData.lineId,
      profile?.uid || 'coord',
      selectedPauseReason,
      pauseObservation
    );
    showToast(`OP ${pauseModalData.opNumber} pausada com justificativa registrada.`, 'info');
    setPauseModalData(null);
    await loadData();
  };

  const handleResumeOP = async (op: ProductionOrder) => {
    const targetLineId = op.lineId || 'line-1';
    await resumeOP(op.id, targetLineId, profile?.uid || 'coord');
    showToast(`OP ${op.number} retomada!`);
    await loadData();
  };

  const handleFinishOP = async (op: ProductionOrder) => {
    if (window.confirm(`Deseja concluir o lote da OP ${op.number}?`)) {
      const targetLineId = op.lineId || 'line-1';
      await finishOP(op.id, targetLineId, profile?.uid || 'coord');
      showToast(`OP ${op.number} concluída com sucesso!`);
      await loadData();
    }
  };

  const handleUpdateLeaderRotation = async (leaderId: string, lineId: string) => {
    await saveLeaderRotation(leaderId, lineId);
    setRotations(prev => ({ ...prev, [leaderId]: lineId }));
    showToast('Escala do líder atualizada no Supabase.');
    await loadData();
  };

  // ---------------- KPI COMPUTATIONS ----------------
  const todayStr = new Date().toISOString().split('T')[0];
  const currentWeekRange = React.useMemo(() => getWeekRange(todayStr), [todayStr]);

  const todayOps = ops.filter(o => o.scheduledDate === todayStr);
  const todayScheduledVolume = todayOps.reduce((acc, o) => acc + o.plannedQuantity, 0);

  const weekOps = ops.filter(o => o.scheduledDate && o.scheduledDate >= currentWeekRange.startStr && o.scheduledDate <= currentWeekRange.endStr);
  const weekScheduledVolume = weekOps.reduce((acc, o) => acc + o.plannedQuantity, 0);

  const unassignedOps = ops.filter(o => !o.lineId);
  const unassignedVolume = unassignedOps.reduce((acc, o) => acc + o.plannedQuantity, 0);
  const totalOpsVolume = ops.reduce((acc, o) => acc + o.plannedQuantity, 0);

  const totalPlanned = ops
    .filter(op => op.status === 'in_progress' || op.status === 'completed' || op.status === 'paused')
    .reduce((acc, op) => acc + op.plannedQuantity, 0);
  const totalProduced = ops.reduce((acc, op) => acc + op.producedQuantity, 0);
  const globalProgress = totalPlanned > 0 ? Math.min(Math.round((totalProduced / totalPlanned) * 100), 100) : 0;

  const activeLinesCount = lines.filter(l => l.status === 'active').length;
  const pausedLinesCount = lines.filter(l => l.status === 'paused').length;
  const idleLinesCount = lines.filter(l => l.status === 'idle').length;
  const criticalOpsCount = ops.filter(op => op.priority === 'Crítica' && op.status !== 'completed').length;

  const coordinatorCount = allUsers.filter(u => u.role === 'coordinator').length;
  const leadersCount = allUsers.filter(u => u.role === 'leader').length;
  const pendingCount = allUsers.filter(u => u.status === 'pending' || u.status === 'inactive').length;

  // Filtered OPs
  const filteredOps = ops.filter(op => {
    const term = searchTerm.toLowerCase();
    const matchSearch = op.number.toLowerCase().includes(term) || 
                        op.product.toLowerCase().includes(term) ||
                        (op.lote ? op.lote.toLowerCase().includes(term) : false) ||
                        (op.granel ? op.granel.toLowerCase().includes(term) : false);
    
    let matchStatus = true;
    if (statusFilter === 'today') {
      matchStatus = op.scheduledDate === todayStr;
    } else if (statusFilter === 'week') {
      matchStatus = Boolean(op.scheduledDate && op.scheduledDate >= currentWeekRange.startStr && op.scheduledDate <= currentWeekRange.endStr);
    } else if (statusFilter === 'unassigned') {
      matchStatus = !op.lineId;
    } else if (statusFilter === 'stock') {
      matchStatus = op.status === 'pending';
    } else if (statusFilter !== 'all') {
      matchStatus = op.status === statusFilter;
    }

    return matchSearch && matchStatus;
  });

  // Filtered Users
  const filteredUsers = allUsers.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(userSearchTerm.toLowerCase()) || 
                        u.email.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                        (u.cargo && u.cargo.toLowerCase().includes(userSearchTerm.toLowerCase()));
    const matchRole = userRoleFilter === 'all' 
      ? true 
      : userRoleFilter === 'pending'
      ? (u.status === 'pending' || u.status === 'inactive')
      : u.role === userRoleFilter;
    return matchSearch && matchRole;
  });

  // Modal Filtered Users
  const modalFilteredUsers = allUsers.filter(u => {
    if (!modalUserSearch.trim()) return true;
    const s = modalUserSearch.toLowerCase();
    return u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || (u.cargo && u.cargo.toLowerCase().includes(s));
  });

  const pendingUsersCount = allUsers.filter(
    (u) => u.status === 'pending' || u.status === 'awaiting_confirmation'
  ).length;

  const screenTitles: Record<
    DashboardTab,
    { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    home: {
      title: 'DASHBOARD',
      subtitle: 'Painel de Indicadores de Produção',
      icon: LayoutDashboard,
    },
    lines: {
      title: 'Linhas de Produção',
      subtitle: 'Monitoramento em tempo real do chão de fábrica e status operacional',
      icon: Layers,
    },
    ops: {
      title: 'Estoque de OPs',
      subtitle: 'Gestão de ordens de produção em estoque, lotes industriais e importação CSV',
      icon: Package,
    },
    rotations: {
      title: 'Escala de Líderes',
      subtitle: 'Distribuição e alocação por turno e linha de produção',
      icon: CalendarDays,
    },
    users: {
      title: 'Equipe & Gestão de Acessos',
      subtitle: 'Aprovação de cadastros, perfis e permissões industriais',
      icon: ShieldCheck,
    },
    events: {
      title: 'Auditoria Operacional',
      subtitle: 'Histórico detalhado de paradas, apontamentos e eventos',
      icon: History,
    },
  };

  const currentScreen = screenTitles[activeTab] || screenTitles.home;
  const ScreenIcon = currentScreen.icon;

  return (
    <div className="h-screen bg-[#09090b] text-[#f4f4f5] flex font-sans overflow-hidden selection:bg-blue-600 selection:text-white">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200 ${
          toastMessage.type === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200 shadow-emerald-950/50' :
          toastMessage.type === 'error' ? 'bg-red-950/90 border-red-800 text-red-200 shadow-red-950/50' :
          'bg-blue-950/90 border-blue-800 text-blue-200 shadow-blue-950/50'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
          {toastMessage.type === 'info' && <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ---------------- MENU LATERAL (SIDEBAR) ---------------- */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        linesCount={lines.length}
        activeLinesCount={activeLinesCount}
        opsCount={ops.length}
        usersCount={allUsers.length}
        pendingCount={pendingUsersCount}
        profile={profile}
        onNewOp={() => setShowNewOpModal(true)}
        onRefresh={handleManualRefresh}
        onSignOut={() => signOut()}
        isRefreshing={isRefreshing}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        mobileOpen={isMobileSidebarOpen}
        setMobileOpen={setIsMobileSidebarOpen}
      />

      {/* ---------------- ÁREA PRINCIPAL DE CONTEÚDO ---------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* CABEÇALHO SUPERIOR DA TELA ATIVA */}
        <header className="h-14 sm:h-16 border-b border-[#1e1e24] bg-[#0d0d11]/90 backdrop-blur-md flex items-center justify-between px-3 sm:px-6 shrink-0 z-20">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {/* Botão Hamburger para Mobile */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-2 rounded-xl bg-[#171720] border border-[#262632] text-[#f4f4f5] hover:text-white hover:bg-[#20202c] transition-colors shrink-0"
              title="Abrir Menu de Navegação"
            >
              <Menu className="w-5 h-5 text-blue-400" />
            </button>

            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#171720] border border-[#262632] flex items-center justify-center text-blue-400 shrink-0">
              <ScreenIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs sm:text-sm font-bold text-[#f4f4f5] tracking-tight truncate">
                {currentScreen.title}
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[#71717a] truncate font-medium">
                {currentScreen.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-[#15151c] hover:bg-[#1f1f2a] border border-[#262632] text-xs font-semibold text-[#a1a1aa] hover:text-white flex items-center gap-1.5 transition-all shrink-0"
              title="Sincronizar dados em tempo real"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sincronizar</span>
            </button>
          </div>
        </header>

        {/* CORPO PRINCIPAL POR ABA (SCROLLÁVEL) */}
        <main className="flex-1 overflow-auto p-3 sm:p-6 bg-[#09090b]">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* ---------------- TELA 1: HOME (DASHBOARD COM MÉTRICAS) ---------------- */}
            {activeTab === 'home' && (
              <HomeDashboard
                lines={lines}
                ops={ops}
                leaders={leaders}
                allUsers={allUsers}
                events={events}
                onNavigateTab={(tab) => setActiveTab(tab)}
                onNewOp={() => setShowNewOpModal(true)}
              />
            )}

            {/* ---------------- TELA 2: MONITORAMENTO DE LINHAS ---------------- */}
            {activeTab === 'lines' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                    Chão de Fábrica • Visão em Tempo Real
                  </h2>
                  <p className="text-xs text-[#71717a]">
                    Acompanhe o status instantâneo, líderes operacionais e lotes de cada linha.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-2 py-1 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Live Supabase
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {lines.map(line => {
                  const currentOp = line.currentOpId ? ops.find(o => o.id === line.currentOpId) : null;
                  
                  const leaderId = Object.keys(rotations).find(k => rotations[k] === line.id);
                  const leader = leaderId ? leaders.find(l => l.uid === leaderId) : null;

                  const latestPauseEvent = line.status === 'paused' && currentOp 
                    ? events.find(e => e.opId === currentOp.id && e.type === 'PAUSED') 
                    : null;

                  const progress = currentOp && currentOp.plannedQuantity > 0 
                    ? Math.min(Math.round((currentOp.producedQuantity / currentOp.plannedQuantity) * 100), 100) 
                    : 0;

                  return (
                    <div
                      key={line.id}
                      className={`bg-[#121216] border rounded-2xl p-5 flex flex-col justify-between transition-all ${
                        line.status === 'active'
                          ? 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.05)]'
                          : line.status === 'paused'
                          ? 'border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                          : 'border-[#242429]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between pb-3 border-b border-[#1f1f24]">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-black text-[#f4f4f5]">{line.name}</h3>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                line.status === 'active'
                                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                                  : line.status === 'paused'
                                  ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
                                  : 'bg-[#1e1e24] text-[#a1a1aa] border border-[#2c2c34]'
                              }`}>
                                {line.status === 'active' ? 'Produzindo' : line.status === 'paused' ? 'Pausada' : 'Livre / Ociosa'}
                              </span>
                            </div>
                            <p className="text-xs text-[#71717a] mt-0.5 flex items-center gap-1.5">
                              <Users className="w-3 h-3 text-blue-400" />
                              <span>Líder Responsável: <strong>{leader?.name || 'Aguardando alocação'}</strong></span>
                            </p>
                          </div>

                          {currentOp && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              currentOp.priority === 'Crítica' ? 'bg-rose-950/80 border border-rose-800/40 text-rose-400' :
                              currentOp.priority === 'Alta' ? 'bg-orange-950/80 border border-orange-800/40 text-orange-400' :
                              'bg-[#1a1a20] text-[#a1a1aa]'
                            }`}>
                              Prioridade {currentOp.priority}
                            </span>
                          )}
                        </div>

                        <div className="py-4">
                          {currentOp ? (
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <span className="text-[10px] text-blue-400 font-mono font-bold tracking-wider uppercase">
                                    OP {currentOp.number}
                                  </span>
                                  <p className="text-sm font-bold text-[#f4f4f5] leading-snug mt-0.5">
                                    {currentOp.product}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <span className="text-base font-mono font-bold text-[#f4f4f5]">
                                    {currentOp.producedQuantity} <span className="text-xs text-[#71717a]">/ {currentOp.plannedQuantity} un</span>
                                  </span>
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between text-[10px] font-mono text-[#a1a1aa] mb-1">
                                  <span>Progresso do Lote</span>
                                  <span className="font-bold text-[#f4f4f5]">{progress}%</span>
                                </div>
                                <div className="w-full h-2.5 bg-[#1f1f25] rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ${
                                      line.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              </div>

                              {line.status === 'paused' && (
                                <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-2.5 text-xs text-amber-200 flex items-start gap-2 mt-2">
                                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-bold text-amber-300">
                                      Motivo: {latestPauseEvent?.reason || 'Parada de Produção'}
                                    </p>
                                    {latestPauseEvent?.observation && (
                                      <p className="text-[11px] text-amber-200/80 mt-0.5">
                                        Obs: {latestPauseEvent.observation}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="py-6 text-center text-[#71717a] border border-dashed border-[#24242a] rounded-xl">
                              <Package className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
                              <p className="text-xs font-semibold">Nenhuma OP em execução nesta linha</p>
                              <p className="text-[10px] text-[#52525b]">Vincule ou inicie uma OP da fila de produção</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-[#1f1f24] flex items-center justify-between gap-2">
                        {currentOp ? (
                          <>
                            {line.status === 'active' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenPauseModal(currentOp)}
                                className="h-8 bg-[#18181e] hover:bg-amber-950/40 border-amber-800/40 text-amber-300 text-xs font-bold rounded-lg flex items-center gap-1.5"
                              >
                                <Pause className="w-3.5 h-3.5" />
                                <span>Pausar Linha</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleResumeOP(currentOp)}
                                className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
                              >
                                <Play className="w-3.5 h-3.5" />
                                <span>Retomar Linha</span>
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleFinishOP(currentOp)}
                              className="h-8 bg-[#18181e] hover:bg-[#22222a] border-[#2c2c35] text-[#d4d4d8] text-xs font-bold rounded-lg flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Finalizar OP</span>
                            </Button>
                          </>
                        ) : (
                          <div className="w-full flex items-center justify-between">
                            <span className="text-[10px] text-[#71717a]">Disponível para novos lotes</span>
                            <Button
                              size="sm"
                              onClick={() => {
                                setNewOpLineId(line.id);
                                setShowNewOpModal(true);
                              }}
                              className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Criar OP para Linha</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---------------- ABA 2: ESTOQUE DE OPS & IMPORTAÇÃO CSV ---------------- */}
          {activeTab === 'ops' && (
            <div className="space-y-4">
              
              {/* Header do Estoque de OPs com os botões no canto superior direito */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#111116] border border-[#202028] p-4 rounded-2xl">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                      Estoque de Ordens de Produção (OPs)
                    </h2>
                    <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full font-bold">
                      {ops.length} OPs cadastradas
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Importe planilhas CSV com os lotes disponíveis em estoque e despache para as linhas de envase.
                  </p>
                </div>

                {/* Botões no canto superior direito */}
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <Button
                    onClick={() => setShowCsvImportModal(true)}
                    className="h-9 px-3.5 bg-[#181822] hover:bg-[#222230] border border-[#2e2e3e] text-blue-400 hover:text-blue-300 text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
                    title="Importar planilha de OPs em estoque via arquivo CSV"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                    <span>Importar CSV</span>
                  </Button>

                  <Button
                    onClick={() => setShowNewOpModal(true)}
                    className="h-9 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(37,99,235,0.3)] transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar Nova OP</span>
                  </Button>
                </div>
              </div>

              {/* Cards de Métricas Rápidas do Cronograma & Estoque */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                
                {/* Meta / Programado Hoje */}
                <div className="bg-[#121217] border border-[#202027] p-3.5 rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/15 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-[#71717a] block truncate">
                      Programado Hoje
                    </span>
                    <span className="text-base font-black font-mono text-[#f4f4f5]">
                      {todayScheduledVolume.toLocaleString('pt-BR')} un
                    </span>
                    <span className="text-[10px] text-blue-400 font-semibold block">
                      {todayOps.length} {todayOps.length === 1 ? 'OP agendada' : 'OPs agendadas'}
                    </span>
                  </div>
                </div>

                {/* Meta / Programado Esta Semana */}
                <div className="bg-[#121217] border border-[#202027] p-3.5 rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-600/15 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-[#71717a] block truncate">
                      Meta Desta Semana
                    </span>
                    <span className="text-base font-black font-mono text-[#f4f4f5]">
                      {weekScheduledVolume.toLocaleString('pt-BR')} un
                    </span>
                    <span className="text-[10px] text-emerald-400 font-semibold block">
                      {weekOps.length} {weekOps.length === 1 ? 'OP agendada' : 'OPs agendadas'}
                    </span>
                  </div>
                </div>

                {/* Aguardando Linha / Estoque */}
                <div className="bg-[#121217] border border-[#202027] p-3.5 rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-600/15 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <Boxes className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-[#71717a] block truncate">
                      Aguardando Linha
                    </span>
                    <span className="text-base font-black font-mono text-[#f4f4f5]">
                      {unassignedOps.length} OPs
                    </span>
                    <span className="text-[10px] text-amber-400 font-semibold block">
                      {unassignedVolume.toLocaleString('pt-BR')} un disponíveis
                    </span>
                  </div>
                </div>

                {/* Total Geral em Carteira */}
                <div className="bg-[#121217] border border-[#202027] p-3.5 rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-600/15 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-[#71717a] block truncate">
                      Total em Carteira
                    </span>
                    <span className="text-base font-black font-mono text-[#f4f4f5]">
                      {totalOpsVolume.toLocaleString('pt-BR')} un
                    </span>
                    <span className="text-[10px] text-purple-400 font-semibold block">
                      {ops.length} OPs cadastradas
                    </span>
                  </div>
                </div>
              </div>

              {/* Barra de Filtros e Busca no Estoque & Cronograma */}
              <div className="bg-[#121216] border border-[#222226] p-3 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-[#71717a] absolute left-3 top-2.5" />
                  <Input
                    placeholder="Buscar por OP, Produto, Lote ou Granel..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 bg-[#0b0b0e] border-[#222227] pl-9 text-xs text-[#f4f4f5] rounded-xl"
                  />
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {[
                    { id: 'all', label: 'Todas as OPs' },
                    { id: 'today', label: 'Hoje' },
                    { id: 'week', label: 'Esta Semana' },
                    { id: 'unassigned', label: 'Sem Linha' },
                    { id: 'in_progress', label: 'Em Produção' },
                    { id: 'completed', label: 'Concluídas' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setStatusFilter(tab.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                        statusFilter === tab.id
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabela do Estoque de OPs & Cronograma */}
              <div className="bg-[#121216] border border-[#222226] rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#17171c] text-[#71717a] uppercase font-bold text-[10px] tracking-wider border-b border-[#222226]">
                      <tr>
                        <th className="py-3 px-4">OP</th>
                        <th className="py-3 px-4">Nome do Produto</th>
                        <th className="py-3 px-4">Lote</th>
                        <th className="py-3 px-4 text-right">Quantidade</th>
                        <th className="py-3 px-4">Granel</th>
                        <th className="py-3 px-4">Linha Destino</th>
                        <th className="py-3 px-4">Data Cronograma</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e1e23]">
                      {filteredOps.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-[#71717a]">
                            <div className="flex flex-col items-center justify-center">
                              <FileSpreadsheet className="w-8 h-8 text-[#52525b] mb-2 opacity-50" />
                              <p className="text-xs font-bold text-[#f4f4f5]">Nenhuma Ordem de Produção encontrada</p>
                              <p className="text-[11px] text-[#71717a] mt-1 max-w-sm">
                                Importe uma planilha CSV com os lotes disponíveis ou cadastre uma nova OP no botão acima.
                              </p>
                              <Button
                                size="sm"
                                onClick={() => setShowCsvImportModal(true)}
                                className="mt-3 h-8 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>Importar CSV Agora</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredOps.map((op) => {
                          const assignedLine = lines.find(l => l.id === op.lineId);
                          const progress = op.plannedQuantity > 0 ? Math.min(Math.round((op.producedQuantity / op.plannedQuantity) * 100), 100) : 0;

                          return (
                            <tr key={op.id} className="hover:bg-[#16161b] transition-colors">
                              
                              {/* OP */}
                              <td className="py-3.5 px-4">
                                <span className="font-mono font-black text-blue-400 bg-blue-950/60 border border-blue-800/40 px-2 py-1 rounded-lg text-xs">
                                  {op.number}
                                </span>
                              </td>

                              {/* NOME DO PRODUTO */}
                              <td className="py-3.5 px-4 font-bold text-[#f4f4f5] max-w-xs">
                                <div className="truncate">{op.product}</div>
                                <div className="text-[10px] text-[#71717a] font-normal mt-0.5">
                                  Prioridade: <span className="font-semibold text-[#d4d4d8]">{op.priority}</span>
                                </div>
                              </td>

                              {/* LOTE */}
                              <td className="py-3.5 px-4">
                                {op.lote ? (
                                  <span className="font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded text-[11px]">
                                    {op.lote}
                                  </span>
                                ) : (
                                  <span className="text-[#52525b] text-[11px] italic">Sem Lote</span>
                                )}
                              </td>

                              {/* QUANTIDADE */}
                              <td className="py-3.5 px-4 text-right">
                                <div className="font-mono font-black text-[#f4f4f5] text-xs">
                                  {op.plannedQuantity.toLocaleString('pt-BR')} un
                                </div>
                                {op.producedQuantity > 0 && (
                                  <div className="text-[10px] text-emerald-400 font-mono font-semibold">
                                    {op.producedQuantity.toLocaleString('pt-BR')} un ({progress}%)
                                  </div>
                                )}
                              </td>

                              {/* GRANEL */}
                              <td className="py-3.5 px-4">
                                {op.granel ? (
                                  <span className="font-mono font-semibold text-amber-300 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded text-[11px]">
                                    {op.granel}
                                  </span>
                                ) : (
                                  <span className="text-[#52525b] text-[11px] italic">Sem Granel</span>
                                )}
                              </td>

                              {/* LINHA DESTINO */}
                              <td className="py-3.5 px-4">
                                {assignedLine ? (
                                  <span className="font-semibold text-xs text-[#d4d4d8] flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                                    {assignedLine.name}
                                  </span>
                                ) : (
                                  <span className="text-[#71717a] text-[11px] italic">Disponível no Estoque</span>
                                )}
                              </td>

                              {/* DATA CRONOGRAMA */}
                              <td className="py-3.5 px-4">
                                {op.scheduledDate ? (
                                  <div className="space-y-0.5">
                                    <span className="font-semibold text-xs text-[#f4f4f5] flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                      {new Date(op.scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                    </span>
                                    {op.scheduledShift && (
                                      <span className="text-[10px] text-[#71717a] block font-medium">
                                        {op.scheduledShift}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[#52525b] text-[11px] italic">Sem Data Prevista</span>
                                )}
                              </td>

                              {/* STATUS */}
                              <td className="py-3.5 px-4">
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                  op.status === 'in_progress' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40' :
                                  op.status === 'paused' ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40' :
                                  op.status === 'completed' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                                  'bg-blue-950/60 text-blue-300 border border-blue-800/30'
                                }`}>
                                  {op.status === 'in_progress' ? 'Em Produção' :
                                   op.status === 'paused' ? 'Pausada' :
                                   op.status === 'completed' ? 'Concluída' : 'Em Estoque'}
                                </span>
                              </td>

                              {/* AÇÕES */}
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Botão de Atribuir à Linha / Cronograma */}
                                  <Button
                                    size="sm"
                                    onClick={() => handleOpenAssignModal(op)}
                                    className="h-7 px-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all hover:scale-[1.02]"
                                    title="Atribuir Linha de Produção & Programar Cronograma"
                                  >
                                    <CalendarDays className="w-3.5 h-3.5" />
                                    <span>Atribuir Linha</span>
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOpenDeleteModal(op)}
                                    className="h-7 w-7 text-[#71717a] hover:text-red-400 hover:bg-red-950/40 rounded-lg p-0 transition-colors"
                                    title={`Excluir OP ${op.number} do Estoque`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- ABA 3: ESCALA DE LÍDERES ---------------- */}
          {activeTab === 'rotations' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                  Escala & Alocação de Líderes de Produção
                </h2>
                <p className="text-xs text-[#71717a]">
                  Defina qual Líder de Chão de Fábrica opera cada Linha de Produção (armazenado no Supabase).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#121216] border border-[#222226] rounded-2xl p-5 shadow-xl">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    Líderes Disponíveis ({leaders.length})
                  </h3>

                  {leaders.length === 0 ? (
                    <div className="py-8 text-center text-[#71717a] text-xs">
                      Nenhum Líder com cargo `leader` cadastrado ainda no Supabase.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {leaders.map(ldr => {
                        const currentLineId = rotations[ldr.uid] || 'line-1';
                        return (
                          <div key={ldr.uid} className="bg-[#17171d] border border-[#26262e] p-3.5 rounded-xl flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-[#f4f4f5]">{ldr.name}</p>
                              <p className="text-[11px] text-[#71717a]">{ldr.email}</p>
                            </div>

                            <div className="flex items-center gap-2">
                              <Label className="text-[10px] uppercase font-bold text-[#71717a]">Linha:</Label>
                              <select
                                value={currentLineId}
                                onChange={(e) => handleUpdateLeaderRotation(ldr.uid, e.target.value)}
                                className="h-8 bg-[#0d0d10] border border-[#282830] text-xs text-[#f4f4f5] rounded-lg px-2 font-semibold focus:ring-1 focus:ring-blue-500"
                              >
                                {lines.map(line => (
                                  <option key={line.id} value={line.id}>
                                    {line.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-[#121216] border border-[#222226] rounded-2xl p-5 shadow-xl">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Mapa de Cobertura por Linha
                  </h3>

                  <div className="space-y-3">
                    {lines.map(line => {
                      const assignedLeaderId = Object.keys(rotations).find(k => rotations[k] === line.id);
                      const leader = assignedLeaderId ? leaders.find(l => l.uid === assignedLeaderId) : null;

                      return (
                        <div key={line.id} className="bg-[#17171d] border border-[#26262e] p-3.5 rounded-xl flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-[#f4f4f5]">{line.name}</p>
                            <span className="text-[10px] text-[#71717a] uppercase font-bold">Status: {line.status}</span>
                          </div>

                          <div className="text-right">
                            {leader ? (
                              <span className="text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-1 rounded-lg">
                                {leader.name}
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 rounded-lg">
                                Sem Líder Alocado
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- ABA 4: GESTÃO DE EQUIPE & ACESSOS ---------------- */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                    Gestão de Equipe, Acessos & Promoção de Coordenadores
                  </h2>
                  <p className="text-xs text-[#71717a]">
                    Autorize novos e-mails, promova líderes a coordenadores e controle os acessos de chão de fábrica.
                  </p>
                </div>

                <Button
                  onClick={() => setShowAuthorizeModal(true)}
                  className="h-9 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-[0_0_12px_rgba(37,99,235,0.3)]"
                >
                  <Users className="w-4 h-4" />
                  <span>Cadastros & Acessos</span>
                  {pendingCount > 0 && (
                    <span className="bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </Button>
              </div>

              {/* Banner de Ajuda: Confirmação de E-mail */}
              <div className="bg-[#15151c] border border-blue-900/40 rounded-2xl p-4 flex items-start gap-3 shadow-lg">
                <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5 text-blue-400">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="flex-1 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="font-bold text-[#f4f4f5]">Dica sobre "E-mail não confirmado" no Supabase</h4>
                    <Button
                      size="sm"
                      onClick={handleCopyConfirmAllSql}
                      className="h-7 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded-lg px-2.5 font-semibold shrink-0"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copiar SQL p/ Validar Todos
                    </Button>
                  </div>
                  <p className="text-[#a1a1aa] text-[11px] mt-1 leading-relaxed">
                    Se um colaborador cadastrado receber a mensagem de e-mail não confirmado ao tentar fazer login:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    <div className="bg-[#0e0e12] border border-[#23232b] p-2.5 rounded-xl">
                      <p className="text-blue-300 font-bold text-[11px]">Opção 1: Liberação Imediata via SQL</p>
                      <p className="text-[#71717a] text-[10px] mt-0.5">
                        Clique no ícone de envelope <Mail className="w-3 h-3 inline mx-0.5 text-blue-400" /> na tabela para copiar o comando de validação instantânea no Supabase SQL Editor.
                      </p>
                    </div>
                    <div className="bg-[#0e0e12] border border-[#23232b] p-2.5 rounded-xl">
                      <p className="text-emerald-300 font-bold text-[11px]">Opção 2: Desativar no Supabase</p>
                      <p className="text-[#71717a] text-[10px] mt-0.5">
                        No painel do Supabase, acesse <strong>Authentication &gt; Providers &gt; Email</strong> e desmarque a opção <strong>Confirm email</strong> para liberar entrada direta sem link.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Filtros de Usuários */}
              <div className="bg-[#121216] border border-[#222226] p-3 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-[#71717a] absolute left-3 top-2.5" />
                  <Input
                    placeholder="Buscar colaborador por nome, e-mail ou cargo..."
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    className="h-9 bg-[#0b0b0e] border-[#222227] pl-9 text-xs text-[#f4f4f5] rounded-xl"
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setUserRoleFilter('all')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      userRoleFilter === 'all' ? 'bg-blue-600 text-white' : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22]'
                    }`}
                  >
                    Todos ({allUsers.length})
                  </button>
                  {pendingCount > 0 && (
                    <button
                      onClick={() => setUserRoleFilter('pending')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                        userRoleFilter === 'pending' ? 'bg-amber-500 text-black' : 'text-amber-400 hover:bg-amber-950/20'
                      }`}
                    >
                      <span>Aguardando ({pendingCount})</span>
                    </button>
                  )}
                  <button
                    onClick={() => setUserRoleFilter('coordinator')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      userRoleFilter === 'coordinator' ? 'bg-blue-600 text-white' : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22]'
                    }`}
                  >
                    Coordenadores ({coordinatorCount})
                  </button>
                  <button
                    onClick={() => setUserRoleFilter('leader')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      userRoleFilter === 'leader' ? 'bg-blue-600 text-white' : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22]'
                    }`}
                  >
                    Líderes ({leadersCount})
                  </button>
                </div>
              </div>

              {/* Tabela de Colaboradores & Acessos */}
              <div className="bg-[#121216] border border-[#222226] rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#17171c] text-[#71717a] uppercase font-bold text-[10px] tracking-wider border-b border-[#222226]">
                      <tr>
                        <th className="py-3.5 px-4">Colaborador</th>
                        <th className="py-3.5 px-4">E-mail Corporativo</th>
                        <th className="py-3.5 px-4">Cargo / Nível</th>
                        <th className="py-3.5 px-4">Status de Acesso</th>
                        <th className="py-3.5 px-4 text-right">Ações da Coordenação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e1e23]">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-[#71717a]">
                            Nenhum colaborador encontrado com os filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isSelf = user.uid === profile?.uid;
                          const isCoordinator = user.role === 'coordinator';
                          const isActive = user.status !== 'inactive';

                          return (
                            <tr key={user.uid || user.email} className="hover:bg-[#16161b] transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black uppercase ${
                                    isCoordinator 
                                      ? 'bg-blue-600/20 border border-blue-500/40 text-blue-400' 
                                      : 'bg-[#22222a] border border-[#2c2c36] text-[#a1a1aa]'
                                  }`}>
                                    {user.name.substring(0, 2)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#f4f4f5] flex items-center gap-1.5">
                                      <span>{user.name}</span>
                                      {isSelf && (
                                        <span className="text-[9px] bg-blue-950/80 border border-blue-800/40 text-blue-400 px-1.5 py-0.2 rounded font-bold">
                                          Você
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3.5 px-4 font-mono text-[#a1a1aa]">
                                {user.email}
                              </td>

                              <td className="py-3.5 px-4">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 w-fit ${
                                  isCoordinator
                                    ? 'bg-blue-950/80 text-blue-400 border border-blue-800/40'
                                    : 'bg-[#1c1c24] text-[#d4d4d8] border border-[#292934]'
                                }`}>
                                  {isCoordinator ? <Award className="w-3 h-3 text-blue-400" /> : <Users className="w-3 h-3 text-[#71717a]" />}
                                  <span>{user.cargo || (isCoordinator ? 'Coordenador Geral' : 'Líder de Produção')}</span>
                                </span>
                              </td>

                              <td className="py-3.5 px-4">
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded flex items-center gap-1 w-fit ${
                                  isActive
                                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                                    : 'bg-red-950/80 text-red-400 border border-red-800/40'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                  <span>{isActive ? 'Ativo' : 'Bloqueado'}</span>
                                </span>
                              </td>

                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Botão Promover / Rebaixar Cargo */}
                                  {!isCoordinator ? (
                                    <Button
                                      size="sm"
                                      onClick={() => handlePromoteToCoordinator(user)}
                                      className="h-7 px-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow-sm"
                                      title="Promover a Coordenador Geral"
                                    >
                                      <Award className="w-3 h-3 text-white" />
                                      <span>Promover a Coordenador</span>
                                    </Button>
                                  ) : (
                                    !isSelf && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleDemoteToLeader(user)}
                                        className="h-7 px-2 bg-[#17171d] hover:bg-[#22222a] border-[#292935] text-[#a1a1aa] hover:text-white text-[11px] font-semibold rounded-lg"
                                        title="Alterar para Líder de Produção"
                                      >
                                        <span>Tornar Líder</span>
                                      </Button>
                                    )
                                  )}

                                  {/* Botão Alternar Status (Ativo / Bloqueado) */}
                                  {!isSelf && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleToggleUserStatus(user)}
                                      className={`h-7 px-2 text-[11px] font-bold rounded-lg ${
                                        isActive
                                          ? 'bg-amber-950/30 border-amber-800/40 text-amber-300 hover:bg-amber-950/50'
                                          : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300 hover:bg-emerald-950/50'
                                      }`}
                                      title={isActive ? 'Bloquear Acesso' : 'Desbloquear Acesso'}
                                    >
                                      {isActive ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                                      <span>{isActive ? 'Bloquear' : 'Ativar'}</span>
                                    </Button>
                                  )}

                                  {/* Botão Copiar SQL Confirmação E-mail */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleCopyConfirmEmailSql(user.email)}
                                    className="h-7 px-2 text-[#71717a] hover:text-emerald-400 hover:bg-emerald-950/20 text-[11px] rounded-lg"
                                    title="Copiar SQL para validar/confirmar e-mail no Supabase"
                                  >
                                    <Mail className="w-3.5 h-3.5" />
                                  </Button>

                                  {/* Botão Copiar SQL para Supabase */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleCopySqlForUser(user.email)}
                                    className="h-7 px-2 text-[#71717a] hover:text-blue-400 hover:bg-blue-950/20 text-[11px] rounded-lg"
                                    title="Copiar SQL de Coordenador para Supabase"
                                  >
                                    {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </Button>

                                  {/* Botão Excluir */}
                                  {!isSelf && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteUserRecord(user)}
                                      className="h-7 w-7 text-[#71717a] hover:text-red-400 hover:bg-red-950/30 rounded-lg p-0"
                                      title="Remover Colaborador"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- ABA 5: AUDITORIA & EVENTOS ---------------- */}
          {activeTab === 'events' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5]">
                  Feed de Eventos e Auditoria de Chão de Fábrica
                </h2>
                <p className="text-xs text-[#71717a]">
                  Registro cronológico de paradas, apontamentos de quantidade, inícios e conclusões de lotes.
                </p>
              </div>

              <div className="bg-[#121216] border border-[#222226] rounded-2xl overflow-hidden shadow-xl p-4">
                {events.length === 0 ? (
                  <div className="py-8 text-center text-[#71717a] text-xs">
                    Nenhum evento registrado no histórico recente.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e1e23]">
                    {events.map((evt) => (
                      <div key={evt.id} className="py-3.5 flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            evt.type === 'STARTED' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40' :
                            evt.type === 'PAUSED' ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40' :
                            evt.type === 'RESUMED' ? 'bg-blue-950/80 text-blue-400 border border-blue-800/40' :
                            evt.type === 'FINISHED' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                            'bg-[#1c1c24] text-[#a1a1aa]'
                          }`}>
                            {evt.type === 'STARTED' && <Play className="w-3.5 h-3.5" />}
                            {evt.type === 'PAUSED' && <Pause className="w-3.5 h-3.5" />}
                            {evt.type === 'RESUMED' && <Play className="w-3.5 h-3.5" />}
                            {evt.type === 'FINISHED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {evt.type === 'QUANTITY_REPORTED' && <TrendingUp className="w-3.5 h-3.5" />}
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[#f4f4f5]">
                                {evt.type === 'STARTED' && 'Início de Produção'}
                                {evt.type === 'PAUSED' && 'Parada de Linha / Pausa'}
                                {evt.type === 'RESUMED' && 'Retomada de Produção'}
                                {evt.type === 'FINISHED' && 'Conclusão de Lote'}
                                {evt.type === 'QUANTITY_REPORTED' && `Apontamento de Quantidade (+${evt.quantity} un)`}
                              </span>
                              <span className="text-[10px] text-blue-400 font-mono font-bold">
                                {evt.opNumber ? `OP ${evt.opNumber}` : ''}
                              </span>
                              <span className="text-[10px] text-[#71717a]">
                                • {evt.lineName || 'Linha'}
                              </span>
                            </div>

                            {evt.reason && (
                              <p className="text-xs text-amber-300 font-semibold mt-0.5">
                                Motivo: {evt.reason}
                              </p>
                            )}

                            {evt.observation && (
                              <p className="text-[11px] text-[#a1a1aa] mt-0.5">
                                Detalhes: {evt.observation}
                              </p>
                            )}

                            <p className="text-[10px] text-[#71717a] mt-1">
                              Operado por: <strong>{evt.leaderName || 'Líder de Produção'}</strong>
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono text-[#71717a] shrink-0">
                          {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          </div>
        </main>
      </div>

      {/* ---------------- MODAL: CADASTROS & CONFIRMAÇÕES DE USUÁRIOS ---------------- */}
      {showAuthorizeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-[#27272e] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            
            {/* Header do Modal */}
            <div className="p-4 border-b border-[#222228] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wide">
                      Gestão de Cadastros & Confirmações
                    </h3>
                    {pendingCount > 0 && (
                      <span className="bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.2 rounded-full">
                        {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#71717a]">
                    Confirme acessos pendentes, promova colaboradores e gerencie permissões.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAuthorizeModal(false)}
                className="text-[#71717a] hover:text-white p-1 rounded-lg hover:bg-[#1a1a22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo: Lista de Cadastros & Confirmações */}
            <div className="flex-1 overflow-hidden flex flex-col p-4 space-y-3">
              {/* Barra de Ações & Busca rápida */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-2.5" />
                  <Input
                    placeholder="Filtrar colaboradores por nome ou e-mail..."
                    value={modalUserSearch}
                    onChange={(e) => setModalUserSearch(e.target.value)}
                    className="h-8 bg-[#0b0b0e] border-[#222227] pl-8 text-xs text-[#f4f4f5] rounded-lg"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleCopyConfirmAllSql}
                  className="h-8 text-[11px] bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg px-3 font-semibold shrink-0"
                  title="Copia o script SQL para confirmar e ativar todos os colaboradores no Supabase de uma só vez"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copiar SQL Validar Todos
                </Button>
              </div>

              {/* Lista de Usuários com Scroll */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[55vh]">
                {modalFilteredUsers.length === 0 ? (
                  <div className="p-8 text-center bg-[#0d0d10] border border-[#222228] rounded-xl">
                    <Users className="w-8 h-8 text-[#52525b] mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-[#f4f4f5]">Nenhum colaborador encontrado</p>
                    <p className="text-[11px] text-[#71717a] mt-1">
                      Os usuários cadastrados na tela de login aparecerão automaticamente aqui para aprovação.
                    </p>
                  </div>
                ) : (
                  modalFilteredUsers.map((user) => {
                    const isSelf = user.uid === profile?.uid;
                    const isCoordinator = user.role === 'coordinator';
                    const isPending = user.status === 'pending';
                    const isInactive = user.status === 'inactive';

                    return (
                      <div
                        key={user.uid || user.email}
                        className="bg-[#0e0e12] border border-[#23232b] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-[#32323e] transition-all"
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-black ${
                            isCoordinator ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                          }`}>
                            {user.name?.charAt(0).toUpperCase() || 'U'}
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-[#f4f4f5]">{user.name}</span>
                              {isSelf && (
                                <span className="text-[9px] bg-blue-950 text-blue-400 border border-blue-800/50 px-1.5 py-0.2 rounded font-bold">
                                  VOCÊ
                                </span>
                              )}
                              
                              {/* Badge de Status */}
                              {isPending && (
                                <span className="text-[9px] bg-amber-950/80 text-amber-300 border border-amber-800/60 px-1.5 py-0.2 rounded font-bold flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" /> Aguardando Confirmação
                                </span>
                              )}
                              {isInactive && (
                                <span className="text-[9px] bg-rose-950/80 text-rose-300 border border-rose-800/60 px-1.5 py-0.2 rounded font-bold">
                                  Bloqueado
                                </span>
                              )}
                              {!isPending && !isInactive && (
                                <span className="text-[9px] bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 px-1.5 py-0.2 rounded font-bold">
                                  Ativo
                                </span>
                              )}

                              {/* Badge de Cargo */}
                              <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                                isCoordinator ? 'bg-blue-950/60 text-blue-400 border border-blue-900/40' : 'bg-[#1a1a22] text-[#a1a1aa] border border-[#2b2b36]'
                              }`}>
                                {isCoordinator ? 'Coordenador Geral' : 'Líder de Produção'}
                              </span>
                            </div>

                            <p className="text-[11px] font-mono text-[#71717a] mt-0.5">{user.email}</p>
                          </div>
                        </div>

                        {/* Ações Rápidas */}
                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0 flex-wrap">
                          {/* Botão Aprovar / Ativar Acesso */}
                          {(isPending || isInactive) && (
                            <Button
                              size="sm"
                              onClick={() => handleApproveUser(user, user.role)}
                              className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 font-bold flex items-center gap-1 shadow-sm"
                              title="Aprovar e liberar acesso deste usuário"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Aprovar Acesso</span>
                            </Button>
                          )}

                          {/* Botão Promover a Coordenador */}
                          {!isCoordinator && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApproveUser(user, 'coordinator')}
                              className="h-7 text-[11px] border-blue-600/40 text-blue-400 hover:bg-blue-950/30 rounded-lg px-2 flex items-center gap-1"
                              title="Promover a Coordenador Geral"
                            >
                              <Award className="w-3 h-3" />
                              <span>Tornar Coordenador</span>
                            </Button>
                          )}

                          {/* Botão Rebaixar a Líder */}
                          {isCoordinator && !isSelf && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleApproveUser(user, 'leader')}
                              className="h-7 text-[10px] text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1a1a22] rounded-lg px-2"
                              title="Definir como Líder de Produção"
                            >
                              Tornar Líder
                            </Button>
                          )}

                          {/* Botão Copiar SQL de Confirmação de E-mail */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyConfirmEmailSql(user.email)}
                            className="h-7 px-2 text-[#71717a] hover:text-emerald-400 hover:bg-emerald-950/20 text-[11px] rounded-lg"
                            title="Copiar SQL para validar/confirmar e-mail no Supabase"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </Button>

                          {/* Botão Copiar SQL Coordenador */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopySqlForUser(user.email)}
                            className="h-7 px-2 text-[#71717a] hover:text-blue-400 hover:bg-blue-950/20 text-[11px] rounded-lg"
                            title="Copiar SQL completo para Supabase"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>

                          {/* Botão Excluir */}
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteUserRecord(user)}
                              className="h-7 w-7 text-[#71717a] hover:text-red-400 hover:bg-red-950/30 rounded-lg p-0"
                              title="Remover Colaborador"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-2 border-t border-[#1e1e24] flex items-center justify-between text-[11px] text-[#71717a]">
                <span>Total de colaboradores cadastrados: <strong>{allUsers.length}</strong></span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAuthorizeModal(false)}
                  className="h-8 text-xs text-[#a1a1aa] hover:text-white"
                >
                  Fechar
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ---------------- MODAL: NOVA OP ---------------- */}
      {showNewOpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-[#27272e] w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[#222228] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wide">
                  Cadastrar Ordem de Produção (OP)
                </h3>
              </div>
              <button
                onClick={() => setShowNewOpModal(false)}
                className="text-[#71717a] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOP} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Número da OP *</Label>
                  <Input
                    placeholder="Ex: 40236"
                    value={newOpNumber}
                    onChange={(e) => setNewOpNumber(e.target.value)}
                    className="bg-[#0b0b0e] border-[#25252c] text-xs font-mono font-bold text-[#f4f4f5]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Prioridade *</Label>
                  <select
                    value={newOpPriority}
                    onChange={(e) => setNewOpPriority(e.target.value as any)}
                    className="w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-md px-3 text-xs text-[#f4f4f5] font-semibold"
                  >
                    <option value="Crítica">Crítica (Urgência Máxima)</option>
                    <option value="Alta">Alta</option>
                    <option value="Normal">Normal</option>
                    <option value="Baixa">Baixa</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Descrição do Produto *</Label>
                <Input
                  placeholder="Ex: Shampoo Nutritivo Pro 500ml"
                  value={newOpProduct}
                  onChange={(e) => setNewOpProduct(e.target.value)}
                  className="bg-[#0b0b0e] border-[#25252c] text-xs font-semibold text-[#f4f4f5]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Lote do Produto</Label>
                  <Input
                    placeholder="Ex: LT-24-101"
                    value={newOpLote}
                    onChange={(e) => setNewOpLote(e.target.value)}
                    className="bg-[#0b0b0e] border-[#25252c] text-xs font-mono text-emerald-400"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Código/Lote do Granel</Label>
                  <Input
                    placeholder="Ex: GR-SH-910"
                    value={newOpGranel}
                    onChange={(e) => setNewOpGranel(e.target.value)}
                    className="bg-[#0b0b0e] border-[#25252c] text-xs font-mono text-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Qtd Planejada (un) *</Label>
                  <Input
                    type="number"
                    placeholder="Ex: 2500"
                    value={newOpPlanned}
                    onChange={(e) => setNewOpPlanned(e.target.value)}
                    className="bg-[#0b0b0e] border-[#25252c] text-xs font-mono font-bold text-[#f4f4f5]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Linha Alocada</Label>
                  <select
                    value={newOpLineId}
                    onChange={(e) => setNewOpLineId(e.target.value)}
                    className="w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-md px-3 text-xs text-[#f4f4f5] font-semibold"
                  >
                    <option value="">Estoque Geral (Sem linha fixa)</option>
                    {lines.map(line => (
                      <option key={line.id} value={line.id}>{line.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Disponibilidade de Embalagens</Label>
                <Input
                  type="number"
                  placeholder="Ex: 5000"
                  value={newOpPackage}
                  onChange={(e) => setNewOpPackage(e.target.value)}
                  className="bg-[#0b0b0e] border-[#25252c] text-xs font-mono text-[#f4f4f5]"
                />
              </div>

              <div className="pt-3 border-t border-[#222228] flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowNewOpModal(false)}
                  className="h-9 text-xs text-[#a1a1aa] hover:text-white"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingOp}
                  className="h-9 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl"
                >
                  {isSubmittingOp ? 'Gravando no Supabase...' : 'Confirmar e Salvar no Estoque'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: IMPORTAR CSV DO ESTOQUE ---------------- */}
      <CsvImportModal
        isOpen={showCsvImportModal}
        onClose={() => setShowCsvImportModal(false)}
        onSuccess={(imported) => {
          showToast(`${imported.length} Ordens de Produção importadas com sucesso para o estoque!`);
          loadData();
        }}
      />

      {/* ---------------- MODAL: PAUSAR OP ---------------- */}
      {pauseModalData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-[#27272e] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[#222228] flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <Pause className="w-4 h-4" />
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  Pausar OP {pauseModalData.opNumber}
                </h3>
              </div>
              <button
                onClick={() => setPauseModalData(null)}
                className="text-[#71717a] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Motivo da Parada *</Label>
                <select
                  value={selectedPauseReason}
                  onChange={(e) => setSelectedPauseReason(e.target.value)}
                  className="w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-md px-3 text-xs text-[#f4f4f5] font-semibold"
                >
                  {pauseReasons.map(pr => (
                    <option key={pr.id} value={pr.name}>{pr.name} ({pr.category || 'Geral'})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Observação do Chão de Fábrica</Label>
                <textarea
                  placeholder="Ex: Aguardando liberação de lote pelo laboratório de qualidade..."
                  value={pauseObservation}
                  onChange={(e) => setPauseObservation(e.target.value)}
                  className="w-full h-20 bg-[#0b0b0e] border border-[#25252c] rounded-md p-2.5 text-xs text-[#f4f4f5] resize-none"
                />
              </div>

              <div className="pt-3 border-t border-[#222228] flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPauseModalData(null)}
                  className="h-9 text-xs text-[#a1a1aa] hover:text-white"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirmPause}
                  className="h-9 px-4 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl"
                >
                  Confirmar Parada
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: CONFIRMAR EXCLUSÃO DE OP ---------------- */}
      {deleteModalOp && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-red-900/40 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="p-5 border-b border-[#222228] bg-red-950/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wide">
                      Excluir OP do Estoque
                    </h3>
                    <span className="text-[10px] bg-red-950 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-full font-mono font-bold">
                      OP #{deleteModalOp.number}
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Confirme a remoção definitiva da Ordem de Produção
                  </p>
                </div>
              </div>

              <button
                onClick={() => !isDeletingOp && setDeleteModalOp(null)}
                className="text-[#71717a] hover:text-white p-1 rounded-lg hover:bg-[#1f1f28] transition-colors"
                disabled={isDeletingOp}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-5 space-y-4">
              
              {/* Card de Detalhes da OP */}
              <div className="bg-[#0b0b0e] border border-[#222228] rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] text-[#71717a] uppercase font-bold">Produto</span>
                  <span className="text-xs font-bold text-[#f4f4f5] text-right max-w-[240px] truncate">
                    {deleteModalOp.product}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1e1e24] text-xs">
                  <div>
                    <span className="text-[10px] text-[#71717a] uppercase font-bold block">Lote</span>
                    <span className="font-mono font-bold text-emerald-400 text-[11px]">
                      {deleteModalOp.lote || 'Sem Lote'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#71717a] uppercase font-bold block">Quantidade</span>
                    <span className="font-mono font-bold text-[#f4f4f5] text-[11px]">
                      {deleteModalOp.plannedQuantity.toLocaleString('pt-BR')} un
                    </span>
                  </div>
                </div>

                {deleteModalOp.granel && (
                  <div className="pt-2 border-t border-[#1e1e24] flex items-center justify-between text-xs">
                    <span className="text-[10px] text-[#71717a] uppercase font-bold">Granel</span>
                    <span className="font-mono font-semibold text-amber-300 text-[11px]">
                      {deleteModalOp.granel}
                    </span>
                  </div>
                )}
              </div>

              {/* Mensagem de Aviso */}
              <div className="bg-red-950/30 border border-red-900/40 p-3 rounded-xl flex items-start gap-2.5 text-xs text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Tem certeza de que deseja remover esta Ordem de Produção do Estoque? Esta ação apagará o registro no sistema e não poderá ser desfeita.
                </p>
              </div>

              {/* Ações */}
              <div className="pt-3 border-t border-[#222228] flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isDeletingOp}
                  onClick={() => setDeleteModalOp(null)}
                  className="h-9 text-xs text-[#a1a1aa] hover:text-white"
                >
                  Cancelar
                </Button>
                
                <Button
                  disabled={isDeletingOp}
                  onClick={handleConfirmDelete}
                  className="h-9 px-4 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(220,38,38,0.35)]"
                >
                  {isDeletingOp ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Excluindo...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirmar Exclusão</span>
                    </>
                  )}
                </Button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ATRIBUIR À LINHA & CRONOGRAMA */}
      <AssignLineModal
        isOpen={Boolean(assignModalOp)}
        onClose={() => setAssignModalOp(null)}
        op={assignModalOp}
        lines={lines}
        allOps={ops}
        onSave={handleSaveAssignment}
      />

    </div>
  );
}
