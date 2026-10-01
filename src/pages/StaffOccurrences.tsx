import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, X, Plus, Trash2, Loader2 } from 'lucide-react';
import { StaffOccurrence, StaffOccurrenceType, ProductionLine } from '../types';
import {
  getStaffOccurrences,
  addStaffOccurrence,
  deleteStaffOccurrence,
  sumStaffOccurrences,
  STAFF_OCCURRENCE_LABELS,
  toLocalDateStr,
} from '../services/db';

/**
 * OCORRÊNCIAS DE PESSOAL — faltas, atrasos, atestados, saídas antecipadas,
 * acidentes/incidentes, hora extra e free do balde, com nome e motivo.
 * - <StaffOccurrencesButton/>: botão + janela que o líder usa na tela da linha/setor.
 * - <StaffOccurrencesSummary/>: resumo + lista (Histórico & Gráficos).
 */

export const STAFF_TYPES: StaffOccurrenceType[] = [
  'falta', 'atraso', 'atestado', 'saida_antecipada', 'acidente', 'incidente', 'hora_extra', 'free_balde',
];

const TYPE_STYLE: Record<StaffOccurrenceType, string> = {
  falta: 'bg-rose-950/60 text-rose-300 border-rose-800/50',
  atraso: 'bg-amber-950/60 text-amber-300 border-amber-800/50',
  atestado: 'bg-sky-950/60 text-sky-300 border-sky-800/50',
  saida_antecipada: 'bg-orange-950/60 text-orange-300 border-orange-800/50',
  acidente: 'bg-red-900/60 text-red-200 border-red-600/60',
  incidente: 'bg-yellow-950/60 text-yellow-300 border-yellow-800/50',
  hora_extra: 'bg-violet-950/60 text-violet-300 border-violet-800/50',
  free_balde: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50',
};

const REASON_PLACEHOLDER: Record<StaffOccurrenceType, string> = {
  falta: 'Ex.: não avisou / problema familiar',
  atraso: 'Ex.: chegou 07:40 — ônibus',
  atestado: 'Ex.: atestado de 2 dias',
  saida_antecipada: 'Ex.: saiu às 15:00 — consulta',
  acidente: 'O que aconteceu, onde e se houve afastamento',
  incidente: 'O que aconteceu (quase acidente, derramamento etc.)',
  hora_extra: 'Ex.: das 17:00 às 19:00',
  free_balde: 'Ex.: lavagem de baldes — 4h',
};

export function StaffTypeBadge({ type }: { type: StaffOccurrenceType }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${TYPE_STYLE[type]}`}>
      {STAFF_OCCURRENCE_LABELS[type]}
    </span>
  );
}

interface ButtonProps {
  lineId: string;
  lineName: string;
  userId?: string | null;
  className?: string;
}

export function StaffOccurrencesButton({ lineId, lineName, userId, className }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<StaffOccurrence[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = toLocalDateStr(new Date().toISOString());
  const [type, setType] = useState<StaffOccurrenceType>('falta');
  const [employeeName, setEmployeeName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const d = new Date();
    const from = toLocalDateStr(new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString());
    const res = await getStaffOccurrences(from, today);
    setLoading(false);
    if (res.error) setError(/staff_occurrences|does not exist|relation/i.test(res.error) ? 'A tabela de ocorrências ainda não existe — peça para a coordenação rodar sql/add_staff_occurrences.sql.' : res.error);
    setList(res.list.filter(o => o.date === today && o.lineId === lineId));
    // nomes já usados (para sugerir enquanto digita)
    setNames(Array.from(new Set(res.list.map(o => o.employeeName).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')));
  }, [lineId, today]);

  useEffect(() => { if (open) load(); }, [open, load]);
  // contador do botão (ocorrências de hoje nesta linha)
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setError(null);
    setSaving(true);
    const res = await addStaffOccurrence(
      { date: today, lineId, type, employeeName, quantity: type === 'free_balde' ? Math.max(1, parseInt(quantity, 10) || 1) : 1, reason },
      userId
    );
    setSaving(false);
    if (!res.ok) { setError(res.error || 'Não foi possível registrar.'); return; }
    setEmployeeName('');
    setReason('');
    setQuantity('1');
    load();
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const res = await deleteStaffOccurrence(id);
    if (!res.ok) { setError(res.error || 'Não foi possível excluir.'); return; }
    load();
  };

  const totals = useMemo(() => sumStaffOccurrences(list), [list]);
  const count = list.length;
  const needsName = type !== 'free_balde';
  const input = 'w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2.5 text-xs text-[#f4f4f5] focus:outline-none focus:border-blue-500';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || 'px-3 py-1.5 rounded-lg bg-[#171720] hover:bg-[#20202c] border border-[#2b2b38] text-[11px] font-bold text-[#f4f4f5] flex items-center gap-1.5'}
        title="Faltas, atrasos, atestados, saídas, acidentes/incidentes, hora extra e free do balde"
      >
        <ClipboardList className="w-3.5 h-3.5 text-blue-400" />
        Ocorrências{count > 0 ? ` (${count})` : ''}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-[#121216] border border-[#222228] w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#1f1f26] flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-blue-400" /> Ocorrências de pessoal
                </h3>
                <p className="text-[11px] text-[#71717a]">{lineName} · hoje {new Date().toLocaleDateString('pt-BR')}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg text-[#71717a] hover:text-white hover:bg-[#1f1f28]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Formulário */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {STAFF_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`h-8 rounded-lg text-[11px] font-bold border transition-all ${
                        type === t ? TYPE_STYLE[t] + ' ring-1 ring-white/20' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'
                      }`}
                    >
                      {STAFF_OCCURRENCE_LABELS[t]}
                    </button>
                  ))}
                </div>
                <div className={`grid gap-2 ${type === 'free_balde' ? 'grid-cols-[1fr_90px]' : 'grid-cols-1'}`}>
                  <div>
                    <input
                      list={`staff-names-${lineId}`}
                      value={employeeName}
                      onChange={e => setEmployeeName(e.target.value)}
                      placeholder={needsName ? 'Nome do colaborador *' : 'Nome (opcional)'}
                      className={input}
                    />
                    <datalist id={`staff-names-${lineId}`}>
                      {names.map(n => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                  {type === 'free_balde' && (
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      placeholder="Qtd."
                      title="Quantidade de free (diaristas) do balde"
                      className={input}
                    />
                  )}
                </div>
                <input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={`Motivo / detalhe — ${REASON_PLACEHOLDER[type]}`}
                  className={input}
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving || (needsName && !employeeName.trim())}
                  className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Registrar {STAFF_OCCURRENCE_LABELS[type].toLowerCase()}
                </button>
                {error && <p className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">{error}</p>}
              </div>

              {/* Lista de hoje */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {STAFF_TYPES.filter(t => totals[t] > 0).map(t => (
                    <span key={t} className={`text-[10px] font-bold px-2 py-0.5 rounded border ${TYPE_STYLE[t]}`}>
                      {STAFF_OCCURRENCE_LABELS[t]}: {totals[t]}
                    </span>
                  ))}
                </div>
                {loading ? (
                  <p className="text-[11px] text-[#71717a] text-center py-4">Carregando…</p>
                ) : list.length === 0 ? (
                  <p className="text-[11px] text-[#52525b] text-center py-4">Nenhuma ocorrência registrada hoje nesta linha.</p>
                ) : (
                  <div className="divide-y divide-[#1f1f26] border border-[#1f1f26] rounded-xl">
                    {list.map(o => (
                      <div key={o.id} className="flex items-start gap-2 px-3 py-2">
                        <StaffTypeBadge type={o.type} />
                        <div className="flex-1 min-w-0 text-xs">
                          <p className="text-white font-semibold truncate">
                            {o.employeeName || '—'}{o.type === 'free_balde' && o.quantity > 1 ? ` · ${o.quantity} pessoas` : ''}
                          </p>
                          {o.reason && <p className="text-[#a1a1aa] text-[11px]">{o.reason}</p>}
                        </div>
                        <span className="text-[10px] text-[#52525b] font-mono shrink-0">
                          {new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(o.id)}
                          className="p-1 rounded text-[#52525b] hover:text-rose-400 hover:bg-rose-950/40 shrink-0"
                          title="Excluir (lançado por engano)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface SummaryProps {
  rangeStart: string;
  rangeEnd: string;
  periodLabel: string;
  lines: ProductionLine[];
  scopeToggle?: React.ReactNode;
}

const SECTOR_NAMES: Record<string, string> = {
  'setor-manipulacao': 'Manipulação',
  'setor-pesagem': 'Pesagem',
};

export function StaffOccurrencesSummary({ rangeStart, rangeEnd, periodLabel, lines, scopeToggle }: SummaryProps) {
  const [list, setList] = useState<StaffOccurrence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStaffOccurrences(rangeStart, rangeEnd).then(res => {
      if (cancelled) return;
      setLoading(false);
      setError(res.error);
      setList(res.list);
    });
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  const lineName = (id: string) => SECTOR_NAMES[id] || lines.find(l => l.id === id)?.name || id;
  const totals = useMemo(() => sumStaffOccurrences(list), [list]);
  const sorted = useMemo(() => [...list].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)), [list]);

  return (
    <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {scopeToggle}
          <ClipboardList className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">Ocorrências de pessoal</h3>
          <span className="bg-[#1a1a22] text-[#d4d4d8] border border-[#2c2c3c] px-1.5 py-0.5 rounded text-[9px] font-bold font-mono">{periodLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {STAFF_TYPES.map(t => (
          <div key={t} className={`rounded-xl border px-3 py-2 ${TYPE_STYLE[t]}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">{STAFF_OCCURRENCE_LABELS[t]}</p>
            <p className="text-xl font-black font-mono">{totals[t]}</p>
          </div>
        ))}
      </div>

      {error ? (
        <p className="text-[11px] text-rose-300">Não foi possível ler as ocorrências ({error}). Se for a primeira vez, rode sql/add_staff_occurrences.sql no Supabase.</p>
      ) : loading ? (
        <p className="text-[11px] text-[#71717a] text-center py-4">Carregando…</p>
      ) : sorted.length === 0 ? (
        <p className="text-[11px] text-[#52525b] text-center py-4">Nenhuma ocorrência registrada no período</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[#71717a] uppercase tracking-wider text-[9px]">
                <th className="py-1.5 pr-3 font-bold">Data</th>
                <th className="py-1.5 pr-3 font-bold">Linha / setor</th>
                <th className="py-1.5 pr-3 font-bold">Tipo</th>
                <th className="py-1.5 pr-3 font-bold">Colaborador</th>
                <th className="py-1.5 font-bold">Motivo / detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22222b]">
              {sorted.map(o => (
                <tr key={o.id} className="text-[#d4d4d8]">
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">{o.date.split('-').reverse().join('/')}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{lineName(o.lineId)}</td>
                  <td className="py-2 pr-3"><StaffTypeBadge type={o.type} /></td>
                  <td className="py-2 pr-3 text-white">
                    {o.employeeName || '—'}{o.type === 'free_balde' && o.quantity > 1 ? ` · ${o.quantity} pessoas` : ''}
                  </td>
                  <td className="py-2 text-[#a1a1aa]">{o.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
