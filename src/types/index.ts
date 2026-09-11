export type Role = 'coordinator' | 'leader';

export type AccessRule = 
  | 'admin'           // Coordenador Geral (Acesso total)
  | 'pesagem'         // Líder de Pesagem (Home + Pesagem)
  | 'manipulacao'     // Líder de Manipulação (Home + Manipulação)
  | 'envase'          // Líder de Envase (Home + Chão de Fábrica)
  | 'custom';         // Personalizado (Seleção manual de telas)

export type DashboardTab = 
  | 'home'
  | 'pesagem'
  | 'manipulacao'
  | 'envase'
  | 'cronograma'
  | 'daily_production'
  | 'ops'
  | 'users'
  | 'events';

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  name: string;
  cargo?: string;
  area?: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação';
  rule?: AccessRule;
  allowedScreens?: DashboardTab[];
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
  scheduledEndDate?: string;
  scheduledDays?: number;
  scheduledShift?: string;
  setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral';
  unidade?: 'Un' | 'Kg' | 'Qtd';
  rejectedQuantity?: number;
  plannedHours?: number;
  tipoDocumento?: 'OP' | 'OSM';
  industria?: 'Ybera' | 'Carvalho' | 'Macpaul' | string;
  finishedShift?: 'Manhã' | 'Tarde';
  completedAt?: string;
  observation?: string;
  createdAt: string;
}

export interface MonthlyGoal {
  id: string;
  lineId: string;
  year: number;
  month: number;
  goalQuantity: number;
  setor?: 'Pesagem' | 'Manipulação' | 'Envase' | 'Geral';
  createdAt: string;
  updatedAt: string;
}

/**
 * Meta diária fixa de uma linha de produção (quantidade/dia). Fica fixa até
 * que seja atualizada manualmente — sem vínculo com mês/ano, diferente de
 * MonthlyGoal/FactoryMonthlyGoal.
 */
export interface LineDailyGoal {
  lineId: string;
  goalQuantity: number;
  updatedAt: string;
}

/**
 * Meta mensal ÚNICA da fábrica inteira (não por linha) — ex: 450.000 un no
 * mês. Fica fixa até ser atualizada manualmente pelo Coordenador Geral.
 */
export interface FactoryMonthlyGoal {
  year: number;
  month: number;
  goalQuantity: number;
  updatedAt: string;
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
