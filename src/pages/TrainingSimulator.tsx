import { useEffect, useRef, useState } from 'react';
import { GraduationCap, RefreshCw, ShieldCheck, Scale, FlaskConical, Factory } from 'lucide-react';
import { setTrainingMode } from '../services/db';
import { ProductionOrder, ProductionLine } from '../types';
import { PesagemScreen } from './PesagemScreen';
import { ManipulacaoScreen } from './ManipulacaoScreen';
import { LeaderScreen } from './LeaderScreen';

/**
 * SIMULADOR DE TREINAMENTO — "Modo Treinamento"
 * ------------------------------------------------------------------
 * Renderiza as TELAS DE PRODUÇÃO DE VERDADE (PesagemScreen,
 * ManipulacaoScreen, LeaderScreen) — mesmo componente, idênticas em tudo —
 * só que alimentadas por OPs fictícias em memória em vez do Supabase.
 *
 * Como funciona: `setTrainingMode(true, seed)` (em services/db.ts) faz
 * TODAS as funções de leitura/escrita que essas telas já usam (getLines,
 * getAllOPs, startOP, pauseOP, resumeOP, finishOP, reportQuantity,
 * createOP, updateOP, deleteOP, getRecentEvents, saveLeaderRotation...)
 * desviarem para um conjunto de dados isolado — sem tocar em nenhuma OP,
 * linha ou evento real, e sem nenhuma chamada ao Supabase. O `seed` é
 * ativado de forma SÍNCRONA durante a renderização (não num useEffect),
 * para garantir que já esteja no ar antes da tela real montar e disparar
 * sua própria busca inicial de dados.
 *
 * `hideDashboardTabs` (prop nova nas 3 telas) esconde só a aba de
 * Dashboard/Histórico interna de cada tela — não faz sentido treinar
 * "leitura de indicadores" sobre dados fictícios, só o fluxo operacional.
 *
 * Acesso: esta tela só aparece no menu para quem tem a Rule "admin"
 * (Coordenador Geral) — ver ACCESS_RULES.admin.tabs em lib/permissions.ts.
 */

type SimArea = 'pesagem' | 'manipulacao' | 'envase';

interface SimSeed {
  ops: ProductionOrder[];
  lines: ProductionLine[];
}

// ----------------------------------------------------------------------
// Dados de exemplo — modelados nos MESMOS campos de uma OP real (número,
// produto, lote, granel, quantidade planejada etc.), só marcados como
// "TREINO" no número da OP pra nunca serem confundidos com produção real.
// Se quiser treinar com os valores exatos de uma OP real específica (nome
// do produto, lote, número, granel, quantidade), me passe os dados dela
// que eu troco aqui.
// ----------------------------------------------------------------------
function buildSeed(area: SimArea): SimSeed {
  const now = new Date().toISOString();
  const baseOp = (over: Partial<ProductionOrder> & Pick<ProductionOrder, 'id' | 'number' | 'product' | 'lote' | 'granel' | 'plannedQuantity'>): ProductionOrder => ({
    producedQuantity: 0,
    priority: 'Normal',
    status: 'pending',
    lineId: null,
    leaderId: null,
    packageAvailability: over.plannedQuantity,
    sequence: 1,
    unidade: 'Kg',
    tipoDocumento: 'OP',
    industria: 'Ybera',
    rejectedQuantity: 0,
    createdAt: now,
    ...over,
  });

  if (area === 'pesagem') {
    return {
      lines: [{ id: 'sim-pesagem', name: 'Balança / Fracionamento', status: 'idle', currentOpId: null }],
      ops: [
        baseOp({ id: 'sim-op-pes-1', number: 'OP-TREINO-2601', product: 'Detergente Neutro Concentrado', lote: 'L-260901', granel: 'GRAN-0912', plannedQuantity: 1200, setor: 'Pesagem', unidade: 'Kg', sequence: 1 }),
        baseOp({ id: 'sim-op-pes-2', number: 'OP-TREINO-2602', product: 'Amaciante Concentrado', lote: 'L-260902', granel: 'GRAN-0913', plannedQuantity: 800, setor: 'Pesagem', unidade: 'Kg', sequence: 2 }),
        baseOp({ id: 'sim-op-pes-3', number: 'OP-TREINO-2603', product: 'Água Sanitária', lote: 'L-260903', granel: 'GRAN-0914', plannedQuantity: 950, setor: 'Pesagem', unidade: 'Kg', sequence: 3 }),
      ],
    };
  }

  if (area === 'manipulacao') {
    return {
      lines: [{ id: 'sim-manipulacao', name: 'Reatores / Granéis', status: 'idle', currentOpId: null }],
      ops: [
        baseOp({ id: 'sim-op-mnp-1', number: 'OP-TREINO-3601', product: 'Granel Detergente Neutro', lote: 'L-360901', granel: 'GRAN-0912', plannedQuantity: 1200, setor: 'Manipulação', unidade: 'Kg', sequence: 1 }),
        baseOp({ id: 'sim-op-mnp-2', number: 'OP-TREINO-3602', product: 'Granel Amaciante Concentrado', lote: 'L-360902', granel: 'GRAN-0913', plannedQuantity: 800, setor: 'Manipulação', unidade: 'Kg', sequence: 2 }),
      ],
    };
  }

  // envase — 3 linhas reais de produção, cada uma com sua própria fila
  return {
    lines: [
      { id: 'sim-linha-1', name: 'Linha 1', status: 'idle', currentOpId: null },
      { id: 'sim-linha-2', name: 'Linha 2', status: 'idle', currentOpId: null },
      { id: 'sim-linha-3', name: 'Linha 3', status: 'idle', currentOpId: null },
    ],
    ops: [
      baseOp({ id: 'sim-op-env-1', number: 'OP-TREINO-9001', product: 'Detergente Neutro 500ml', lote: 'L-900101', granel: 'GRAN-0912', plannedQuantity: 4000, setor: 'Envase', unidade: 'Un', lineId: 'sim-linha-1', sequence: 1 }),
      baseOp({ id: 'sim-op-env-2', number: 'OP-TREINO-9002', product: 'Detergente Neutro 500ml', lote: 'L-900102', granel: 'GRAN-0912', plannedQuantity: 2500, setor: 'Envase', unidade: 'Un', lineId: 'sim-linha-1', sequence: 2 }),
      baseOp({ id: 'sim-op-env-3', number: 'OP-TREINO-9003', product: 'Amaciante Concentrado 1L', lote: 'L-900201', granel: 'GRAN-0913', plannedQuantity: 3000, setor: 'Envase', unidade: 'Un', lineId: 'sim-linha-2', sequence: 1 }),
      baseOp({ id: 'sim-op-env-4', number: 'OP-TREINO-9004', product: 'Água Sanitária 1L', lote: 'L-900301', granel: 'GRAN-0914', plannedQuantity: 3200, setor: 'Envase', unidade: 'Un', lineId: 'sim-linha-3', sequence: 1 }),
    ],
  };
}

const AREA_TABS: { id: SimArea; label: string; icon: typeof Scale; color: string }[] = [
  { id: 'pesagem', label: 'Pesagem', icon: Scale, color: 'bg-purple-600 hover:bg-purple-500' },
  { id: 'manipulacao', label: 'Manipulação', icon: FlaskConical, color: 'bg-cyan-600 hover:bg-cyan-500' },
  { id: 'envase', label: 'Envase', icon: Factory, color: 'bg-emerald-600 hover:bg-emerald-500' },
];

export function TrainingSimulator() {
  const [area, setArea] = useState<SimArea>('envase');
  const [resetKey, setResetKey] = useState(0);

  // Ativa o Modo Treinamento de forma SÍNCRONA durante a renderização (e não
  // num useEffect) — isso garante que trainingModeActive já esteja ligado
  // ANTES da tela real (Leader/Pesagem/Manipulação) montar e disparar seu
  // próprio fetchData() inicial, evitando uma corrida onde a primeira busca
  // pegaria dados reais por engano.
  const appliedSeedRef = useRef<{ area: SimArea; resetKey: number } | null>(null);
  if (!appliedSeedRef.current || appliedSeedRef.current.area !== area || appliedSeedRef.current.resetKey !== resetKey) {
    setTrainingMode(true, buildSeed(area));
    appliedSeedRef.current = { area, resetKey };
  }

  // Desliga o Modo Treinamento quando o coordenador sai da tela — a partir
  // daí getLines/getAllOPs/startOP/etc. voltam a operar normalmente sobre
  // os dados reais da fábrica.
  useEffect(() => {
    return () => setTrainingMode(false);
  }, []);

  const handleReset = () => setResetKey(k => k + 1);

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-[#09090b]">
      {/* Banner fixo de Modo Treinamento */}
      <div className="bg-amber-950/40 border-b border-amber-800/40 px-4 py-2.5 flex flex-wrap items-center gap-3 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <GraduationCap className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-xs font-bold text-amber-300">
            MODO TREINAMENTO
            <span className="font-medium text-amber-400/80 ml-1.5">
              — tela idêntica à de produção, com OPs de teste. Nenhum dado real é afetado.
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {AREA_TABS.map(({ id, label, icon: Icon, color }) => (
            <button
              key={id}
              onClick={() => setArea(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                area === id ? `${color} text-white shadow` : 'bg-[#1e1e28]/60 text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          <button
            onClick={handleReset}
            title="Recria as OPs de teste do zero, descartando qualquer clique feito na simulação"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#1e1e28]/60 text-[#a1a1aa] hover:text-white transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reiniciar
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {area === 'pesagem' && (
          <div key={`pesagem-${resetKey}`} className="h-full">
            <PesagemScreen embedded hideDashboardTabs />
          </div>
        )}
        {area === 'manipulacao' && (
          <div key={`manipulacao-${resetKey}`} className="h-full">
            <ManipulacaoScreen embedded hideDashboardTabs />
          </div>
        )}
        {area === 'envase' && (
          <div key={`envase-${resetKey}`} className="h-full">
            <LeaderScreen embedded hideDashboardTabs />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[10px] text-[#52525b] px-4 py-2 border-t border-[#1e1e24] shrink-0">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>Visível somente para Coordenador Geral — os líderes não têm acesso a esta tela.</span>
      </div>
    </div>
  );
}
