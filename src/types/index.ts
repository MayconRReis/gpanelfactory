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
  | 'events'
  | 'relatorio';

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  name: string;
  cargo?: string;
  area?: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação';
  rule?: AccessRule;
  allowedScreens?: DashboardTab[];
  status?: 'active' | 'inactive' | 'pending' | 'first_access' | 'awaiting_confirmation';
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
  isSleeve?: boolean;
  manipulacaoStatus?: string;
  /** Registro virtual (só em memória) da produção de uma conclusão parcial — soma na produção, não conta como OP finalizada. */
  isPartialRecord?: boolean;
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

export type EventType = 'STARTED' | 'PAUSED' | 'RESUMED' | 'FINISHED' | 'QUANTITY_REPORTED' | 'CANCELLED';

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

/** Expediente de uma linha (tabela work_sessions): do "Iniciar" ao "Encerrar expediente". */
export interface WorkSession {
  id: string;
  lineId: string;
  startedAt: string;
  endedAt?: string | null;
  startedBy?: string | null;
  endedBy?: string | null;
}

/** Equipe de uma linha num momento do dia (tabela line_headcounts). O valor vigente é o registro mais recente. */
export interface LineHeadcount {
  id: string;
  lineId: string;
  present: number;
  absent: number;
  recordedAt: string;
  recordedBy?: string | null;
}

/** Troca de produto numa linha (tabela line_changeovers): do "Iniciar troca" até iniciar a próxima OP. */
export interface LineChangeover {
  id: string;
  lineId: string;
  startedAt: string;
  endedAt?: string | null;
  startedBy?: string | null;
  endedBy?: string | null;
  previousOpId?: string | null;
  nextOpId?: string | null;
  /** Tipo do setup informado pelo líder: mesmo tipo de produto ou produto diferente. */
  setupType?: 'same' | 'different' | null;
}

// Histórico de movimentações da Pesagem (quem registrou, editou, excluiu
// ou deu saída em cada OSM). Registro imutável: nunca é editado nem apagado.
export type PesagemHistoryAction =
  | 'created'                       // OSM registrada na Pesagem (entrada)
  | 'edited'                        // OSM editada na Pesagem
  | 'deleted'                       // OSM excluída na Pesagem
  | 'manual_exit'                   // Saída Manual (Carvalho / Macpaul)
  | 'manipulacao_started'           // Saída: Manipulação iniciou a OSM no reator
  | 'manipulacao_start_cancelled';  // Manipulação cancelou o início (iniciado por engano)

export interface PesagemHistoryChange {
  field: string;
  from: string;
  to: string;
}

export interface PesagemHistoryEntry {
  id: string;
  createdAt: string;
  action: PesagemHistoryAction;
  opId?: string | null;
  opNumber: string;
  product?: string | null;
  lote?: string | null;
  industria?: string | null;
  /** Nome do usuário logado que fez a ação. */
  collaboratorName: string;
  userId?: string | null;
  userName?: string | null;
  details?: {
    changes?: PesagemHistoryChange[];
    reactor?: string;
    exitDate?: string;
    note?: string;
  } | null;
}

/** Parte digitada pelo Coordenador no Relatório do Dia (tabela daily_reports). */
export interface DailyReportManual {
  date: string; // 'AAAA-MM-DD'
  atestados: number;
  faltas: number;
  atrasos: number;
  saidasAntecipadas: number;
  /** Principais pontos do dia: tópico + texto (vazios não aparecem no relatório) */
  pontos: { titulo: string; texto: string }[];
  seguranca: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}
