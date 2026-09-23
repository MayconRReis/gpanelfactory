import { createClient } from '@supabase/supabase-js';
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  isRetryableError,
  isFetchOrNetworkError,
  isSupabaseRuntimeEnabled,
} from '../lib/supabase';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, PauseReason, MonthlyGoal, LineDailyGoal, FactoryMonthlyGoal, AccessRule, DashboardTab } from '../types';
import { calculateProductionTime } from '../lib/productionTime';

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

      // Se a OP está atualmente em pausa (sem RESUMED ainda), contabiliza até agora
      if (pauseStartTime !== null) {
        const diff = Date.now() - pauseStartTime;
        if (diff > 0) totalMs += diff;
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
    } else if (events && events.length > 0) {
      // Fallback OEE baseado no histórico real de eventos: reaproveita o mesmo
      // cálculo de Tempo Trabalhado/Ocioso usado nos cards de Índice de
      // Ociosidade (lib/productionTime.ts), para que os dois nunca divirjam.
      // Desde a correção da ociosidade real (gaps entre OPs consecutivas do
      // mesmo setor/turno/dia, a partir dos horários reais de início/fim já
      // registrados), isso também passou a refletir corretamente meses
      // importados do histórico que só têm STARTED/FINISHED (sem PAUSED),
      // em vez de assumir 100% de disponibilidade por falta de pausas
      // registradas explicitamente.
      const opIds = new Set(ops.map(o => o.id));
      const opEvents = events.filter(e => e.opId && opIds.has(e.opId));
      const timeMetrics = calculateProductionTime(opEvents, ops, []);

      if (timeMetrics.totalMs > 0) {
        disponibilidade = Math.max(0, Math.min(1, timeMetrics.workingMs / timeMetrics.totalMs));
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
 * Agrupa producedQuantity por HORA (0–23) de um dia específico — usado pelo
 * gráfico do Dashboard quando o filtro de período é "Dia". Usa `completedAt`
 * (o momento real em que a OP foi finalizada) como referência de hora, com
 * fallback pra `createdAt` quando a OP ainda não tem `completedAt`. Como
 * `ops`/`production_orders` não têm limite de linhas (getAllOPs pagina tudo),
 * isso é confiável mesmo em dias de muita atividade — diferente de tentar
 * montar essa mesma visão a partir de `events`, que só traz os 50 mais
 * recentes de toda a fábrica (getRecentEvents).
 */
export function groupProductionByHour(
  ops: ProductionOrder[],
  dateStr: string
): Array<{ hour: number; label: string; quantity: number }> {
  const result = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}h`,
    quantity: 0,
  }));

  if (!ops || ops.length === 0 || !dateStr) return result;

  try {
    for (const op of ops) {
      if (!op || !op.producedQuantity) continue;

      const tsStr = op.completedAt || op.createdAt;
      if (!tsStr) continue;

      const d = new Date(tsStr);
      if (isNaN(d.getTime())) continue;

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      if (`${yyyy}-${mm}-${dd}` !== dateStr) continue;

      const hour = d.getHours();
      result[hour].quantity += Number(op.producedQuantity || 0);
    }
  } catch (err) {
    console.warn('Erro ao agrupar produção por hora:', err);
  }

  return result;
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

// Configuração oficial de linhas de produção: Envase 1, Envase 2 e Sleev (sem o prefixo 'Linha')
export const normalizeLineName = (id: string, name?: string | null): string => {
  const cleanId = String(id || '').toLowerCase().trim();
  const cleanName = String(name || '').toLowerCase().trim();

  // Envase 1
  if (
    cleanId === 'line-1' ||
    cleanName === 'linha 01 - envase' ||
    cleanName === 'linha 1 - envase' ||
    cleanName === 'linha 1' ||
    cleanName === 'linha 01' ||
    cleanName === 'envase 1' ||
    cleanName === 'envase 01' ||
    (cleanName.includes('envase') && (cleanName.includes('1') || cleanName.includes('01')))
  ) {
    return 'Envase 1';
  }

  // Envase 2
  if (
    cleanId === 'line-2' ||
    cleanName === 'linha 02 - envase' ||
    cleanName === 'linha 2 - envase' ||
    cleanName === 'linha 2' ||
    cleanName === 'linha 02' ||
    cleanName === 'envase 2' ||
    cleanName === 'envase 02' ||
    (cleanName.includes('envase') && (cleanName.includes('2') || cleanName.includes('02')))
  ) {
    return 'Envase 2';
  }

  // Sleev
  if (
    cleanId === 'line-sleeve' ||
    cleanId === 'line-sleev' ||
    cleanName === 'linha sleeve' ||
    cleanName === 'linha sleev' ||
    cleanName === 'sleeve' ||
    cleanName === 'sleev' ||
    cleanName.includes('sleeve') ||
    cleanName.includes('sleev')
  ) {
    return 'Sleev';
  }

  // Se qualquer outra linha começar com "Linha " ou "Linha - "
  if (name && /^linha\s*[-–—]?\s*/i.test(name.trim())) {
    const stripped = name.trim().replace(/^linha\s*[-–—]?\s*/i, '');
    if (stripped.length > 0) {
      return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }

  return name || id;
};

const DEFAULT_LINES: ProductionLine[] = [
  { id: 'line-1', name: 'Envase 1', status: 'idle', currentOpId: null },
  { id: 'line-2', name: 'Envase 2', status: 'idle', currentOpId: null },
  { id: 'line-sleeve', name: 'Sleev', status: 'idle', currentOpId: null },
];

// Default initial fallback OPs (Vazio por padrão para novas atribuições e importações)
const DEFAULT_OPS: ProductionOrder[] = [];

// Default pause reasons
export const DEFAULT_PAUSE_REASONS: PauseReason[] = [
  { id: 'pr-1', name: 'Aguardando laboratório' },
  { id: 'pr-2', name: 'Falta de insumo' },
  { id: 'pr-3', name: 'Limpeza' },
  { id: 'pr-4', name: 'Manutenção' },
  { id: 'pr-5', name: 'Problema na envasadora' },
  { id: 'pr-6', name: 'Problema operacional' },
  { id: 'pr-7', name: 'Intervalo' },
  { id: 'pr-8', name: 'Outro' },
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

// Blacklist persistente de OPs excluídas (por id específico — não afeta OPs
// futuras nem históricas, só as que o usuário realmente excluiu uma a uma).
//
// Havia também um "timestamp do último reset geral" (SIG_PROD_OPS_RESET_TIME_V6)
// que escondia no Dashboard qualquer OP com created_at <= aquele momento. Como
// o botão de resetar produção já apaga de verdade no Supabase
// (DELETE FROM production_orders/ops abaixo), esse filtro por data no
// navegador era redundante — e tinha o efeito colateral de esconder
// permanentemente qualquer dado histórico importado depois com uma data de
// produção anterior ao reset (foi a causa de um bug real: meses inteiros
// sumindo do Dashboard). Removido.
const DELETED_OPS_KEY = 'SIG_PROD_DELETED_OPS_V6';

let deletedOpIds = new Set<string>();

if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const stored = window.localStorage.getItem(DELETED_OPS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        deletedOpIds = new Set(parsed);
      }
    }
    // Limpa a trava antiga de reset por data, caso ainda exista no navegador.
    window.localStorage.removeItem('SIG_PROD_OPS_RESET_TIME_V6');
  } catch {}
}

function saveDeletedOpIds() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(DELETED_OPS_KEY, JSON.stringify(Array.from(deletedOpIds)));
    } catch {}
  }
}

const SLEEVE_OPS_KEY = 'gpanel_sleeve_op_ids';

export function getSleeveOpIds(): Set<string> {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(SLEEVE_OPS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
      }
    } catch {}
  }
  return new Set();
}

export function markOpAsSleeve(opId: string, isSleeve: boolean) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const set = getSleeveOpIds();
      if (isSleeve) {
        set.add(opId);
      } else {
        set.delete(opId);
      }
      window.localStorage.setItem(SLEEVE_OPS_KEY, JSON.stringify(Array.from(set)));
    } catch {}
  }
}

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
        rule: data.rule || (isCoord ? 'admin' : data.area === 'Pesagem' ? 'pesagem' : data.area === 'Manipulação' ? 'manipulacao' : 'envase'),
        allowedScreens: data.allowed_screens || undefined,
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
          rule: d.rule || localMatch?.rule || (isCoord ? 'admin' : (d.area || localMatch?.area) === 'Pesagem' ? 'pesagem' : (d.area || localMatch?.area) === 'Manipulação' ? 'manipulacao' : 'envase'),
          allowedScreens: d.allowed_screens || localMatch?.allowedScreens || undefined,
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

    if (error) {
      console.error('Erro ao atualizar cargo de usuário no Supabase:', error.message);
    }
    return !error;
  } catch (err) {
    console.error('Erro ao atualizar cargo de usuário:', err);
    return false;
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

    if (error) {
      console.error('Erro ao atualizar área de usuário no Supabase:', error.message);
    }
    return !error;
  } catch (err) {
    console.error('Erro ao atualizar área de usuário:', err);
    return false;
  }
};

export const updateUserRule = async (
  userId: string,
  newRule: AccessRule,
  allowedScreens?: DashboardTab[]
): Promise<boolean> => {
  try {
    const isCoord = newRule === 'admin';
    const targetArea: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação' | undefined = 
      newRule === 'pesagem' ? 'Pesagem' 
      : newRule === 'manipulacao' ? 'Manipulação' 
      : newRule === 'envase' ? 'Envase' 
      : isCoord ? 'Coordenação' : undefined;

    const targetCargo = newRule === 'admin' ? 'Coordenador Geral'
      : newRule === 'pesagem' ? 'Líder de Pesagem'
      : newRule === 'manipulacao' ? 'Líder de Manipulação'
      : newRule === 'envase' ? 'Líder de Envase'
      : undefined;

    // 1. Atualizar em memória imediatamente
    const target = inMemoryProfiles.find(u => u.uid === userId || (u.email && u.email.toLowerCase() === userId.toLowerCase()));
    if (target) {
      target.rule = newRule;
      target.allowedScreens = allowedScreens;
      target.role = isCoord ? 'coordinator' : 'leader';
      if (targetArea) target.area = targetArea;
      if (targetCargo) target.cargo = targetCargo;
      persistProfiles();
    }

    // 2. Atualizar no Supabase
    const payload: any = {
      role: isCoord ? 'coordinator' : 'leader',
      rule: newRule,
      allowed_screens: allowedScreens || null,
      updated_at: new Date().toISOString(),
    };
    if (targetArea) payload.area = targetArea;
    if (targetCargo) payload.cargo = targetCargo;

    let { error } = await supabase.from('profiles').update(payload).eq('id', userId);
    if (error) {
      const res = await supabase.from('profiles').update(payload).eq('email', userId);
      error = res.error;
    }

    // Se falhar por colunas inexistentes, tenta salvar payload base seguro
    if (error) {
      const safePayload: any = {
        role: isCoord ? 'coordinator' : 'leader',
        updated_at: new Date().toISOString(),
      };
      if (targetArea) safePayload.area = targetArea;
      if (targetCargo) safePayload.cargo = targetCargo;

      const safeRes = await supabase.from('profiles').update(safePayload).eq('id', userId);
      error = safeRes.error;
    }

    if (error) {
      console.error('Erro ao atualizar rule do usuário no Supabase:', error.message);
    }
    return !error;
  } catch (err) {
    console.error('Erro ao atualizar rule do usuário:', err);
    return false;
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

    if (error) {
      console.error('Erro ao alterar status de usuário no Supabase:', error.message);
    }
    return !error;
  } catch (err) {
    console.error('Erro ao alterar status de usuário:', err);
    return false;
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

    let deleteFailed = false;
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error || targetEmail) {
        const resByEmail = await supabase.from('profiles').delete().eq('email', targetEmail);
        // Só consideramos falha se AMBAS as tentativas (por id e por email) erraram —
        // a segunda é feita sempre como reforço, mesmo quando a primeira já deu certo.
        deleteFailed = Boolean(error) && Boolean(resByEmail.error);
      }
    } catch (e) {
      console.warn('Erro ao excluir no Supabase:', e);
      deleteFailed = true;
    }

    if (deleteFailed) {
      console.error(`Falha ao excluir perfil ${userId} no Supabase.`);
    }
    return !deleteFailed;
  } catch (err) {
    console.error('Erro ao remover perfil:', err);
    return false;
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
      const mapped: ProductionLine[] = data.map((d: any) => {
        const normName = normalizeLineName(String(d.id), d.name);
        // Sincroniza atualização do nome no Supabase se ainda tiver o formato antigo com 'Linha'
        if (d.name && d.name !== normName) {
          try {
            supabase.from('production_lines').update({ name: normName }).eq('id', d.id).then();
            supabase.from('lines').update({ name: normName }).eq('id', d.id).then();
          } catch {}
        }

        return {
          id: String(d.id),
          name: normName,
          status: (d.status || 'idle') as 'active' | 'idle' | 'paused',
          currentOpId: d.current_op_id ? String(d.current_op_id) : (d.currentOpId ? String(d.currentOpId) : null),
        };
      });

      const existingMap = new Map(inMemoryLines.map(l => [l.id, l]));
      mapped.forEach(remoteLine => {
        const local = existingMap.get(remoteLine.id);
        existingMap.set(remoteLine.id, {
          name: remoteLine.name || normalizeLineName(remoteLine.id, local?.name),
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

  // Sanitize line status if currentOpId is a mock or non-existent OP, and ensure normalized names
  const opIds = new Set(inMemoryOps.map(o => o.id));
  inMemoryLines = inMemoryLines.map(line => {
    const normName = normalizeLineName(line.id, line.name);
    if (line.currentOpId && (!opIds.has(line.currentOpId) || isMockOp({ id: line.currentOpId }))) {
      return { ...line, name: normName, currentOpId: null, status: 'idle' };
    }
    return { ...line, name: normName };
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
 * Todos os setores agora utilizam a nomenclatura padrão OP (Ordem de Produção).
 */
export function getTipoDocumento(
  _setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral'
): 'OP' {
  return 'OP';
}

// Busca TODAS as linhas de uma tabela, paginando com .range() em vez de um
// único select() sem limite — o Supabase/PostgREST aplica um teto de linhas
// por requisição (Max Rows do projeto, geralmente 1000), e sem isso qualquer
// tabela que passe desse teto tem linhas cortadas silenciosamente (sem erro).
// Ordena por `sequence` + `id` (desempate determinístico) porque muitas OPs
// importadas do histórico compartilham o mesmo valor de `sequence` — sem um
// desempate único, a paginação por .range() pode pular ou repetir linhas
// empatadas entre uma página e outra.
async function fetchAllRows(table: 'production_orders' | 'ops'): Promise<{ data: any[] | null; error: any }> {
  const PAGE_SIZE = 1000;
  const allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('sequence', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      return { data: allRows.length > 0 ? allRows : null, error };
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break; // última página
    offset += PAGE_SIZE;
  }
  return { data: allRows, error: null };
}

export const getAllOPs = async (): Promise<ProductionOrder[]> => {
  try {
    let { data, error } = await fetchAllRows('production_orders');
    if (error || !data || data.length === 0) {
      const res = await fetchAllRows('ops');
      data = res.data;
      error = res.error;
    }

    if (data && data.length > 0 && !error) {
      const sleeveIds = getSleeveOpIds();
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
          scheduledEndDate: d.scheduled_end_date || d.scheduledEndDate || undefined,
          scheduledDays: d.scheduled_days != null ? Number(d.scheduled_days) : (d.scheduledDays != null ? Number(d.scheduledDays) : undefined),
          scheduledShift: d.scheduled_shift || d.scheduledShift || undefined,
          setor: d.setor || undefined,
          unidade: d.unidade || undefined,
          rejectedQuantity: Number(d.rejected_quantity || d.rejectedQuantity || 0),
          plannedHours: d.planned_hours != null ? Number(d.planned_hours) : (d.plannedHours != null ? Number(d.plannedHours) : undefined),
          tipoDocumento: d.tipo_documento || 'OP',
          industria: d.industria || undefined,
          finishedShift: d.finished_shift || undefined,
          isSleeve: sleeveIds.has(String(d.id)) || Boolean(d.is_sleeve || d.isSleeve),
          createdAt: d.created_at || d.createdAt || new Date().toISOString(),
        }))
        .filter((op) => {
          if (isMockOp(op)) return false;
          if (deletedOpIds.has(op.id)) return false;
          return true;
        });

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

  // Se o ID constava no blacklist de excluídos, remove-o
  deletedOpIds.delete(newOp.id);
  saveDeletedOpIds();

  // 1. Immediately persist locally
  inMemoryOps = [newOp, ...inMemoryOps];
  persistOps();

  // 2. Synchronize with Supabase — grava nas duas tabelas (production_orders e ops)
  // sequencialmente, com log de erro por tabela. NÃO usar Promise.allSettled aqui:
  // uma falha silenciosa em uma das duas é exatamente a causa da dessincronização
  // entre elas (ver investigação em ops vs production_orders).
  //
  // Payload restrito às colunas que existem confirmadamente em `ops` E em
  // `production_orders` (confirmado em produção: `production_orders` espelha
  // exatamente as mesmas colunas de `ops`, sem scheduled_end_date/scheduled_days/
  // completed_at — ver o erro "Could not find the 'scheduled_days' column of
  // 'production_orders'"). As DUAS tabelas recebem este mesmo payload restrito.
  const opsPayload: any = {
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
    created_at: newOp.createdAt,
  };

  try {
    const resProductionOrders = await supabase.from('production_orders').insert(opsPayload);
    if (resProductionOrders.error) {
      console.error(`[createOP] Falha ao gravar em production_orders (OP ${newOp.id}):`, resProductionOrders.error.message);
    }
  } catch (err) {
    console.error(`[createOP] Erro inesperado ao gravar em production_orders (OP ${newOp.id}):`, err);
  }

  try {
    const resOps = await supabase.from('ops').insert(opsPayload);
    if (resOps.error) {
      console.error(`[createOP] Falha ao gravar em ops (OP ${newOp.id}):`, resOps.error.message);
    }
  } catch (err) {
    console.error(`[createOP] Erro inesperado ao gravar em ops (OP ${newOp.id}):`, err);
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

  // Remove qualquer OP importada do blacklist de excluídos
  newCreated.forEach(op => deletedOpIds.delete(op.id));
  saveDeletedOpIds();

  // 1. Immediately persist locally in memory and localStorage
  inMemoryOps = [...newCreated, ...inMemoryOps];
  persistOps();

  // 2. Synchronize with Supabase — grava nas duas tabelas sequencialmente,
  // com log de erro por tabela (mesmo motivo do createOP: não usar
  // Promise.allSettled/fallback silencioso aqui, senão `ops` fica para trás).
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

  try {
    const resProductionOrders = await supabase.from('production_orders').insert(payloads);
    if (resProductionOrders.error) {
      console.error('[importOPsBatch] Falha ao gravar em production_orders:', resProductionOrders.error.message);
    }
  } catch (err) {
    console.error('[importOPsBatch] Erro inesperado ao gravar em production_orders:', err);
  }

  try {
    const resOps = await supabase.from('ops').insert(payloads);
    if (resOps.error) {
      console.error('[importOPsBatch] Falha ao gravar em ops:', resOps.error.message);
    }
  } catch (err) {
    console.error('[importOPsBatch] Erro inesperado ao gravar em ops:', err);
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

  // 2. Update Supabase — payload "completo" para production_orders e um
  // payload restrito para ops (mesma distinção já feita em createOP:
  // scheduled_end_date/scheduled_days/completed_at não existem em `ops`,
  // só foram adicionadas manualmente em `production_orders`). Antes este
  // payload era único e idêntico para as duas tabelas — qualquer updateOP
  // que incluísse scheduledEndDate/scheduledDays (como ao vincular uma OP a
  // uma linha) derrubava o PATCH em `ops` com 400 (coluna inexistente).
  const fullPayload: any = {};
  if (updates.number !== undefined) fullPayload.number = updates.number;
  if (updates.product !== undefined) fullPayload.product = updates.product;
  if (updates.lote !== undefined) fullPayload.lote = updates.lote;
  if (updates.plannedQuantity !== undefined) fullPayload.planned_quantity = updates.plannedQuantity;
  if (updates.producedQuantity !== undefined) fullPayload.produced_quantity = updates.producedQuantity;
  if (updates.granel !== undefined) fullPayload.granel = updates.granel;
  if (updates.priority !== undefined) fullPayload.priority = updates.priority;
  if (updates.status !== undefined) fullPayload.status = updates.status;
  if (updates.lineId !== undefined) fullPayload.line_id = updates.lineId;
  if (updates.leaderId !== undefined) fullPayload.leader_id = updates.leaderId;
  if (updates.packageAvailability !== undefined) fullPayload.package_availability = updates.packageAvailability;
  if (updates.sequence !== undefined) fullPayload.sequence = updates.sequence;
  if (updates.scheduledDate !== undefined) fullPayload.scheduled_date = updates.scheduledDate;
  if (updates.scheduledEndDate !== undefined) fullPayload.scheduled_end_date = updates.scheduledEndDate;
  if (updates.scheduledDays !== undefined) fullPayload.scheduled_days = updates.scheduledDays;
  if (updates.scheduledShift !== undefined) fullPayload.scheduled_shift = updates.scheduledShift;
  if (updates.setor !== undefined) fullPayload.setor = updates.setor;
  if (updates.unidade !== undefined) fullPayload.unidade = updates.unidade;
  if (updates.rejectedQuantity !== undefined) fullPayload.rejected_quantity = updates.rejectedQuantity;
  if (updates.plannedHours !== undefined) fullPayload.planned_hours = updates.plannedHours;
  if (updates.tipoDocumento !== undefined) fullPayload.tipo_documento = updates.tipoDocumento;
  if (updates.industria !== undefined) fullPayload.industria = updates.industria;
  if (updates.completedAt !== undefined) fullPayload.completed_at = updates.completedAt;
  if (updates.finishedShift !== undefined) fullPayload.finished_shift = updates.finishedShift;

  // Payload restrito às colunas confirmadas em `ops` — sem
  // scheduled_end_date, scheduled_days e completed_at.
  // `production_orders` foi confirmado em produção como espelhando exatamente
  // as mesmas colunas de `ops` (o erro "Could not find the 'scheduled_days'
  // column of 'production_orders'" provou isso) — por isso as DUAS tabelas
  // recebem o mesmo payload restrito, e não mais o fullPayload.
  const opsPayload: any = { ...fullPayload };
  delete opsPayload.scheduled_end_date;
  delete opsPayload.scheduled_days;
  delete opsPayload.completed_at;

  try {
    const resProductionOrders = await supabase.from('production_orders').update(opsPayload).eq('id', opId);
    if (resProductionOrders.error) {
      console.error(`[updateOP] Falha ao atualizar production_orders (OP ${opId}):`, resProductionOrders.error.message);
    }
  } catch (err) {
    console.error(`[updateOP] Erro inesperado ao atualizar production_orders (OP ${opId}):`, err);
  }

  try {
    const resOps = await supabase.from('ops').update(opsPayload).eq('id', opId);
    if (resOps.error) {
      console.error(`[updateOP] Falha ao atualizar ops (OP ${opId}):`, resOps.error.message);
    }
  } catch (err) {
    console.error(`[updateOP] Erro inesperado ao atualizar ops (OP ${opId}):`, err);
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

/**
 * Busca as metas diárias fixas por linha (independe de mês/ano — fica fixa
 * até ser atualizada manualmente).
 */
export const getLineDailyGoals = async (): Promise<LineDailyGoal[]> => {
  try {
    const { data, error } = await supabase.from('line_daily_goals').select('*');
    if (data && !error) {
      return data.map((d: any) => ({
        lineId: String(d.line_id),
        goalQuantity: Number(d.goal_quantity || 0),
        updatedAt: d.updated_at || new Date().toISOString(),
      }));
    }
  } catch (err) {
    console.warn('Erro ao buscar metas diárias por linha no Supabase:', err);
  }
  return [];
};

/**
 * Salva (upsert) a meta diária fixa de uma linha. Fica fixa até que essa
 * função seja chamada novamente para a mesma linha.
 */
export const saveLineDailyGoal = async (lineId: string, goalQuantity: number): Promise<boolean> => {
  try {
    const payload = {
      line_id: lineId,
      goal_quantity: goalQuantity,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('line_daily_goals')
      .upsert(payload, { onConflict: 'line_id' });

    if (error) {
      console.warn('Erro ao persistir meta diária da linha no Supabase:', error);
      return false;
    }

    notifyStateChange();
    return true;
  } catch (err) {
    console.error('Erro ao salvar meta diária da linha:', err);
    return false;
  }
};

/**
 * Busca a meta mensal ÚNICA da fábrica (não por linha) para um mês/ano.
 * Retorna null se ainda não houver meta cadastrada (o app deve decidir o
 * valor padrão de exibição nesse caso).
 */
export const getFactoryMonthlyGoal = async (year: number, month: number): Promise<number | null> => {
  try {
    const { data, error } = await supabase
      .from('factory_monthly_goal')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (data && !error) {
      return Number(data.goal_quantity || 0);
    }
  } catch (err) {
    console.warn('Erro ao buscar meta mensal da fábrica no Supabase:', err);
  }
  return null;
};

/**
 * Busca as metas mensais ÚNICAS da fábrica para TODOS os meses de um ano
 * (uma linha por mês em que alguém já salvou uma meta — meses sem meta
 * cadastrada simplesmente não aparecem no array). Usado pelo gráfico
 * "Produção Mensal" do Dashboard para mostrar a meta certa de cada mês, em
 * vez de repetir a meta do mês atual pro ano inteiro.
 */
export const getFactoryMonthlyGoals = async (year: number): Promise<FactoryMonthlyGoal[]> => {
  try {
    const { data, error } = await supabase
      .from('factory_monthly_goal')
      .select('*')
      .eq('year', year)
      .order('month', { ascending: true });

    if (data && !error) {
      return data.map((d: any) => ({
        year: Number(d.year),
        month: Number(d.month),
        goalQuantity: Number(d.goal_quantity || 0),
        updatedAt: d.updated_at || new Date().toISOString(),
      }));
    }
  } catch (err) {
    console.warn('Erro ao buscar metas mensais da fábrica no Supabase:', err);
  }
  return [];
};

/**
 * Salva (upsert) a meta mensal única da fábrica para um mês/ano. Fica fixa
 * até ser atualizada novamente.
 */
export const saveFactoryMonthlyGoal = async (
  year: number,
  month: number,
  goalQuantity: number
): Promise<boolean> => {
  try {
    const payload = {
      year,
      month,
      goal_quantity: goalQuantity,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('factory_monthly_goal')
      .upsert(payload, { onConflict: 'year, month' });

    if (error) {
      console.warn('Erro ao persistir meta mensal da fábrica no Supabase:', error);
      return false;
    }

    notifyStateChange();
    return true;
  } catch (err) {
    console.error('Erro ao salvar meta mensal da fábrica:', err);
    return false;
  }
};

export const deleteOP = async (opId: string) => {
  // 1. Marca no blacklist persistente para nunca mais ressurgir em cache ou retorno de API
  deletedOpIds.add(opId);
  saveDeletedOpIds();

  // 2. Remove da memória
  inMemoryOps = inMemoryOps.filter(op => op.id !== opId);
  persistOps();

  // 3. Exclui das tabelas do Supabase
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

    // IMPORTANTE:
    // 1. `rotations` é a tabela física principal no Supabase.
    // 2. `weekly_rotations` é uma VIEW (SELECT * FROM rotations) criada para compatibilidade.
    //    No PostgreSQL, VIEWs NUNCA suportam `onConflict`, gerando o erro:
    //    "there is no unique or exclusion constraint matching the ON CONFLICT specification".
    // 3. Se a tabela física `rotations` não possuir constraint UNIQUE em `leader_id`,
    //    o upsert com onConflict também falha com esse mesmo erro.
    //
    // Solução robusta:
    // A. Tenta upsert na tabela física `rotations`. Se falhar por falta de constraint UNIQUE,
    //    faz fallback seguro (SELECT -> UPDATE ou INSERT), sem quebrar a aplicação.
    // B. Como `weekly_rotations` é uma VIEW sobre `rotations`, salvar em `rotations` já atualiza
    //    `weekly_rotations` automaticamente. Só tentamos `weekly_rotations` se `rotations` falhar.
    const saveToTable = async (tableName: 'rotations' | 'weekly_rotations'): Promise<boolean> => {
      // Tenta upsert direto se for a tabela física 'rotations'
      if (tableName === 'rotations') {
        try {
          const res = await supabase.from(tableName).upsert(payload, { onConflict: 'leader_id' });
          if (!res.error) return true;

          const isMissingConstraint =
            res.error.message?.includes('no unique or exclusion constraint') ||
            (res.error as any).code === '42P10';

          if (!isMissingConstraint) {
            console.error(`[saveLeaderRotation] Falha ao gravar em ${tableName} (líder ${canonicalId}):`, res.error.message);
            return false;
          }
        } catch (err) {
          console.error(`[saveLeaderRotation] Erro ao tentar upsert em ${tableName}:`, err);
        }
      }

      // Fallback seguro: SELECT -> UPDATE se existir, ou INSERT se não existir
      // (Não depende de constraint UNIQUE no PostgreSQL, funciona em VIEWs e tabelas normais)
      try {
        const { data: existing, error: selErr } = await supabase
          .from(tableName)
          .select('id, leader_id')
          .eq('leader_id', canonicalId)
          .limit(1);

        if (!selErr && existing && existing.length > 0) {
          const updateRes = await supabase
            .from(tableName)
            .update({ line_id: lineId, updated_at: payload.updated_at })
            .eq('leader_id', canonicalId);
          if (!updateRes.error) return true;
          console.error(`[saveLeaderRotation] Falha no update em ${tableName} (líder ${canonicalId}):`, updateRes.error.message);
        } else {
          const insertRes = await supabase
            .from(tableName)
            .insert(payload);
          if (!insertRes.error) return true;
          console.error(`[saveLeaderRotation] Falha no insert em ${tableName} (líder ${canonicalId}):`, insertRes.error.message);
        }
      } catch (innerErr) {
        console.error(`[saveLeaderRotation] Erro inesperado no fallback de ${tableName}:`, innerErr);
      }
      return false;
    };

    // Grava primeiro na tabela física 'rotations'
    const savedInRotations = await saveToTable('rotations');

    // Se não salvou em 'rotations' (ex.: tabela não existe no banco legado), tenta em 'weekly_rotations'
    if (!savedInRotations) {
      await saveToTable('weekly_rotations');
    }

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
    // pause_reasons não está no schema.sql (tabela criada manualmente no
    // Supabase). Colunas reais confirmadas: id (uuid), reason (text),
    // description (text), created_at — não existe "name" nem "category".
    // Ordenamos em JS (em vez de .order('reason', ...) no Supabase) para não
    // depender de mais nenhuma suposição sobre o schema real dessa tabela.
    const { data, error } = await supabase.from('pause_reasons').select('*');
    if (data && data.length > 0 && !error) {
      return data
        .map((d: any) => ({
          id: String(d.id),
          name: d.reason || d.description || 'Pausa Operacional',
          category: d.category || 'Geral',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
  } catch (err) {
    console.warn('Busca de motivos de pausa no Supabase:', err);
  }
  return DEFAULT_PAUSE_REASONS;
};

// Helper para verificar se uma string é um UUID válido do PostgreSQL
export const isUUID = (str?: string | null): boolean =>
  Boolean(str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str).trim()));

/**
 * Atualiza o status da linha de produção de forma resiliente tanto na tabela `lines`
 * (que aceita ids em texto como 'line-1') quanto em `production_lines` (com id do tipo UUID).
 */
export const updateLineStatusRemote = async (
  lineId: string,
  status: 'active' | 'idle' | 'paused',
  currentOpId: string | null = null
) => {
  try {
    // 1. Tabela `lines` aceita id em texto simples ("line-1", "line-2", "line-sleeve")
    await supabase.from('lines').update({ status, current_op_id: currentOpId }).eq('id', lineId);
  } catch (err) {
    console.warn(`[updateLineStatusRemote] Falha em lines (${lineId}):`, err);
  }

  try {
    // 2. Tabela `production_lines` possui coluna id tipada como UUID.
    if (isUUID(lineId)) {
      await supabase.from('production_lines').update({ status, current_op_id: currentOpId }).eq('id', lineId);
    }
  } catch (err) {
    console.warn(`[updateLineStatusRemote] Falha em production_lines (${lineId}):`, err);
  }
};

/**
 * Grava eventos de produção de forma 100% segura e compatível com as duas tabelas:
 * - `events`: schema real usa colunas `quantity_reported`, `pause_reason_name`, `comments` e line_id em texto.
 * - `production_events`: schema real usa `quantity`, `reason`, `observation`, e line_id tipado como UUID.
 */
export const recordEventRemote = async (eventData: {
  opId: string;
  lineId: string;
  leaderId?: string | null;
  type: string;
  quantity?: number;
  reason?: string;
  observation?: string;
  createdAt: string;
}) => {
  const { opId, lineId, leaderId, type, quantity, reason, observation, createdAt } = eventData;

  // 1. Tabela `events`
  try {
    const eventsPayload: any = {
      op_id: opId,
      line_id: lineId, // em events, line_id aceita text ("line-1", "line-2", etc.)
      type,
      created_at: createdAt,
    };
    if (leaderId && isUUID(leaderId)) {
      eventsPayload.leader_id = leaderId;
    }
    if (quantity !== undefined && quantity !== null && !isNaN(quantity)) {
      eventsPayload.quantity_reported = quantity; // Coluna correta em events é quantity_reported, NÃO quantity
    }
    if (reason) {
      eventsPayload.pause_reason_name = reason;
    }
    if (observation) {
      eventsPayload.comments = observation;
    }

    const resEvents = await supabase.from('events').insert(eventsPayload);
    if (resEvents.error) {
      console.warn(`[recordEventRemote] Aviso ao gravar em events (OP ${opId}):`, resEvents.error.message);
    }
  } catch (err) {
    console.warn(`[recordEventRemote] Erro ao gravar em events (OP ${opId}):`, err);
  }

  // 2. Tabela `production_events`
  try {
    const prodEventsPayload: any = {
      op_id: opId,
      type,
      created_at: createdAt,
    };
    // CRÍTICO: line_id em `production_events` é do tipo UUID. Não passar "line-1" para evitar erro 22P02 "invalid input syntax for type uuid".
    if (lineId && isUUID(lineId)) {
      prodEventsPayload.line_id = lineId;
    }
    if (leaderId && isUUID(leaderId)) {
      prodEventsPayload.leader_id = leaderId;
    }
    if (quantity !== undefined && quantity !== null && !isNaN(quantity)) {
      prodEventsPayload.quantity = quantity;
    }
    if (reason) {
      prodEventsPayload.reason = reason;
    }
    if (observation) {
      prodEventsPayload.observation = observation;
    }

    const resProdEvents = await supabase.from('production_events').insert(prodEventsPayload);
    if (resProdEvents.error) {
      console.warn(`[recordEventRemote] Aviso ao gravar em production_events (OP ${opId}):`, resProdEvents.error.message);
    }
  } catch (err) {
    console.warn(`[recordEventRemote] Erro ao gravar em production_events (OP ${opId}):`, err);
  }
};

// Busca TODOS os eventos (paginado, sem limite) — antes este fetch tinha um
// `.limit(50)` fixo, aplicado sobre a fábrica INTEIRA (todas as linhas juntas,
// não por linha/dia). Na prática isso significava que, fora do "agora
// imediato", o Dashboard só enxergava os ~50 eventos mais recentes de toda a
// fábrica — nenhum evento STARTED/FINISHED de dias ou meses anteriores nunca
// chegava ao cálculo de Ociosidade/Disponibilidade (nem ao OEE), fazendo esses
// indicadores aparecerem zerados/em branco para qualquer período que não
// fosse o instante atual. A paginação abaixo usa o mesmo padrão já validado
// em `fetchAllRows` (loop de 1000 em 1000), ordenando por `created_at` e,
// como desempate, por `id` (evita perder/duplicar linhas quando há vários
// eventos importados com o mesmo timestamp).
async function fetchAllEventRows(table: 'production_events' | 'events'): Promise<{ data: any[] | null; error: any }> {
  const PAGE_SIZE = 1000;
  const allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      return { data: allRows.length > 0 ? allRows : null, error };
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break; // última página
    offset += PAGE_SIZE;
  }
  return { data: allRows, error: null };
}

export const getRecentEvents = async (): Promise<ProductionEvent[]> => {
  try {
    // IMPORTANTE: `recordEventRemote` grava todo evento AO VIVO em duas
    // tabelas (`events` e `production_events` — dual-write, igual ops/
    // production_orders), mas a importação histórica só gravou em `events`.
    // Buscar só uma tabela e "cair" pra outra apenas se a primeira vier
    // TOTALMENTE vazia (como era antes) nunca funcionava de verdade: como
    // `production_events` sempre tem registros do uso ao vivo, ela nunca
    // fica vazia, então os eventos STARTED/FINISHED da importação histórica
    // (só em `events`) nunca chegavam a ser lidos — e sem eles, toda OP
    // concluída caía no fallback "OP inteira = 100% trabalhada, 0% ocioso"
    // do calculateProductionTime. Por isso agora buscamos as DUAS tabelas e
    // unimos os resultados (por id), em vez de tratar uma como fallback da
    // outra.
    const [prodEventsRes, eventsRes] = await Promise.all([
      fetchAllEventRows('production_events'),
      fetchAllEventRows('events'),
    ]);

    const byId = new Map<string, any>();
    for (const row of prodEventsRes.data || []) {
      if (row && row.id != null) byId.set(String(row.id), row);
    }
    for (const row of eventsRes.data || []) {
      if (row && row.id != null && !byId.has(String(row.id))) byId.set(String(row.id), row);
    }

    const data = byId.size > 0 ? Array.from(byId.values()) : null;
    const error = (prodEventsRes.error && eventsRes.error) ? (prodEventsRes.error || eventsRes.error) : null;

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
          quantity: e.quantity !== undefined && e.quantity !== null
            ? Number(e.quantity)
            : (e.quantity_reported !== undefined && e.quantity_reported !== null ? Number(e.quantity_reported) : undefined),
          reason: e.reason || e.pause_reason_name,
          observation: e.observation || e.comments,
          createdAt: e.created_at || new Date().toISOString(),
        }))
        .filter(e => !isMockEvent(e))
        // fetchAllEventRows pagina em ordem crescente (exigido pelo .range());
        // devolve mais recente primeiro, como este fetch sempre devolveu.
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    ]);
    await updateLineStatusRemote(lineId, 'active', opId);
    await recordEventRemote({
      opId,
      lineId,
      leaderId,
      type: 'STARTED',
      createdAt: newEvent.createdAt,
    });
  } catch (error) {
    console.error('Erro ao iniciar OP:', error);
  }
};

export const pauseOP = async (
  opId: string,
  lineId: string,
  leaderId: string,
  reason: string,
  observation: string,
  producedQuantity?: number
) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);
  const updatedProducedQty = producedQuantity !== undefined && !isNaN(producedQuantity) ? producedQuantity : currentOp?.producedQuantity;

  inMemoryOps = inMemoryOps.map(op =>
    op.id === opId
      ? {
          ...op,
          status: 'paused',
          producedQuantity: updatedProducedQty !== undefined ? updatedProducedQty : op.producedQuantity,
        }
      : op
  );
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
    quantity: updatedProducedQty,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  const updateOpPayload: any = { status: 'paused' };
  if (updatedProducedQty !== undefined) {
    updateOpPayload.produced_quantity = updatedProducedQty;
  }

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update(updateOpPayload).eq('id', opId),
      supabase.from('ops').update(updateOpPayload).eq('id', opId),
    ]);
    await updateLineStatusRemote(lineId, 'paused', null);
    await recordEventRemote({
      opId,
      lineId,
      leaderId,
      type: 'PAUSED',
      reason,
      observation,
      quantity: updatedProducedQty,
      createdAt: newEvent.createdAt,
    });
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
    ]);
    await updateLineStatusRemote(lineId, 'active', opId);
    await recordEventRemote({
      opId,
      lineId,
      leaderId,
      type: 'RESUMED',
      createdAt: newEvent.createdAt,
    });
  } catch (error) {
    console.error('Erro ao retomar OP:', error);
  }
};

export const finishOP = async (
  opId: string,
  lineId: string,
  leaderId: string,
  finishedShift?: 'Manhã' | 'Tarde',
  producedQuantity?: number,
  sendToSleeve?: boolean,
  rejectedQuantity?: number
) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);
  const completedAtIso = new Date().toISOString();
  const finalProducedQty = producedQuantity !== undefined ? producedQuantity : (currentOp?.producedQuantity || 0);
  // Quantidade rejeitada informada AGORA (na conclusão desta etapa). Sem
  // integração com o laboratório ainda, é o próprio líder que registra isso
  // ao concluir a OP — usado no cálculo de Qualidade do OEE.
  const finalRejectedQty = rejectedQuantity !== undefined ? rejectedQuantity : (currentOp?.rejectedQuantity || 0);

  if (sendToSleeve) {
    markOpAsSleeve(opId, true);
    inMemoryOps = inMemoryOps.map(op =>
      op.id === opId
        ? {
            ...op,
            status: 'pending',
            lineId: null, // volta para o estoque sem linha
            leaderId: null,
            plannedQuantity: finalProducedQty, // assume a quantidade apontada no envase como nova meta para o sleev
            producedQuantity: 0, // reinicia a contagem de produção para a fase do sleev
            rejectedQuantity: 0, // reinicia a contagem de rejeitos — a etapa do Sleev começa sua própria contagem
            finishedShift: undefined,
            completedAt: undefined,
            isSleeve: true,
          }
        : op
    );
  } else {
    markOpAsSleeve(opId, false);
    inMemoryOps = inMemoryOps.map(op =>
      op.id === opId
        ? {
            ...op,
            status: 'completed',
            finishedShift: finishedShift || undefined,
            completedAt: completedAtIso,
            producedQuantity: finalProducedQty,
            rejectedQuantity: finalRejectedQty,
            leaderId: leaderId || op.leaderId,
            isSleeve: false,
          }
        : op
    );
  }
  inMemoryLines = inMemoryLines.map(l => l.id === lineId ? { ...l, status: 'idle', currentOpId: null } : l);

  persistOps();
  persistLines();

  const observation = sendToSleeve
    ? `Envase finalizado (${finalProducedQty.toLocaleString('pt-BR')} un${finalRejectedQty > 0 ? `, ${finalRejectedQty.toLocaleString('pt-BR')} rejeitada(s)` : ''}). Retornou ao estoque para acabamento no Sleev.`
    : undefined;

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'FINISHED',
    observation,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  const opPayload: any = sendToSleeve
    ? {
        status: 'pending',
        line_id: null,
        leader_id: null,
        planned_quantity: finalProducedQty,
        produced_quantity: 0,
        rejected_quantity: 0,
        finished_shift: null,
      }
    : {
        status: 'completed',
        finished_shift: finishedShift || null,
        produced_quantity: finalProducedQty,
        rejected_quantity: finalRejectedQty,
        leader_id: leaderId || null,
        completed_at: completedAtIso,
      };

  // `production_orders` não tem a coluna `completed_at` (confirmado em produção
  // — mesma causa do erro "Could not find the 'scheduled_days' column of
  // 'production_orders'"). Envia o payload restrito para ela e o completo (com
  // completed_at) só para `ops`.
  const opPayloadForProductionOrders: any = { ...opPayload };
  delete opPayloadForProductionOrders.completed_at;

  try {
    // Tenta production_orders primeiro — se falhar, tenta ops
    const { error: err1 } = await supabase
      .from('production_orders')
      .update(opPayloadForProductionOrders)
      .eq('id', opId);

    if (err1) {
      console.warn('[finishOP] production_orders falhou, tentando ops:', err1.message);
    }

    // Sempre tenta ops também (as duas tabelas precisam estar sincronizadas)
    const { error: err2 } = await supabase
      .from('ops')
      .update(opPayload)
      .eq('id', opId);

    if (err2) {
      console.warn('[finishOP] ops falhou:', err2.message);
    }

    if (err1 && err2) {
      console.error('[finishOP] Falha ao gravar nas duas tabelas. Status salvo apenas localmente.');
    }

    // Atualizar linha e gravar evento
    await updateLineStatusRemote(lineId, 'idle', null);
    await recordEventRemote({
      opId,
      lineId,
      leaderId,
      type: 'FINISHED',
      quantity: finalProducedQty,
      observation,
      createdAt: newEvent.createdAt,
    });
  } catch (error) {
    console.error('[finishOP] Erro inesperado ao finalizar OP:', error);
  }
};

export const reportQuantity = async (
  opId: string,
  lineId: string,
  leaderId: string,
  quantity: number,
  rejectedQty?: number
) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);
  const newQty = (currentOp?.producedQuantity || 0) + quantity;
  // Rejeito informado pelo líder junto com este apontamento (soma ao total já
  // registrado na OP) — enquanto o laboratório não entra no fluxo, é quem
  // está no chão de fábrica que reporta a perda, usado na Qualidade do OEE.
  const newRejectedQty = (currentOp?.rejectedQuantity || 0) + (rejectedQty || 0);

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, producedQuantity: newQty, rejectedQuantity: newRejectedQty } : op);
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
    observation: rejectedQty ? `${rejectedQty.toLocaleString('pt-BR')} rejeitada(s) neste apontamento` : undefined,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  // Grava sequencialmente com log de aviso por tabela
  try {
    const resProductionOrders = await supabase.from('production_orders').update({ produced_quantity: newQty, rejected_quantity: newRejectedQty }).eq('id', opId);
    if (resProductionOrders.error) {
      console.warn(`[reportQuantity] Falha ao gravar produced_quantity em production_orders (OP ${opId}):`, resProductionOrders.error.message);
    }
  } catch (err) {
    console.warn(`[reportQuantity] Erro inesperado ao gravar em production_orders (OP ${opId}):`, err);
  }

  try {
    const resOps = await supabase.from('ops').update({ produced_quantity: newQty, rejected_quantity: newRejectedQty }).eq('id', opId);
    if (resOps.error) {
      console.warn(`[reportQuantity] Falha ao gravar produced_quantity em ops (OP ${opId}):`, resOps.error.message);
    }
  } catch (err) {
    console.warn(`[reportQuantity] Erro inesperado ao gravar em ops (OP ${opId}):`, err);
  }

  // Grava em events e production_events com schemas validados
  await recordEventRemote({
    opId,
    lineId,
    leaderId,
    type: 'QUANTITY_REPORTED',
    quantity,
    observation: newEvent.observation,
    createdAt: newEvent.createdAt,
  });
};

export const updateProducedQuantityDirect = async (
  opId: string,
  lineId: string,
  leaderId: string,
  totalProducedQty: number
) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);
  const oldQty = currentOp?.producedQuantity || 0;
  const delta = totalProducedQty - oldQty;

  inMemoryOps = inMemoryOps.map(op =>
    op.id === opId ? { ...op, producedQuantity: totalProducedQty } : op
  );
  persistOps();

  const newEvent: ProductionEvent = {
    id: `ev-${Date.now()}`,
    opId,
    opNumber: currentOp?.number || opId,
    lineId,
    lineName: currentLine?.name || lineId,
    leaderId,
    type: 'QUANTITY_REPORTED',
    quantity: delta > 0 ? delta : totalProducedQty,
    createdAt: new Date().toISOString(),
  };
  inMemoryEvents = [newEvent, ...inMemoryEvents];
  persistEvents();

  try {
    const resProductionOrders = await supabase
      .from('production_orders')
      .update({ produced_quantity: totalProducedQty })
      .eq('id', opId);
    if (resProductionOrders.error) {
      console.warn(
        `[updateProducedQuantityDirect] Falha ao gravar em production_orders (OP ${opId}):`,
        resProductionOrders.error.message
      );
    }
  } catch (err) {
    console.warn(`[updateProducedQuantityDirect] Erro em production_orders (OP ${opId}):`, err);
  }

  try {
    const resOps = await supabase
      .from('ops')
      .update({ produced_quantity: totalProducedQty })
      .eq('id', opId);
    if (resOps.error) {
      console.warn(
        `[updateProducedQuantityDirect] Falha ao gravar em ops (OP ${opId}):`,
        resOps.error.message
      );
    }
  } catch (err) {
    console.warn(`[updateProducedQuantityDirect] Erro em ops (OP ${opId}):`, err);
  }

  await recordEventRemote({
    opId,
    lineId,
    leaderId,
    type: 'QUANTITY_REPORTED',
    quantity: delta > 0 ? delta : totalProducedQty,
    createdAt: newEvent.createdAt,
  });
};

// ---------------- DATABASE RESET & CLEANUP ----------------
export const clearAllOPs = async (): Promise<void> => {
  // Registra todas as OPs atuais como excluídas (por id — o DELETE real no
  // Supabase abaixo é quem efetivamente limpa os dados)
  inMemoryOps.forEach(op => deletedOpIds.add(op.id));
  saveDeletedOpIds();

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
  // Registra todas as OPs atuais como excluídas (por id — o DELETE real no
  // Supabase abaixo é quem efetivamente limpa os dados)
  inMemoryOps.forEach(op => deletedOpIds.add(op.id));
  saveDeletedOpIds();

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

