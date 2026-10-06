import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, X, Plus, Trash2, Loader2, Download, Search, Users, CalendarDays, Lock } from 'lucide-react';
import { StaffOccurrence, StaffOccurrenceType, ProductionLine, UserProfile } from '../types';
import { getStaffOccurrenceAreas, getUserRule, isAdminRule } from '../lib/permissions';
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
 * acidentes/incidentes, hora extra e retorno (de quem saiu antes e voltou), com nome, horário e motivo.
 * - <StaffOccurrencesButton/>: botão + janela que o líder usa na tela da linha/setor.
 * - <StaffOccurrencesSummary/>: resumo + lista (Histórico & Gráficos).
 */

// Tipos do formulário/filtros. "Free do balde" foi descontinuado (os
// lançamentos antigos continuam aparecendo na lista).
export const STAFF_TYPES: StaffOccurrenceType[] = [
  'falta', 'atraso', 'atestado', 'saida_antecipada', 'retorno', 'acidente', 'incidente', 'hora_extra',
];

/** Tipos que pedem o horário em que aconteceu */
const TIMED_TYPES: StaffOccurrenceType[] = ['saida_antecipada', 'retorno'];
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TYPE_STYLE: Record<StaffOccurrenceType, string> = {
  falta: 'bg-rose-950/60 text-rose-300 border-rose-800/50',
  atraso: 'bg-amber-950/60 text-amber-300 border-amber-800/50',
  atestado: 'bg-sky-950/60 text-sky-300 border-sky-800/50',
  saida_antecipada: 'bg-orange-950/60 text-orange-300 border-orange-800/50',
  acidente: 'bg-red-900/60 text-red-200 border-red-600/60',
  incidente: 'bg-yellow-950/60 text-yellow-300 border-yellow-800/50',
  hora_extra: 'bg-violet-950/60 text-violet-300 border-violet-800/50',
  retorno: 'bg-teal-950/60 text-teal-300 border-teal-800/50',
  free_balde: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50',
};

const REASON_PLACEHOLDER: Record<StaffOccurrenceType, string> = {
  falta: 'Ex.: não avisou / problema familiar',
  atraso: 'Ex.: chegou 07:40 — ônibus',
  atestado: 'Ex.: atestado de 2 dias',
  saida_antecipada: 'Ex.: consulta médica',
  acidente: 'O que aconteceu, onde e se houve afastamento',
  incidente: 'O que aconteceu (quase acidente, derramamento etc.)',
  hora_extra: 'Ex.: das 17:00 às 19:00',
  retorno: 'Ex.: voltou da consulta',
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

// ---------------------------------------------------------------------------
// TELA DEDICADA — "Ocorrências de Pessoal" (menu lateral, todos têm acesso)
// Todos VEEM tudo; cada um só LANÇA na sua área (ADM/Diretor em qualquer uma).
// ---------------------------------------------------------------------------

const isReactorLike = (l: ProductionLine) => /reator|pesagem|manipula/i.test(l.id) || /reator/i.test(l.name);

type Period = 'hoje' | 'ontem' | 'semana' | 'mes' | 'personalizado';

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function periodRange(period: Period, today: string, customFrom: string, customTo: string): [string, string] {
  if (period === 'hoje') return [today, today];
  if (period === 'ontem') { const y = addDays(today, -1); return [y, y]; }
  if (period === 'semana') {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0 = domingo
    return [addDays(today, -((dow + 6) % 7)), today]; // segunda → hoje
  }
  if (period === 'mes') return [today.slice(0, 8) + '01', today];
  const from = customFrom || today;
  const to = customTo || today;
  return from <= to ? [from, to] : [to, from];
}

const fmtDate = (d: string) => d.split('-').reverse().join('/');

interface PageProps {
  lines: ProductionLine[];
  profile: UserProfile | null;
}

export function StaffOccurrencesPage({ lines, profile }: PageProps) {
  const today = toLocalDateStr(new Date().toISOString());
  const areas = getStaffOccurrenceAreas(profile);
  const isAdmin = isAdminRule(getUserRule(profile));

  // Todas as linhas/setores possíveis (para nome e filtro)
  const allTargets = useMemo(() => {
    const envase = lines.filter(l => !isReactorLike(l)).map(l => ({ id: l.id, name: l.name, group: 'Envase' }));
    return [
      ...envase,
      { id: 'setor-pesagem', name: 'Pesagem', group: 'Setores' },
      { id: 'setor-manipulacao', name: 'Manipulação', group: 'Setores' },
    ];
  }, [lines]);

  // Onde ESTE usuário pode lançar
  const myTargets = useMemo(() => allTargets.filter(t => {
    if (areas.all) return true;
    if (t.id === 'setor-pesagem') return areas.pesagem;
    if (t.id === 'setor-manipulacao') return areas.manipulacao;
    return areas.envase;
  }), [allTargets, areas.all, areas.envase, areas.pesagem, areas.manipulacao]);

  const targetName = useCallback((id: string) => allTargets.find(t => t.id === id)?.name || SECTOR_NAMES[id] || id, [allTargets]);

  // ---------- Período e filtros ----------
  const [period, setPeriod] = useState<Period>('hoje');
  const [customFrom, setCustomFrom] = useState(today.slice(0, 8) + '01');
  const [customTo, setCustomTo] = useState(today);
  const [fLine, setFLine] = useState('all');
  const [fType, setFType] = useState<'all' | StaffOccurrenceType>('all');
  const [fName, setFName] = useState('');
  const [rangeStart, rangeEnd] = periodRange(period, today, customFrom, customTo);

  // ---------- Dados ----------
  const [list, setList] = useState<StaffOccurrence[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStaffOccurrences(rangeStart, rangeEnd).then(res => {
      if (cancelled) return;
      setLoading(false);
      setLoadError(res.error ? (/staff_occurrences|does not exist|relation/i.test(res.error)
        ? 'A tabela de ocorrências ainda não existe — rode sql/add_staff_occurrences.sql no Supabase.'
        : res.error) : null);
      setList(res.list);
    });
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd, reloadKey]);

  // nomes já usados nos últimos 3 meses (sugestão ao digitar)
  useEffect(() => {
    const d = new Date();
    const from = toLocalDateStr(new Date(d.getFullYear(), d.getMonth() - 3, 1).toISOString());
    getStaffOccurrences(from, today).then(res => {
      setNames(Array.from(new Set(res.list.map(o => o.employeeName.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')));
    });
  }, [today, reloadKey]);

  // ---------- Formulário ----------
  const [fDate, setFDate] = useState(today);
  const [fTarget, setFTarget] = useState('');
  const [type, setType] = useState<StaffOccurrenceType>('falta');
  const [employeeName, setEmployeeName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [occTime, setOccTime] = useState(nowHHMM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const isTimed = TIMED_TYPES.includes(type);

  // Ao trocar para saída/retorno, sugere o horário de agora
  useEffect(() => { if (TIMED_TYPES.includes(type)) setOccTime(nowHHMM()); }, [type]);

  // Quem saiu antes nesse dia (e área) e ainda não teve retorno lançado —
  // atalho para o líder registrar o retorno com um clique no nome.
  const [dayList, setDayList] = useState<StaffOccurrence[]>([]);
  useEffect(() => {
    let cancelled = false;
    getStaffOccurrences(fDate, fDate).then(res => { if (!cancelled) setDayList(res.list); });
    return () => { cancelled = true; };
  }, [fDate, reloadKey]);
  const pendingReturns = useMemo(() => {
    const key = (o: StaffOccurrence) => `${o.lineId}|${o.employeeName.trim().toLowerCase()}`;
    const exits = dayList.filter(o => o.type === 'saida_antecipada' && o.employeeName.trim() && (!fTarget || o.lineId === fTarget));
    const returnsCount = new Map<string, number>();
    dayList.filter(o => o.type === 'retorno').forEach(o => returnsCount.set(key(o), (returnsCount.get(key(o)) || 0) + 1));
    const out: StaffOccurrence[] = [];
    const used = new Map<string, number>();
    exits.sort((a, b) => (a.occurredTime || a.createdAt).localeCompare(b.occurredTime || b.createdAt)).forEach(o => {
      const k = key(o);
      const u = used.get(k) || 0;
      if (u < (returnsCount.get(k) || 0)) { used.set(k, u + 1); return; }
      out.push(o);
    });
    return out;
  }, [dayList, fTarget]);

  useEffect(() => {
    if (!myTargets.some(t => t.id === fTarget)) setFTarget(myTargets.length === 1 ? myTargets[0].id : '');
  }, [myTargets, fTarget]);

  const needsName = type !== 'free_balde';
  const canSubmit = !!fTarget && (!needsName || !!employeeName.trim()) && !!fDate && fDate <= today && (!isTimed || /^\d{2}:\d{2}$/.test(occTime));

  const handleAdd = async () => {
    setFormError(null); setFormOk(null);
    if (!myTargets.some(t => t.id === fTarget)) { setFormError('Você só pode lançar ocorrências na sua área.'); return; }
    setSaving(true);
    const res = await addStaffOccurrence(
      { date: fDate, lineId: fTarget, type, employeeName, quantity: 1, reason, occurredTime: isTimed ? occTime : null },
      profile?.uid || null
    );
    setSaving(false);
    if (!res.ok) { setFormError(res.error || 'Não foi possível registrar.'); return; }
    setFormOk(`Registrado: ${STAFF_OCCURRENCE_LABELS[type]}${employeeName.trim() ? ` — ${employeeName.trim()}` : ''} (${targetName(fTarget)}, ${fmtDate(fDate)}${isTimed ? ` às ${occTime}` : ''}).`);
    setEmployeeName(''); setReason(''); setQuantity('1');
    // se lançou fora do período em tela, mostra o dia lançado
    if (fDate < rangeStart || fDate > rangeEnd) {
      if (fDate === today) setPeriod('hoje');
      else { setPeriod('personalizado'); setCustomFrom(fDate); setCustomTo(fDate); }
    }
    setReloadKey(k => k + 1);
  };

  const canDelete = (o: StaffOccurrence) => isAdmin || (!!profile?.uid && o.createdBy === profile.uid);

  const handleDelete = async (o: StaffOccurrence) => {
    if (!canDelete(o)) return;
    if (!window.confirm(`Excluir ${STAFF_OCCURRENCE_LABELS[o.type].toLowerCase()} de ${o.employeeName || '—'} (${fmtDate(o.date)})?`)) return;
    const res = await deleteStaffOccurrence(o.id);
    if (!res.ok) { setLoadError(res.error || 'Não foi possível excluir.'); return; }
    setReloadKey(k => k + 1);
  };

  // ---------- Lista filtrada, totais e ranking ----------
  const filtered = useMemo(() => {
    const q = fName.trim().toLowerCase();
    return list
      .filter(o => fLine === 'all' || o.lineId === fLine)
      .filter(o => fType === 'all' || o.type === fType)
      .filter(o => !q || o.employeeName.toLowerCase().includes(q) || o.reason.toLowerCase().includes(q))
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  }, [list, fLine, fType, fName]);

  const totals = useMemo(() => sumStaffOccurrences(filtered), [filtered]);

  const ranking = useMemo(() => {
    const map = new Map<string, { name: string; total: number; byType: Partial<Record<StaffOccurrenceType, number>>; lines: Set<string> }>();
    for (const o of filtered) {
      const name = o.employeeName.trim();
      if (!name || o.type === 'free_balde' || o.type === 'hora_extra' || o.type === 'retorno') continue;
      const key = name.toLowerCase();
      const row = map.get(key) || { name, total: 0, byType: {}, lines: new Set<string>() };
      row.total += 1;
      row.byType[o.type] = (row.byType[o.type] || 0) + 1;
      row.lines.add(o.lineId);
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 10);
  }, [filtered]);

  const periodLabel = rangeStart === rangeEnd ? fmtDate(rangeStart) : `${fmtDate(rangeStart)} a ${fmtDate(rangeEnd)}`;

  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Data', 'Hora do lançamento', 'Horário (saída/retorno)', 'Linha / setor', 'Tipo', 'Colaborador', 'Quantidade', 'Motivo / detalhe'].map(esc).join(';'),
      ...filtered.map(o => [
        fmtDate(o.date),
        new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        o.occurredTime || '',
        targetName(o.lineId),
        STAFF_OCCURRENCE_LABELS[o.type],
        o.employeeName,
        String(o.quantity),
        o.reason,
      ].map(esc).join(';')),
    ];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocorrencias_${rangeStart}_${rangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const input = 'w-full h-10 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-3 text-xs text-[#f4f4f5] focus:outline-none focus:border-blue-500';
  const chip = (active: boolean) => `h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`;
  const groups = Array.from(new Set(myTargets.map(t => t.group)));

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#111116] border border-[#202028] p-4 rounded-2xl">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-400" /> Ocorrências de Pessoal
          </h2>
          <p className="text-xs text-[#71717a] mt-0.5">
            Faltas, atrasos, atestados, saídas antecipadas e retornos, acidentes/incidentes e hora extra.
            {!areas.all && myTargets.length > 0 && <> Você lança em: <span className="text-[#d4d4d8] font-semibold">{areas.envase && areas.pesagem === false && areas.manipulacao === false ? 'linhas de envase' : myTargets.map(t => t.name).join(', ')}</span>.</>}
          </p>
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="h-9 px-3 rounded-lg bg-[#171720] hover:bg-[#20202c] border border-[#2b2b38] text-[11px] font-bold text-[#f4f4f5] flex items-center gap-1.5 disabled:opacity-40 self-start md:self-auto">
          <Download className="w-3.5 h-3.5 text-emerald-400" /> Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4">
        {/* ---------- Formulário ---------- */}
        <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3 h-fit">
          <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-400" /> Nova ocorrência
          </h3>

          {myTargets.length === 0 ? (
            <p className="text-[11px] text-[#a1a1aa] bg-[#16161e] border border-[#26262f] rounded-lg px-3 py-3 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#71717a]" />
              Seu perfil só pode visualizar. Os lançamentos são feitos pelos líderes de cada área.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Data</label>
                  <input type="date" value={fDate} max={today} onChange={e => setFDate(e.target.value)} className={input + ' mt-1 [color-scheme:dark]'} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Linha / setor</label>
                  <select value={fTarget} onChange={e => setFTarget(e.target.value)} className={input + ' mt-1'}>
                    {myTargets.length > 1 && <option value="">Selecione…</option>}
                    {groups.map(g => (
                      <optgroup key={g} label={g}>
                        {myTargets.filter(t => t.group === g).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Tipo</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-1.5 mt-1">
                  {STAFF_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setType(t)}
                      className={`h-9 rounded-lg text-[11px] font-bold border transition-all ${type === t ? TYPE_STYLE[t] + ' ring-1 ring-white/20' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`}>
                      {STAFF_OCCURRENCE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {type === 'retorno' && (
                <div className="bg-[#0f1a19] border border-teal-900/50 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-teal-300">Saíram antes e ainda não voltaram ({fmtDate(fDate)})</p>
                  {pendingReturns.length === 0 ? (
                    <p className="text-[11px] text-[#71717a]">Nenhuma saída antecipada pendente{fTarget ? ' nesta área' : ''}. Você pode digitar o nome abaixo.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingReturns.map(o => (
                        <button key={o.id} type="button" onClick={() => setEmployeeName(o.employeeName)}
                          className={`h-7 px-2 rounded-md text-[11px] font-semibold border transition-all ${employeeName.trim().toLowerCase() === o.employeeName.trim().toLowerCase() ? 'bg-teal-600 border-teal-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#d4d4d8] hover:text-white'}`}
                          title={o.reason || undefined}>
                          {o.employeeName}{o.occurredTime ? <span className="opacity-70 font-mono"> · saiu {o.occurredTime}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className={`grid gap-2 ${isTimed ? 'grid-cols-[1fr_100px]' : 'grid-cols-1'}`}>
                <div>
                  <input list="staff-names-page" value={employeeName} onChange={e => setEmployeeName(e.target.value)}
                    placeholder={needsName ? 'Nome do colaborador *' : 'Nome (opcional)'} className={input} />
                  <datalist id="staff-names-page">{names.map(n => <option key={n} value={n} />)}</datalist>
                </div>
                {isTimed && (
                  <input type="time" value={occTime} onChange={e => setOccTime(e.target.value)}
                    title={type === 'retorno' ? 'Horário em que voltou' : 'Horário em que saiu'}
                    className={input + ' [color-scheme:dark] font-mono'} />
                )}
              </div>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder={`Motivo / detalhe — ${REASON_PLACEHOLDER[type]}`} className={input} />

              <button type="button" onClick={handleAdd} disabled={saving || !canSubmit}
                className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Registrar {STAFF_OCCURRENCE_LABELS[type].toLowerCase()}
              </button>
              {formError && <p className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">{formError}</p>}
              {formOk && <p className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2">{formOk}</p>}
            </>
          )}
        </div>

        {/* ---------- Consulta ---------- */}
        <div className="space-y-4 min-w-0">
          {/* Filtros */}
          <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-[#71717a] mr-1" />
              {([['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', 'Semana'], ['mes', 'Mês'], ['personalizado', 'Período']] as [Period, string][]).map(([p, label]) => (
                <button key={p} onClick={() => setPeriod(p)} className={chip(period === p)}>{label}</button>
              ))}
              {period === 'personalizado' && (
                <div className="flex items-center gap-1.5">
                  <input type="date" value={customFrom} max={today} onChange={e => setCustomFrom(e.target.value)} className="h-8 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-[11px] text-white [color-scheme:dark]" />
                  <span className="text-[11px] text-[#71717a]">a</span>
                  <input type="date" value={customTo} max={today} onChange={e => setCustomTo(e.target.value)} className="h-8 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-[11px] text-white [color-scheme:dark]" />
                </div>
              )}
              <span className="ml-auto bg-[#1a1a22] text-[#d4d4d8] border border-[#2c2c3c] px-2 py-0.5 rounded text-[10px] font-bold font-mono">{periodLabel}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select value={fLine} onChange={e => setFLine(e.target.value)} className={input}>
                <option value="all">Todas as linhas e setores</option>
                {allTargets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={fType} onChange={e => setFType(e.target.value as any)} className={input}>
                <option value="all">Todos os tipos</option>
                {STAFF_TYPES.map(t => <option key={t} value={t}>{STAFF_OCCURRENCE_LABELS[t]}</option>)}
              </select>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#52525b] absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="Buscar colaborador ou motivo" className={input + ' pl-8'} />
              </div>
            </div>
          </div>

          {/* Totais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-8 gap-2">
            {STAFF_TYPES.map(t => (
              <button key={t} onClick={() => setFType(fType === t ? 'all' : t)}
                className={`text-left rounded-xl border px-3 py-2 transition-all ${TYPE_STYLE[t]} ${fType === t ? 'ring-1 ring-white/30' : fType !== 'all' ? 'opacity-50' : ''}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">{STAFF_OCCURRENCE_LABELS[t]}</p>
                <p className="text-xl font-black font-mono">{totals[t]}</p>
              </button>
            ))}
          </div>

          {loadError && <p className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">{loadError}</p>}

          <div className="grid grid-cols-1 2xl:grid-cols-[1fr_300px] gap-4">
            {/* Lista */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 min-w-0">
              <h3 className="text-xs font-black text-white uppercase tracking-wider mb-3">Lançamentos ({filtered.length})</h3>
              {loading ? (
                <p className="text-[11px] text-[#71717a] text-center py-6">Carregando…</p>
              ) : filtered.length === 0 ? (
                <p className="text-[11px] text-[#52525b] text-center py-6">Nenhuma ocorrência no período / filtro.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[#71717a] uppercase tracking-wider text-[9px]">
                        <th className="py-1.5 pr-3 font-bold">Data</th>
                        <th className="py-1.5 pr-3 font-bold">Linha / setor</th>
                        <th className="py-1.5 pr-3 font-bold">Tipo</th>
                        <th className="py-1.5 pr-3 font-bold">Colaborador</th>
                        <th className="py-1.5 pr-3 font-bold">Motivo / detalhe</th>
                        <th className="py-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#22222b]">
                      {filtered.map(o => (
                        <tr key={o.id} className="text-[#d4d4d8] align-top">
                          <td className="py-2 pr-3 font-mono whitespace-nowrap">
                            {fmtDate(o.date)}
                            {o.occurredTime
                              ? <span className="block text-[10px] text-teal-300 font-bold">às {o.occurredTime}</span>
                              : <span className="block text-[9px] text-[#52525b]">{new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{targetName(o.lineId)}</td>
                          <td className="py-2 pr-3"><StaffTypeBadge type={o.type} /></td>
                          <td className="py-2 pr-3 text-white">
                            {o.employeeName || '—'}{o.type === 'free_balde' && o.quantity > 1 ? ` · ${o.quantity} pessoas` : ''}
                          </td>
                          <td className="py-2 pr-3 text-[#a1a1aa]">{o.reason || '—'}</td>
                          <td className="py-2">
                            {canDelete(o) && (
                              <button onClick={() => handleDelete(o)} title="Excluir (lançado por engano)"
                                className="p-1 rounded text-[#52525b] hover:text-rose-400 hover:bg-rose-950/40">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Ranking por colaborador */}
            <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 h-fit">
              <h3 className="text-xs font-black text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" /> Mais ocorrências
              </h3>
              <p className="text-[10px] text-[#52525b] mb-3">Faltas, atrasos, atestados, saídas e acidentes/incidentes no período</p>
              {ranking.length === 0 ? (
                <p className="text-[11px] text-[#52525b] text-center py-4">Sem registros</p>
              ) : (
                <div className="space-y-2">
                  {ranking.map((r, i) => (
                    <button key={r.name} onClick={() => setFName(r.name)} className="w-full text-left bg-[#16161e] hover:bg-[#1c1c26] border border-[#24242e] rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-white font-semibold truncate"><span className="text-[#52525b] font-mono mr-1.5">{i + 1}.</span>{r.name}</span>
                        <span className="text-sm font-black font-mono text-amber-300">{r.total}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {STAFF_TYPES.filter(t => r.byType[t]).map(t => (
                          <span key={t} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${TYPE_STYLE[t]}`}>{STAFF_OCCURRENCE_LABELS[t]}: {r.byType[t]}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
