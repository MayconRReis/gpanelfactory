export type Role = 'coordinator' | 'leader';

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  name: string;
  cargo?: string;
  status?: 'active' | 'inactive' | 'pending' | 'first_access';
  mustChangePassword?: boolean;
  defaultPassword?: string;
  createdAt: string;
}

export interface ProductionLine {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'paused';
  currentOpId: string | null;
}

export type OPStatus = 'pending' | 'in_progress' | 'paused' | 'completed';
export type OPPriority = 'Crítica' | 'Alta' | 'Normal' | 'Baixa';

export interface ProductionOrder {
  id: string;
  number: string;
  product: string;
  lote?: string;
  plannedQuantity: number;
  producedQuantity: number;
  granel?: string;
  priority: OPPriority;
  status: OPStatus;
  lineId: string | null;
  leaderId: string | null;
  packageAvailability: number;
  sequence: number;
  scheduledDate?: string;
  scheduledShift?: string;
  createdAt: string;
}

export type EventType = 'STARTED' | 'PAUSED' | 'RESUMED' | 'FINISHED' | 'QUANTITY_REPORTED';

export interface ProductionEvent {
  id: string;
  opId?: string;
  lineId?: string;
  leaderId?: string;
  leaderName?: string;
  lineName?: string;
  opNumber?: string;
  type: EventType;
  quantity?: number;
  reason?: string;
  observation?: string;
  createdAt: string;
}

export interface LeaderAssignment {
  leaderId: string;
  leaderName: string;
  lineId: string;
  lineName: string;
  shift?: string;
}

export interface PauseReason {
  id: string;
  name: string;
  category?: string;
}
