import React, { useState, useEffect } from 'react';
import { Target, Check, X, Loader2, CalendarClock, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { ProductionLine, LineDailyGoal, FactoryMonthlyGoal } from '../types';
import { saveLineDailyGoal, saveFactoryMonthlyGoal } from '../services/db';

interface GoalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  factoryMonthlyGoal: number | null;
  /** Metas mensais da fábrica de TODOS os meses do ano corrente — permite
   * editar a meta de qualquer mês, não só o atual. */
  factoryMonthlyGoals: FactoryMonthlyGoal[];
  lineDailyGoals: LineDailyGoal[];
  /** Chamado depois de salvar uma meta mensal, pra quem estiver segurando o
   * estado (CoordinatorDashboard) recarregar os dados e refletir na hora. */
  onGoalsSaved?: () => void;
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * Modal de edição das metas fixas de produção:
 * - Meta MENSAL ÚNICA da fábrica (não por linha) — ex: 450.000 un no mês.
 * - Meta DIÁRIA fixa por linha — ex: linha1 18.000, linha2 18.000, sleeve 10.000.
 * Ambas ficam valendo até serem reeditadas aqui. Só aparece na barra lateral
 * para o Coordenador Geral (ver Sidebar.tsx), já que só ele tem permissão de
 * escrita nessas tabelas via RLS.
 */
export function GoalsModal({ isOpen, onClose, lines, factoryMonthlyGoal, factoryMonthlyGoals = [], lineDailyGoals, onGoalsSaved }: GoalsModalProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Mês que está sendo editado no momento, dentro do ano corrente — começa
  // no mês atual, mas o usuário pode navegar pra qualquer outro mês do ano
  // pra definir a meta dele especificamente (antes só dava pra editar o mês
  // atual).
  const selectedYear = currentYear;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const [monthlyInput, setMonthlyInput] = useState('0');
  const [dailyInputs, setDailyInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlashId, setSavedFlashId] = useState<string | null>(null);

  // Preenche os campos com os valores atuais só quando o modal abre, ou
  // quando o usuário troca de mês/ano — assim não perdemos o que ele está
  // digitando se um refresh (realtime ou polling) acontecer com o modal já
  // aberto.
  useEffect(() => {
    if (!isOpen) return;
    const isCurrentMonth = selectedYear === currentYear && selectedMonth === currentMonth;
    const existing = factoryMonthlyGoals.find((g) => g.year === selectedYear && g.month === selectedMonth);
    const fallback = isCurrentMonth ? factoryMonthlyGoal : null;
    setMonthlyInput(String(existing?.goalQuantity ?? fallback ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedYear, selectedMonth]);

  // Metas diárias por linha não são por mês — só precisam recarregar quando
  // o modal abre.
  useEffect(() => {
    if (!isOpen) return;
    const dMap: Record<string, string> = {};
    lines.forEach((line) => {
      const d = lineDailyGoals.find((dg) => dg.lineId === line.id);
      dMap[line.id] = String(d?.goalQuantity ?? 0);
    });
    setDailyInputs(dMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const flashSaved = (id: string) => {
    setSavedFlashId(id);
    setTimeout(() => setSavedFlashId((prev) => (prev === id ? null : prev)), 2000);
  };

  // Navegação fica dentro do ano corrente — é o período pro qual
  // `factoryMonthlyGoals` foi carregado e que o gráfico "Produção Mensal"
  // exibe; sair do ano atual mostraria valores desatualizados ou vazios.
  const canGoPrev = !(selectedYear === currentYear && selectedMonth === 1);
  const canGoNext = !(selectedYear === currentYear && selectedMonth === 12);

  const goToPrevMonth = () => {
    if (!canGoPrev) return;
    setSelectedMonth((m) => (m === 1 ? 12 : m - 1));
  };

  const goToNextMonth = () => {
    if (!canGoNext) return;
    setSelectedMonth((m) => (m === 12 ? 1 : m + 1));
  };

  const handleSaveMonthly = async () => {
    const val = parseInt(monthlyInput, 10);
    if (isNaN(val) || val < 0) return;
    setSavingId('monthly');
    const ok = await saveFactoryMonthlyGoal(selectedYear, selectedMonth, val);
    setSavingId(null);
    if (ok) {
      flashSaved('monthly');
      onGoalsSaved?.();
    }
  };

  const handleSaveDaily = async (lineId: string) => {
    const val = parseInt(dailyInputs[lineId] ?? '', 10);
    if (isNaN(val) || val < 0) return;
    const key = `d-${lineId}`;
    setSavingId(key);
    const ok = await saveLineDailyGoal(lineId, val);
    setSavingId(null);
    if (ok) flashSaved(key);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#121216] border border-[#272732] rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="p-5 border-b border-[#20202a] flex items-center justify-between bg-gradient-to-r from-blue-950/40 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#f4f4f5]">Metas de Produção</h3>
              <p className="text-xs text-[#71717a] mt-0.5">
                Metas fixas — ficam valendo até você atualizá-las aqui
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#71717a] hover:text-white hover:bg-[#1e1e28] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-5 space-y-6 overflow-y-auto">
          {/* ---------------- META MENSAL ÚNICA DA FÁBRICA ---------------- */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-400" />
              <h4 className="text-xs font-bold text-[#f4f4f5] uppercase tracking-wide">
                Meta Mensal da Fábrica
              </h4>
            </div>
            <p className="text-[11px] text-[#71717a] -mt-1.5">
              Um total para a fábrica inteira em cada mês (ex: 450.000 un). Cada mês tem a sua própria meta —
              navegue pelos meses abaixo pra definir a de qualquer um deles, inclusive meses futuros.
            </p>

            {/* Navegador de mês/ano — antes só dava pra editar o mês atual */}
            <div className="flex items-center justify-between bg-[#13131a] border border-[#232330] rounded-xl px-2 py-1.5">
              <button
                type="button"
                onClick={goToPrevMonth}
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#1e1e28] transition-colors"
                title="Mês anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold text-[#f4f4f5]">
                {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}
                {selectedYear === currentYear && selectedMonth === currentMonth && (
                  <span className="ml-1.5 text-[9px] font-semibold text-blue-400 uppercase">atual</span>
                )}
              </span>
              <button
                type="button"
                onClick={goToNextMonth}
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#1e1e28] transition-colors"
                title="Próximo mês"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 bg-[#171720] border border-[#232330] rounded-xl px-3 py-2.5">
              <span className="text-xs font-semibold text-[#f4f4f5] flex-1">
                Meta de {MONTH_NAMES[selectedMonth - 1]}
              </span>
              <input
                type="number"
                min={0}
                value={monthlyInput}
                onChange={(e) => setMonthlyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveMonthly();
                }}
                className="w-36 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 py-1.5 text-sm font-bold text-white focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-[#71717a]">un</span>
              <button
                type="button"
                onClick={handleSaveMonthly}
                disabled={savingId === 'monthly'}
                title="Salvar meta mensal da fábrica"
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                  savedFlashId === 'monthly'
                    ? 'bg-emerald-500/30 text-emerald-400'
                    : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                }`}
              >
                {savingId === 'monthly' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* ---------------- META DIÁRIA POR LINHA ---------------- */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-bold text-[#f4f4f5] uppercase tracking-wide">
                Meta Diária por Linha
              </h4>
            </div>
            <p className="text-[11px] text-[#71717a] -mt-1.5">
              Quantidade/dia esperada de cada linha (ex: Envase 1: 18.000, Envase 2: 18.000, Sleev: 10.000). Fica fixa até você atualizar.
            </p>

            <div className="space-y-2">
              {lines.length === 0 && (
                <p className="text-xs text-[#71717a]">Nenhuma linha cadastrada ainda.</p>
              )}
              {lines.map((line) => {
                const key = `d-${line.id}`;
                return (
                  <div
                    key={line.id}
                    className="flex items-center gap-2 bg-[#171720] border border-[#232330] rounded-xl px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-[#f4f4f5] flex-1 truncate">{line.name}</span>
                    <input
                      type="number"
                      min={0}
                      value={dailyInputs[line.id] ?? '0'}
                      onChange={(e) =>
                        setDailyInputs((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveDaily(line.id);
                      }}
                      className="w-28 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveDaily(line.id)}
                      disabled={savingId === key}
                      title="Salvar meta diária desta linha"
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                        savedFlashId === key
                          ? 'bg-emerald-500/30 text-emerald-400'
                          : 'bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30'
                      }`}
                    >
                      {savingId === key ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="p-4 border-t border-[#20202a] flex items-center justify-end bg-[#0e0e12]">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border-[#2a2a38] text-[#a1a1aa] hover:text-white hover:bg-[#1c1c24] text-xs font-semibold"
          >
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
