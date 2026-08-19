// User Profile Types
export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'coordinator' | 'leader';
  createdAt: string;
}

// Production Line Types
export interface ProductionLine {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'paused';
  currentOpId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// Production Order Types
export interface ProductionOrder {
  id: string;
  number: string;
  product: string;
  plannedQuantity: number;
  producedQuantity: number;
  priority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa';
  status: 'pending' | 'in_progress' | 'paused' | 'completed';
  lineId: string | null;
  leaderId: string | null;
  packageAvailability: number;
  sequence: number;
  createdAt: string;
  updatedAt?: string;
}

// Production Event Types
export interface ProductionEvent {
  id: string;
  opId: string;
  lineId: string;
  leaderId: string | null;
  type: 'STARTED' | 'PAUSED' | 'RESUMED' | 'FINISHED' | 'QUANTITY_REPORTED';
  quantity?: number;
  reason?: string;
  observation?: string;
  timestamp: string;
  createdAt: string;
}

// Weekly Rotation Types
export interface WeeklyRotation {
  id: string;
  weekNumber: number;
  year: number;
  assignments: Array<{
    leaderId: string;
    lineId: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

// Pause Reason Types
export interface PauseReason {
  id: string;
  reason: string;
  description?: string;
  createdAt: string;
}
