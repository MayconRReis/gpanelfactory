import { UserProfile, AccessRule, DashboardTab } from '../types';

export interface AccessRuleConfig {
  id: AccessRule;
  name: string;
  shortName: string;
  description: string;
  badgeClass: string;
  tabs: DashboardTab[];
}

export const ACCESS_RULES: Record<AccessRule, AccessRuleConfig> = {
  admin: {
    id: 'admin',
    name: 'ADM (Acesso Total)',
    shortName: 'ADM',
    description: 'Acesso irrestrito a todas as telas, cadastros e configurações industriais. O cargo exibido é o título informado para a pessoa.',
    badgeClass: 'bg-blue-950/90 text-blue-400 border border-blue-800/50',
    tabs: [
      'home',
      'pesagem',
      'manipulacao',
      'envase',
      'cronograma',
      'relatorio',
      'ocorrencias',
      'daily_production',
      'ops',
      'users',
      'events',
    ],
  },
  diretor: {
    id: 'diretor',
    name: 'Diretor Industrial (Acesso Total)',
    shortName: 'Diretoria',
    description: 'Mesmo acesso do Coordenador Geral a todas as telas, cadastros e configurações industriais',
    badgeClass: 'bg-amber-500/15 text-amber-300 border border-amber-400/60',
    tabs: [],
  },
  pesagem: {
    id: 'pesagem',
    name: 'Líder de Pesagem',
    shortName: 'Pesagem',
    description: 'Acesso ao Dashboard Geral e módulo de Balança & Fracionamento (OP)',
    badgeClass: 'bg-purple-950/90 text-purple-300 border border-purple-800/50',
    tabs: ['home', 'pesagem', 'cronograma'],
  },
  manipulacao: {
    id: 'manipulacao',
    name: 'Líder de Manipulação',
    shortName: 'Manipulação',
    description: 'Acesso ao Dashboard Geral e módulo de Fabricação de Granéis & Reatores',
    badgeClass: 'bg-cyan-950/90 text-cyan-300 border border-cyan-800/50',
    tabs: ['home', 'manipulacao', 'cronograma'],
  },
  envase: {
    id: 'envase',
    name: 'Líder de Envase',
    shortName: 'Envase',
    description: 'Acesso ao Dashboard Geral e Chão de Fábrica das Linhas de Envase',
    badgeClass: 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/50',
    tabs: ['home', 'envase', 'cronograma'],
  },
  custom: {
    id: 'custom',
    name: 'Personalizado',
    shortName: 'Personalizado',
    description: 'Permissões específicas customizadas para o colaborador',
    badgeClass: 'bg-amber-950/90 text-amber-300 border border-amber-800/50',
    tabs: ['home'],
  },
};

export const TAB_METADATA: Record<DashboardTab, { label: string; group: string; description: string }> = {
  home: {
    label: 'Dashboard Geral',
    group: 'Visão Geral',
    description: 'Métricas executivas, Farol de Produção e OEE (Padrão para todos)',
  },
  pesagem: {
    label: 'Pesagem',
    group: 'Processos Produtivos',
    description: 'Pesagem de matérias-primas e emissão de OP',
  },
  manipulacao: {
    label: 'Manipulação',
    group: 'Processos Produtivos',
    description: 'Produção de granéis, reatores e misturas',
  },
  envase: {
    label: 'Envase',
    group: 'Processos Produtivos',
    description: 'Painel operacional do líder da linha de envase',
  },
  cronograma: {
    label: 'Cronograma',
    group: 'Gestão & PCP',
    description: 'Quadro Kanban das linhas de envase e reatores (líderes só visualizam o da sua área)',
  },
  relatorio: {
    label: 'Relatório do Dia',
    group: 'Gestão & PCP',
    description: 'Relatório diário de produção (indicadores, quadro do dia, pontos do dia e evolução do mês)',
  },
  ocorrencias: {
    label: 'Ocorrências de Pessoal',
    group: 'Gestão & PCP',
    description: 'Faltas, atrasos, atestados, saídas, acidentes/incidentes, hora extra e free do balde (todos têm acesso)',
  },
  daily_production: {
    label: 'Histórico & Gráficos',
    group: 'Gestão & PCP',
    description: 'Acompanhamento de metas diárias e mensais',
  },
  ops: {
    label: 'Estoque de OPs',
    group: 'Gestão & PCP',
    description: 'Fila de OPs em carteira e importador CSV',
  },
  users: {
    label: 'Equipe & Acessos',
    group: 'Administração',
    description: 'Gestão de usuários e regras de acesso (Rules)',
  },
  events: {
    label: 'Auditoria',
    group: 'Administração',
    description: 'Registro de paradas, inícios e finalizações',
  },
};

/**
 * Detecta ou recupera a Regra (Rule) do usuário a partir do seu perfil.
 */
export function getUserRule(profile: UserProfile | null): AccessRule {
  if (!profile) return 'envase';
  if (profile.rule && ACCESS_RULES[profile.rule]) {
    return profile.rule;
  }

  const role = String(profile.role || '').toLowerCase().trim();
  const cargo = String(profile.cargo || '').toLowerCase().trim();
  const area = String(profile.area || '').toLowerCase().trim();

  // Coordenador geral
  // Cuidado: usar `cargo.includes('coordena')` daria acesso total (admin) a
  // qualquer cargo que apenas MENCIONE coordenação sem SER um coordenador —
  // ex.: "Assistente de Coordenação de Estoque". Por isso exigimos que o
  // cargo comece com "coordenador" (ex.: "Coordenador Geral", "Coordenador
  // de Produção"), não apenas contenha o radical em qualquer posição.
  // Diretor Industrial — mesmo acesso do Coordenador, só muda o cargo
  if (cargo.startsWith('diretor')) {
    return 'diretor';
  }
  if (role === 'coordinator' || role === 'coordenador' || cargo.startsWith('coordenador') || area === 'coordenação' || area === 'coordenacao') {
    return 'admin';
  }

  // Pesagem
  if (area === 'pesagem' || cargo.includes('pesag')) {
    return 'pesagem';
  }

  // Manipulação
  if (area === 'manipulação' || area === 'manipulacao' || cargo.includes('manipula')) {
    return 'manipulacao';
  }

  // Envase / Líder de produção padrão
  if (area === 'envase' || cargo.includes('envas') || role === 'leader') {
    return 'envase';
  }

  return 'envase';
}

/**
 * Retorna a lista de telas (tabs) que o usuário tem permissão para visualizar.
 * REGRA ESSENCIAL: Todos os usuários SEMPRE têm acesso à tela 'home' (Dashboard Geral).
 */
export function getUserAllowedTabs(profile: UserProfile | null): DashboardTab[] {
  // Tela home é a home de todos
  if (!profile) return ['home', 'ocorrencias'];

  // Se houver lista de telas personalizada (custom rule)
  if (profile.allowedScreens && Array.isArray(profile.allowedScreens) && profile.allowedScreens.length > 0) {
    const screens = new Set<DashboardTab>(['home', 'ocorrencias', ...profile.allowedScreens.filter((s: any) => s !== 'rotations')]);
    return Array.from(screens);
  }

  const rule = getUserRule(profile);
  const ruleConfig = ACCESS_RULES[rule] || ACCESS_RULES.envase;
  const screens = new Set<DashboardTab>(['home', 'ocorrencias', ...ruleConfig.tabs]);
  return Array.from(screens);
}

/**
 * Verifica se o usuário tem permissão para acessar uma tela específica.
 */
export function canUserAccessTab(profile: UserProfile | null, tab: DashboardTab): boolean {
  if (tab === 'home' || tab === 'ocorrencias') return true; // Todos têm acesso irrestrito ao Dashboard Geral
  const allowed = getUserAllowedTabs(profile);
  return allowed.includes(tab);
}

/**
 * Acesso ao Cronograma: o Coordenador (e perfis personalizados que tenham a
 * tela) editam os dois quadros; os líderes só VISUALIZAM o quadro da sua área
 * — Envase vê o de Envase; Manipulação e Pesagem veem o de Manipulação.
 */
export function getCronogramaAccess(profile: UserProfile | null): {
  editable: boolean;
  modes: Array<'envase' | 'manipulacao'>;
} {
  if (!canUserAccessTab(profile, 'cronograma')) return { editable: false, modes: [] };
  const hasCustomScreens = !!(profile?.allowedScreens && Array.isArray(profile.allowedScreens) && profile.allowedScreens.length > 0);
  const rule = getUserRule(profile);
  if (isAdminRule(rule) || (rule === 'custom' && hasCustomScreens)) return { editable: true, modes: ['envase', 'manipulacao'] };
  if (rule === 'manipulacao' || rule === 'pesagem') return { editable: false, modes: ['manipulacao'] };
  return { editable: false, modes: ['envase'] };
}

/** Regras com acesso total (Coordenador Geral e Diretor Industrial). */
export function isAdminRule(rule: AccessRule | string | null | undefined): boolean {
  return rule === 'admin' || rule === 'diretor';
}

// O Diretor Industrial enxerga exatamente as mesmas telas do Coordenador.
ACCESS_RULES.diretor.tabs = [...ACCESS_RULES.admin.tabs];

/**
 * Ocorrências de pessoal: TODOS veem tudo, mas cada um só LANÇA na sua área.
 * - ADM / Diretor: qualquer linha ou setor.
 * - Envase: as linhas de envase (inclui Sleev).
 * - Pesagem: setor de Pesagem. Manipulação: setor de Manipulação.
 * Perfis personalizados seguem as telas liberadas para eles.
 */
export function getStaffOccurrenceAreas(profile: UserProfile | null): {
  all: boolean;
  envase: boolean;
  pesagem: boolean;
  manipulacao: boolean;
} {
  if (!profile) return { all: false, envase: false, pesagem: false, manipulacao: false };
  const rule = getUserRule(profile);
  if (isAdminRule(rule)) return { all: true, envase: true, pesagem: true, manipulacao: true };
  const tabs = getUserAllowedTabs(profile);
  return {
    all: false,
    envase: tabs.includes('envase'),
    pesagem: tabs.includes('pesagem'),
    manipulacao: tabs.includes('manipulacao'),
  };
}
