import { supabase } from '../lib/supabase';
import { ProductionLine, ProductionOrder, UserProfile, ProductionEvent, PauseReason } from '../types';

// Storage keys for persistent local storage fallback
const STORAGE_KEYS = {
  ops: 'SIG_PROD_OPS_STORAGE_V5',
  deletedOpIds: 'SIG_PROD_DELETED_OPS_V5',
  lines: 'SIG_PROD_LINES_STORAGE_V5',
  events: 'SIG_PROD_EVENTS_STORAGE_V5',
  rotations: 'SIG_PROD_ROTATIONS_STORAGE_V5',
  pauseReasons: 'SIG_PROD_PAUSE_REASONS_STORAGE_V5',
  profiles: 'SIG_PROD_PROFILES_STORAGE_V5',
};

// Safe storage utilities
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const item = window.localStorage.getItem(key);
    if (item) {
      return JSON.parse(item) as T;
    }
  } catch (err) {
    console.warn(`Erro ao carregar chave ${key} do localStorage:`, err);
  }
  return fallback;
}

function saveToStorage<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn(`Erro ao gravar chave ${key} no localStorage:`, err);
  }
}

function getDeletedOpIds(): Set<string> {
  const list = loadFromStorage<string[]>(STORAGE_KEYS.deletedOpIds, []);
  return new Set(list);
}

function addDeletedOpId(id: string): void {
  const ids = getDeletedOpIds();
  ids.add(id);
  saveToStorage(STORAGE_KEYS.deletedOpIds, Array.from(ids));
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

// Initialize in-memory runtime store from localStorage (or defaults)
let inMemoryLines: ProductionLine[] = loadFromStorage<ProductionLine[]>(STORAGE_KEYS.lines, DEFAULT_LINES);
let inMemoryOps: ProductionOrder[] = loadFromStorage<ProductionOrder[]>(STORAGE_KEYS.ops, DEFAULT_OPS).filter(op => !isMockOp(op));
let inMemoryEvents: ProductionEvent[] = loadFromStorage<ProductionEvent[]>(STORAGE_KEYS.events, DEFAULT_EVENTS).filter(e => !isMockEvent(e));
let inMemoryRotations: Record<string, string> = loadFromStorage<Record<string, string>>(STORAGE_KEYS.rotations, {});
let inMemoryProfiles: UserProfile[] = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, []);

// Helper to save current in-memory state
function persistOps() {
  saveToStorage(STORAGE_KEYS.ops, inMemoryOps);
}

function persistLines() {
  saveToStorage(STORAGE_KEYS.lines, inMemoryLines);
}

function persistEvents() {
  saveToStorage(STORAGE_KEYS.events, inMemoryEvents);
}

function persistRotations() {
  saveToStorage(STORAGE_KEYS.rotations, inMemoryRotations);
}

export function persistProfiles() {
  saveToStorage(STORAGE_KEYS.profiles, inMemoryProfiles);
}

// ---------------- PROFILES & LEADERS ----------------
export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  // First check in-memory cache
  inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
  const foundLocal = inMemoryProfiles.find(p => p.uid === uid || p.email === uid);

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();

    if (data && !error) {
      const isCoord = data.role === 'coordinator' || data.role === 'coordenador' || (data.cargo && data.cargo.toLowerCase().includes('coordenador'));
      const profile: UserProfile = {
        uid: data.id,
        email: data.email,
        name: data.name || data.email?.split('@')[0] || 'Usuário',
        role: isCoord ? 'coordinator' : 'leader',
        cargo: data.cargo || (isCoord ? 'Coordenador Geral' : 'Líder de Produção'),
        status: data.status || 'active',
        createdAt: data.created_at || new Date().toISOString(),
      };
      
      // Update local storage
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
  // Load from local storage
  inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data && data.length > 0 && !error) {
      const remoteUsers: UserProfile[] = data.map((d: any) => {
        const isCoord = d.role === 'coordinator' || d.role === 'coordenador' || (d.cargo && d.cargo.toLowerCase().includes('coordenador'));
        return {
          uid: String(d.id || d.uid || `usr-${d.email}`),
          email: d.email || '',
          name: d.name || d.email?.split('@')[0] || 'Colaborador',
          role: isCoord ? 'coordinator' : 'leader',
          cargo: d.cargo || (isCoord ? 'Coordenador Geral' : 'Líder de Produção'),
          status: (d.status as 'active' | 'inactive' | 'pending') || 'active',
          createdAt: d.created_at || new Date().toISOString(),
        };
      });

      // Merge remoteUsers with inMemoryProfiles (remote users take precedence, local-only preserved)
      const userMap = new Map<string, UserProfile>();
      
      // Seed with local profiles
      inMemoryProfiles.forEach(u => {
        const key = u.email ? u.email.toLowerCase().trim() : u.uid;
        if (key) userMap.set(key, u);
      });

      // Override / augment with remote profiles
      remoteUsers.forEach(u => {
        const key = u.email ? u.email.toLowerCase().trim() : u.uid;
        if (key) userMap.set(key, u);
      });

      inMemoryProfiles = Array.from(userMap.values());
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
    inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
    return inMemoryProfiles.filter(u => u.role !== 'coordinator');
  }
};

export const updateUserRole = async (userId: string, newRole: 'coordinator' | 'leader', newCargo?: string): Promise<boolean> => {
  try {
    // 1. Update in-memory / local storage immediately
    inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
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

export const updateUserStatus = async (userId: string, newStatus: 'active' | 'inactive' | 'pending'): Promise<boolean> => {
  try {
    // 1. Update in-memory / local storage immediately
    inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
    const target = inMemoryProfiles.find(u => u.uid === userId || (u.email && u.email.toLowerCase() === userId.toLowerCase()));
    if (target) {
      target.status = newStatus;
      persistProfiles();
    }

    // 2. Update Supabase
    let { error } = await supabase
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', userId);

    if (error) {
      const res = await supabase
        .from('profiles')
        .update({ status: newStatus })
        .eq('email', userId);
      error = res.error;
    }

    return true;
  } catch (err) {
    console.error('Erro ao alterar status de usuário:', err);
    return true;
  }
};

export const preAuthorizeUser = async (data: {
  email: string;
  name: string;
  role: 'coordinator' | 'leader';
  cargo?: string;
  lineId?: string;
}): Promise<boolean> => {
  try {
    const email = data.email.trim().toLowerCase();
    const name = data.name.trim();
    const role = data.role;
    const cargo = data.cargo || (role === 'coordinator' ? 'Coordenador Geral' : 'Líder de Produção');
    const generatedId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 1. Save to inMemoryProfiles and localStorage immediately
    inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
    const existingLocalIdx = inMemoryProfiles.findIndex(u => u.email?.toLowerCase() === email || u.uid === generatedId);
    
    const userObj: UserProfile = {
      uid: existingLocalIdx !== -1 ? inMemoryProfiles[existingLocalIdx].uid : generatedId,
      email,
      name,
      role,
      cargo,
      status: 'active',
      createdAt: existingLocalIdx !== -1 ? inMemoryProfiles[existingLocalIdx].createdAt : new Date().toISOString(),
    };

    if (existingLocalIdx !== -1) {
      inMemoryProfiles[existingLocalIdx] = userObj;
    } else {
      inMemoryProfiles.unshift(userObj);
    }
    persistProfiles();

    // 2. If lineId provided, allocate rotation immediately
    if (data.lineId) {
      try {
        await saveLeaderRotation(userObj.uid, data.lineId);
      } catch (rotErr) {
        console.warn('Erro ao alocar rotação inicial do líder:', rotErr);
      }
    }

    // 3. Sync with Supabase profiles table
    try {
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();

      if (existingUser?.id) {
        userObj.uid = existingUser.id;
        persistProfiles();

        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ role, name, cargo, status: 'active' })
          .eq('id', existingUser.id);

        if (updateErr) {
          await supabase.from('profiles').update({ role, name, cargo }).eq('email', email);
        }
        return true;
      }

      const payload: any = {
        id: generatedId,
        email,
        name,
        role,
        cargo,
        status: 'active',
        created_at: new Date().toISOString(),
      };

      const { error: insertErr } = await supabase.from('profiles').insert(payload);

      if (insertErr) {
        const { error: upsertErr } = await supabase
          .from('profiles')
          .upsert(payload, { onConflict: 'email' });

        if (upsertErr) {
          await supabase
            .from('profiles')
            .upsert({ email, name, role, cargo, status: 'active' }, { onConflict: 'email' });
        }
      }
    } catch (dbErr) {
      console.warn('Sincronização do perfil no Supabase (mantido em local storage):', dbErr);
    }

    return true;
  } catch (err) {
    console.error('Erro ao pré-autorizar usuário:', err);
    return false;
  }
};

export const deleteUserProfile = async (userId: string): Promise<boolean> => {
  try {
    // 1. Remove from local storage
    inMemoryProfiles = loadFromStorage<UserProfile[]>(STORAGE_KEYS.profiles, inMemoryProfiles);
    inMemoryProfiles = inMemoryProfiles.filter(u => u.uid !== userId && u.email?.toLowerCase() !== userId.toLowerCase());
    persistProfiles();

    // Remove from rotations
    inMemoryRotations = loadFromStorage<Record<string, string>>(STORAGE_KEYS.rotations, inMemoryRotations);
    delete inMemoryRotations[userId];
    persistRotations();

    // 2. Remove from Supabase
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      await supabase.from('profiles').delete().eq('email', userId);
    }
    return true;
  } catch (err) {
    console.error('Erro ao remover perfil:', err);
    return true;
  }
};

// ---------------- PRODUCTION LINES ----------------
export const getLines = async (): Promise<ProductionLine[]> => {
  // Always load from storage first to prevent flashes or resets
  inMemoryLines = loadFromStorage<ProductionLine[]>(STORAGE_KEYS.lines, DEFAULT_LINES);

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

      // Merge with inMemoryLines (preserve local names / states if any)
      const existingMap = new Map(inMemoryLines.map(l => [l.id, l]));
      mapped.forEach(line => {
        if (!existingMap.has(line.id)) {
          existingMap.set(line.id, line);
        }
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
export const getAllOPs = async (): Promise<ProductionOrder[]> => {
  // 1. Immediately read from localStorage
  const localOps = loadFromStorage<ProductionOrder[]>(STORAGE_KEYS.ops, inMemoryOps);
  inMemoryOps = localOps.filter(o => !isMockOp(o));
  const deletedIds = getDeletedOpIds();

  // Filter out any explicitly deleted IDs
  inMemoryOps = inMemoryOps.filter(o => !deletedIds.has(o.id));

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
          createdAt: d.created_at || d.createdAt || new Date().toISOString(),
        }))
        .filter((op) => !deletedIds.has(op.id) && !isMockOp(op)); // NEVER bring back deleted or mock items!

      // Intelligent merge: keep local edits as authoritative, but add new remote OPs
      const localMap = new Map<string, ProductionOrder>();
      inMemoryOps.forEach(op => localMap.set(op.id, op));

      remoteOps.forEach(remoteOp => {
        if (!localMap.has(remoteOp.id)) {
          localMap.set(remoteOp.id, remoteOp);
        }
      });

      inMemoryOps = Array.from(localMap.values()).filter(op => !isMockOp(op));
      persistOps();
      return inMemoryOps;
    }
  } catch (err) {
    console.warn('Usando OPs em cache local:', err);
  }

  persistOps();
  return inMemoryOps;
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
}): Promise<ProductionOrder> => {
  const newOp: ProductionOrder = {
    id: `prod-op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    number: newOpData.number.trim(),
    product: newOpData.product.trim(),
    lote: (newOpData.lote || '').trim(),
    plannedQuantity: Number(newOpData.plannedQuantity) || 0,
    producedQuantity: 0,
    granel: (newOpData.granel || '').trim(),
    priority: newOpData.priority || 'Normal',
    status: 'pending',
    lineId: newOpData.lineId || null,
    leaderId: null,
    packageAvailability: Number(newOpData.packageAvailability || 0),
    sequence: Number(newOpData.sequence || (inMemoryOps.length + 1)),
    scheduledDate: newOpData.scheduledDate,
    scheduledShift: newOpData.scheduledShift,
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
      produced_quantity: 0,
      granel: newOp.granel,
      priority: newOp.priority,
      status: 'pending',
      line_id: newOp.lineId,
      package_availability: newOp.packageAvailability,
      sequence: newOp.sequence,
      scheduled_date: newOp.scheduledDate,
      scheduled_shift: newOp.scheduledShift,
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
        produced_quantity: 0,
        priority: newOp.priority,
        status: 'pending',
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
  }>
): Promise<{ successCount: number; imported: ProductionOrder[] }> => {
  const newCreated: ProductionOrder[] = [];
  const startSeq = inMemoryOps.length + 1;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
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

  try {
    await Promise.allSettled([
      supabase.from('production_orders').update(dbPayload).eq('id', opId),
      supabase.from('ops').update(dbPayload).eq('id', opId),
    ]);
  } catch (err) {
    console.warn('Atualização de OP no Supabase:', err);
  }
};

export const deleteOP = async (opId: string) => {
  // 1. Mark as permanently deleted and remove from memory and localStorage
  addDeletedOpId(opId);
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
export const getLeaderRotation = async (leaderId: string): Promise<string | null> => {
  inMemoryRotations = loadFromStorage<Record<string, string>>(STORAGE_KEYS.rotations, inMemoryRotations);

  try {
    let { data, error } = await supabase
      .from('weekly_rotations')
      .select('line_id')
      .eq('leader_id', leaderId)
      .maybeSingle();

    if (!data || error) {
      const res = await supabase
        .from('rotations')
        .select('line_id')
        .eq('leader_id', leaderId)
        .maybeSingle();
      data = res.data;
    }

    if (data?.line_id) {
      inMemoryRotations[leaderId] = String(data.line_id);
      persistRotations();
      return String(data.line_id);
    }
  } catch (err) {
    console.warn('Consulta de rotação no Supabase:', err);
  }
  return inMemoryRotations[leaderId] || 'line-1';
};

export const getAllRotations = async (): Promise<Record<string, string>> => {
  inMemoryRotations = loadFromStorage<Record<string, string>>(STORAGE_KEYS.rotations, inMemoryRotations);

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
        if (r.leader_id && r.line_id) map[String(r.leader_id)] = String(r.line_id);
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

export const saveLeaderRotation = async (leaderId: string, lineId: string): Promise<void> => {
  inMemoryRotations[leaderId] = lineId;
  persistRotations();

  try {
    const payload = {
      leader_id: leaderId,
      line_id: lineId,
      updated_at: new Date().toISOString(),
    };

    await Promise.any([
      supabase.from('weekly_rotations').upsert(payload, { onConflict: 'leader_id' }),
      supabase.from('rotations').upsert(payload, { onConflict: 'leader_id' }),
    ]);
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
  inMemoryEvents = loadFromStorage<ProductionEvent[]>(STORAGE_KEYS.events, DEFAULT_EVENTS).filter(e => !isMockEvent(e));

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

export const finishOP = async (opId: string, lineId: string, leaderId: string) => {
  const currentOp = inMemoryOps.find(op => op.id === opId);
  const currentLine = inMemoryLines.find(l => l.id === lineId);

  inMemoryOps = inMemoryOps.map(op => op.id === opId ? { ...op, status: 'completed' } : op);
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
      supabase.from('production_orders').update({ status: 'completed' }).eq('id', opId),
      supabase.from('ops').update({ status: 'completed' }).eq('id', opId),
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
  saveToStorage(STORAGE_KEYS.deletedOpIds, []);

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
  saveToStorage(STORAGE_KEYS.deletedOpIds, []);

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

