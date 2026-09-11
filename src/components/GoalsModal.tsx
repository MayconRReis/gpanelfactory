import React, { useState, useEffect } from 'react';
import { Target, Check, X, Loader2, CalendarClock, CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { ProductionLine, LineDailyGoal } from '../types';
import { saveLineDailyGoal, saveFactoryMonthlyGoal } from '../services/db';

interface GoalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  factoryMonthlyGoal: number | null;
  lineDailyGoals: LineDailyGoal[];
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
export function GoalsModal({ isOpen, onClose, lines, factoryMonthlyGoal, lineDailyGoals }: GoalsModalProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [monthlyInput, setMonthlyInput] = useState('0');
  const [dailyInputs, setDailyInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlashId, setSavedFlashId] = useState<string | null>(null);

  // Preenche os campos com os valores atuais só quando o modal abre — assim
  // não perdemos o que o usuário está digitando se um refresh (realtime ou
  // polling) acontecer com o modal já aberto.
  useEffect(() => {
    if (!isOpen) return;
    setMonthlyInput(String(factoryMonthlyGoal ?? 0));
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

  const handleSaveMonthly = async () => {
    const val = parseInt(monthlyInput, 10);
    if (isNaN(val) || val < 0) return;
    setSavingId('monthly');
    const ok = await saveFactoryMonthlyGoal(currentYear, currentMonth, val);
    setSavingId(null);
    if (ok) flashSaved('monthly');
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
                Meta Mensal da Fábrica • {MONTH_NAMES[currentMonth - 1]}/{currentYear}
              </h4>
            </div>
            <p className="text-[11px] text-[#71717a] -mt-1.5">
              Um único total para a fábrica inteira no mês (ex: 450.000 un). Fica fixo até você editar.
            </p>

            <div className="flex items-center gap-2 bg-[#171720] border border-[#232330] rounded-xl px-3 py-2.5">
              <span className="text-xs font-semibold text-[#f4f4f5] flex-1">Meta do mês</span>
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
              Quantidade/dia esperada de cada linha (ex: linha1 18.000, linha2 18.000, sleeve 10.000). Fica fixa até você atualizar.
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
