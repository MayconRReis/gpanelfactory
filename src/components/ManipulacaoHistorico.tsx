import { useEffect, useMemo, useState } from 'react';
import {
  History,
  Search,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Snowflake,
  TestTube,
  ThumbsUp,
  ThumbsDown,
  Wrench,
  Droplets,
  ClipboardCheck,
  FlaskConical,
} from 'lucide-react';
import { ProductionEvent, ProductionLine, ProductionOrder, UserProfile } from '../types';
import { getAllUsers, MANIP_PHASE_REASONS, ManipConferencia } from '../services/db';

/**
 * HISTÓRICO DA MANIPULAÇÃO — quem fez cada ação em cada OSM: conferência,
 * início, resfriamento, análises, resultado do CQ, pausas, drenagem e
 * conclusão. Filtros por período, reator, OSM e tipo de ação.
 */

type Kind = 'conferencia' | 'inicio' | 'resfriamento' | 'analise' | 'reprovado' | 'correcao' | 'aprovado'
  | 'manip_fim' | 'pausa' | 'retomada' | 'drenagem' | 'conclusao' | 'cancelado';

const KIND_META: Record<Kind, { label: string; badge: string; Icon: any }> = {
  conferencia: { label: 'Conferência', badge: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/50', Icon: ClipboardCheck },
  inicio: { label: 'Início', badge: 'bg-cyan-950/70 text-cyan-300 border-cyan-800/50', Icon: Play },
  manip_fim: { label: 'Manipulação finalizada', badge: 'bg-zinc-900 text-zinc-200 border-zinc-700', Icon: FlaskConical },
  resfriamento: { label: 'Resfriamento', badge: 'bg-blue-950/70 text-blue-200 border-blue-800/50', Icon: Snowflake },
  analise: { label: 'Análise', badge: 'bg-sky-950/70 text-sky-300 border-sky-800/50', Icon: TestTube },
  reprovado: { label: 'CQ reprovado', badge: 'bg-rose-950/70 text-rose-300 border-rose-800/50', Icon: ThumbsDown },
  correcao: { label: 'CQ aprovado c/ correção', badge: 'bg-lime-950/70 text-lime-300 border-lime-800/50', Icon: Wrench },
  aprovado: { label: 'CQ aprovado', badge: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/50', Icon: ThumbsUp },
  pausa: { label: 'Pausa', badge: 'bg-amber-950/70 text-amber-300 border-amber-800/50', Icon: Pause },
  retomada: { label: 'Retomada', badge: 'bg-cyan-950/70 text-cyan-300 border-cyan-800/50', Icon: Play },
  drenagem: { label: 'Drenagem iniciada', badge: 'bg-teal-950/70 text-teal-300 border-teal-800/50', Icon: Droplets },
  conclusao: { label: 'Conclusão', badge: 'bg-purple-950/70 text-purple-300 border-purple-800/50', Icon: CheckCircle2 },
  cancelado: { label: 'Início cancelado', badge: 'bg-rose-950/70 text-rose-300 border-rose-800/50', Icon: XCircle },
};

const KIND_FILTERS: { key: 'todas' | 'cq' | 'pausas' | Kind; label: string }[] = [
  { key: 'todas', label: 'Todas as ações' },
  { key: 'conferencia', label: 'Conferência' },
  { key: 'inicio', label: 'Início' },
  { key: 'resfriamento', label: 'Resfriamento' },
  { key: 'cq', label: 'Análise / CQ' },
  { key: 'pausas', label: 'Pausas e retomadas' },
  { key: 'drenagem', label: 'Drenagem' },
  { key: 'conclusao', label: 'Conclusão' },
];

interface Row {
  key: string;
  at: string;
  kind: Kind;
  text: string;
  detail?: string;
  who: string;
  opId: string;
  opNumber: string;
  product: string;
  reactorId: string | null;
}

type PeriodKey = 'hoje' | '7d' | '30d' | 'todos';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

interface Props {
  ops: ProductionOrder[];
  events: ProductionEvent[];
  reactors: ProductionLine[];
  conferencias: ManipConferencia[];
}

export function ManipulacaoHistorico({ ops, events, reactors, conferencias }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [reactor, setReactor] = useState('todos');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('todas');
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    getAllUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const userName = (id?: string | null, fallback?: string) => {
    if (id) {
      const u = users.find(x => x.uid === id || x.email === id);
      if (u?.name) return u.name;
    }
    return fallback && fallback !== 'Líder' ? fallback : 'responsável não registrado';
  };

  const manipOps = useMemo(() => ops.filter(o => o.setor === 'Manipulação'), [ops]);
  const reactorName = (id?: string | null) => reactors.find(r => r.id === id)?.name || (id || '—');

  // Monta as linhas do histórico OSM a OSM (precisa da ordem dos eventos
  // para saber se uma retomada é da manipulação ou o início da drenagem).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const byOp = new Map<string, ProductionEvent[]>();
    const ids = new Set(manipOps.map(o => String(o.id)));
    for (const e of events) {
      if (!e.opId || !ids.has(String(e.opId))) continue;
      const list = byOp.get(String(e.opId)) || [];
      list.push(e);
      byOp.set(String(e.opId), list);
    }
    const phaseReasons = new Set<string>(Object.values(MANIP_PHASE_REASONS));
    for (const op of manipOps) {
      const base = { opId: String(op.id), opNumber: op.number, product: op.product };
      const list = (byOp.get(String(op.id)) || []).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      let manipFinished = false;
      let inDrain = false;
      for (const e of list) {
        const who = userName(e.leaderId, e.leaderName);
        const reactorId = e.lineId || op.lineId || null;
        const push = (kind: Kind, text: string, detail?: string) =>
          out.push({ key: `${e.id}-${kind}`, at: e.createdAt, kind, text, detail, who, reactorId, ...base });
        if (e.type === 'STARTED') { manipFinished = false; inDrain = false; push('inicio', 'Manipulação iniciada'); }
        else if (e.type === 'CANCELLED') { manipFinished = false; inDrain = false; push('cancelado', 'Início cancelado (iniciada por engano)', e.observation); }
        else if (e.type === 'PAUSED') {
          const r = e.reason || '';
          if (r === MANIP_PHASE_REASONS.resfriamento) { manipFinished = true; push('resfriamento', 'Manipulação finalizada · resfriamento iniciado'); }
          else if (r === MANIP_PHASE_REASONS.aguardandoCq) { const first = !manipFinished; manipFinished = true; push('analise', e.observation || 'Amostra enviada para análise', first ? 'Manipulação finalizada' : undefined); }
          else if (r === MANIP_PHASE_REASONS.emAjuste) { manipFinished = true; push('reprovado', e.observation || 'CQ: não aprovado · em ajuste'); }
          else if (r === MANIP_PHASE_REASONS.emCorrecao) { manipFinished = true; push('correcao', e.observation || 'CQ: aprovado com correção'); }
          else if (r === MANIP_PHASE_REASONS.aguardandoDrenagem) { manipFinished = true; push('aprovado', e.observation || 'CQ: aprovado · liberado para drenagem'); }
          else if (r === MANIP_PHASE_REASONS.aguardandoAmostragem) { manipFinished = true; push('manip_fim', e.observation || 'Manipulação finalizada'); }
          else if (!phaseReasons.has(r)) push('pausa', `${inDrain ? 'Drenagem pausada' : 'Manipulação pausada'}${r ? ` — ${r}` : ''}`, e.observation);
        } else if (e.type === 'RESUMED') {
          if (manipFinished && !inDrain) { inDrain = true; push('drenagem', 'Drenagem iniciada'); }
          else push('retomada', inDrain ? 'Drenagem retomada' : 'Manipulação retomada');
        } else if (e.type === 'FINISHED') {
          push('conclusao', `Drenagem finalizada${e.quantity ? ` · ${Number(e.quantity).toLocaleString('pt-BR')} kg` : ''} — OSM concluída`, e.observation);
        }
      }
    }
    // Conferências da pesagem
    for (const c of conferencias) {
      const op = manipOps.find(o => String(o.id) === String(c.opId)) || manipOps.find(o => c.osmNumber && o.number.trim() === c.osmNumber.trim());
      out.push({
        key: `conf-${c.id}`, at: c.conferidoEm, kind: 'conferencia', text: 'Pesagem conferida',
        detail: c.observacao || undefined, who: c.conferidoNome || userName(c.conferidoPor),
        opId: op ? String(op.id) : String(c.opId || ''), opNumber: op?.number || c.osmNumber || '—', product: op?.product || '',
        reactorId: c.reactorId || op?.lineId || null,
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manipOps, events, conferencias, users]);

  const filtered = useMemo(() => {
    const now = new Date();
    const from = period === 'hoje' ? startOfDay(now)
      : period === '7d' ? startOfDay(now) - 6 * 86400000
      : period === '30d' ? startOfDay(now) - 29 * 86400000
      : -Infinity;
    const q = search.trim().toLowerCase().replace(/[\s/]/g, '-');
    return rows.filter(r => {
      if (new Date(r.at).getTime() < from) return false;
      if (reactor !== 'todos' && r.reactorId !== reactor) return false;
      if (q) {
        const num = r.opNumber.toLowerCase().replace(/[\s/]/g, '-');
        if (!num.includes(q) && !r.product.toLowerCase().includes(search.trim().toLowerCase()) && !r.who.toLowerCase().includes(search.trim().toLowerCase())) return false;
      }
      if (kindFilter === 'cq' && !['analise', 'reprovado', 'correcao', 'aprovado'].includes(r.kind)) return false;
      if (kindFilter === 'pausas' && !['pausa', 'retomada'].includes(r.kind)) return false;
      if (!['todas', 'cq', 'pausas'].includes(kindFilter) && r.kind !== kindFilter) return false;
      return true;
    });
  }, [rows, period, reactor, search, kindFilter]);

  const shown = filtered.slice(0, limit);
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${active ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-[#121215] text-[#a1a1aa] border-[#27272a] hover:text-white'}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-cyan-950/70 border border-cyan-800/50 flex items-center justify-center text-cyan-300">
          <History className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-white">Histórico da Manipulação</h2>
          <p className="text-[11px] text-[#71717a]">Quem fez cada ação em cada OSM — conferência, início, resfriamento, análises, CQ, pausas e drenagem.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {([['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['todos', 'Tudo']] as [PeriodKey, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setPeriod(k); setLimit(100); }} className={chip(period === k)}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={reactor} onChange={e => { setReactor(e.target.value); setLimit(100); }} className="h-10 rounded-xl bg-[#121215] border border-[#27272a] text-xs text-white px-3">
            <option value="todos">Todos os reatores</option>
            {reactors.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => { setSearch(e.target.value); setLimit(100); }} placeholder="OSM, produto ou pessoa..." className="w-full h-10 rounded-xl bg-[#121215] border border-[#27272a] text-xs text-white pl-8 pr-3" />
          </div>
          <select value={kindFilter} onChange={e => { setKindFilter(e.target.value); setLimit(100); }} className="h-10 rounded-xl bg-[#121215] border border-[#27272a] text-xs text-white px-3">
            {KIND_FILTERS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div className="text-[11px] text-[#71717a]">{filtered.length.toLocaleString('pt-BR')} registro(s)</div>
      </div>

      {/* Lista */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-2xl overflow-hidden">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#71717a]">Nenhuma ação encontrada com esses filtros.</div>
        ) : (
          <div className="divide-y divide-[#222226]">
            {shown.map(r => {
              const meta = KIND_META[r.kind];
              const Icon = meta.Icon;
              return (
                <div key={r.key} className="px-4 py-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${meta.badge}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.badge}`}>{meta.label}</span>
                      <button type="button" onClick={() => setSearch(r.opNumber)} className="font-mono text-xs font-black text-white hover:text-cyan-300" title="Filtrar por esta OSM">{r.opNumber}</button>
                      <span className="text-[10px] text-[#71717a]">• {reactorName(r.reactorId)}</span>
                    </div>
                    <div className="text-xs text-[#e4e4e7] mt-0.5">{r.text}</div>
                    {r.detail && <div className="text-[11px] text-[#a1a1aa] mt-0.5">{r.detail}</div>}
                    {r.product && <div className="text-[10px] text-[#71717a] truncate mt-0.5">{r.product}</div>}
                    <div className="text-[10px] text-[#71717a] mt-1">Feito por: <strong className="text-[#d4d4d8]">{r.who}</strong></div>
                  </div>
                  <span className="text-[10px] font-mono text-[#71717a] shrink-0">{fmt(r.at)}</span>
                </div>
              );
            })}
          </div>
        )}
        {filtered.length > shown.length && (
          <button type="button" onClick={() => setLimit(l => l + 100)} className="w-full py-3 text-xs font-bold text-cyan-300 hover:bg-[#1f1f24] border-t border-[#27272a]">
            Mostrar mais ({(filtered.length - shown.length).toLocaleString('pt-BR')} restantes)
          </button>
        )}
      </div>
    </div>
  );
}
