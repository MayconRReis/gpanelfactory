export type Role = 'coordinator' | 'leader';

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  name: string;
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
  plannedQuantity: number;
  producedQuantity: number;
  priority: OPPriority;
  status: OPStatus;
  lineId: string | null;
  leaderId: string | null;
  packageAvailability: number;
  sequence: number;
  createdAt: string;
}

export type EventType = 'STARTED' | 'PAUSED' | 'RESUMED' | 'FINISHED' | 'QUANTITY_REPORTED';

export interface ProductionEvent {
  id: string;
  opId: string;
  lineId: string;
  leaderId: string;
  type: EventType;
  timestamp: any; // Firestore server timestamp
  quantity?: number;
  reason?: string;
  observation?: string;
}

export interface WeeklyRotation {
  id: string;
  weekNumber: number;
  year: number;
  assignments: {
    leaderId: string;
    lineId: string;
  }[];
}
