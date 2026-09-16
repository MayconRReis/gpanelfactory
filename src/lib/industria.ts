// Cores por indústria (Ybera Group possui mais de uma indústria operando no
// mesmo galpão: Ybera, Carvalho e Macpaul). Usar uma cor distinta por
// indústria — em vez da cor genérica do setor (roxo/ciano/âmbar) — deixa
// claro, num piscar de olhos, a quem pertence cada OSM disponível para
// manipulação, já que Carvalho/Macpaul raramente passam pela manipulação da
// Ybera e por isso precisam se destacar visualmente das OSMs da própria Ybera.
export const INDUSTRIA_BADGE_CLASSES: Record<string, string> = {
  Ybera: 'bg-sky-950/80 text-sky-300 border-sky-800/60',
  Carvalho: 'bg-orange-950/80 text-orange-300 border-orange-800/60',
  Macpaul: 'bg-pink-950/80 text-pink-300 border-pink-800/60',
};

export const DEFAULT_INDUSTRIA_BADGE_CLASS = 'bg-slate-800/80 text-slate-300 border-slate-700/60';

export function getIndustriaBadgeClass(industria?: string | null): string {
  if (!industria) return DEFAULT_INDUSTRIA_BADGE_CLASS;
  return INDUSTRIA_BADGE_CLASSES[industria] || DEFAULT_INDUSTRIA_BADGE_CLASS;
}

// Indústrias que raramente passam pela Manipulação na própria Ybera — para
// essas, o líder de Pesagem pode dar "saída manual" direto, sem depender de
// alguém iniciar/finalizar a manipulação.
export function isManualExitEligible(industria?: string | null): boolean {
  return !!industria && industria !== 'Ybera';
}
