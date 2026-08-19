import { supabase } from '../lib/supabase';
import { ProductionLine, ProductionOrder, UserProfile, WeeklyRotation } from '../types';

// ============ PROFILE OPERATIONS ============

export const getProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }

    return data as UserProfile;
  } catch (error) {
    console.error('Error getting profile:', error);
    return null;
  }
};

// ============ PRODUCTION LINE OPERATIONS ============

export const getLines = async (): Promise<ProductionLine[]> => {
  try {
    const { data, error } = await supabase
      .from('production_lines')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return (data || []).map((line) => ({
      id: line.id,
      name: line.name,
      status: line.status,
      currentOpId: line.current_op_id,
    })) as ProductionLine[];
  } catch (error) {
    console.error('Error fetching lines:', error);
    return [];
  }
};

export const createLine = async (name: string): Promise<ProductionLine | null> => {
  try {
    const { data, error } = await supabase
      .from('production_lines')
      .insert([{ name, status: 'idle', current_op_id: null }])
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      currentOpId: data.current_op_id,
    } as ProductionLine;
  } catch (error) {
    console.error('Error creating line:', error);
    return null;
  }
};

// ============ PRODUCTION ORDER OPERATIONS ============

export const getAllOPs = async (): Promise<ProductionOrder[]> => {
  try {
    const { data, error } = await supabase
      .from('production_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((op) => ({
      id: op.id,
      number: op.number,
      product: op.product,
      plannedQuantity: op.planned_quantity,
      producedQuantity: op.produced_quantity,
      priority: op.priority,
      status: op.status,
      lineId: op.line_id,
      leaderId: op.leader_id,
      packageAvailability: op.package_availability,
      sequence: op.sequence,
      createdAt: op.created_at,
    })) as ProductionOrder[];
  } catch (error) {
    console.error('Error fetching OPs:', error);
    return [];
  }
};

export const getActiveOP = async (lineId: string): Promise<ProductionOrder | null> => {
  try {
    // First, try to find an in-progress or paused OP
    const { data: activeData, error: activeError } = await supabase
      .from('production_orders')
      .select('*')
      .eq('line_id', lineId)
      .in('status', ['in_progress', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!activeError && activeData) {
      return mapOP(activeData);
    }

    // If no active OP, get the next pending OP
    const { data: pendingData, error: pendingError } = await supabase
      .from('production_orders')
      .select('*')
      .eq('line_id', lineId)
      .eq('status', 'pending')
      .order('sequence', { ascending: true })
      .limit(1)
      .single();

    if (!pendingError && pendingData) {
      return mapOP(pendingData);
    }

    return null;
  } catch (error) {
    console.error('Error fetching active OP:', error);
    return null;
  }
};

export const createOP = async (
  number: string,
  product: string,
  plannedQuantity: number,
  priority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa',
  lineId: string,
  sequence: number
): Promise<ProductionOrder | null> => {
  try {
    const { data, error } = await supabase
      .from('production_orders')
      .insert([
        {
          number,
          product,
          planned_quantity: plannedQuantity,
          produced_quantity: 0,
          priority,
          status: 'pending',
          line_id: lineId,
          leader_id: null,
          sequence,
          package_availability: 0,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return mapOP(data);
  } catch (error) {
    console.error('Error creating OP:', error);
    return null;
  }
};

// ============ PRODUCTION OPERATION HANDLERS ============

export const startOP = async (
  opId: string,
  lineId: string,
  leaderId: string
): Promise<void> => {
  try {
    // Update OP status
    const { error: opError } = await supabase
      .from('production_orders')
      .update({ status: 'in_progress', leader_id: leaderId })
      .eq('id', opId);

    if (opError) throw opError;

    // Update line status
    const { error: lineError } = await supabase
      .from('production_lines')
      .update({ status: 'active', current_op_id: opId })
      .eq('id', lineId);

    if (lineError) throw lineError;

    // Create event
    await supabase.from('production_events').insert([
      {
        op_id: opId,
        line_id: lineId,
        leader_id: leaderId,
        type: 'STARTED',
      },
    ]);
  } catch (error) {
    console.error('Error starting OP:', error);
    throw new Error('Não foi possível iniciar a produção.');
  }
};

export const pauseOP = async (
  opId: string,
  lineId: string,
  leaderId: string,
  reason: string,
  observation: string
): Promise<void> => {
  try {
    // Update OP status
    const { error: opError } = await supabase
      .from('production_orders')
      .update({ status: 'paused' })
      .eq('id', opId);

    if (opError) throw opError;

    // Update line status
    const { error: lineError } = await supabase
      .from('production_lines')
      .update({ status: 'paused' })
      .eq('id', lineId);

    if (lineError) throw lineError;

    // Create event
    await supabase.from('production_events').insert([
      {
        op_id: opId,
        line_id: lineId,
        leader_id: leaderId,
        type: 'PAUSED',
        reason,
        observation,
      },
    ]);
  } catch (error) {
    console.error('Error pausing OP:', error);
    throw new Error('Não foi possível pausar a produção.');
  }
};

export const resumeOP = async (
  opId: string,
  lineId: string,
  leaderId: string
): Promise<void> => {
  try {
    // Update OP status
    const { error: opError } = await supabase
      .from('production_orders')
      .update({ status: 'in_progress' })
      .eq('id', opId);

    if (opError) throw opError;

    // Update line status
    const { error: lineError } = await supabase
      .from('production_lines')
      .update({ status: 'active' })
      .eq('id', lineId);

    if (lineError) throw lineError;

    // Create event
    await supabase.from('production_events').insert([
      {
        op_id: opId,
        line_id: lineId,
        leader_id: leaderId,
        type: 'RESUMED',
      },
    ]);
  } catch (error) {
    console.error('Error resuming OP:', error);
    throw new Error('Não foi possível retomar a produção.');
  }
};

export const finishOP = async (
  opId: string,
  lineId: string,
  leaderId: string
): Promise<void> => {
  try {
    // Update OP status
    const { error: opError } = await supabase
      .from('production_orders')
      .update({ status: 'completed' })
      .eq('id', opId);

    if (opError) throw opError;

    // Update line status
    const { error: lineError } = await supabase
      .from('production_lines')
      .update({ status: 'idle', current_op_id: null })
      .eq('id', lineId);

    if (lineError) throw lineError;

    // Create event
    await supabase.from('production_events').insert([
      {
        op_id: opId,
        line_id: lineId,
        leader_id: leaderId,
        type: 'FINISHED',
      },
    ]);
  } catch (error) {
    console.error('Error finishing OP:', error);
    throw new Error('Não foi possível finalizar a produção.');
  }
};

export const reportQuantity = async (
  opId: string,
  lineId: string,
  leaderId: string,
  quantity: number
): Promise<void> => {
  try {
    // Get current produced quantity
    const { data: opData, error: fetchError } = await supabase
      .from('production_orders')
      .select('produced_quantity')
      .eq('id', opId)
      .single();

    if (fetchError) throw fetchError;

    const newQuantity = (opData?.produced_quantity || 0) + quantity;

    // Update OP
    const { error: updateError } = await supabase
      .from('production_orders')
      .update({ produced_quantity: newQuantity })
      .eq('id', opId);

    if (updateError) throw updateError;

    // Create event
    await supabase.from('production_events').insert([
      {
        op_id: opId,
        line_id: lineId,
        leader_id: leaderId,
        type: 'QUANTITY_REPORTED',
        quantity,
      },
    ]);
  } catch (error) {
    console.error('Error reporting quantity:', error);
    throw new Error('Não foi possível registrar a produção.');
  }
};

// ============ WEEKLY ROTATION OPERATIONS ============

export const getLeaderRotation = async (leaderId: string): Promise<string | null> => {
  try {
    const weekNumber = getWeekNumber(new Date());
    const year = new Date().getFullYear();

    const { data, error } = await supabase
      .from('weekly_rotations')
      .select('line_id')
      .eq('leader_id', leaderId)
      .eq('week_number', weekNumber)
      .eq('year', year)
      .single();

    if (error) {
      console.error('No rotation found for this week:', error.message);
      return null;
    }

    return data?.line_id || null;
  } catch (error) {
    console.error('Error fetching leader rotation:', error);
    return null;
  }
};

export const createWeeklyRotation = async (
  leaderId: string,
  lineId: string,
  weekNumber: number,
  year: number
): Promise<WeeklyRotation | null> => {
  try {
    const { data, error } = await supabase
      .from('weekly_rotations')
      .insert([
        {
          leader_id: leaderId,
          line_id: lineId,
          week_number: weekNumber,
          year,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      weekNumber: data.week_number,
      year: data.year,
      assignments: [
        {
          leaderId: data.leader_id,
          lineId: data.line_id,
        },
      ],
    } as WeeklyRotation;
  } catch (error) {
    console.error('Error creating rotation:', error);
    return null;
  }
};

// ============ REALTIME SUBSCRIPTIONS ============

export const subscribeToLines = (callback: (lines: ProductionLine[]) => void) => {
  const subscription = supabase
    .from('production_lines')
    .on('*', (payload) => {
      getLines().then(callback);
    })
    .subscribe();

  return () => {
    supabase.removeAllChannels();
  };
};

export const subscribeToOPs = (callback: (ops: ProductionOrder[]) => void) => {
  const subscription = supabase
    .from('production_orders')
    .on('*', (payload) => {
      getAllOPs().then(callback);
    })
    .subscribe();

  return () => {
    supabase.removeAllChannels();
  };
};

// ============ HELPER FUNCTIONS ============

function mapOP(data: any): ProductionOrder {
  return {
    id: data.id,
    number: data.number,
    product: data.product,
    plannedQuantity: data.planned_quantity,
    producedQuantity: data.produced_quantity,
    priority: data.priority,
    status: data.status,
    lineId: data.line_id,
    leaderId: data.leader_id,
    packageAvailability: data.package_availability,
    sequence: data.sequence,
    createdAt: data.created_at,
  };
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
