import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Layers,
  Package,
  ShieldCheck,
  History,
  TrendingUp,
  Sparkles,
  BarChart3,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  UserCheck,
  UserX,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Trash2,
  Edit,
  SlidersHorizontal,
  FileSpreadsheet,
  X,
  Target,
  Share2,
  Eye,
  KeyRound,
  Edit2,
  Loader2,
  Info,
  XCircle,
  Copy,
  Check,
  Lock,
  ArrowRight,
  Maximize2,
  Minimize2,
  Users,
  Factory
} from 'lucide-react';
import {
  getLines,
  createLine,
  getAllOPs,
  createOP,
  updateOP,
  deleteOP,
  startOP,
  pauseOP,
  resumeOP,
  finishOP,
  cancelOP,
  reportQuantity,
  getAllUsers,
  getLeaders,
  updateUserRole,
  updateUserRule,
  updateUserStatus,
  preAuthorizeUser,
  syncPendingLeadersToSupabase,
  resetLeaderPassword,
  deleteUserProfile,
  getAllRotations,
  getRecentEvents,
  getPauseReasons,
  getMonthlyGoals,
  getLineDailyGoals,
  getFactoryMonthlyGoal,
  getFactoryMonthlyGoals,
  DEFAULT_PAUSE_REASONS
} from '../services/db';
import {
  ProductionLine,
  ProductionOrder,
  UserProfile,
  ProductionEvent,
  PauseReason,
  MonthlyGoal,
  LineDailyGoal,
  FactoryMonthlyGoal,
  DashboardTab,
  AccessRule
} from '../types';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { getIndustriaBadgeClass } from '../lib/industria';
import { ACCESS_RULES, getUserRule, getUserAllowedTabs } from '../lib/permissions';
import { Sidebar } from '../components/Sidebar';
import { HomeDashboard } from '../components/HomeDashboard';
import { PesagemScreen } from './PesagemScreen';
import { ManipulacaoScreen } from './ManipulacaoScreen';
import { LeaderScreen } from './LeaderScreen';
import { CronogramaBoard, BACKLOG_COLUMN_ID } from '../components/CronogramaBoard';
import { DailyProductionHistory } from '../components/DailyProductionHistory';
import { TrainingSimulator } from './TrainingSimulator';
import { GoalsModal } from '../components/GoalsModal';
import { ShareDashboardModal } from '../components/ShareDashboardModal';
import { CsvImportModal } from '../components/CsvImportModal';
import { AssignLineModal } from '../components/AssignLineModal';
import { AssignStockOpToLineModal } from '../components/AssignStockOpToLineModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../components/ui/dialog';

function getLocalDateStr(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CoordinatorDashboard() {
  const { profile, signOut } = useAuthStore();

  const [activeTab, setActiveTab] = useState<DashboardTab>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Dados globais
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [ops, setOps] = useState<ProductionOrder[]>([]);
  const [events, setEvents] = useState<ProductionEvent[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [rotations, setRotations] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [lineDailyGoals, setLineDailyGoals] = useState<LineDailyGoal[]>([]);
  const [factoryMonthlyGoal, setFactoryMonthlyGoal] = useState<number | null>(null);
  const [factoryMonthlyGoals, setFactoryMonthlyGoals] = useState<FactoryMonthlyGoal[]>([]);
  const [pauseReasons, setPauseReasons] = useState<PauseReason[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modais de PCP e Gestão
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [assignModalOp, setAssignModalOp] = useState<ProductionOrder | null>(null);
  const [assignStockLine, setAssignStockLine] = useState<ProductionLine | null>(null);

  // Modal: Nova / Editar OP
  const [showOpModal, setShowOpModal] = useState(false);
  const [editingOp, setEditingOp] = useState<ProductionOrder | null>(null);
  const [opFormData, setOpFormData] = useState({
    number: '',
    product: '',
    plannedQuantity: '',
    lote: '',
    granel: '',
    priority: 'Normal' as ProductionOrder['priority'],
    setor: 'Envase' as ProductionOrder['setor'],
    unidade: 'Un' as ProductionOrder['unidade'],
    lineId: '',
    scheduledDate: getLocalDateStr(),
    scheduledShift: 'Manhã',
    tipoDocumento: 'OP' as 'OP' | 'OSM',
    industria: 'Ybera',
    observation: ''
  });
  const [isSavingOp, setIsSavingOp] = useState(false);

  // Modal: Detalhes da OP (Estoque de OPs)
  const [detailsModalOp, setDetailsModalOp] = useState<ProductionOrder | null>(null);

  // Modal: Excluir OP
  const [deleteModalOp, setDeleteModalOp] = useState<ProductionOrder | null>(null);
  const [isDeletingOp, setIsDeletingOp] = useState(false);

  // Modal: Pausar OP
  const [pauseModalData, setPauseModalData] = useState<{ opId: string; lineId: string; opNumber: string } | null>(null);
  const [selectedPauseReason, setSelectedPauseReason] = useState('');
  const [pauseObs, setPauseObs] = useState('');
  const [isPausingOp, setIsPausingOp] = useState(false);

  // Modal: Detalhes do Colaborador (Gestão de Equipe)
  const [detailsModalUserId, setDetailsModalUserId] = useState<string | null>(null);

  // Modal: Cadastrar Novo Colaborador
  const [showAuthorizeModal, setShowAuthorizeModal] = useState(false);
  const [newUserFormData, setNewUserFormData] = useState({
    name: '',
    email: '',
    cargo: '',
    area: 'Envase' as 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação',
    rule: 'envase' as AccessRule,
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [userCreatedPassword, setUserCreatedPassword] = useState<string | null>(null);

  // Modal: Confirmar Exclusão de Colaborador
  const [deleteUserModalData, setDeleteUserModalData] = useState<UserProfile | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Sincronização de pendentes
  const [isSyncingPending, setIsSyncingPending] = useState(false);

  // Filtros de Estoque de OPs
  const [opsFilterTab, setOpsFilterTab] = useState<'today' | 'week' | 'unassigned' | 'completed' | 'all'>('all');
  const [opsSearchTerm, setOpsSearchTerm] = useState('');
  const [opsSectorFilter, setOpsSectorFilter] = useState<'Todos' | 'Envase' | 'Pesagem' | 'Manipulação'>('Todos');

  // Filtros de Usuários
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRuleFilter, setUserRuleFilter] = useState<string>('all');

  // Filtros de Auditoria
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [eventLineFilter, setEventLineFilter] = useState<string>('all');

  // Toast simples
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      const [ls, os, evts, usrs, ldrs, rots, gls, ldgs, fmg, fmgs, prs] = await Promise.all([
        getLines(),
        getAllOPs(),
        getRecentEvents(),
        getAllUsers(),
        getLeaders(),
        getAllRotations(),
        getMonthlyGoals(currentYear),
        getLineDailyGoals(),
        getFactoryMonthlyGoal(currentYear, currentMonth),
        getFactoryMonthlyGoals(currentYear),
        getPauseReasons()
      ]);

      setLines(ls || []);
      setOps(os || []);
      setEvents(evts || []);
      setAllUsers(usrs || []);
      setLeaders(ldrs || []);
      setRotations(rots || {});
      setGoals(gls || []);
      setLineDailyGoals(ldgs || []);
      setFactoryMonthlyGoal(fmg);
      setFactoryMonthlyGoals(fmgs || []);
      setPauseReasons(prs && prs.length > 0 ? prs : DEFAULT_PAUSE_REASONS);
    } catch (err) {
      console.error('Erro ao carregar dados do coordenador:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  // Carregamento inicial e Realtime
  useEffect(() => {
    loadDataRef.current();

    const stableRefresh = () => loadDataRef.current(true);

    const channel = supabase
      .channel('coordinator-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops' }, stableRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lines' }, stableRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, stableRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, stableRefresh)
      .subscribe();

    const interval = setInterval(() => {
      loadDataRef.current(true);
    }, 20000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  // PCP Handlers
  const handleAssignToQueue = async (opId: string, lineId: string, scheduledDate?: string) => {
    const date = scheduledDate || getLocalDateStr();
    await updateOP(opId, {
      lineId,
      scheduledDate: date,
      scheduledEndDate: date,
      scheduledDays: 1,
    });
    showToast('OP colocada na fila de produção da linha com sucesso.');
    await loadData(true);
  };

  const handleUnassign = async (opId: string) => {
    await updateOP(opId, {
      lineId: null,
      sequence: 0,
    });
    showToast('OP devolvida ao estoque.');
    await loadData(true);
  };

  const handleReorderColumn = async (columnId: string, orderedOpIds: string[], scheduledDate?: string) => {
    const columnOps = columnId === BACKLOG_COLUMN_ID
      ? ops.filter(o => !o.lineId && o.status !== 'completed')
      : ops.filter(o => o.lineId === columnId && o.status !== 'completed' && (!scheduledDate || o.scheduledDate === scheduledDate));

    const sortedSequences = columnOps
      .map(o => o.sequence || 0)
      .sort((a, b) => a - b);

    const updatePromises = orderedOpIds.map((id, index) => {
      const targetSeq = sortedSequences[index] ?? (index + 1) * 10;
      return updateOP(id, { sequence: targetSeq });
    });

    await Promise.all(updatePromises);
    await loadData(true);
  };

  // Handler de Nova / Edição de OP
  const handleOpenCreateOp = () => {
    setEditingOp(null);
    setOpFormData({
      number: '',
      product: '',
      plannedQuantity: '',
      lote: '',
      granel: '',
      priority: 'Normal',
      setor: 'Envase',
      unidade: 'Un',
      lineId: '',
      scheduledDate: getLocalDateStr(),
      scheduledShift: 'Manhã',
      tipoDocumento: 'OP',
      industria: 'Ybera',
      observation: ''
    });
    setShowOpModal(true);
  };

  const handleOpenEditOp = (op: ProductionOrder) => {
    setEditingOp(op);
    setOpFormData({
      number: op.number,
      product: op.product,
      plannedQuantity: String(op.plannedQuantity || ''),
      lote: op.lote || '',
      granel: op.granel || '',
      priority: op.priority || 'Normal',
      setor: op.setor || 'Envase',
      unidade: op.unidade || 'Un',
      lineId: op.lineId || '',
      scheduledDate: op.scheduledDate || getLocalDateStr(),
      scheduledShift: op.scheduledShift || 'Manhã',
      tipoDocumento: op.tipoDocumento || 'OP',
      industria: op.industria || 'Ybera',
      observation: op.observation || ''
    });
    setShowOpModal(true);
  };

  const handleSaveOp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opFormData.number || !opFormData.product || !opFormData.plannedQuantity) {
      showToast('Preencha os campos obrigatórios (Número, Produto, Quantidade).');
      return;
    }

    setIsSavingOp(true);
    try {
      const qty = parseFloat(opFormData.plannedQuantity.replace(/\./g, '').replace(',', '.')) || 0;
      if (editingOp) {
        await updateOP(editingOp.id, {
          number: opFormData.number.trim(),
          product: opFormData.product.trim(),
          plannedQuantity: qty,
          lote: opFormData.lote.trim() || undefined,
          granel: opFormData.granel.trim() || undefined,
          priority: opFormData.priority,
          setor: opFormData.setor,
          unidade: opFormData.unidade,
          lineId: opFormData.lineId || null,
          scheduledDate: opFormData.scheduledDate,
          scheduledShift: opFormData.scheduledShift,
          tipoDocumento: opFormData.tipoDocumento,
          industria: opFormData.industria,
          observation: opFormData.observation.trim() || undefined
        });
        showToast(`OP ${opFormData.number} atualizada.`);
      } else {
        await createOP({
          number: opFormData.number.trim(),
          product: opFormData.product.trim(),
          plannedQuantity: qty,
          lote: opFormData.lote.trim() || undefined,
          granel: opFormData.granel.trim() || undefined,
          priority: opFormData.priority,
          setor: opFormData.setor,
          unidade: opFormData.unidade,
          lineId: opFormData.lineId || null,
          scheduledDate: opFormData.scheduledDate,
          scheduledShift: opFormData.scheduledShift,
          tipoDocumento: opFormData.tipoDocumento,
          industria: opFormData.industria,
        });
        showToast(`OP ${opFormData.number} criada com sucesso.`);
      }
      setShowOpModal(false);
      await loadData(true);
    } catch (err) {
      console.error('Erro ao salvar OP:', err);
      showToast('Falha ao salvar a OP.');
    } finally {
      setIsSavingOp(false);
    }
  };

  // Exclusão de OP
  const handleDeleteOp = async () => {
    if (!deleteModalOp) return;
    setIsDeletingOp(true);
    try {
      await deleteOP(deleteModalOp.id);
      showToast(`OP ${deleteModalOp.number} excluída com sucesso.`);
      setDeleteModalOp(null);
      await loadData(true);
    } catch (err) {
      console.error('Erro ao excluir OP:', err);
      showToast('Erro ao excluir a ordem de produção.');
    } finally {
      setIsDeletingOp(false);
    }
  };

  // Pausar OP
  const handleConfirmPause = async () => {
    if (!pauseModalData || !selectedPauseReason) return;
    setIsPausingOp(true);
    try {
      await pauseOP(pauseModalData.opId, pauseModalData.lineId, selectedPauseReason, profile?.uid || 'coordinator', pauseObs);
      showToast(`OP ${pauseModalData.opNumber} pausada.`);
      setPauseModalData(null);
      setSelectedPauseReason('');
      setPauseObs('');
      await loadData(true);
    } catch (err) {
      console.error('Erro ao pausar OP:', err);
      showToast('Erro ao pausar a OP.');
    } finally {
      setIsPausingOp(false);
    }
  };

  // Cadastrar Colaborador
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserFormData.name || !newUserFormData.email) {
      showToast('Preencha nome e e-mail do colaborador.');
      return;
    }

    setIsCreatingUser(true);
    try {
      const generatedPass = Math.random().toString(36).slice(-8) + 'A1!';
      const res = await preAuthorizeUser({
        name: newUserFormData.name.trim(),
        email: newUserFormData.email.trim().toLowerCase(),
        role: newUserFormData.rule === 'admin' ? 'coordinator' : 'leader',
        cargo: newUserFormData.cargo.trim() || 'Operador',
        area: newUserFormData.area,
        defaultPassword: generatedPass,
      });

      if (res.success) {
        if (res.uid) {
          await updateUserRule(res.uid, newUserFormData.rule);
        }
        setUserCreatedPassword(generatedPass);
        showToast('Colaborador pré-cadastrado com sucesso!');
        await loadData(true);
      } else {
        showToast(res.error || 'Não foi possível cadastrar o colaborador.');
      }
    } catch (err) {
      console.error('Erro ao cadastrar colaborador:', err);
      showToast('Erro ao cadastrar colaborador.');
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Sincronizar Líderes Pendentes
  const handleSyncPending = async () => {
    setIsSyncingPending(true);
    try {
      const res = await syncPendingLeadersToSupabase();
      showToast(`Sincronização concluída: ${res.synced} usuários sincronizados.`);
      await loadData(true);
    } catch (err) {
      console.error('Erro ao sincronizar:', err);
      showToast('Erro ao sincronizar usuários pendentes.');
    } finally {
      setIsSyncingPending(false);
    }
  };

  // Excluir Colaborador
  const handleDeleteUser = async () => {
    if (!deleteUserModalData) return;
    setIsDeletingUser(true);
    try {
      await deleteUserProfile(deleteUserModalData.uid, deleteUserModalData.email);
      showToast(`Colaborador ${deleteUserModalData.name} removido com sucesso.`);
      setDeleteUserModalData(null);
      if (detailsModalUserId === deleteUserModalData.uid || detailsModalUserId === deleteUserModalData.email) {
        setDetailsModalUserId(null);
      }
      await loadData(true);
    } catch (err) {
      console.error('Erro ao excluir colaborador:', err);
      showToast('Erro ao excluir perfil de colaborador.');
    } finally {
      setIsDeletingUser(false);
    }
  };

  // Resetar Senha
  const handleResetPassword = async (user: UserProfile) => {
    try {
      const res = await resetLeaderPassword(user.uid, user.email);
      if (res.success && res.newPassword) {
        navigator.clipboard.writeText(res.newPassword);
        showToast(`Nova senha temporária: ${res.newPassword} (copiada!)`);
        await loadData(true);
      }
    } catch (err) {
      console.error('Erro ao resetar senha:', err);
      showToast('Falha ao resetar a senha.');
    }
  };

  // Filtragem do Estoque de OPs
  const todayStr = useMemo(() => getLocalDateStr(), []);

  const filteredOps = useMemo(() => {
    return ops.filter((op) => {
      // Filtro de aba
      if (opsFilterTab === 'today') {
        if (op.scheduledDate !== todayStr) return false;
      } else if (opsFilterTab === 'week') {
        if (!op.scheduledDate) return false;
        const now = new Date();
        const dow = now.getDay();
        const diffToMonday = dow === 0 ? -6 : 1 - dow;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diffToMonday);
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        const opDate = new Date(op.scheduledDate + 'T12:00:00');
        if (opDate < monday || opDate > sunday) return false;
      } else if (opsFilterTab === 'unassigned') {
        if (op.lineId || op.status === 'completed') return false;
      } else if (opsFilterTab === 'completed') {
        if (op.status !== 'completed') return false;
      }

      // Filtro de setor
      if (opsSectorFilter !== 'Todos') {
        if (op.setor !== opsSectorFilter) return false;
      }

      // Busca textual
      if (opsSearchTerm.trim()) {
        const term = opsSearchTerm.trim().toLowerCase();
        const matchNumber = op.number?.toLowerCase().includes(term);
        const matchProduct = op.product?.toLowerCase().includes(term);
        const matchLote = op.lote ? op.lote.toLowerCase().includes(term) : false;
        const matchGranel = op.granel ? op.granel.toLowerCase().includes(term) : false;
        if (!matchNumber && !matchProduct && !matchLote && !matchGranel) return false;
      }

      return true;
    });
  }, [ops, opsFilterTab, opsSectorFilter, opsSearchTerm, todayStr]);

  // Filtragem de Usuários
  const filteredUsers = useMemo(() => {
    return allUsers.filter((u) => {
      if (userRuleFilter !== 'all') {
        if ((u.rule || 'envase') !== userRuleFilter) return false;
      }
      if (userSearchTerm.trim()) {
        const term = userSearchTerm.trim().toLowerCase();
        const matchName = u.name?.toLowerCase().includes(term);
        const matchEmail = u.email?.toLowerCase().includes(term);
        const matchCargo = u.cargo?.toLowerCase().includes(term);
        if (!matchName && !matchEmail && !matchCargo) return false;
      }
      return true;
    });
  }, [allUsers, userRuleFilter, userSearchTerm]);

  // Filtragem de Auditoria
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (eventTypeFilter !== 'all') {
        if (ev.type !== eventTypeFilter) return false;
      }
      if (eventLineFilter !== 'all') {
        if (ev.lineId !== eventLineFilter) return false;
      }
      if (eventSearchTerm.trim()) {
        const term = eventSearchTerm.trim().toLowerCase();
        const matchOp = ev.opNumber?.toLowerCase().includes(term);
        const matchLeader = ev.leaderName?.toLowerCase().includes(term);
        const matchLine = ev.lineName?.toLowerCase().includes(term);
        const matchReason = ev.reason?.toLowerCase().includes(term);
        const matchObs = ev.observation?.toLowerCase().includes(term);
        if (!matchOp && !matchLeader && !matchLine && !matchReason && !matchObs) return false;
      }
      return true;
    });
  }, [events, eventTypeFilter, eventLineFilter, eventSearchTerm]);

  const activeLinesCount = useMemo(() => lines.filter(l => l.status === 'active').length, [lines]);
  const pendingUsersCount = useMemo(() => allUsers.filter(u => u.status === 'pending' || u.status === 'first_access').length, [allUsers]);

  return (
    <div className="flex h-screen bg-[#09090b] text-[#f4f4f5] font-sans antialiased overflow-hidden">
      {/* Toast flutuante */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white font-medium text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Info className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Barra Lateral Unificada */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        linesCount={lines.length}
        activeLinesCount={activeLinesCount}
        opsCount={ops.length}
        usersCount={allUsers.length}
        pendingCount={pendingUsersCount}
        profile={profile}
        onOpenGoals={() => setShowGoalsModal(true)}
        onRefresh={() => loadData(false)}
        onSignOut={signOut}
        isRefreshing={isRefreshing}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        setMobileOpen={setMobileMenuOpen}
      />

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
        {/* Topbar móvel */}
        <div className="lg:hidden flex items-center justify-between p-3.5 bg-[#121216] border-b border-[#222226]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 rounded-lg bg-[#18181f] text-zinc-300 hover:text-white"
            >
              <Factory className="w-5 h-5 text-blue-500" />
            </button>
            <span className="text-xs font-bold uppercase tracking-wider text-white">GPANEL FACTORY</span>
          </div>
          <button
            onClick={() => loadData(false)}
            className="p-1.5 rounded-lg bg-[#18181f] text-zinc-300 hover:text-white"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>

        {/* ÁREA DE RENDERIZAÇÃO DAS TELAS CONFORME TAB ATIVA */}
        <div className="flex-1 p-3 sm:p-5">
          {/* TAB 1: DASHBOARD GERAL */}
          {activeTab === 'home' && (
            <HomeDashboard
              lines={lines}
              ops={ops}
              leaders={leaders}
              allUsers={allUsers}
              events={events}
              rotations={rotations}
              goals={goals}
              factoryMonthlyGoal={factoryMonthlyGoal}
              factoryMonthlyGoals={factoryMonthlyGoals}
              lineDailyGoals={lineDailyGoals}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onOpenShareModal={() => setShowShareModal(true)}
            />
          )}

          {/* TAB 2: PESAGEM */}
          {activeTab === 'pesagem' && (
            <PesagemScreen embedded={true} />
          )}

          {/* TAB 3: MANIPULAÇÃO */}
          {activeTab === 'manipulacao' && (
            <ManipulacaoScreen embedded={true} />
          )}

          {/* TAB 4: CHÃO DE FÁBRICA (ENVASE) */}
          {activeTab === 'envase' && (
            <LeaderScreen embedded={true} />
          )}

          {/* TAB 5: CRONOGRAMA DE ENVASE (KANBAN) */}
          {activeTab === 'cronograma' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-4 rounded-2xl">
                <div>
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-blue-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">Cronograma de Envase</h2>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800/40">
                      Kanban Semanal
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Selecione o dia da semana nas abas abaixo e arraste as OPs entre as colunas para atribuí-las às linhas de envase naquele dia, ou use o "+" de cada coluna.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleOpenCreateOp}
                    className="h-9 px-3 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nova OP</span>
                  </Button>
                  <Button
                    onClick={() => setShowCsvModal(true)}
                    variant="outline"
                    className="h-9 px-3 text-xs font-medium rounded-xl border-[#272733] bg-[#181820] text-zinc-300 hover:text-white gap-1.5"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importar CSV</span>
                  </Button>
                </div>
              </div>

              <CronogramaBoard
                lines={lines}
                ops={ops}
                onAssignToQueue={handleAssignToQueue}
                onUnassign={handleUnassign}
                onReorderColumn={handleReorderColumn}
                onOpenAssignModal={(line) => setAssignStockLine(line)}
                onOpenEditOpModal={(op) => handleOpenEditOp(op)}
              />
            </div>
          )}

          {/* TAB 6: HISTÓRICO & GRÁFICOS */}
          {activeTab === 'daily_production' && (
            <DailyProductionHistory
              ops={ops}
              lines={lines}
              leaders={leaders}
              goals={goals}
              events={events}
            />
          )}

          {/* TAB 7: ESTOQUE DE OPS */}
          {activeTab === 'ops' && (
            <div className="space-y-4">
              {/* Header do Estoque de OPs */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-4 rounded-2xl">
                <div>
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">Estoque de Ordens de Produção</h2>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800/40">
                      {filteredOps.length} de {ops.length} OPs
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Visão geral de ordens emitidas, filas de linhas, prioridades e progresso de envase.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleOpenCreateOp}
                    className="h-9 px-3 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white gap-1.5 shadow-md shadow-blue-950/40"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nova OP</span>
                  </Button>
                  <Button
                    onClick={() => setShowCsvModal(true)}
                    variant="outline"
                    className="h-9 px-3 text-xs font-medium rounded-xl border-[#272733] bg-[#181820] text-zinc-300 hover:text-white gap-1.5"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importar CSV</span>
                  </Button>
                </div>
              </div>

              {/* Filtros e Busca */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-3 rounded-2xl">
                {/* Abas Rápidas */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {[
                    { id: 'today', label: 'Hoje' },
                    { id: 'week', label: 'Esta Semana' },
                    { id: 'unassigned', label: 'Sem Linha' },
                    { id: 'completed', label: 'Concluídas' },
                    { id: 'all', label: 'Todas as OPs' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setOpsFilterTab(tab.id as any)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                        opsFilterTab === tab.id
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40'
                          : 'bg-[#181820] text-zinc-400 hover:text-zinc-200 border border-[#222228]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {/* Filtro Setor */}
                  <select
                    value={opsSectorFilter}
                    onChange={(e) => setOpsSectorFilter(e.target.value as any)}
                    className="h-9 text-xs bg-[#181820] border border-[#272733] rounded-xl px-2.5 text-zinc-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Todos">Todos os Setores</option>
                    <option value="Envase">Envase</option>
                    <option value="Pesagem">Pesagem</option>
                    <option value="Manipulação">Manipulação</option>
                  </select>

                  {/* Barra de Busca */}
                  <div className="relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <Input
                      type="text"
                      placeholder="Buscar por OP, produto, lote..."
                      value={opsSearchTerm}
                      onChange={(e) => setOpsSearchTerm(e.target.value)}
                      className="h-9 pl-9 pr-3 text-xs bg-[#181820] border-[#272733] rounded-xl text-zinc-200 placeholder:text-zinc-500"
                    />
                    {opsSearchTerm && (
                      <button
                        onClick={() => setOpsSearchTerm('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Lista de Cards do Estoque de OPs */}
              {filteredOps.length === 0 ? (
                <div className="bg-[#121216] border border-[#222226] rounded-2xl p-12 text-center space-y-3">
                  <Package className="w-10 h-10 text-zinc-600 mx-auto" />
                  <p className="text-sm font-bold text-zinc-300">Nenhuma ordem de produção encontrada</p>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                    Tente ajustar os filtros acima ou cadastre uma nova OP pelo botão no topo.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {filteredOps.map((op) => {
                    const line = lines.find(l => l.id === op.lineId);
                    const progress = op.plannedQuantity > 0
                      ? Math.min(100, Math.round(((op.producedQuantity || 0) / op.plannedQuantity) * 100))
                      : 0;

                    const isCritical = op.priority === 'Crítica' || op.priority === 'Alta';

                    return (
                      <div
                        key={op.id}
                        className={`bg-[#121216] border rounded-2xl p-4 flex flex-col justify-between transition-all hover:border-[#383848] space-y-3 ${
                          op.status === 'in_progress' ? 'border-emerald-500/40 bg-emerald-950/10' :
                          op.status === 'paused' ? 'border-amber-500/40 bg-amber-950/10' :
                          'border-[#222226]'
                        }`}
                      >
                        {/* Topo do Card */}
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono font-black text-sm text-white">
                                {op.tipoDocumento || 'OP'} {op.number}
                              </span>
                              {op.setor && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  op.setor === 'Pesagem' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                                  op.setor === 'Manipulação' ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/40' :
                                  'bg-blue-950/80 text-blue-400 border border-blue-800/40'
                                }`}>
                                  {op.setor}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* Status */}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                op.status === 'in_progress' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' :
                                op.status === 'paused' ? 'bg-amber-950 text-amber-400 border border-amber-800/50' :
                                op.status === 'completed' ? 'bg-purple-950 text-purple-400 border border-purple-800/50' :
                                'bg-zinc-800/80 text-zinc-400 border border-zinc-700/50'
                              }`}>
                                {op.status === 'in_progress' ? 'Em Produção' :
                                 op.status === 'paused' ? 'Pausada' :
                                 op.status === 'completed' ? 'Concluída' : 'Aguardando'}
                              </span>

                              {/* Prioridade */}
                              {isCritical && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-950/90 text-rose-400 border border-rose-800/50">
                                  {op.priority}
                                </span>
                              )}
                            </div>
                          </div>

                          <h3 className="text-xs font-bold text-zinc-100 line-clamp-2 leading-snug" title={op.product}>
                            {op.product}
                          </h3>

                          {/* Info adicional (Lote, Granel, Linha) */}
                          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] text-zinc-400 bg-[#16161c] p-2.5 rounded-xl border border-white/5">
                            <div>
                              <span className="text-zinc-500 block text-[9px] uppercase font-bold">Lote</span>
                              <span className="font-mono text-zinc-200">{op.lote || '—'}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500 block text-[9px] uppercase font-bold">Linha de Envase</span>
                              <span className={`font-semibold ${line ? 'text-blue-400' : 'text-zinc-500'}`}>
                                {line ? line.name : 'Não vinculada'}
                              </span>
                            </div>
                            {op.scheduledDate && (
                              <div>
                                <span className="text-zinc-500 block text-[9px] uppercase font-bold">Data Agendada</span>
                                <span className="font-mono text-zinc-300">
                                  {op.scheduledDate.split('-').reverse().join('/')}
                                </span>
                              </div>
                            )}
                            <div>
                              <span className="text-zinc-500 block text-[9px] uppercase font-bold">Progresso</span>
                              <span className="font-bold text-white">
                                {(op.producedQuantity || 0).toLocaleString('pt-BR')} / {op.plannedQuantity.toLocaleString('pt-BR')} {op.unidade || 'un'}
                              </span>
                            </div>
                          </div>

                          {/* Barra de Progresso */}
                          <div className="w-full bg-[#1e1e26] rounded-full h-1.5 mt-2.5 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                op.status === 'completed' ? 'bg-purple-500' :
                                progress >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>

                        {/* Ações do Card */}
                        <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-white/5">
                          <button
                            type="button"
                            onClick={() => setDetailsModalOp(op)}
                            className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 py-1"
                          >
                            <Info className="w-3.5 h-3.5" />
                            <span>Mais informações</span>
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setAssignModalOp(op)}
                              className="p-1.5 rounded-lg bg-[#181822] text-zinc-300 hover:text-white border border-[#272733]"
                              title="Alocar ou Trocar Linha"
                            >
                              <Layers className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditOp(op)}
                              className="p-1.5 rounded-lg bg-[#181822] text-zinc-300 hover:text-white border border-[#272733]"
                              title="Editar OP"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteModalOp(op)}
                              className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 border border-rose-800/30"
                              title="Excluir OP"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 8: EQUIPE & ACESSOS */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Header da Gestão de Equipe */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-4 rounded-2xl">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-blue-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">Gestão de Equipe & Acessos</h2>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800/40">
                      {filteredUsers.length} Colaboradores
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Controle central de papéis, lideranças de linha, senhas temporárias e permissões de tela.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setUserCreatedPassword(null);
                      setNewUserFormData({
                        name: '',
                        email: '',
                        cargo: 'Líder de Produção',
                        area: 'Envase',
                        rule: 'envase',
                      });
                      setShowAuthorizeModal(true);
                    }}
                    className="h-9 px-3 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar Colaborador</span>
                  </Button>
                  <Button
                    onClick={handleSyncPending}
                    disabled={isSyncingPending}
                    variant="outline"
                    className="h-9 px-3 text-xs font-medium rounded-xl border-[#272733] bg-[#181820] text-zinc-300 hover:text-white gap-1.5"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncingPending ? 'animate-spin' : ''}`} />
                    <span>Sincronizar Pendentes</span>
                  </Button>
                </div>
              </div>

              {/* Filtros de Usuários */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-3 rounded-2xl">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {[
                    { id: 'all', label: 'Todos' },
                    { id: 'admin', label: 'Coordenação' },
                    { id: 'envase', label: 'Envase' },
                    { id: 'pesagem', label: 'Pesagem' },
                    { id: 'manipulacao', label: 'Manipulação' }
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setUserRuleFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all ${
                        userRuleFilter === f.id
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40'
                          : 'bg-[#181820] text-zinc-400 hover:text-zinc-200 border border-[#222228]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[220px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input
                    type="text"
                    placeholder="Buscar por nome, e-mail, cargo..."
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    className="h-9 pl-9 pr-3 text-xs bg-[#181820] border-[#272733] rounded-xl text-zinc-200 placeholder:text-zinc-500"
                  />
                  {userSearchTerm && (
                    <button
                      onClick={() => setUserSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Cards de Usuários */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredUsers.map((user) => {
                  const ruleConfig = ACCESS_RULES[user.rule || 'envase'] || ACCESS_RULES.envase;
                  const isPending = user.status === 'pending' || user.status === 'first_access';

                  return (
                    <div
                      key={user.uid || user.email}
                      className="bg-[#121216] border border-[#222226] rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-[#383848] transition-all"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ruleConfig.badgeClass}`}>
                            {ruleConfig.shortName}
                          </span>

                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            user.status === 'active' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40' :
                            isPending ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40' :
                            'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          }`}>
                            {user.status === 'active' ? 'Ativo' :
                             user.status === 'first_access' ? 'Primeiro Acesso' :
                             user.status === 'pending' ? 'Pendente' : 'Inativo'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 font-black text-sm flex items-center justify-center shrink-0 border border-blue-500/30">
                            {user.name ? user.name.slice(0, 2).toUpperCase() : 'CO'}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-xs font-bold text-white truncate">{user.name}</h3>
                            <p className="text-[11px] text-zinc-400 truncate">{user.cargo || 'Operador Industrial'}</p>
                            <p className="text-[10px] text-zinc-500 truncate font-mono">{user.email}</p>
                          </div>
                        </div>

                        {user.defaultPassword && isPending && (
                          <div className="mt-3 p-2 bg-amber-950/30 border border-amber-800/40 rounded-xl flex items-center justify-between">
                            <div className="text-[10px] text-amber-400">
                              <span className="font-semibold block">Senha Provisória:</span>
                              <span className="font-mono font-bold text-white">{user.defaultPassword}</span>
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(user.defaultPassword || '');
                                showToast('Senha copiada!');
                              }}
                              className="p-1 rounded bg-amber-900/50 text-amber-200 hover:bg-amber-800"
                              title="Copiar senha"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-white/5">
                        <button
                          type="button"
                          onClick={() => setDetailsModalUserId(user.uid || user.email)}
                          className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 py-1"
                        >
                          <Info className="w-3.5 h-3.5" />
                          <span>Ver detalhes</span>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleResetPassword(user)}
                            className="p-1.5 rounded-lg bg-[#181822] text-zinc-300 hover:text-white border border-[#272733]"
                            title="Resetar Senha"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteUserModalData(user)}
                            className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 border border-rose-800/30"
                            title="Excluir Colaborador"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 9: AUDITORIA / LOG DE EVENTOS */}
          {activeTab === 'events' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#121216] border border-[#222226] p-4 rounded-2xl">
                <div>
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-blue-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">Auditoria & Registro de Eventos</h2>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800/40">
                      {filteredEvents.length} eventos
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a] mt-0.5">
                    Histórico cronológico detalhado de apontamentos, paradas, inícios e conclusões de linha.
                  </p>
                </div>
              </div>

              {/* Filtros de Auditoria */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-[#121216] border border-[#222226] p-3 rounded-2xl">
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  className="h-9 text-xs bg-[#181820] border border-[#272733] rounded-xl px-2.5 text-zinc-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Todos os Tipos de Evento</option>
                  <option value="STARTED">Início de Produção</option>
                  <option value="PAUSED">Pausa / Parada</option>
                  <option value="RESUMED">Retomada</option>
                  <option value="FINISHED">Conclusão de Lote</option>
                  <option value="QUANTITY_REPORTED">Apontamento de Quantidade</option>
                  <option value="CANCELLED">Início Cancelado</option>
                </select>

                <select
                  value={eventLineFilter}
                  onChange={(e) => setEventLineFilter(e.target.value)}
                  className="h-9 text-xs bg-[#181820] border border-[#272733] rounded-xl px-2.5 text-zinc-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Todas as Linhas</option>
                  {lines.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>

                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input
                    type="text"
                    placeholder="Buscar por OP, líder, motivo de pausa..."
                    value={eventSearchTerm}
                    onChange={(e) => setEventSearchTerm(e.target.value)}
                    className="h-9 pl-9 pr-3 text-xs bg-[#181820] border-[#272733] rounded-xl text-zinc-200 placeholder:text-zinc-500"
                  />
                  {eventSearchTerm && (
                    <button
                      onClick={() => setEventSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Lista Cronológica de Eventos */}
              <div className="bg-[#121216] border border-[#222226] rounded-2xl overflow-hidden divide-y divide-white/5">
                {filteredEvents.length === 0 ? (
                  <div className="p-12 text-center text-zinc-500 text-xs">
                    Nenhum evento registrado nos critérios selecionados.
                  </div>
                ) : (
                  filteredEvents.map((evt) => {
                    const formattedDate = new Date(evt.createdAt).toLocaleString('pt-BR');

                    return (
                      <div key={evt.id} className="p-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                        <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                          evt.type === 'STARTED' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40' :
                          evt.type === 'PAUSED' ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40' :
                          evt.type === 'RESUMED' ? 'bg-blue-950/80 text-blue-400 border border-blue-800/40' :
                          evt.type === 'FINISHED' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                          evt.type === 'CANCELLED' ? 'bg-rose-950/80 text-rose-400 border border-rose-800/40' :
                          'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                        }`}>
                          {evt.type === 'STARTED' && <Play className="w-3.5 h-3.5" />}
                          {evt.type === 'PAUSED' && <Pause className="w-3.5 h-3.5" />}
                          {evt.type === 'RESUMED' && <RotateCcw className="w-3.5 h-3.5" />}
                          {evt.type === 'FINISHED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {evt.type === 'QUANTITY_REPORTED' && <TrendingUp className="w-3.5 h-3.5" />}
                          {evt.type === 'CANCELLED' && <XCircle className="w-3.5 h-3.5" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">
                                {evt.type === 'STARTED' && 'Início de Produção'}
                                {evt.type === 'PAUSED' && 'Parada Registrada'}
                                {evt.type === 'RESUMED' && 'Retomada de Produção'}
                                {evt.type === 'FINISHED' && 'Conclusão de Lote'}
                                {evt.type === 'QUANTITY_REPORTED' && `Apontamento de Quantidade (+${evt.quantity} un)`}
                                {evt.type === 'CANCELLED' && 'Início Cancelado (por engano)'}
                              </span>
                              {evt.opNumber && (
                                <span className="text-[10px] text-blue-400 font-mono font-bold">
                                  OP {evt.opNumber}
                                </span>
                              )}
                              {evt.lineName && (
                                <span className="text-[10px] text-zinc-400">
                                  na {evt.lineName}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">
                              {formattedDate}
                            </span>
                          </div>

                          {evt.reason && (
                            <p className="text-[11px] text-amber-300/90 mt-1 font-medium">
                              Motivo: {evt.reason}
                            </p>
                          )}

                          {evt.observation && (
                            <p className="text-[11px] text-zinc-400 mt-0.5 italic">
                              "{evt.observation}"
                            </p>
                          )}

                          {evt.leaderName && (
                            <p className="text-[10px] text-zinc-500 mt-1">
                              Registrado por: <strong className="text-zinc-400">{evt.leaderName}</strong>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 10: SIMULADOR DE TREINAMENTO */}
          {activeTab === 'training' && (
            <TrainingSimulator />
          )}
        </div>
      </main>

      {/* ---------------- MODAIS DO SISTEMA ---------------- */}

      {/* MODAL: NOVA / EDITAR OP */}
      <Dialog open={showOpModal} onOpenChange={setShowOpModal}>
        <DialogContent className="bg-[#121216] border-[#272733] text-white max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider text-white">
              {editingOp ? `Editar Ordem de Produção ${editingOp.number}` : 'Cadastrar Nova Ordem de Produção'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Preencha os dados técnicos da OP para integrar com a programação fabril.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveOp} className="space-y-3.5 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] text-zinc-300">Número da OP *</Label>
                <Input
                  required
                  placeholder="Ex: 104502"
                  value={opFormData.number}
                  onChange={(e) => setOpFormData({ ...opFormData, number: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white font-mono mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Tipo de Documento</Label>
                <select
                  value={opFormData.tipoDocumento}
                  onChange={(e) => setOpFormData({ ...opFormData, tipoDocumento: e.target.value as any })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="OP">OP (Ordem de Produção)</option>
                  <option value="OSM">OSM (Ordem de Serviço/Manipulação)</option>
                </select>
              </div>
            </div>

            <div>
              <Label className="text-[11px] text-zinc-300">Descrição do Produto *</Label>
              <Input
                required
                placeholder="Ex: Shampoo Nutritivo 300ml"
                value={opFormData.product}
                onChange={(e) => setOpFormData({ ...opFormData, product: e.target.value })}
                className="h-9 text-xs bg-[#181822] border-[#272733] text-white mt-1"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[11px] text-zinc-300">Qtd Planejada *</Label>
                <Input
                  required
                  type="number"
                  placeholder="Ex: 5000"
                  value={opFormData.plannedQuantity}
                  onChange={(e) => setOpFormData({ ...opFormData, plannedQuantity: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white font-mono mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Unidade</Label>
                <select
                  value={opFormData.unidade}
                  onChange={(e) => setOpFormData({ ...opFormData, unidade: e.target.value as any })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="Un">Unidade (un)</option>
                  <option value="Kg">Quilograma (kg)</option>
                  <option value="Qtd">Qtd</option>
                </select>
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Setor</Label>
                <select
                  value={opFormData.setor}
                  onChange={(e) => setOpFormData({ ...opFormData, setor: e.target.value as any })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="Envase">Envase</option>
                  <option value="Pesagem">Pesagem</option>
                  <option value="Manipulação">Manipulação</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] text-zinc-300">Lote</Label>
                <Input
                  placeholder="Ex: L2409"
                  value={opFormData.lote}
                  onChange={(e) => setOpFormData({ ...opFormData, lote: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white font-mono mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Granel Associado</Label>
                <Input
                  placeholder="Ex: G-8891"
                  value={opFormData.granel}
                  onChange={(e) => setOpFormData({ ...opFormData, granel: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white font-mono mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] text-zinc-300">Linha de Envase</Label>
                <select
                  value={opFormData.lineId}
                  onChange={(e) => setOpFormData({ ...opFormData, lineId: e.target.value })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="">Sem Linha (Estoque)</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Prioridade</Label>
                <select
                  value={opFormData.priority}
                  onChange={(e) => setOpFormData({ ...opFormData, priority: e.target.value as any })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="Normal">Normal</option>
                  <option value="Alta">Alta</option>
                  <option value="Crítica">Crítica</option>
                  <option value="Baixa">Baixa</option>
                </select>
              </div>
            </div>

            <DialogFooter className="mt-4 pt-3 border-t border-white/5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowOpModal(false)}
                className="h-9 px-4 text-xs rounded-xl border-[#272733] bg-[#181820] text-zinc-300"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSavingOp}
                className="h-9 px-4 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
              >
                {isSavingOp ? 'Salvando...' : editingOp ? 'Salvar Alterações' : 'Criar Ordem'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- MODAL: MAIS INFORMAÇÕES DA OP (Estoque de OPs) ---------------- */}
      {detailsModalOp && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailsModalOp(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-[#121216] border border-[#272733] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Detalhes da {detailsModalOp.tipoDocumento || 'OP'} {detailsModalOp.number}
                </h3>
              </div>
              <button
                onClick={() => setDetailsModalOp(null)}
                className="text-zinc-500 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-bold block">Produto</span>
                <p className="text-white font-semibold text-sm">{detailsModalOp.product}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-[#16161c] p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Quantidade Planejada</span>
                  <span className="font-mono text-zinc-200 font-bold">
                    {detailsModalOp.plannedQuantity?.toLocaleString('pt-BR')} {detailsModalOp.unidade || 'un'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Quantidade Produzida</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {(detailsModalOp.producedQuantity || 0).toLocaleString('pt-BR')} {detailsModalOp.unidade || 'un'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Lote</span>
                  <span className="font-mono text-zinc-300">{detailsModalOp.lote || 'Não informado'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Granel</span>
                  <span className="font-mono text-zinc-300">{detailsModalOp.granel || 'Não informado'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Linha de Envase</span>
                  <span className="text-blue-400 font-medium">
                    {lines.find(l => l.id === detailsModalOp.lineId)?.name || 'Sem Linha Atribuída'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Data Agendada</span>
                  <span className="font-mono text-zinc-300">
                    {detailsModalOp.scheduledDate ? detailsModalOp.scheduledDate.split('-').reverse().join('/') : 'Não agendada'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Prioridade</span>
                  <span className="text-zinc-200">{detailsModalOp.priority}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Status</span>
                  <span className="text-zinc-200">{detailsModalOp.status}</span>
                </div>
              </div>

              {detailsModalOp.observation && (
                <div className="bg-[#16161c] p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Observações</span>
                  <p className="text-zinc-300 text-[11px] whitespace-pre-wrap">{detailsModalOp.observation}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <Button
                onClick={() => setDetailsModalOp(null)}
                className="h-9 px-4 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: DETALHES DO COLABORADOR (Gestão de Equipe) ---------------- */}
      {detailsModalUserId && (() => {
        const user = allUsers.find(u => (u.uid || u.email) === detailsModalUserId);
        if (!user) return null;
        const ruleConfig = ACCESS_RULES[user.rule || 'envase'] || ACCESS_RULES.envase;

        return (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setDetailsModalUserId(null);
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          >
            <div className="bg-[#121216] border border-[#272733] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-400" />
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    Perfil do Colaborador
                  </h3>
                </div>
                <button
                  onClick={() => setDetailsModalUserId(null)}
                  className="text-zinc-500 hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 font-black text-base flex items-center justify-center shrink-0 border border-blue-500/30">
                    {user.name ? user.name.slice(0, 2).toUpperCase() : 'CO'}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">{user.name}</h4>
                    <p className="text-xs text-zinc-400">{user.cargo || 'Operador Industrial'}</p>
                    <p className="text-[11px] font-mono text-zinc-500">{user.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-[#16161c] p-3 rounded-xl border border-white/5">
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Regra de Acesso</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 ${ruleConfig.badgeClass}`}>
                      {ruleConfig.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Status da Conta</span>
                    <span className="text-zinc-200 font-bold capitalize mt-0.5 inline-block">{user.status}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Área de Atuação</span>
                    <span className="text-zinc-300 font-medium">{user.area || 'Envase'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Cadastrado em</span>
                    <span className="text-zinc-400 font-mono">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  </div>
                </div>

                {/* Alterar Regra Diretamente */}
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-zinc-300">Alterar Regra de Acesso (Rule)</Label>
                  <select
                    value={user.rule || 'envase'}
                    onChange={async (e) => {
                      const newRule = e.target.value as AccessRule;
                      await updateUserRule(user.uid, newRule);
                      showToast(`Regra de ${user.name} alterada para ${newRule}.`);
                      await loadData(true);
                    }}
                    className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200"
                  >
                    <option value="admin">Coordenador Geral (Acesso Total)</option>
                    <option value="envase">Líder de Envase (Home + Chão de Fábrica)</option>
                    <option value="pesagem">Líder de Pesagem (Home + Pesagem)</option>
                    <option value="manipulacao">Líder de Manipulação (Home + Manipulação)</option>
                    <option value="custom">Personalizado</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-between items-center gap-2 pt-3 border-t border-white/5">
                <Button
                  onClick={() => {
                    setDeleteUserModalData(user);
                  }}
                  variant="outline"
                  className="h-9 px-3 text-xs font-bold rounded-xl border-rose-800/40 text-rose-400 hover:bg-rose-950/50"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Excluir Colaborador
                </Button>

                <Button
                  onClick={() => setDetailsModalUserId(null)}
                  className="h-9 px-4 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---------------- MODAL: CADASTRAR NOVO COLABORADOR ---------------- */}
      <Dialog open={showAuthorizeModal} onOpenChange={setShowAuthorizeModal}>
        <DialogContent className="bg-[#121216] border-[#272733] text-white max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider text-white">
              Cadastrar Novo Colaborador
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Gere uma credencial de acesso pré-autorizada para os líderes de produção.
            </DialogDescription>
          </DialogHeader>

          {userCreatedPassword ? (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Colaborador Cadastrado!</span>
                </div>
                <p className="text-xs text-zinc-300">
                  Compartilhe a senha temporária abaixo com o colaborador para o primeiro acesso:
                </p>
                <div className="flex items-center justify-between p-2.5 bg-black/40 rounded-lg border border-emerald-800/30">
                  <span className="font-mono text-sm font-black text-white tracking-widest">
                    {userCreatedPassword}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(userCreatedPassword);
                      showToast('Senha copiada com sucesso!');
                    }}
                    className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                    title="Copiar senha"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowAuthorizeModal(false);
                    setUserCreatedPassword(null);
                  }}
                  className="w-full h-9 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Concluir
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreateUser} className="space-y-3.5 mt-2">
              <div>
                <Label className="text-[11px] text-zinc-300">Nome Completo *</Label>
                <Input
                  required
                  placeholder="Ex: Carlos Silva"
                  value={newUserFormData.name}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, name: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">E-mail Corporativo *</Label>
                <Input
                  required
                  type="email"
                  placeholder="Ex: carlos@fabrica.com"
                  value={newUserFormData.email}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, email: e.target.value })}
                  className="h-9 text-xs bg-[#181822] border-[#272733] text-white mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] text-zinc-300">Cargo</Label>
                  <Input
                    placeholder="Ex: Líder de Envase"
                    value={newUserFormData.cargo}
                    onChange={(e) => setNewUserFormData({ ...newUserFormData, cargo: e.target.value })}
                    className="h-9 text-xs bg-[#181822] border-[#272733] text-white mt-1"
                  />
                </div>

                <div>
                  <Label className="text-[11px] text-zinc-300">Área</Label>
                  <select
                    value={newUserFormData.area}
                    onChange={(e) => setNewUserFormData({ ...newUserFormData, area: e.target.value as any })}
                    className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                  >
                    <option value="Envase">Envase</option>
                    <option value="Pesagem">Pesagem</option>
                    <option value="Manipulação">Manipulação</option>
                    <option value="Coordenação">Coordenação</option>
                  </select>
                </div>
              </div>

              <div>
                <Label className="text-[11px] text-zinc-300">Regra de Acesso Inicial</Label>
                <select
                  value={newUserFormData.rule}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, rule: e.target.value as any })}
                  className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
                >
                  <option value="envase">Líder de Envase (Home + Chão de Fábrica)</option>
                  <option value="pesagem">Líder de Pesagem (Home + Pesagem)</option>
                  <option value="manipulacao">Líder de Manipulação (Home + Manipulação)</option>
                  <option value="admin">Coordenador Geral (Acesso Total)</option>
                </select>
              </div>

              <DialogFooter className="mt-4 pt-3 border-t border-white/5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAuthorizeModal(false)}
                  className="h-9 px-4 text-xs rounded-xl border-[#272733] bg-[#181820] text-zinc-300"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isCreatingUser}
                  className="h-9 px-4 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {isCreatingUser ? 'Cadastrando...' : 'Gerar Acesso'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------- MODAL: CONFIRMAR EXCLUSÃO DE COLABORADOR ---------------- */}
      <Dialog open={!!deleteUserModalData} onOpenChange={(open) => !open && setDeleteUserModalData(null)}>
        <DialogContent className="bg-[#121216] border-[#272733] text-white max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
              Excluir Colaborador
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-300">
              Tem certeza que deseja excluir o acesso de{' '}
              <strong className="text-white">{deleteUserModalData?.name}</strong> ({deleteUserModalData?.email})?
              Esta ação removerá a conta e suas permissões industriais.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 pt-3 border-t border-white/5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteUserModalData(null)}
              className="h-9 px-4 text-xs rounded-xl border-[#272733] bg-[#181820] text-zinc-300"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isDeletingUser}
              onClick={handleDeleteUser}
              className="h-9 px-4 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white"
            >
              {isDeletingUser ? 'Excluindo...' : 'Sim, Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- MODAL: CONFIRMAR EXCLUSÃO DE OP ---------------- */}
      <Dialog open={!!deleteModalOp} onOpenChange={(open) => !open && setDeleteModalOp(null)}>
        <DialogContent className="bg-[#121216] border-[#272733] text-white max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
              Excluir Ordem de Produção
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-300">
              Tem certeza que deseja excluir a OP{' '}
              <strong className="text-white">{deleteModalOp?.number}</strong> ({deleteModalOp?.product})?
              Esta ação é permanente e remove todos os apontamentos vinculados.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 pt-3 border-t border-white/5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteModalOp(null)}
              className="h-9 px-4 text-xs rounded-xl border-[#272733] bg-[#181820] text-zinc-300"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isDeletingOp}
              onClick={handleDeleteOp}
              className="h-9 px-4 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white"
            >
              {isDeletingOp ? 'Excluindo...' : 'Sim, Excluir OP'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- MODAL: PAUSAR OP ---------------- */}
      <Dialog open={!!pauseModalData} onOpenChange={(open) => !open && setPauseModalData(null)}>
        <DialogContent className="bg-[#121216] border-[#272733] text-white max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Pause className="w-5 h-5 text-amber-500" />
              Pausar Produção da OP {pauseModalData?.opNumber}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Selecione o motivo da parada para alimentar o cálculo de Disponibilidade e OEE.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-[11px] text-zinc-300">Motivo da Parada *</Label>
              <select
                value={selectedPauseReason}
                onChange={(e) => setSelectedPauseReason(e.target.value)}
                className="w-full h-9 text-xs bg-[#181822] border border-[#272733] rounded-xl px-2.5 text-zinc-200 mt-1"
              >
                <option value="">Selecione um motivo...</option>
                {pauseReasons.map((pr) => (
                  <option key={pr.id} value={pr.name}>{pr.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-[11px] text-zinc-300">Observação Técnica</Label>
              <Input
                placeholder="Ex: Ajuste mecânico no bico dosador"
                value={pauseObs}
                onChange={(e) => setPauseObs(e.target.value)}
                className="h-9 text-xs bg-[#181822] border-[#272733] text-white mt-1"
              />
            </div>
          </div>

          <DialogFooter className="mt-4 pt-3 border-t border-white/5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPauseModalData(null)}
              className="h-9 px-4 text-xs rounded-xl border-[#272733] bg-[#181820] text-zinc-300"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isPausingOp || !selectedPauseReason}
              onClick={handleConfirmPause}
              className="h-9 px-4 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-500 text-white"
            >
              {isPausingOp ? 'Registrando...' : 'Confirmar Pausa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- MODAL: METAS (Sidebar) ---------------- */}
      <GoalsModal
        isOpen={showGoalsModal}
        onClose={() => setShowGoalsModal(false)}
        lines={lines}
        factoryMonthlyGoal={factoryMonthlyGoal}
        factoryMonthlyGoals={factoryMonthlyGoals}
        lineDailyGoals={lineDailyGoals}
        onGoalsSaved={async () => {
          await loadData(true);
        }}
      />

      {/* ---------------- MODAL: COMPARTILHAR DASHBOARD (Sidebar) ---------------- */}
      <ShareDashboardModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />

      {/* ---------------- MODAL: IMPORTAR CSV (Estoque & Cronograma) ---------------- */}
      <CsvImportModal
        isOpen={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        onSuccess={async () => {
          showToast('Importação de OPs concluída com sucesso!');
          await loadData(true);
        }}
      />

      {/* ---------------- MODAL: ATRIBUIR LINHA À OP ---------------- */}
      <AssignLineModal
        isOpen={!!assignModalOp}
        onClose={() => setAssignModalOp(null)}
        op={assignModalOp}
        lines={lines}
        allOps={ops}
        onSave={async (opId, updates) => {
          await updateOP(opId, updates);
          showToast('Linha e agendamento da OP atualizados.');
          setAssignModalOp(null);
          await loadData(true);
        }}
      />

      {/* ---------------- MODAL: VINCULAR OP DO ESTOQUE À LINHA ("+" no Kanban) ---------------- */}
      <AssignStockOpToLineModal
        isOpen={!!assignStockLine}
        onClose={() => setAssignStockLine(null)}
        targetLine={assignStockLine}
        ops={ops}
        onAssignAndStart={async (opId, lineId) => {
          await handleAssignToQueue(opId, lineId);
          setAssignStockLine(null);
        }}
        onAssignToQueue={async (opId, lineId) => {
          await handleAssignToQueue(opId, lineId);
          setAssignStockLine(null);
        }}
      />
    </div>
  );
}
