import { createClient } from '@supabase/supabase-js';
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  isRetryableError,
  isFetchOrNetworkError,
  isSupabaseRuntimeEnabled,
} from '../lib/supabase';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, PauseReason, MonthlyGoal } from '../types';

/**
 * Helper para calcular horas reais de pausa a partir de uma lista de eventos de produção.
 */
export function calculateTotalPauseHours(events: ProductionEvent[]): number {
  if (!events || events.length === 0) return 0;
  try {
    const sorted = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const eventsByOp: Record<string, ProductionEvent[]> = {};
    for (const ev of sorted) {
      const key = ev.opId || 'global';
      if (!eventsByOp[key]) eventsByOp[key] = [];
      eventsByOp[key].push(ev);
    }

    let totalMs = 0;
    for (const opId of Object.keys(eventsByOp)) {
      const opEvents = eventsByOp[opId];
      let pauseStartTime: number | null = null;

      for (const ev of opEvents) {
        const time = new Date(ev.createdAt).getTime();
        if (isNaN(time)) continue;

        if (ev.type === 'PAUSED') {
          pauseStartTime = time;
        } else if ((ev.type === 'RESUMED' || ev.type === 'FINISHED') && pauseStartTime !== null) {
          const diff = time - pauseStartTime;
          if (diff > 0) totalMs += diff;
          pauseStartTime = null;
        }
      }
    }
    return totalMs / (1000 * 60 * 60);
  } catch (err) {
    console.warn('Erro ao calcular horas de pausa:', err);
    return 0;
  }
}

/**
 * Calcula os 3 componentes do OEE e o OEE final.
 *
 * Disponibilidade = tempo_real_produzindo / tempo_planejado_total
 *   tempo_real_produzindo  = planned_hours - horas de pausa reais (calculateTotalPauseHours)
 *   tempo_planejado_total  = soma de planned_hours de todas as OPs do período
 *
 * Performance = producedQuantity / plannedQuantity  (para OPs concluídas ou em progresso)
 *
 * Qualidade = (producedQuantity - rejectedQuantity) / producedQuantity
 *
 * OEE = Disponibilidade × Performance × Qualidade
 *
 * Retorna valores entre 0 e 1 (multiplique por 100 para exibir como %).
 * Retorna null para cada componente quando não há dados suficientes.
 */
export function calculateOEE(
  ops: ProductionOrder[],
  events: ProductionEvent[]
): {
  disponibilidade: number | null;
  performance: number | null;
  qualidade: number | null;
  oee: number | null;
} {
  try {
    if (!ops || ops.length === 0) {
      return { disponibilidade: null, performance: null, qualidade: null, oee: null };
    }

    // 1. Disponibilidade = tempo_real_produzindo / tempo_planejado_total
    const opsWithPlannedHours = ops.filter(op => op.plannedHours != null && op.plannedHours > 0);
    let disponibilidade: number | null = null;

    if (opsWithPlannedHours.length > 0) {
      const tempoPlanejadoTotal = opsWithPlannedHours.reduce(
        (sum, op) => sum + (op.plannedHours || 0),
        0
      );

      if (tempoPlanejadoTotal > 0) {
        const relevantOpIds = new Set(opsWithPlannedHours.map(op => op.id));
        const relevantEvents = events ? events.filter(e => e.opId && relevantOpIds.has(e.opId)) : [];
        const pauseHours = calculateTotalPauseHours(relevantEvents.length > 0 ? relevantEvents : events || []);
        
        const tempoRealProduzindo = Math.max(0, tempoPlanejadoTotal - pauseHours);
        disponibilidade = Math.max(0, Math.min(1, tempoRealProduzindo / tempoPlanejadoTotal));
      }
    }

    // 2. Performance = producedQuantity / plannedQuantity (para OPs concluídas, pausadas ou em progresso)
    const activeOrFinishedOps = ops.filter(
      op => (op.status === 'completed' || op.status === 'in_progress' || op.status === 'paused') && op.plannedQuantity > 0
    );
    let performance: number | null = null;

    if (activeOrFinishedOps.length > 0) {
      const totalPlanned = activeOrFinishedOps.reduce((sum, op) => sum + (op.plannedQuantity || 0), 0);
      const totalProduced = activeOrFinishedOps.reduce((sum, op) => sum + (op.producedQuantity || 0), 0);

      if (totalPlanned > 0) {
        performance = Math.max(0, totalProduced / totalPlanned);
      }
    }

    // 3. Qualidade = (producedQuantity - rejectedQuantity) / producedQuantity
    const opsWithProduction = ops.filter(op => (op.producedQuantity || 0) > 0);
    let qualidade: number | null = null;

    if (opsWithProduction.length > 0) {
      const totalProduced = opsWithProduction.reduce((sum, op) => sum + (op.producedQuantity || 0), 0);
      const totalRejected = opsWithProduction.reduce((sum, op) => sum + (op.rejectedQuantity || 0), 0);

      if (totalProduced > 0) {
        const goodQuantity = Math.max(0, totalProduced - totalRejected);
        qualidade = Math.max(0, Math.min(1, goodQuantity / totalProduced));
      }
    }

    // OEE = Disponibilidade × Performance × Qualidade
    let oee: number | null = null;
    if (disponibilidade !== null && performance !== null && qualidade !== null) {
      oee = disponibilidade * performance * qualidade;
    }

    return { disponibilidade, performance, qualidade, oee };
  } catch (err) {
    console.warn('Erro ao calcular OEE:', err);
    return { disponibilidade: null, performance: null, qualidade: null, oee: null };
  }
}

/**
 * Agrupa producedQuantity por dia e por setor (para o gráfico de barras diário).
 * Retorna um array de objetos com: { day: number, setor: string, quantity: number }
 * ordenado por dia crescente, filtrado pelo mês e ano fornecidos.
 */
export function groupProductionByDayAndSetor(
  ops: ProductionOrder[],
  month: number,
  year: number
): Array<{ day: number; setor: string; quantity: number }> {
  if (!ops || ops.length === 0) return [];
  try {
    const targetMonth1to12 = month >= 1 && month <= 12 ? month : (month + 1);
    const map = new Map<string, { day: number; setor: string; quantity: number }>();

    for (const op of ops) {
      if (!op || (op.producedQuantity == null)) continue;

      let opDate: Date | null = null;
      if (op.scheduledDate) {
        const parts = op.scheduledDate.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          if (y === year && m === targetMonth1to12) {
            opDate = new Date(y, m - 1, d);
          }
        }
      }

      if (!opDate && op.createdAt) {
        const d = new Date(op.createdAt);
        if (!isNaN(d.getTime())) {
          if (d.getFullYear() === year && (d.getMonth() + 1) === targetMonth1to12) {
            opDate = d;
          }
        }
      }

      if (!opDate) continue;

      const day = opDate.getDate();
      const setor = op.setor || 'Geral';
      const key = `${day}-${setor}`;

      const existing = map.get(key);
      if (existing) {
        existing.quantity += Number(op.producedQuantity || 0);
      } else {
        map.set(key, { day, setor, quantity: Number(op.producedQuantity || 0) });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.day - b.day || a.setor.localeCompare(b.setor));
  } catch (err) {
    console.warn('Erro ao agrupar produção por dia e setor:', err);
    return [];
  }
}

/**
 * Agrupa producedQuantity por mês (para o gráfico de barras mensal).
 * Retorna um array de 12 posições (jan=0 … dez=11) com a quantidade produzida.
 * Filtra pelo ano fornecido.
 */
export function groupProductionByMonth(
  ops: ProductionOrder[],
  year: number
): Array<{ month: number; label: string; quantity: number }> {
  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const result = monthLabels.map((label, idx) => ({
    month: idx,
    label,
    quantity: 0,
  }));

  if (!ops || ops.length === 0) return result;

  try {
    for (const op of ops) {
      if (!op || !op.producedQuantity) continue;

      let opYear: number | null = null;
      let opMonth0: number | null = null;

      if (op.scheduledDate) {
        const parts = op.scheduledDate.split('-');
        if (parts.length >= 2) {
          opYear = parseInt(parts[0], 10);
          opMonth0 = parseInt(parts[1], 10) - 1;
        }
      }

      if ((opYear === null || opMonth0 === null) && op.createdAt) {
        const d = new Date(op.createdAt);
        if (!isNaN(d.getTime())) {
          opYear = d.getFullYear();
          opMonth0 = d.getMonth();
        }
      }

      if (opYear === year && opMonth0 !== null && opMonth0 >= 0 && opMonth0 < 12) {
        result[opMonth0].quantity += Number(op.producedQuantity || 0);
      }
    }
  } catch (err) {
    console.warn('Erro ao agrupar produção por mês:', err);
  }

  return result;
}

/**
 * Gera uma senha temporária segura para o primeiro acesso do líder.
 * Nunca use uma senha fixa/hardcoded — cada usuário recebe uma senha única.
 * Formato: 3 letras maiúsculas + 3 números + 2 caracteres especiais (ex: "XKP472#!")
 */
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O para evitar confusão visual
  const digits = '0123456789';
  const special = '!@#$%&*';

  const rand = (charset: string) =>
    charset[crypto.getRandomValues(new Uint32Array(1))[0] % charset.length];

  const parts = [
    rand(upper), rand(upper), rand(upper),
    rand(digits), rand(digits), rand(digits),
    rand(special), rand(special),
  ];

  // Embaralha para não ter padrão previsível
  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join('');
}

/** @deprecated Use generateTemporaryPassword() — senha fixa removida por segurança. */
export const DEFAULT_LEADER_PASSWORD = generateTemporaryPassword();

/**
 * Gera um e-mail corporativo padronizado a partir do nome completo do líder
 * Ex: "Carlos Alberto da Silva" -> "carlos.silva@fabrica.com"
 */
export function generateLeaderEmail(name: string, domain = 'fabrica.com'): string {
  if (!name || !name.trim()) return '';
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (clean.length === 0) return '';
  if (clean.length === 1) return `${clean[0]}@${domain}`;
  return `${clean[0]}.${clean[clean.length - 1]}@${domain}`;
}

// Limpeza definitiva de chaves legadas de cache local para sincronização 100% online
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const legacyKeys = [
      'SIG_PROD_OPS_STORAGE_V5',
      'SIG_PROD_DELETED_OPS_V5',
      'SIG_PROD_LINES_STORAGE_V5',
      'SIG_PROD_EVENTS_STORAGE_V5',
      'SIG_PROD_ROTATIONS_STORAGE_V5',
      'SIG_PROD_PAUSE_REASONS_STORAGE_V5',
      'SIG_PROD_PROFILES_STORAGE_V5',
      'SIG_PROD_MONTHLY_GOALS_V5',
      'SIG_PROD_OPS_STORAGE_V4',
      'SIG_PROD_DELETED_OPS_V4',
      'SIG_PROD_EVENTS_STORAGE_V4',
      'SIG_PROD_OPS_STORAGE',
      'SIG_PROD_EVENTS_STORAGE',
      'SIG_PROD_LAST_SYNC',
      'gpanel_monthly_goal',
    ];
    legacyKeys.forEach(k => window.localStorage.removeItem(k));
  } catch {}
}

// Configuração oficial de linhas de produção: 2 linhas de envase e 1 linha para sleeve
const DEFAULT_LINES: ProductionLine[] = [
  { id: 'line-1', name: 'Linha 01 - Envase', status: 'idle', currentOpId: null },
  { id: 'line-2', name: 'Linha 02 - Envase', status: 'idle', currentOpId: null },
  { id: 'line-sleeve', name: 'Linha Sleeve', status: 'idle', currentOpId: null },
];

// Default initial fallback OPs (Vazio por padrão para novas atribuições e importações)
const DEFAULT_OPS: ProductionOrder[] = [];

// Default pause reasons
export const DEFAULT_PAUSE_REASONS: PauseReason[] = [
  { id: 'pr-1', name: 'Falta de Matéria-Prima / Granel', category: 'Suprimentos' },
  { id: 'pr-2', name: 'Falta de Embalagem / Rótulo / Tampa / Sleeve', category: 'Suprimentos' },
  { id: 'pr-3', name: 'Manutenção Mecânica / Elétrica', category: 'Manutenção' },
  { id: 'pr-4', name: 'Setup / Troca de Formato de Linha', category: 'Operação' },
  { id: 'pr-5', name: 'Limpeza e Sanitização Periódica', category: 'Qualidade' },
  { id: 'pr-6', name: 'Inspeção / Liberação de Qualidade', category: 'Qualidade' },
  { id: 'pr-7', name: 'Almoço / Intervalo Operacional', category: 'Operação' },
  { id: 'pr-8', name: 'Aguardando Aprovação da Coordenação', category: 'Gestão' },
];

// Default recent events (Vazio por padrão)
const DEFAULT_EVENTS: ProductionEvent[] = [];

// Helper para filtrar dados mock legados
const isMockOp = (op: ProductionOrder | any) => {
  if (!op) return true;
  const id = String(op.id || '').trim();
  const num = String(op.number || op.op_number || '').trim();
  const prod = String(op.product || op.product_name || '').trim();
  
  const mockExactIds = ['op-1', 'op-2', 'op-3', 'op-4', 'op-5'];
  const mockExactNumbers = ['40231', '40232', '40233', '40234', '40235'];
  
  return (
    mockExactIds.includes(id) ||
    mockExactNumbers.includes(num) ||
    prod === 'Shampoo Hidratante X 500ml' ||
    prod === 'Condicionador Revitalizante 300ml' ||
    prod === 'Sleeve Térmico Lote Especial 250ml' ||
    prod === 'Kit Presente Natalino Supreme'
  );
};

const isMockEvent = (e: ProductionEvent | any) => {
  if (!e) return true;
  const id = String(e.id || '').trim();
  const num = String(e.opNumber || e.op_number || '').trim();
  const mockExactIds = ['ev-1', 'ev-2', 'ev-3'];
  const mockExactNumbers = ['40231', '40232', '40233', '40234', '40235'];
  return mockExactIds.includes(id) || mockExactNumbers.includes(num);
};

// Estado volátil em memória para feedback instantâneo de UI
let inMemoryLines: ProductionLine[] = [...DEFAULT_LINES];
let inMemoryOps: ProductionOrder[] = [];
let inMemoryEvents: ProductionEvent[] = [];
let inMemoryRotations: Record<string, string> = {};
let inMemoryProfiles: UserProfile[] = [];

export function notifyStateChange() {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('sig_data_updated'));
    } catch {}
  }
}

// Helpers de notificação reativa de estado
function persistOps() {
  notifyStateChange();
}

function persistLines() {
  notifyStateChange();
}

function persistEvents() {
  notifyStateChange();
}

function persistRotations() {
  notifyStateChange();
}

export function persistProfiles() {
  notifyStateChange();
}

// ---------------- PROFILES & LEADERS ----------------
export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  const foundLocal = inMemoryProfiles.find(p => p.uid === uid || p.email === uid);

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();

    if (data && !error) {
      const isCoord = data.role === 'coordinator' || data.role === 'coordenador' || (data.cargo && data.cargo.toLowerCase().includes('coordenador'));
      let isFirstAccess = false;
      if (data.must_change_password === true || data.status === 'first_access') {
        isFirstAccess = true;
      } else if (data.must_change_password === false || data.status === 'active') {
        isFirstAccess = false;
      } else {
        isFirstAccess = foundLocal?.mustChangePassword === true || foundLocal?.status === 'first_access';
      }

      const profile: UserProfile = {
        uid: data.id,
        email: data.email,
        name: data.name || data.email?.split('@')[0] || 'Usuário',
        role: isCoord ? 'coordinator' : 'leader',
        cargo: data.cargo || (isCoord ? 'Coordenador Geral' : 'Líder de Produção'),
        area: data.area || undefined,
        status: isFirstAccess ? 'first_access' : (data.status || 'active'),
        mustChangePassword: isFirstAccess,
        defaultPassword: data.default_password || undefined,
        createdAt: data.created_at || new Date().toISOString(),
      };
      
      const existingIdx = inMemoryProfiles.findIndex(p => p.uid === profile.uid || (profile.email && p.email?.toLowerCase() === profile.email.toLowerCase()));
      if (existingIdx !== -1) {
        inMemoryProfiles[existingIdx] = profile;
      } else {
        inMemoryProfiles.push(profile);
      }
      persistProfiles();

      return profile;
    }
  } catch (error) {
    console.warn('Consulta de perfil Supabase:', error);
  }

  return foundLocal || null;
};

export const getAllUsers = async (): Promise<UserProfile[]> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data && data.length > 0 && !error) {
      const remoteUsers: UserProfile[] = data.map((d: any) => {
        const isCoord = d.role === 'coordinator' || d.role === 'coordenador' || (d.cargo && d.cargo.toLowerCase().includes('coordenador'));
        const localMatch = inMemoryProfiles.find(p => p.uid === d.id || (d.email && p.email?.toLowerCase() === d.email.toLowerCase()));
        
        let isFirstAccess = false;
        if (d.must_change_password === true || d.status === 'first_access') {
          isFirstAccess = true;
        } else if (d.must_change_password === false || d.status === 'active') {
          isFirstAccess = false;
        } else {
          isFirstAccess = localMatch?.mustChangePassword === true || localMatch?.status === 'first_access';
        }

        return {
          uid: String(d.id || d.uid || `usr-${d.email}`),
          email: d.email || '',
          name: d.name || d.email?.split('@')[0] || 'Colaborador',
          role: isCoord ? 'coordinator' : 'leader',
          cargo: d.cargo || (isCoord ? 'Coordenador Geral' : 'Líder de Produção'),
          area: d.area || localMatch?.area || undefined,
          status: isFirstAccess ? 'first_access' : ((d.status as 'active' | 'inactive' | 'pending' | 'first_access') || 'active'),
          mustChangePassword: isFirstAccess,
          defaultPassword: d.default_password || localMatch?.defaultPassword || undefined,
          createdAt: d.created_at || localMatch?.createdAt || new Date().toISOString(),
        };
      });

      inMemoryProfiles = remoteUsers;
      persistProfiles();
      return inMemoryProfiles;
    }
  } catch (err) {
    console.warn('Busca de todos usuários no Supabase:', err);
  }

  return inMemoryProfiles;
};

export const getLeaders = async (): Promise<UserProfile[]> => {
  try {
    const allUsers = await getAllUsers();
    // Retorna todos os usuários cujo perfil não seja coordenador (isto é, líderes cadastrados)
    const leaders = allUsers.filter(u => u.role !== 'coordinator');
    return leaders;
  } catch (err) {
    console.warn('Busca de líderes:', err);
    return inMemoryProfiles.filter(u => u.role !== 'coordinator');
  }
};

export const updateUserRole = async (userId: string, newRole: 'coordinator' | 'leader', newCargo?: string): Promise<boolean> => {
  try {
    // 1. Update in-memory immediately
    const target = inMemoryProfiles.find(u => u.uid === userId || (u.email && u.email.toLowerCase() === userId.toLowerCase()));
    if (target) {
      target.role = newRole;
      target.cargo = newCargo || (newRole === 'coordinator' ? 'Coordenador Geral' : 'Líder de Produção');
      persistProfiles();
    }

    // 2. Update Supabase
    let { error } = await supabase
      .from('profiles')
      .update({ role: newRole, cargo: newCargo || (newRole === 'coordinator' ? 'Coordenador Geral' : 'Líder de Produção') })
      .eq('id', userId);

    if (error) {
      const res = await supabase
        .from('profiles')
        .update({ role: newRole, cargo: newCargo || (newRole === 'coordinator' ? 'Coordenador Geral' : 'Líder de Produção') })
        .eq('email', userId);
      error = res.error;
    }

    return true;
  } catch (err) {
    console.error('Erro ao atualizar cargo de usuário:', err);
    return true;
  }
};

export const updateUserArea = async (
  userId: string,
  newArea: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação',
  newCargo?: string
): Promise<boolean> => {
  try {
    // 1. Atualizar em memória imediatamente
    const target = inMemoryProfiles.find(u => u.uid === userId || (u.email && u.email.toLowerCase() === userId.toLowerCase()));
    if (target) {
      target.area = newArea;
      if (newCargo) {
        target.cargo = newCargo;
      }
      persistProfiles();
    }

    // 2. Atualizar no Supabase
    const payload: any = { area: newArea };
    if (newCargo) {
      payload.cargo = newCargo;
    }

    let { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);

    if (error) {
      const res = await supabase
        .from('profiles')
        .update(payload)
        .eq('email', userId);
      error = res.error;
    }

    return true;
  } catch (err) {
    console.error('Erro ao atualizar área de usuário:', err);
    return true;
  }
};

export const updateUserStatus = async (userId: string, newStatus: 'active' | 'inactive' | 'pending' | 'first_access'): Promise<boolean> => {
  try {
    const isFirstAccess = newStatus === 'first_access';
    // 1. Update in-memory immediately
    const target = inMemoryProfiles.find(u => u.uid === userId || (u.email && u.email.toLowerCase() === userId.toLowerCase()));
    if (target) {
      target.status = newStatus;
      target.mustChangePassword = isFirstAccess;
      if (!isFirstAccess) {
        delete target.defaultPassword;
      }
      persistProfiles();
    }

    // 2. Update Supabase
    let { error } = await supabase
      .from('profiles')
      .update({
        status: newStatus,
        must_change_password: isFirstAccess,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      const res = await supabase
        .from('profiles')
        .update({
          status: newStatus,
          must_change_password: isFirstAccess,
          updated_at: new Date().toISOString(),
        })
        .eq('email', userId);
      error = res.error;
    }

    return true;
  } catch (err) {
    console.error('Erro ao alterar status de usuário:', err);
    return true;
  }
};

export interface PreAuthorizeResult {
  success: boolean;
  message?: string;
  error?: string;
  isOfflineFallback?: boolean;
  uid?: string;
}

export const preAuthorizeUser = async (data: {
  email: string;
  name: string;
  role: 'coordinator' | 'leader';
  cargo?: string;
  area?: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação';
  lineId?: string;
  mustChangePassword?: boolean;
  defaultPassword?: string;
}): Promise<PreAuthorizeResult> => {
  try {
    const email = data.email.trim().toLowerCase();
    const name = data.name.trim();
    const role = data.role;
    const cargo = data.cargo || (role === 'coordinator' ? 'Coordenador Geral' : 'Líder de Produção');
    const area = data.area || (role === 'coordinator' ? 'Coordenação' : undefined);
    const isFirstAccess = data.mustChangePassword !== false;
    const defaultPassword = data.defaultPassword || generateTemporaryPassword();

    if (!isSupabaseRuntimeEnabled || !supabaseUrl || !supabaseAnonKey) {
      return {
        success: false,
        error: 'Supabase não está configurado. Conecte ao banco online para criar colaboradores.',
      };
    }

    // PASSO 1: Criar usuário no Supabase Auth PRIMEIRO (via ephemeralClient)
    let realUserId: string | undefined;
    let isSupabaseAuthCreated = false;
    let rateLimitExceeded = false;
    let authErrorMessage: string | undefined;

    try {
      const ephemeralClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const signUpResult = await ephemeralClient.auth.signUp({
        email,
        password: defaultPassword,
        options: {
          data: {
            name,
            role,
            cargo,
            area: area || null,
            must_change_password: isFirstAccess,
            status: isFirstAccess ? 'first_access' : 'active',
          },
        },
      });

      const errorMsg = (signUpResult.error?.message || '').toLowerCase();

      if (errorMsg.includes('rate limit') || errorMsg.includes('over_email_send_rate_limit')) {
        rateLimitExceeded = true;
        authErrorMessage = 'Limite de e-mails do Supabase atingido. Para permitir cadastros ilimitados sem confirmação por e-mail, acesse o painel do Supabase > Authentication > Providers > Email e desative "Confirm email".';
        console.warn('[GPanel] Rate limit de envio de e-mail no Supabase Auth:', signUpResult.error);
      } else if (
        errorMsg.includes('already registered') ||
        errorMsg.includes('user_already_exists')
      ) {
        // Usuário já existe no Auth: buscar ID existente em profiles
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (existing?.id) {
          realUserId = existing.id;
          isSupabaseAuthCreated = true;
        }
      } else if (signUpResult.data?.user?.id) {
        realUserId = signUpResult.data.user.id;
        isSupabaseAuthCreated = true;
      } else if (signUpResult.error) {
        console.warn('[GPanel] Erro no Auth signUp:', signUpResult.error);
        authErrorMessage = signUpResult.error.message;
      }
    } catch (authErr: any) {
      console.warn('[GPanel] Exceção no cliente temporário do Auth:', authErr);
      authErrorMessage = authErr?.message;
    }

    // Se falhou no Auth (ex: rate limit de e-mail), cria UUID local provisório
    const isLocalFallbackId = !realUserId;
    const finalUserId = realUserId || ((typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

    // PASSO 2: Montar userObj
    const userObj: UserProfile = {
      uid: finalUserId,
      email,
      name,
      role,
      cargo,
      area: area || undefined,
      status: isFirstAccess ? 'first_access' : 'active',
      mustChangePassword: isFirstAccess,
      defaultPassword: isFirstAccess ? defaultPassword : undefined,
      createdAt: new Date().toISOString(),
    };
    if (isLocalFallbackId) {
      (userObj as any).pendingSupabaseSync = true;
    }

    // PASSO 3: Salvar em inMemoryProfiles imediatamente
    const existingLocalIdx = inMemoryProfiles.findIndex(u => u.email?.toLowerCase() === email || u.uid === finalUserId);

    if (existingLocalIdx !== -1) {
      inMemoryProfiles[existingLocalIdx] = {
        ...userObj,
        createdAt: inMemoryProfiles[existingLocalIdx].createdAt || userObj.createdAt,
      };
    } else {
      inMemoryProfiles.unshift(userObj);
    }
    persistProfiles();

    // PASSO 4: INSERT/UPSERT em profiles se o ID for real do Supabase Auth
    let databaseSaved = false;
    if (isSupabaseAuthCreated && realUserId) {
      try {
        const fullPayload: any = {
          id: realUserId,
          email,
          name,
          role,
          cargo,
          area: area || null,
          status: isFirstAccess ? 'first_access' : 'active',
          must_change_password: isFirstAccess,
          default_password: isFirstAccess ? defaultPassword : null,
          created_at: new Date().toISOString(),
        };

        let { error: upsertErr } = await supabase.from('profiles').upsert(fullPayload, { onConflict: 'id' });

        // Fallback resiliente: se a tabela profiles ainda não tem a coluna 'area' ou 'default_password'
        if (upsertErr && (
          upsertErr.code === 'PGRST204' ||
          upsertErr.message?.includes('area') ||
          upsertErr.message?.includes('default_password')
        )) {
          console.warn('[GPanel] profiles.upsert falhou por colunas opcionais, tentando payload base:', upsertErr.message);
          const basePayload: any = {
            id: realUserId,
            email,
            name,
            role,
            cargo,
            status: isFirstAccess ? 'first_access' : 'active',
            must_change_password: isFirstAccess,
            created_at: new Date().toISOString(),
          };
          const retryRes = await supabase.from('profiles').upsert(basePayload, { onConflict: 'id' });
          upsertErr = retryRes.error;
        }

        if (!upsertErr) {
          databaseSaved = true;
          // Limpa flag de pendência
          const stored = inMemoryProfiles.find(u => u.uid === realUserId || u.email?.toLowerCase() === email);
          if (stored) {
            delete (stored as any).pendingSupabaseSync;
            persistProfiles();
          }
        } else {
          console.warn('[GPanel] Erro ao gravar perfil em profiles no Supabase (RLS ou schema):', upsertErr);
        }
      } catch (dbErr: any) {
        console.warn('[GPanel] Falha ao sincronizar perfil com profiles no Supabase:', dbErr);
      }
    }

    // PASSO 5: Alocar linha se lineId foi fornecido
    if (data.lineId) {
      try {
        await saveLeaderRotation(finalUserId, data.lineId, email, name);
      } catch (rotErr) {
        console.warn('Erro ao alocar rotação inicial do líder:', rotErr);
      }
    }

    if (rateLimitExceeded) {
      return {
        success: false,
        error: 'rate_limit',
        isOfflineFallback: true,
        uid: finalUserId,
        message: authErrorMessage || 'Limite de e-mails do Supabase atingido. O líder foi salvo localmente.',
      };
    }

    if (!databaseSaved && isLocalFallbackId) {
      return {
        success: true,
        isOfflineFallback: true,
        uid: finalUserId,
        message: authErrorMessage
          ? `Líder salvo localmente (${authErrorMessage}).`
          : 'Líder salvo localmente (pendente envio ao Supabase).',
      };
    }

    return {
      success: true,
      isOfflineFallback: false,
      uid: finalUserId,
      message: 'Líder registrado com sucesso no Supabase!',
    };
  } catch (err: any) {
    if (isRetryableError(err) || isFetchOrNetworkError(err)) {
      console.warn('[GPanel] Falha de rede durante pré-autorização:', err);
    } else {
      console.error('Erro ao pré-autorizar usuário:', err);
    }
    return {
      success: false,
      error: err?.message || 'Erro inesperado',
      message: 'Não foi possível cadastrar o colaborador.',
    };
  }
};

/**
 * Sincroniza colaboradores salvos apenas localmente para o Supabase
 */
export const syncPendingLeadersToSupabase = async (): Promise<{
  total: number;
  synced: number;
  failed: number;
  errors: string[];
}> => {
  const pending = inMemoryProfiles.filter(p => 
    p.role === 'leader' && (
      (p as any).pendingSupabaseSync === true ||
      p.uid.startsWith('usr-')
    )
  );

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const leader of pending) {
    try {
      const res = await preAuthorizeUser({
        name: leader.name,
        email: leader.email,
        role: leader.role,
        cargo: leader.cargo,
        area: leader.area,
        mustChangePassword: leader.mustChangePassword,
        defaultPassword: leader.defaultPassword,
      });

      if (res.success && !res.isOfflineFallback) {
        synced++;
      } else {
        failed++;
        if (res.message) errors.push(`${leader.name} (${leader.email}): ${res.message}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${leader.name} (${leader.email}): ${e?.message || 'Falha de conexão'}`);
    }
  }

  return { total: pending.length, synced, failed, errors };
};

/**
 * Atualiza a senha no primeiro acesso e remove a flag de primeiro acesso
 */
export const completeFirstAccessPasswordChange = async (
  uid: string,
  newPassword: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    // 1. Atualizar em memória imediatamente
    const target = inMemoryProfiles.find(u => u.uid === uid || (u.email && u.email.toLowerCase() === uid.toLowerCase()));
    if (target) {
      target.mustChangePassword = false;
      target.status = 'active';
      delete target.defaultPassword;
      persistProfiles();
    }

    // 2. Atualizar senha no Supabase Auth
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          must_change_password: false,
          status: 'active'
        }
      });
      if (authErr) {
        console.warn('Aviso ao atualizar senha no Supabase Auth:', authErr);
      }
    } catch (authE) {
      console.warn('Exceção ao atualizar senha no Supabase Auth:', authE);
    }

    // 3. Atualizar status na tabela profiles do Supabase
    try {
      let { error: updateErr } = await supabase
        .from('profiles')
        .update({
          default_password: null,
          status: 'active',
          must_change_password: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', uid);

      if (updateErr && target?.email) {
        await supabase
          .from('profiles')
          .update({
            default_password: null,
            status: 'active',
            must_change_password: false,
            updated_at: new Date().toISOString(),
          })
          .eq('email', target.email);
      }
    } catch (dbErr) {
      console.warn('Aviso ao atualizar status no profiles Supabase:', dbErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Erro ao concluir troca de senha do primeiro acesso:', err);
    return { success: false, message: err?.message || 'Falha ao gravar nova senha.' };
  }
};

/**
 * Redefine a senha de um líder para uma nova senha temporária gerada automaticamente.
 */
export const resetLeaderPassword = async (
  leaderId: string,
  leaderEmail: string
): Promise<{ success: boolean; newPassword?: string; error?: string }> => {
  try {
    const newPassword = generateTemporaryPassword();
    const targetEmail = (leaderEmail || leaderId).trim().toLowerCase();

    // 1. Atualizar inMemoryProfiles imediatamente
    const target = inMemoryProfiles.find(u => 
      u.uid === leaderId || 
      (u.email && u.email.toLowerCase() === targetEmail)
    );

    if (target) {
      target.mustChangePassword = true;
      target.status = 'first_access';
      target.defaultPassword = newPassword;
      persistProfiles();
    }

    // 2. Atualizar tabela profiles no Supabase
    try {
      let { error: updateErr } = await supabase
        .from('profiles')
        .update({
          default_password: newPassword,
          must_change_password: true,
          status: 'first_access',
          updated_at: new Date().toISOString(),
        })
        .eq('id', leaderId);

      if (updateErr && targetEmail) {
        await supabase
          .from('profiles')
          .update({
            default_password: newPassword,
            must_change_password: true,
            status: 'first_access',
            updated_at: new Date().toISOString(),
          })
          .eq('email', targetEmail);
      }
    } catch (dbErr) {
      console.warn('Aviso ao sincronizar redefinição no Supabase profiles:', dbErr);
    }

    return { success: true, newPassword };
  } catch (err: any) {
    console.error('Erro ao redefinir senha do líder:', err);
    return { success: false, error: err?.message || 'Falha ao redefinir senha do líder.' };
  }
};

export const deleteUserProfile = async (userId: string, userEmail?: string): Promise<boolean> => {
  try {
    const targetEmail = (userEmail || userId).toLowerCase();

    // 1. Remove from inMemoryProfiles
    inMemoryProfiles = inMemoryProfiles.filter(u => 
      u.uid !== userId && 
      (!u.email || u.email.toLowerCase() !== targetEmail)
    );
    persistProfiles();

    // Remove from inMemoryRotations
    delete inMemoryRotations[userId];
    if (userEmail) delete inMemoryRotations[userEmail];
    if (targetEmail) delete inMemoryRotations[targetEmail];
    persistRotations();

    // 2. Remove from Supabase profiles and rotations
    try {
      await supabase.from('rotations').delete().eq('leader_id', userId);
    } catch {}

    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error || targetEmail) {
        await supabase.from('profiles').delete().eq('email', targetEmail);
      }
    } catch (e) {
      console.warn('Erro ao excluir no Supabase:', e);
    }

    return true;
  } catch (err) {
    console.error('Erro ao remover perfil:', err);
    return true;
  }
};

// ---------------- PRODUCTION LINES ----------------
export const getLines = async (): Promise<ProductionLine[]> => {
  try {
    let { data, error } = await supabase.from('production_lines').select('*').order('name', { ascending: true });
    if (error || !data || data.length === 0) {
      const res = await supabase.from('lines').select('*').order('name', { ascending: true });
      data = res.data;
      error = res.error;
    }

    if (data && data.length > 0 && !error) {
      const mapped: ProductionLine[] = data.map((d: any) => ({
        id: String(d.id),
        name: d.name,
        status: (d.status || 'idle') as 'active' | 'idle' | 'paused',
        currentOpId: d.current_op_id ? String(d.current_op_id) : (d.currentOpId ? String(d.currentOpId) : null),
      }));

      const existingMap = new Map(inMemoryLines.map(l => [l.id, l]));
      mapped.forEach(remoteLine => {
        const local = existingMap.get(remoteLine.id);
        existingMap.set(remoteLine.id, {
          name: remoteLine.name || local?.name || remoteLine.id,
          id: remoteLine.id,
          status: remoteLine.status,
          currentOpId: remoteLine.currentOpId,
        });
      });

      inMemoryLines = Array.from(existingMap.values());
    }
  } catch (err) {
    console.warn('Usando linhas de produção em cache local:', err);
  }

  // Sanitize line status if currentOpId is a mock or non-existent OP
  const opIds = new Set(inMemoryOps.map(o => o.id));
  inMemoryLines = inMemoryLines.map(line => {
    if (line.currentOpId && (!opIds.has(line.currentOpId) || isMockOp({ id: line.currentOpId }))) {
      return { ...line, currentOpId: null, status: 'idle' };
    }
    return line;
  });

  persistLines();
  return inMemoryLines;
};

export const createLine = async (name: string): Promise<ProductionLine> => {
  const newLine: ProductionLine = {
    id: `line-${Date.now()}`,
    name,
    status: 'idle',
    currentOpId: null,
  };

  inMemoryLines.push(newLine);
  persistLines();

  try {
    await Promise.any([
      supabase.from('production_lines').insert({ id: newLine.id, name: newLine.name, status: 'idle' }),
      supabase.from('lines').insert({ id: newLine.id, name: newLine.name, status: 'idle' }),
    ]);
  } catch (err) {
    console.warn('Persistência de nova linha no Supabase:', err);
  }

  return newLine;
};

// ---------------- PRODUCTION ORDERS (OPS) ----------------

/**
 * Deriva o tipo de documento a partir do setor.
 * Pesagem e Manipulação usam OSM; demais usam OP.
 */
export function getTipoDocumento(
  setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral'
): 'OP' | 'OSM' {
  return setor === 'Pesagem' || setor === 'Manipulação' ? 'OSM' : 'OP';
}

export const getAllOPs = async (): Promise<ProductionOrder[]> => {
  try {
    let { data, error } = await supabase.from('production_orders').select('*').order('sequence', { ascending: true });
    if (error || !data || data.length === 0) {
      const res = await supabase.from('ops').select('*').order('sequence', { ascending: true });
      data = res.data;
      error = res.error;
    }

    if (data && data.length > 0 && !error) {
      const remoteOps: ProductionOrder[] = data
        .map((d: any) => ({
          id: String(d.id),
          number: String(d.number || d.op_number || ''),
          product: d.product || d.product_name || 'Produto',
          lote: d.lote || d.batch || d.numero_lote || '',
          plannedQuantity: Number(d.planned_quantity || d.plannedQuantity || 0),
          producedQuantity: Number(d.produced_quantity || d.producedQuantity || 0),
          granel: d.granel || d.bulk || d.lote_granel || d.cod_granel || '',
          priority: (d.priority || 'Normal') as any,
          status: (d.status || 'pending') as any,
          lineId: d.line_id ? String(d.line_id) : (d.lineId ? String(d.lineId) : null),
          leaderId: d.leader_id ? String(d.leader_id) : (d.leaderId ? String(d.leaderId) : null),
          packageAvailability: Number(d.package_availability || d.packageAvailability || 0),
          sequence: Number(d.sequence || 1),
          scheduledDate: d.scheduled_date || d.scheduledDate || undefined,
          scheduledShift: d.scheduled_shift || d.scheduledShift || undefined,
          setor: d.setor || undefined,
          unidade: d.unidade || undefined,
          rejectedQuantity: Number(d.rejected_quantity || d.rejectedQuantity || 0),
          plannedHours: d.planned_hours != null ? Number(d.planned_hours) : (d.plannedHours != null ? Number(d.plannedHours) : undefined),
          tipoDocumento: d.tipo_documento || 'OP',
          industria: d.industria || undefined,
          finishedShift: d.finished_shift || undefined,
          createdAt: d.created_at || d.createdAt || new Date().toISOString(),
        }))
        .filter((op) => !isMockOp(op));

      inMemoryOps = remoteOps;
      persistOps();
      return inMemoryOps;
    }
  } catch (err) {
    console.warn('Erro ao consultar OPs no Supabase:', err);
  }

  persistOps();
  return inMemoryOps;
};

export const getOPById = async (opId: string): Promise<ProductionOrder | null> => {
  const foundLocal = inMemoryOps.find(o => o.id === opId);

  try {
    let { data, error } = await supabase.from('production_orders').select('*').eq('id', opId).maybeSingle();
    if (error || !data) {
      const res = await supabase.from('ops').select('*').eq('id', opId).maybeSingle();
      data = res.data;
      error = res.error;
    }

    if (data && !error) {
      const d: any = data;
      return {
        id: String(d.id),
        number: String(d.number || d.op_number || ''),
        product: d.product || d.product_name || 'Produto',
        lote: d.lote || d.batch || d.numero_lote || '',
        plannedQuantity: Number(d.planned_quantity || d.plannedQuantity || 0),
        producedQuantity: Number(d.produced_quantity || d.producedQuantity || 0),
        granel: d.granel || d.bulk || d.lote_granel || d.cod_granel || '',
        priority: (d.priority || 'Normal') as any,
        status: (d.status || 'pending') as any,
        lineId: d.line_id ? String(d.line_id) : (d.lineId ? String(d.lineId) : null),
        leaderId: d.leader_id ? String(d.leader_id) : (d.leaderId ? String(d.leaderId) : null),
        packageAvailability: Number(d.package_availability || d.packageAvailability || 0),
        sequence: Number(d.sequence || 1),
        scheduledDate: d.scheduled_date || d.scheduledDate || undefined,
        scheduledShift: d.scheduled_shift || d.scheduledShift || undefined,
        setor: d.setor || undefined,
        unidade: d.unidade || undefined,
        rejectedQuantity: Number(d.rejected_quantity || d.rejectedQuantity || 0),
        plannedHours: d.planned_hours != null ? Number(d.planned_hours) : (d.plannedHours != null ? Number(d.plannedHours) : undefined),
        tipoDocumento: d.tipo_documento || 'OP',
        finishedShift: d.finished_shift || undefined,
        createdAt: d.created_at || d.createdAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn('Consulta getOPById no Supabase:', err);
  }

  return foundLocal || null;
};

export const createOP = async (newOpData: {
  number: string;
  product: string;
  lote?: string;
  plannedQuantity: number;
  granel?: string;
  priority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa';
  lineId: string | null;
  packageAvailability?: number;
  sequence?: number;
  scheduledDate?: string;
  scheduledShift?: string;
  setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral';
  unidade?: 'Un' | 'Kg' | 'Qtd';
  rejectedQuantity?: number;
  plannedHours?: number;
  tipoDocumento?: 'OP' | 'OSM';
  industria?: 'Ybera' | 'Carvalho' | 'Macpaul' | string;
  producedQuantity?: number;
  status?: 'pending' | 'in_progress' | 'paused' | 'completed';
  leaderId?: string;
}): Promise<ProductionOrder> => {
  const tipoDoc = newOpData.tipoDocumento || getTipoDocumento(newOpData.setor);

  const newOp: ProductionOrder = {
    id: `prod-op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    number: newOpData.number.trim(),
    product: newOpData.product.trim(),
    lote: (newOpData.lote || '').trim(),
    plannedQuantity: Number(newOpData.plannedQuantity) || 0,
    producedQuantity: Number(newOpData.producedQuantity ?? 0),
    granel: (newOpData.granel || '').trim(),
    priority: newOpData.priority || 'Normal',
    status: newOpData.status || 'pending',
    lineId: newOpData.lineId || null,
    leaderId: newOpData.leaderId || null,
    packageAvailability: Number(newOpData.packageAvailability || 0),
    sequence: Number(newOpData.sequence || (inMemoryOps.length + 1)),
    scheduledDate: newOpData.scheduledDate,
    scheduledShift: newOpData.scheduledShift,
    setor: newOpData.setor,
    unidade: newOpData.unidade,
    rejectedQuantity: Number(newOpData.rejectedQuantity || 0),
    plannedHours: newOpData.plannedHours != null ? Number(newOpData.plannedHours) : undefined,
    tipoDocumento: tipoDoc,
    industria: newOpData.industria || undefined,
    completedAt: newOpData.status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
  };

  // 1. Immediately persist locally
  inMemoryOps = [newOp, ...inMemoryOps];
  persistOps();

  // 2. Synchronize with Supabase in background
  try {
    const fullPayload: any = {
      id: newOp.id,
      number: newOp.number,
      product: newOp.product,
      lote: newOp.lote,
      planned_quantity: newOp.plannedQuantity,
      produced_quantity: newOp.producedQuantity,
      granel: newOp.granel,
      priority: newOp.priority,
      status: newOp.status,
      leader_id: newOp.leaderId || null,
      line_id: newOp.lineId,
      package_availability: newOp.packageAvailability,
      sequence: newOp.sequence,
      scheduled_date: newOp.scheduledDate,
      scheduled_shift: newOp.scheduledShift,
      setor: newOp.setor || null,
      unidade: newOp.unidade || null,
      rejected_quantity: newOp.rejectedQuantity || 0,
      planned_hours: newOp.plannedHours ?? null,
      tipo_documento: newOp.tipoDocumento || 'OP',
      industria: newOp.industria || null,
      completed_at: newOp.completedAt || null,
      created_at: newOp.createdAt,
    };

    const res1 = await supabase.from('production_orders').insert(fullPayload);
    if (res1.error) {
      // Try ops table or simpler payload without extra columns
      const simplePayload = {
        id: newOp.id,
        number: newOp.number,
        product: newOp.product,
        planned_quantity: newOp.plannedQuantity,
        produced_quantity: newOp.producedQuantity,
        priority: newOp.priority,
        status: newOp.status,
        leader_id: newOp.leaderId || null,
        line_id: newOp.lineId,
        created_at: newOp.createdAt,
      };
      try {
        await supabase.from('ops').insert(fullPayload);
      } catch {}
      try {
        await supabase.from('production_orders').insert(simplePayload);
      } catch {}
    }
  } catch (err) {
    console.warn('Persistência de nova OP no Supabase:', err);
  }

  return newOp;
};

export const importOPsBatch = async (
  items: Array<{
    number: string;
    product: string;
    lote?: string;
    plannedQuantity: number;
    granel?: string;
    priority?: 'Crítica' | 'Alta' | 'Normal' | 'Baixa';
    status?: 'pending' | 'in_progress' | 'paused' | 'completed';
    lineId?: string | null;
    packageAvailability?: number;
    scheduledDate?: string;
    scheduledShift?: string;
    setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral';
    unidade?: 'Un' | 'Kg' | 'Qtd';
    rejectedQuantity?: number;
    plannedHours?: number;
    tipoDocumento?: 'OP' | 'OSM';
    finishedShift?: 'Manhã' | 'Tarde';
  }>
): Promise<{ successCount: number; imported: ProductionOrder[] }> => {
  const newCreated: ProductionOrder[] = [];
  const startSeq = inMemoryOps.length + 1;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tipoDoc = it.tipoDocumento || getTipoDocumento(it.setor);
    const op: ProductionOrder = {
      id: `prod-op-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
      number: it.number.trim(),
      product: it.product.trim(),
      lote: (it.lote || '').trim(),
      plannedQuantity: Number(it.plannedQuantity) || 0,
      producedQuantity: 0,
      granel: (it.granel || '').trim(),
      priority: it.priority || 'Normal',
      status: it.status || 'pending',
      lineId: it.lineId || null,
      leaderId: null,
      packageAvailability: Number(it.packageAvailability || 0),
      sequence: startSeq + i,
      scheduledDate: it.scheduledDate,
      scheduledShift: it.scheduledShift,
      setor: it.setor,
      unidade: it.unidade,
      rejectedQuantity: Number(it.rejectedQuantity || 0),
      plannedHours: it.plannedHours != null ? Number(it.plannedHours) : undefined,
      tipoDocumento: tipoDoc,
      finishedShift: it.finishedShift,
      createdAt: new Date().toISOString(),
    };
    newCreated.push(op);
  }

  // 1. Immediately persist locally in memory and localStorage
  inMemoryOps = [...newCreated, ...inMemoryOps];
  persistOps();

  // 2. Synchronize with Supabase in background
  try {
    const payloads = newCreated.map((op) => ({
      id: op.id,
      number: op.number,
      product: op.product,
      lote: op.lote,
      planned_quantity: op.plannedQuantity,
      produced_quantity: 0,
      granel: op.granel,
      priority: op.priority,
      status: op.status,
      line_id: op.lineId,
      package_availability: op.packageAvailability,
      sequence: op.sequence,
      scheduled_date: op.scheduledDate,
      scheduled_shift: op.scheduledShift,
      setor: op.setor || null,
      unidade: op.unidade || null,
      rejected_quantity: op.rejectedQuantity || 0,
      planned_hours: op.plannedHours ?? null,
      tipo_documento: op.tipoDocumento || 'OP',
      finished_shift: op.finishedShift || null,
      created_at: op.createdAt,
    }));

    const res = await supabase.from('production_orders').insert(payloads);
    if (res.error) {
      try {
        await supabase.from('ops').insert(payloads);
      } catch {}
    }
  } catch (err) {
    console.warn('Persistência em lote de OPs no Supabase:', err);
  }

  return {
    successCount: newCreated.length,
    imported: newCreated,
  };
};

export const updateOP = async (opId: string, updates: Partial<ProductionOrder>) => {
  if (updates.status === 'completed' && updates.completedAt === undefined) {
    updates.completedAt = new Date().toISOString();
  }
  // 1. Update in memory and localStorage immediately
  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, ...updates } : op);
  persistOps();

  // 2. Update Supabase
  const dbPayload: any = {};
  if (updates.number !== undefined) dbPayload.number = updates.number;
  if (updates.product !== undefined) dbPayload.product = updates.product;
  if (updates.lote !== undefined) dbPayload.lote = updates.lote;
  if (updates.plannedQuantity !== undefined) dbPayload.planned_quantity = updates.plannedQuantity;
  if (updates.producedQuantity !== undefined) dbPayload.produced_quantity = updates.producedQuantity;
  if (updates.granel !== undefined) dbPayload.granel = updates.granel;
  if (updates.priority !== undefined) dbPayload.priority = updates.priority;
  if (updates.status !== undefined) dbPayload.status = updates.status;
  if (updates.lineId !== undefined) dbPayload.line_id = updates.lineId;
  if (updates.leaderId !== undefined) dbPayload.leader_id = updates.leaderId;
  if (updates.packageAvailability !== undefined) dbPayload.package_availability = updates.packageAvailability;
  if (updates.sequence !== undefined) dbPayload.sequence = updates.sequence;
  if (updates.scheduledDate !== undefined) dbPayload.scheduled_date = updates.scheduledDate;
  if (updates.scheduledShift !== undefined) dbPayload.scheduled_shift = updates.scheduledShift;
  if (updates.setor !== undefined) dbPayload.setor = updates.setor;
  if (updates.unidade !== undefined) dbPayload.unidade = updates.unidade;
  if (updates.rejectedQuantity !== undefined) dbPayload.rejected_quantity = updates.rejectedQuantity;
  if (updates.plannedHours !== undefined) dbPayload.planned_hours = updates.plannedHours;
  if (updates.tipoDocumento !== undefined) dbPayload.tipo_documento = updates.tipoDocumento;
  if (updates.industria !== undefined) dbPayload.industria = updates.industria;
  if (updates.finishedShift !== undefined) dbPayload.finished_shift = updates.finishedShift;

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update(dbPayload).eq('id', opId),
      supabase.from('ops').update(dbPayload).eq('id', opId),
    ]);
  } catch (err) {
    console.warn('Atualização de OP no Supabase:', err);
  }
};

/**
 * Busca as metas mensais do banco para o ano atual.
 * Retorna array de MonthlyGoal ou array vazio em caso de erro.
 */
export const getMonthlyGoals = async (year: number): Promise<MonthlyGoal[]> => {
  try {
    const { data, error } = await supabase
      .from('monthly_goals')
      .select('*')
      .eq('year', year)
      .order('month', { ascending: true });

    if (data && !error && data.length > 0) {
      const mapped: MonthlyGoal[] = data.map((d: any) => ({
        id: String(d.id),
        lineId: String(d.line_id),
        year: Number(d.year),
        month: Number(d.month),
        goalQuantity: Number(d.goal_quantity || 0),
        setor: d.setor || undefined,
        createdAt: d.created_at || new Date().toISOString(),
        updatedAt: d.updated_at || new Date().toISOString(),
      }));

      return mapped;
    }
  } catch (err) {
    console.warn('Erro ao buscar metas mensais no Supabase:', err);
  }

  return [];
};

/**
 * Salva ou atualiza uma meta mensal.
 * Usa upsert com onConflict: 'line_id, year, month, setor'.
 */
export const saveMonthlyGoal = async (
  goal: Omit<MonthlyGoal, 'id' | 'createdAt' | 'updatedAt'>
): Promise<boolean> => {
  try {
    const payload: any = {
      line_id: goal.lineId,
      year: goal.year,
      month: goal.month,
      goal_quantity: goal.goalQuantity,
      setor: goal.setor || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('monthly_goals')
      .upsert(payload, { onConflict: 'line_id, year, month, setor' });

    if (error) {
      console.warn('Erro ao persistir meta mensal no Supabase:', error);
    }

    notifyStateChange();
    return true;
  } catch (err) {
    console.error('Erro ao salvar meta mensal:', err);
    return false;
  }
};

export const deleteOP = async (opId: string) => {
  // 1. Remove from memory
  inMemoryOps = inMemoryOps.filter(op => op.id !== opId);
  persistOps();

  // 2. Delete from Supabase tables
  try {
    await Promise.allSettled([
      supabase.from('production_orders').delete().eq('id', opId),
      supabase.from('ops').delete().eq('id', opId),
    ]);
  } catch (err) {
    console.warn('Remoção de OP no Supabase:', err);
  }
};

export const getActiveOP = async (lineId: string): Promise<ProductionOrder | null> => {
  try {
    const ops = await getAllOPs();
    const active = ops.find(o => o.lineId === lineId && (o.status === 'in_progress' || o.status === 'paused'));
    if (active) return active;

    const pending = ops
      .filter(o => o.lineId === lineId && o.status === 'pending')
      .sort((a, b) => a.sequence - b.sequence);
    
    if (pending.length > 0) return pending[0];
  } catch (err) {
    console.warn('Erro ao buscar OP ativa:', err);
  }
  return null;
};

// ---------------- ROTATIONS & ASSIGNMENTS ----------------
export const getLeaderRotation = async (
  leaderId: string,
  leaderEmail?: string,
  leaderName?: string
): Promise<string | null> => {
  const cleanEmail = (leaderEmail || '').trim().toLowerCase();
  const cleanName = (leaderName || '').trim().toLowerCase();

  const matchingProfile = inMemoryProfiles.find(p =>
    (leaderId && p.uid === leaderId) ||
    (cleanEmail && p.email && p.email.toLowerCase() === cleanEmail) ||
    (cleanName && p.name && p.name.toLowerCase() === cleanName)
  );

  // Supabase é sempre a fonte primária — o coordenador pode ter trocado a linha
  // em outro dispositivo e o cache local estaria desatualizado.
  try {
    const canonicalId = matchingProfile?.uid || leaderId;
    const candidateIds = Array.from(new Set([
      canonicalId,
      leaderId,
      cleanEmail || null,
      matchingProfile?.email?.toLowerCase() || null,
    ].filter(Boolean))) as string[];

    for (const cId of candidateIds) {
      let { data, error } = await supabase
        .from('weekly_rotations')
        .select('line_id')
        .eq('leader_id', cId)
        .maybeSingle();

      if (!data || error) {
        const res = await supabase
          .from('rotations')
          .select('line_id')
          .eq('leader_id', cId)
          .maybeSingle();
        data = res.data;
      }

      if (data?.line_id) {
        const resolvedLine = String(data.line_id);
        inMemoryRotations[canonicalId] = resolvedLine;
        if (cleanEmail) inMemoryRotations[cleanEmail] = resolvedLine;
        persistRotations();
        return resolvedLine;
      }
    }
  } catch (err) {
    console.warn('Consulta de rotação no Supabase:', err);
  }

  // Fallback: memória e depois perfil
  if (leaderId && inMemoryRotations[leaderId]) return inMemoryRotations[leaderId];
  if (cleanEmail && inMemoryRotations[cleanEmail]) return inMemoryRotations[cleanEmail];
  if (matchingProfile?.uid && inMemoryRotations[matchingProfile.uid]) return inMemoryRotations[matchingProfile.uid];
  if ((matchingProfile as any)?.lineId) return (matchingProfile as any).lineId;

  // Último recurso: OP ativa associada ao líder
  const foundOp = inMemoryOps.find(o =>
    (leaderId && o.leaderId === leaderId) ||
    (cleanEmail && o.leaderId && o.leaderId.toLowerCase() === cleanEmail) ||
    (matchingProfile?.uid && o.leaderId === matchingProfile.uid)
  );
  return foundOp?.lineId || null;
};

export const getAllRotations = async (): Promise<Record<string, string>> => {
  try {
    let { data, error } = await supabase.from('weekly_rotations').select('leader_id, line_id');
    if (error || !data || data.length === 0) {
      const res = await supabase.from('rotations').select('leader_id, line_id');
      data = res.data;
      error = res.error;
    }

    if (data && data.length > 0 && !error) {
      const map: Record<string, string> = { ...inMemoryRotations };
      data.forEach((r: any) => {
        if (r.leader_id && r.line_id) {
          map[String(r.leader_id)] = String(r.line_id);
          map[String(r.leader_id).toLowerCase()] = String(r.line_id);
        }
      });
      inMemoryRotations = map;
      persistRotations();
      return map;
    }
  } catch (err) {
    console.warn('Busca de todas rotações no Supabase:', err);
  }
  return inMemoryRotations;
};

export const saveLeaderRotation = async (
  leaderId: string, 
  lineId: string,
  leaderEmail?: string,
  leaderName?: string
): Promise<void> => {
  inMemoryRotations[leaderId] = lineId;
  if (leaderEmail) {
    inMemoryRotations[leaderEmail] = lineId;
    inMemoryRotations[leaderEmail.toLowerCase()] = lineId;
  }

  // Update in profiles if found
  const targetProf = inMemoryProfiles.find(p => 
    p.uid === leaderId || 
    (leaderEmail && p.email?.toLowerCase() === leaderEmail.toLowerCase()) ||
    (leaderName && p.name?.toLowerCase() === leaderName.toLowerCase())
  );

  if (targetProf) {
    (targetProf as any).lineId = lineId;
    if (targetProf.uid) inMemoryRotations[targetProf.uid] = lineId;
    if (targetProf.email) {
      inMemoryRotations[targetProf.email] = lineId;
      inMemoryRotations[targetProf.email.toLowerCase()] = lineId;
    }
    persistProfiles();
  }

  persistRotations();

  // Notify listeners via storage event or custom event for multi-tab / real-time sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sig_rotations_updated', { 
      detail: { leaderId, lineId, leaderEmail: leaderEmail || targetProf?.email } 
    }));
    window.dispatchEvent(new CustomEvent('sig_data_updated'));
  }

  try {
    const canonicalId = targetProf?.uid || leaderId;

    const payload = {
      leader_id: canonicalId,
      line_id: lineId,
      updated_at: new Date().toISOString(),
    };

    await Promise.allSettled([
      supabase.from('weekly_rotations').upsert(payload, { onConflict: 'leader_id' }),
      supabase.from('rotations').upsert(payload, { onConflict: 'leader_id' }),
    ]);

    if (canonicalId !== leaderId && leaderId.includes('@')) {
      await Promise.allSettled([
        supabase.from('weekly_rotations').delete().eq('leader_id', leaderId),
        supabase.from('rotations').delete().eq('leader_id', leaderId),
        supabase.from('weekly_rotations').delete().eq('leader_id', leaderId.toLowerCase()),
        supabase.from('rotations').delete().eq('leader_id', leaderId.toLowerCase()),
      ]);
    }
  } catch (err) {
    console.warn('Salvar escala de líder no Supabase:', err);
  }
};

// ---------------- PAUSE REASONS & EVENTS ----------------
export const getPauseReasons = async (): Promise<PauseReason[]> => {
  try {
    const { data, error } = await supabase.from('pause_reasons').select('*').order('name', { ascending: true });
    if (data && data.length > 0 && !error) {
      return data.map((d: any) => ({
        id: String(d.id),
        name: d.name || d.reason || 'Pausa Operacional',
        category: d.category || 'Geral',
      }));
    }
  } catch (err) {
    console.warn('Busca de motivos de pausa no Supabase:', err);
  }
  return DEFAULT_PAUSE_REASONS;
};

export const getRecentEvents = async (): Promise<ProductionEvent[]> => {
  try {
    let { data, error } = await supabase
      .from('production_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      const res = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      data = res.data;
      error = res.error;
    }

    if (data && data.length > 0 && !error) {
      const mapped: ProductionEvent[] = data
        .map((e: any) => ({
          id: String(e.id),
          opId: e.op_id ? String(e.op_id) : undefined,
          lineId: e.line_id ? String(e.line_id) : undefined,
          leaderId: e.leader_id ? String(e.leader_id) : undefined,
          opNumber: e.op_number || e.op_id || 'OP',
          lineName: e.line_name || e.line_id || 'Linha',
          leaderName: e.leader_name || 'Líder',
          type: e.type,
          quantity: e.quantity ? Number(e.quantity) : undefined,
          reason: e.reason,
          observation: e.observation,
          createdAt: e.created_at || new Date().toISOString(),
        }))
        .filter(e => !isMockEvent(e));

      inMemoryEvents = mapped;
      persistEvents();
      return mapped;
    }
  } catch (err) {
    console.warn('Busca de eventos no Supabase:', err);
  }
  return inMemoryEvents;
};

// ---------------- OP ACTIONS ----------------
export const startOP = async (opId: string, lineId: string, leaderId: string) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, status: 'in_progress', leaderId, lineId } : op);
  inMemoryLines = inMemoryLines.map(l => l.id === lineId ? { ...l, status: 'active', currentOpId: opId } : l);

  persistOps();
  persistLines();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'STARTED',
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update({ status: 'in_progress', leader_id: leaderId, line_id: lineId }).eq('id', opId),
      supabase.from('ops').update({ status: 'in_progress', leader_id: leaderId, line_id: lineId }).eq('id', opId),
      supabase.from('production_lines').update({ status: 'active', current_op_id: opId }).eq('id', lineId),
      supabase.from('lines').update({ status: 'active', current_op_id: opId }).eq('id', lineId),
      supabase.from('production_events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'STARTED', created_at: newEvent.createdAt }),
      supabase.from('events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'STARTED', created_at: newEvent.createdAt }),
    ]);
  } catch (error) {
    console.error('Erro ao iniciar OP:', error);
  }
};

export const pauseOP = async (opId: string, lineId: string, leaderId: string, reason: string, observation: string) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, status: 'paused' } : op);
  inMemoryLines = inMemoryLines.map(l => l.id === lineId ? { ...l, status: 'paused' } : l);

  persistOps();
  persistLines();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'PAUSED',
    reason,
    observation,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update({ status: 'paused' }).eq('id', opId),
      supabase.from('ops').update({ status: 'paused' }).eq('id', opId),
      supabase.from('production_lines').update({ status: 'paused' }).eq('id', lineId),
      supabase.from('lines').update({ status: 'paused' }).eq('id', lineId),
      supabase.from('production_events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'PAUSED', reason, observation, created_at: newEvent.createdAt }),
      supabase.from('events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'PAUSED', reason, observation, created_at: newEvent.createdAt }),
    ]);
  } catch (error) {
    console.error('Erro ao pausar OP:', error);
  }
};

export const resumeOP = async (opId: string, lineId: string, leaderId: string) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, status: 'in_progress' } : op);
  inMemoryLines = inMemoryLines.map(l => l.id === lineId ? { ...l, status: 'active' } : l);

  persistOps();
  persistLines();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'RESUMED',
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update({ status: 'in_progress' }).eq('id', opId),
      supabase.from('ops').update({ status: 'in_progress' }).eq('id', opId),
      supabase.from('production_lines').update({ status: 'active' }).eq('id', lineId),
      supabase.from('lines').update({ status: 'active' }).eq('id', lineId),
      supabase.from('production_events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'RESUMED', created_at: newEvent.createdAt }),
      supabase.from('events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'RESUMED', created_at: newEvent.createdAt }),
    ]);
  } catch (error) {
    console.error('Erro ao retomar OP:', error);
  }
};

export const finishOP = async (
  opId: string,
  lineId: string,
  leaderId: string,
  finishedShift?: 'Manhã' | 'Tarde'
) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);

  inMemoryOps = inMemoryOps.map(op => 
    op.id === opId 
      ? { ...op, status: 'completed', finishedShift: finishedShift || undefined, completedAt: new Date().toISOString() } 
      : op
  );
  inMemoryLines = inMemoryLines.map(l => l.id === lineId ? { ...l, status: 'idle', currentOpId: null } : l);

  persistOps();
  persistLines();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'FINISHED',
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update({ status: 'completed', finished_shift: finishedShift || null }).eq('id', opId),
      supabase.from('ops').update({ status: 'completed', finished_shift: finishedShift || null }).eq('id', opId),
      supabase.from('production_lines').update({ status: 'idle', current_op_id: null }).eq('id', lineId),
      supabase.from('lines').update({ status: 'idle', current_op_id: null }).eq('id', lineId),
      supabase.from('production_events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'FINISHED', created_at: newEvent.createdAt }),
      supabase.from('events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'FINISHED', created_at: newEvent.createdAt }),
    ]);
  } catch (error) {
    console.error('Erro ao finalizar OP:', error);
  }
};

export const reportQuantity = async (opId: string, lineId: string, leaderId: string, quantity: number) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);
  const newQty = (currentOp?.producedQuantity || 0) + quantity;

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, producedQuantity: newQty } : op);
  persistOps();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'QUANTITY_REPORTED',
    quantity,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update({ produced_quantity: newQty }).eq('id', opId),
      supabase.from('ops').update({ produced_quantity: newQty }).eq('id', opId),
      supabase.from('production_events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'QUANTITY_REPORTED', quantity, created_at: newEvent.createdAt }),
      supabase.from('events').insert({ op_id: opId, line_id: lineId, leader_id: leaderId, type: 'QUANTITY_REPORTED', quantity, created_at: newEvent.createdAt }),
    ]);
  } catch (error) {
    console.error('Erro ao registrar quantidade:', error);
  }
};

// ---------------- DATABASE RESET & CLEANUP ----------------
export const clearAllOPs = async (): Promise<void> => {
  inMemoryOps = [];
  persistOps();

  // Also reset all lines to idle
  inMemoryLines = inMemoryLines.map(l => ({ ...l, status: 'idle', currentOpId: null }));
  persistLines();

  try {
    await Promise.allSettled([
      supabase.from('production_orders').delete().neq('id', '___non_existent___'),
      supabase.from('ops').delete().neq('id', '___non_existent___'),
      supabase.from('production_lines').update({ status: 'idle', current_op_id: null }).neq('id', '___none___'),
      supabase.from('lines').update({ status: 'idle', current_op_id: null }).neq('id', '___none___'),
    ]);
  } catch (err) {
    console.warn('Erro ao limpar OPs no Supabase:', err);
  }
};

export const clearAllEvents = async (): Promise<void> => {
  inMemoryEvents = [];
  persistEvents();

  try {
    await Promise.allSettled([
      supabase.from('production_events').delete().neq('id', '___non_existent___'),
      supabase.from('events').delete().neq('id', '___non_existent___'),
    ]);
  } catch (err) {
    console.warn('Erro ao limpar eventos no Supabase:', err);
  }
};

export const resetProductionDatabase = async (): Promise<void> => {
  inMemoryOps = [];
  inMemoryEvents = [];
  inMemoryLines = DEFAULT_LINES.map(l => ({ ...l, status: 'idle', currentOpId: null }));
  
  persistOps();
  persistEvents();
  persistLines();

  // Clean old storage versions as well
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem('SIG_PROD_OPS_STORAGE_V4');
      window.localStorage.removeItem('SIG_PROD_DELETED_OPS_V4');
      window.localStorage.removeItem('SIG_PROD_EVENTS_STORAGE_V4');
      window.localStorage.removeItem('SIG_PROD_OPS_STORAGE');
      window.localStorage.removeItem('SIG_PROD_EVENTS_STORAGE');
    } catch {}
  }

  try {
    await Promise.allSettled([
      supabase.from('production_orders').delete().neq('id', '___non_existent___'),
      supabase.from('ops').delete().neq('id', '___non_existent___'),
      supabase.from('production_events').delete().neq('id', '___non_existent___'),
      supabase.from('events').delete().neq('id', '___non_existent___'),
      supabase.from('production_lines').update({ status: 'idle', current_op_id: null }).neq('id', '___none___'),
      supabase.from('lines').update({ status: 'idle', current_op_id: null }).neq('id', '___none___'),
    ]);
  } catch (err) {
    console.warn('Erro ao resetar banco no Supabase:', err);
  }
};

