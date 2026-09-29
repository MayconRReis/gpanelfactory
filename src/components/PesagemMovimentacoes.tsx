import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  RefreshCw,
  Search,
  LogIn,
  LogOut,
  Pencil,
  Trash2,
  FlaskConical,
  Undo2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getPesagemHistory } from '../services/db';
import { PesagemHistoryEntry, PesagemHistoryAction } from '../types';

/**
 * MOVIMENTAÇÕES DA PESAGEM (só Coordenação)
 * Histórico de entradas, edições, exclusões e saídas de cada OSM, com o nome
 * do usuário logado que fez cada ação.
 */

const ACTION_META: Record<PesagemHistoryAction, { label: string; badge: string; Icon: any }> = {
  created: { label: 'Entrada', badge: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/50', Icon: LogIn },
  edited: { label: 'Edição', badge: 'bg-sky-950/70 text-sky-300 border-sky-800/50', Icon: Pencil },
  deleted: { label: 'Exclusão', badge: 'bg-rose-950/70 text-rose-300 border-rose-800/50', Icon: Trash2 },
  manual_exit: { label: 'Saída manual', badge: 'bg-orange-950/70 text-orange-300 border-orange-800/50', Icon: LogOut },
  manipulacao_started: { label: 'Saída (Manipulação)', badge: 'bg-purple-950/70 text-purple-300 border-purple-800/50', Icon: FlaskConical },
  manipulacao_start_cancelled: { label: 'Saída cancelada', badge: 'bg-amber-950/70 text-amber-300 border-amber-800/50', Icon: Undo2 },
};

type PeriodKey = 'today' | '7d' | '30d' | 'custom';
type ViewMode = 'list' | 'byOsm';

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateBr(dateStr?: string | null): string {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(dateStr);
}

function describeEntry(e: PesagemHistoryEntry): string[] {
  const lines: string[] = [];
  const det = e.details || {};
  if (e.action === 'edited' && det.changes && det.changes.length > 0) {
    det.changes.forEach(c => lines.push(`${c.field}: ${c.from || '(vazio)'} → ${c.to || '(vazio)'}`));
  }
  if (e.action === 'manual_exit' && det.exitDate) lines.push(`Data de saída: ${formatDateBr(det.exitDate)}`);
  if ((e.action === 'manipulacao_started' || e.action === 'manipulacao_start_cancelled') && det.reactor) {
    lines.push(e.action === 'manipulacao_started' ? `Iniciada no ${det.reactor}` : `Início cancelado no ${det.reactor}`);
  }
  if (det.note) lines.push(det.note);
  return lines;
}

interface OsmSummary {
  key: string;
  opNumber: string;
  product?: string | null;
  lote?: string | null;
  industria?: string | null;
  entrada?: PesagemHistoryEntry;
  saida?: PesagemHistoryEntry;
  exclusao?: PesagemHistoryEntry;
  edicoes: PesagemHistoryEntry[];
  all: PesagemHistoryEntry[];
  lastAt: string;
}

export function PesagemMovimentacoes() {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [customFrom, setCustomFrom] = useState(daysAgoStr(7));
  const [customTo, setCustomTo] = useState(localDateStr(new Date()));
  const [entries, setEntries] = useState<PesagemHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | PesagemHistoryAction>('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedOsm, setExpandedOsm] = useState<string | null>(null);

  const range = useMemo(() => {
    const today = localDateStr(new Date());
    if (period === 'today') return { from: today, to: today };
    if (period === '7d') return { from: daysAgoStr(6), to: today };
    if (period === '30d') return { from: daysAgoStr(29), to: today };
    const from = customFrom || today;
    const to = customTo || today;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [period, customFrom, customTo]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const res = await getPesagemHistory(range.from, range.to);
    setEntries(res.entries);
    setLoadError(res.error);
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Atualiza sozinho a cada 30s
  useEffect(() => {
    const t = setInterval(() => loadHistory(), 30000);
    return () => clearInterval(t);
  }, [loadHistory]);

  const people = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => e.collaboratorName && set.add(e.collaboratorName));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (personFilter !== 'all' && e.collaboratorName !== personFilter) return false;
      if (!q) return true;
      return [e.opNumber, e.product, e.lote, e.collaboratorName]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [entries, search, actionFilter, personFilter]);

  const osmSummaries = useMemo(() => {
    const map = new Map<string, OsmSummary>();
    // do mais antigo para o mais recente, para "entrada" ser a primeira e
    // "saída" a mais recente
    [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(e => {
      const key = (e.opNumber || '').trim() || e.opId || e.id;
      let s = map.get(key);
      if (!s) {
        s = { key, opNumber: e.opNumber, edicoes: [], all: [], lastAt: e.createdAt };
        map.set(key, s);
      }
      s.product = e.product || s.product;
      s.lote = e.lote || s.lote;
      s.industria = e.industria || s.industria;
      s.all.push(e);
      s.lastAt = e.createdAt;
      if (e.action === 'created' && !s.entrada) s.entrada = e;
      if (e.action === 'edited') s.edicoes.push(e);
      if (e.action === 'deleted') s.exclusao = e;
      if (e.action === 'manual_exit' || e.action === 'manipulacao_started') s.saida = e;
      if (e.action === 'manipulacao_start_cancelled') s.saida = undefined;
    });
    return Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [filtered]);

  const counts = useMemo(() => {
    const c = { entradas: 0, saidas: 0, edicoes: 0, exclusoes: 0 };
    filtered.forEach(e => {
      if (e.action === 'created') c.entradas++;
      else if (e.action === 'manual_exit' || e.action === 'manipulacao_started') c.saidas++;
      else if (e.action === 'manipulacao_start_cancelled') c.saidas--;
      else if (e.action === 'edited') c.edicoes++;
      else if (e.action === 'deleted') c.exclusoes++;
    });
    c.saidas = Math.max(0, c.saidas);
    return c;
  }, [filtered]);

  const renderBadge = (action: PesagemHistoryAction) => {
    const meta = ACTION_META[action] || ACTION_META.edited;
    const Icon = meta.Icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${meta.badge}`}>
        <Icon className="w-3 h-3" />
        {meta.label}
      </span>
    );
  };

  const renderWho = (e?: PesagemHistoryEntry, emptyText = '—') => {
    if (!e) return <span className="text-[#52525b]">{emptyText}</span>;
    return (
      <span>
        <strong className="text-white">{e.collaboratorName}</strong>
        <span className="text-[#71717a]"> · {formatDateTime(e.createdAt)}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="bg-[#141418] border border-[#27272a] p-4 sm:p-5 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-5 h-5 text-purple-400 shrink-0" />
            <h1 className="text-base sm:text-xl font-bold text-white tracking-tight">Movimentações da Pesagem</h1>
          </div>
          <p className="text-xs text-[#a1a1aa] mt-1">
            Quem registrou, editou, excluiu e deu saída em cada OSM. O histórico não pode ser alterado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadHistory()}
            className="h-9 w-9 rounded-xl border border-[#27272a] bg-[#18181b] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-[#141418] border border-[#27272a] p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap gap-2">
          {([
            ['today', 'Hoje'],
            ['7d', '7 dias'],
            ['30d', '30 dias'],
            ['custom', 'Período'],
          ] as [PeriodKey, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`h-8 px-3 rounded-lg text-xs font-bold cursor-pointer ${
                period === key ? 'bg-purple-600 text-white' : 'bg-[#1c1c22] text-[#a1a1aa] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 bg-[#121215] border border-[#27272a] text-white text-xs rounded-lg px-2 [color-scheme:dark]"
              />
              <span className="text-xs text-[#71717a]">até</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 bg-[#121215] border border-[#27272a] text-white text-xs rounded-lg px-2 [color-scheme:dark]"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar OSM, produto, lote ou usuário"
              className="w-full bg-[#121215] border border-[#27272a] focus:border-purple-500 focus:outline-none text-white text-xs h-9 rounded-xl pl-8 pr-3 placeholder:text-[#52525b]"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as any)}
            className="bg-[#121215] border border-[#27272a] text-white text-xs h-9 rounded-xl px-3 cursor-pointer"
          >
            <option value="all">Todas as ações</option>
            {(Object.keys(ACTION_META) as PesagemHistoryAction[]).map(a => (
              <option key={a} value={a}>{ACTION_META[a].label}</option>
            ))}
          </select>
          <select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="bg-[#121215] border border-[#27272a] text-white text-xs h-9 rounded-xl px-3 cursor-pointer"
          >
            <option value="all">Todos os usuários</option>
            {people.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap gap-3 text-[11px] text-[#a1a1aa]">
            <span>Entradas: <strong className="text-emerald-300">{counts.entradas}</strong></span>
            <span>Saídas: <strong className="text-purple-300">{counts.saidas}</strong></span>
            <span>Edições: <strong className="text-sky-300">{counts.edicoes}</strong></span>
            <span>Exclusões: <strong className="text-rose-300">{counts.exclusoes}</strong></span>
          </div>
          <div className="flex gap-1 bg-[#121215] border border-[#27272a] rounded-lg p-0.5 self-start">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`h-7 px-3 rounded-md text-[11px] font-bold cursor-pointer ${viewMode === 'list' ? 'bg-[#27272a] text-white' : 'text-[#71717a]'}`}
            >
              Movimentações
            </button>
            <button
              type="button"
              onClick={() => setViewMode('byOsm')}
              className={`h-7 px-3 rounded-md text-[11px] font-bold cursor-pointer ${viewMode === 'byOsm' ? 'bg-[#27272a] text-white' : 'text-[#71717a]'}`}
            >
              Por OSM
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs rounded-xl p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Não foi possível carregar o histórico ({loadError}). Confira se o SQL <code>add_pesagem_historico.sql</code> foi rodado no Supabase.</span>
        </div>
      )}

      {/* Conteúdo */}
      {loading && entries.length === 0 ? (
        <div className="text-center text-xs text-[#71717a] py-10">Carregando histórico...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-xs text-[#71717a] py-10 bg-[#141418] border border-[#27272a] rounded-2xl">
          Nenhuma movimentação neste período.
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-[#141418] border border-[#27272a] rounded-2xl divide-y divide-[#27272a]/70 overflow-hidden">
          {filtered.map(e => {
            const details = describeEntry(e);
            return (
              <div key={e.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                <div className="sm:w-36 shrink-0 text-[11px] text-[#a1a1aa] font-mono">{formatDateTime(e.createdAt)}</div>
                <div className="sm:w-40 shrink-0">{renderBadge(e.action)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">
                    <span className="font-mono font-bold">{e.opNumber || '—'}</span>
                    {e.product && <span className="text-[#d4d4d8]"> · {e.product}</span>}
                  </div>
                  <div className="text-[11px] text-[#71717a] mt-0.5">
                    {e.lote ? `Lote ${e.lote}` : ''}{e.lote && e.industria ? ' · ' : ''}{e.industria || ''}
                  </div>
                  {details.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {details.map((d, i) => (
                        <li key={i} className="text-[11px] text-[#a1a1aa]">{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="sm:w-44 shrink-0 text-xs sm:text-right">
                  <span className="text-[#71717a] sm:hidden">Por: </span>
                  <strong className="text-white">{e.collaboratorName}</strong>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {osmSummaries.map(s => {
            const expanded = expandedOsm === s.key;
            return (
              <div key={s.key} className="bg-[#141418] border border-[#27272a] rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedOsm(expanded ? null : s.key)}
                  className="w-full text-left p-3 sm:p-4 hover:bg-[#18181c] cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-white">
                        <span className="font-mono font-bold">{s.opNumber || '—'}</span>
                        {s.product && <span className="text-[#d4d4d8]"> · {s.product}</span>}
                      </div>
                      <div className="text-[11px] text-[#71717a] mt-0.5">
                        {s.lote ? `Lote ${s.lote}` : ''}{s.lote && s.industria ? ' · ' : ''}{s.industria || ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.exclusao && renderBadge('deleted')}
                      {expanded ? <ChevronUp className="w-4 h-4 text-[#71717a]" /> : <ChevronDown className="w-4 h-4 text-[#71717a]" />}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 mt-2 text-[11px] text-[#a1a1aa]">
                    <div><span className="text-emerald-400 font-bold">Entrada: </span>{renderWho(s.entrada, 'fora do período')}</div>
                    <div>
                      <span className="text-purple-400 font-bold">Saída: </span>
                      {renderWho(s.saida, s.exclusao ? '—' : 'ainda na Pesagem')}
                      {s.saida?.action === 'manipulacao_started' && s.saida.details?.reactor && (
                        <span className="text-[#71717a]"> ({s.saida.details.reactor})</span>
                      )}
                      {s.saida?.action === 'manual_exit' && <span className="text-[#71717a]"> (manual)</span>}
                    </div>
                    <div>
                      <span className="text-sky-400 font-bold">Edições: </span>
                      {s.edicoes.length === 0 ? <span className="text-[#52525b]">nenhuma</span> : (
                        <span><strong className="text-white">{s.edicoes.length}</strong> · última por <strong className="text-white">{s.edicoes[s.edicoes.length - 1].collaboratorName}</strong></span>
                      )}
                    </div>
                  </div>
                  {s.exclusao && (
                    <div className="text-[11px] text-rose-300 mt-1">Excluída por <strong>{s.exclusao.collaboratorName}</strong> · {formatDateTime(s.exclusao.createdAt)}</div>
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-[#27272a] px-3 sm:px-4 py-3 space-y-2 bg-[#111114]">
                    {s.all.map(e => (
                      <div key={e.id} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 text-[11px]">
                        <span className="sm:w-36 shrink-0 font-mono text-[#71717a]">{formatDateTime(e.createdAt)}</span>
                        <span className="sm:w-40 shrink-0">{renderBadge(e.action)}</span>
                        <span className="flex-1 text-[#a1a1aa]">
                          <strong className="text-white">{e.collaboratorName}</strong>
                          {describeEntry(e).map((d, i) => <span key={i} className="block">{d}</span>)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
