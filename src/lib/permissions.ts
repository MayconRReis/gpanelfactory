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
    name: 'Coordenador Geral (Acesso Total)',
    shortName: 'Coordenação',
    description: 'Acesso irrestrito a todas as telas, cadastros e configurações industriais',
    badgeClass: 'bg-blue-950/90 text-blue-400 border border-blue-800/50',
    tabs: [
      'home',
      'pesagem',
      'manipulacao',
      'envase',
      'lines',
      'daily_production',
      'ops',
      'rotations',
      'users',
      'events',
    ],
  },
  pesagem: {
    id: 'pesagem',
    name: 'Líder de Pesagem',
    shortName: 'Pesagem',
    description: 'Acesso ao Dashboard Geral e módulo de Balança & Fracionamento (OSM)',
    badgeClass: 'bg-purple-950/90 text-purple-300 border border-purple-800/50',
    tabs: ['home', 'pesagem'],
  },
  manipulacao: {
    id: 'manipulacao',
    name: 'Líder de Manipulação',
    shortName: 'Manipulação',
    description: 'Acesso ao Dashboard Geral e módulo de Fabricação de Granéis & Reatores',
    badgeClass: 'bg-cyan-950/90 text-cyan-300 border border-cyan-800/50',
    tabs: ['home', 'manipulacao'],
  },
  envase: {
    id: 'envase',
    name: 'Líder de Envase',
    shortName: 'Envase',
    description: 'Acesso ao Dashboard Geral e Chão de Fábrica das Linhas de Envase',
    badgeClass: 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/50',
    tabs: ['home', 'envase'],
  },
  pcp: {
    id: 'pcp',
    name: 'PCP & Planejamento',
    shortName: 'PCP',
    description: 'Planejamento e controle de produção: OPs, Linhas, Histórico e Setores',
    badgeClass: 'bg-indigo-950/90 text-indigo-300 border border-indigo-800/50',
    tabs: ['home', 'ops', 'lines', 'daily_production', 'pesagem', 'manipulacao', 'envase'],
  },
  operador: {
    id: 'operador',
    name: 'Operador / Visualizador',
    shortName: 'Operador',
    description: 'Acesso visual ao Painel Geral de Produção e Farol de Fábrica',
    badgeClass: 'bg-zinc-800 text-zinc-300 border border-zinc-700',
    tabs: ['home'],
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
    description: 'Pesagem de matérias-primas e emissão de OSM',
  },
  manipulacao: {
    label: 'Manipulação',
    group: 'Processos Produtivos',
    description: 'Produção de granéis, reatores e misturas',
  },
  envase: {
    label: 'Chão de Fábrica (Envase)',
    group: 'Processos Produtivos',
    description: 'Painel operacional do líder da linha de envase',
  },
  lines: {
    label: 'Linhas de Produção',
    group: 'Gestão & PCP',
    description: 'Monitoramento ao vivo das 8 linhas de fábrica',
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
  rotations: {
    label: 'Escala Semanal',
    group: 'Gestão & PCP',
    description: 'Distribuição e rodízio semanal de líderes',
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
  if (!profile) return 'operador';
  if (profile.rule && ACCESS_RULES[profile.rule]) {
    return profile.rule;
  }

  const role = String(profile.role || '').toLowerCase().trim();
  const cargo = String(profile.cargo || '').toLowerCase().trim();
  const area = String(profile.area || '').toLowerCase().trim();

  // Coordenador geral
  if (role === 'coordinator' || role === 'coordenador' || cargo.includes('coordena') || area === 'coordenação' || area === 'coordenacao') {
    return 'admin';
  }

  // PCP
  if (cargo.includes('pcp') || cargo.includes('planeja')) {
    return 'pcp';
  }

  // Pesagem
  if (area === 'pesagem' || cargo.includes('pesag')) {
    return 'pesagem';
  }

  // Manipulação
  if (area === 'manipulação' || area === 'manipulacao' || cargo.includes('manipula')) {
    return 'manipulacao';
  }

  // Envase
  if (area === 'envase' || cargo.includes('envas') || role === 'leader') {
    return 'envase';
  }

  return 'operador';
}

/**
 * Retorna a lista de telas (tabs) que o usuário tem permissão para visualizar.
 * REGRA ESSENCIAL: Todos os usuários SEMPRE têm acesso à tela 'home' (Dashboard Geral).
 */
export function getUserAllowedTabs(profile: UserProfile | null): DashboardTab[] {
  // Tela home é a home de todos
  if (!profile) return ['home'];

  // Se houver lista de telas personalizada (custom rule)
  if (profile.allowedScreens && Array.isArray(profile.allowedScreens) && profile.allowedScreens.length > 0) {
    const screens = new Set<DashboardTab>(['home', ...profile.allowedScreens]);
    return Array.from(screens);
  }

  const rule = getUserRule(profile);
  const ruleConfig = ACCESS_RULES[rule] || ACCESS_RULES.operador;
  const screens = new Set<DashboardTab>(['home', ...ruleConfig.tabs]);
  return Array.from(screens);
}

/**
 * Verifica se o usuário tem permissão para acessar uma tela específica.
 */
export function canUserAccessTab(profile: UserProfile | null, tab: DashboardTab): boolean {
  if (tab === 'home') return true; // Todos têm acesso irrestrito ao Dashboard Geral
  const allowed = getUserAllowedTabs(profile);
  return allowed.includes(tab);
}
