import { useMemo, useState } from 'react';
import { Package, Play, Pause, CheckCircle2, XCircle, Search, Trash2, RefreshCw, ListChecks, AlertTriangle } from 'lucide-react';
import { ProductionEvent, ProductionLine, ProductionOrder, UserProfile } from '../types';
import { deleteQuantityReport, toLocalDateStr } from '../services/db';
import { useAuthStore } from '../store/authStore';
import { getUserRule, isAdminRule } from '../lib/permissions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

/**
 * HISTÓRICO DE APONTAMENTOS (Envase) — cada apontamento de quantidade, início,
 * pausa, retomada e conclusão da linha, com quem fez e a hora. Serve para
 * achar apontamento lançado errado. Coordenação e ADM podem APAGAR um
 * apontamento de quantidade (com motivo; fica registrado em
 * apontamentos_excluidos).
 */

interface Props {
  ops: ProductionOrder[];
  events: ProductionEvent[];
  lines: ProductionLine[];
  users?: UserProfile[];
  rangeStart: string;
  rangeEnd: string;
  /** Tela de UMA linha (líder) — sem filtro de linha */
  lineId?: string | null;
}

type TypeFilter = 'apontamentos' | 'todos';

export function ApontamentosHistorico({ ops, events, lines, users = [], rangeStart, rangeEnd, lineId }: Props) {
  const { profile } = useAuthStore();
  const canDelete = !!profile && (profile.role === 'coordinator' || isAdminRule(getUserRule(profile)));

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('apontamentos');
  const [lineFilter, setLineFilter] = useState<string>('todas');
  const [search, setSearch] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<ProductionEvent | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(150);

  const lineIds = useMemo(() => new Set(lines.map(l => l.id)), [lines]);
  const opById = useMemo(() => new Map(ops.map(o => [String(o.id), o])), [ops]);
  const lineName = (id?: string | null) => lines.find(l => l.id === id)?.name || id || '—';
  const who = (ev: ProductionEvent) => {
    const u = ev.leaderId ? users.find(x => x.uid === ev.leaderId) : undefined;
    return u?.name || (ev.leaderName && ev.leaderName !== 'Líder' ? ev.leaderName : 'responsável não registrado');
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/[\s/]/g, '-');
    return events
      .filter(ev => {
        if (!ev?.createdAt || removed.has(String(ev.id))) return false;
        const day = toLocalDateStr(ev.createdAt);
        if (!day || day < rangeStart || day > rangeEnd) return false;
        const op = ev.opId ? opById.get(String(ev.opId)) : undefined;
        const lid = ev.lineId || op?.lineId || '';
        if (lineId) { if (lid !== lineId) return false; }
        else {
          if (!lineIds.has(lid)) return false;
          if (lineFilter !== 'todas' && lid !== lineFilter) return false;
        }
        if (typeFilter === 'apontamentos' && ev.type !== 'QUANTITY_REPORTED') return false;
        if (q) {
          const num = (op?.number || '').toLowerCase().replace(/[\s/]/g, '-');
          if (!num.includes(q) && !(op?.product || '').toLowerCase().includes(search.trim().toLowerCase()) && !who(ev).toLowerCase().includes(search.trim().toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, removed, rangeStart, rangeEnd, lineId, lineFilter, typeFilter, search, opById, lineIds, users]);

  const totalQty = rows.filter(r => r.type === 'QUANTITY_REPORTED').reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  const shown = rows.slice(0, limit);

  const confirmDelete = async () => {
    if (!toDelete || !profile) return;
    if (!motivo.trim()) { setError('Informe o motivo.'); return; }
    setBusy(true); setError(null);
    const op = toDelete.opId ? opById.get(String(toDelete.opId)) : undefined;
    const res = await deleteQuantityReport(toDelete, op, { uid: profile.uid, name: profile.name || profile.email }, motivo.trim(), who(toDelete));
    setBusy(false);
    if (res.ok) {
      setRemoved(prev => new Set(prev).add(String(toDelete.id)));
      setToDelete(null);
    } else {
      setError((res as { ok: false; error: string }).error);
    }
  };

  const label = (ev: ProductionEvent, unit: string) => {
    switch (ev.type) {
      case 'QUANTITY_REPORTED': return `Apontamento de +${Number(ev.quantity || 0).toLocaleString('pt-BR')} ${unit}`;
      case 'STARTED': return 'Início de produção';
      case 'PAUSED': return `Pausa: ${ev.reason || 'Operacional'}`;
      case 'RESUMED': return 'Retomada de produção';
      case 'FINISHED': return `Conclusão${ev.quantity != null ? ` · total ${Number(ev.quantity).toLocaleString('pt-BR')} ${unit}` : ''}`;
      case 'CANCELLED': return 'Início cancelado';
      default: return ev.type;
    }
  };
  const iconOf = (t: string) => t === 'QUANTITY_REPORTED' ? <Package className="w-4 h-4" /> : t === 'STARTED' || t === 'RESUMED' ? <Play className="w-4 h-4" /> : t === 'PAUSED' ? <Pause className="w-4 h-4" /> : t === 'CANCELLED' ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />;
  const toneOf = (t: string) => t === 'QUANTITY_REPORTED' ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : t === 'STARTED' || t === 'RESUMED' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30' : t === 'PAUSED' ? 'bg-amber-600/20 text-amber-400 border-amber-500/30' : 'bg-purple-600/20 text-purple-400 border-purple-500/30';
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const chip = (active: boolean) => `h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`;
  const delOp = toDelete?.opId ? opById.get(String(toDelete.opId)) : undefined;

  return (
    <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-blue-400" /> Histórico de apontamentos
          </h3>
          <p className="text-[11px] text-[#71717a] mt-0.5">
            {rows.length.toLocaleString('pt-BR')} registro(s){typeFilter === 'apontamentos' ? ` · ${totalQty.toLocaleString('pt-BR')} un apontadas` : ''}
            {canDelete ? ' · coordenação/ADM pode apagar apontamento lançado errado' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => setTypeFilter('apontamentos')} className={chip(typeFilter === 'apontamentos')}>Só apontamentos</button>
          <button type="button" onClick={() => setTypeFilter('todos')} className={chip(typeFilter === 'todos')}>Todos os eventos</button>
          {!lineId && (
            <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} className="h-8 rounded-lg bg-[#16161e] border border-[#26262f] text-[11px] text-white px-2">
              <option value="todas">Todas as linhas</option>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="OP, produto ou pessoa" className="h-8 w-48 rounded-lg bg-[#16161e] border border-[#26262f] text-[11px] text-white pl-7 pr-2" />
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="p-8 text-center bg-[#15151c] rounded-xl border border-dashed border-[#272733] text-xs text-[#71717a]">
          Nenhum {typeFilter === 'apontamentos' ? 'apontamento' : 'evento'} neste período.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(ev => {
            const op = ev.opId ? opById.get(String(ev.opId)) : undefined;
            const unit = op?.unidade === 'Kg' ? 'kg' : 'un';
            return (
              <div key={ev.id} className="p-3 rounded-xl bg-[#16161e] border border-[#242430] flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${toneOf(ev.type)}`}>{iconOf(ev.type)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">{label(ev, unit)}</span>
                      {op && <span className="text-[10px] font-mono text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded">OP {op.number}</span>}
                      {!lineId && <span className="text-[10px] text-[#71717a]">{lineName(ev.lineId || op?.lineId)}</span>}
                    </div>
                    {op?.product && <p className="text-[10px] text-[#71717a] truncate mt-0.5">{op.product}</p>}
                    {ev.observation && <p className="text-[11px] text-[#a1a1aa] truncate mt-0.5">Obs: {ev.observation}</p>}
                    <p className="text-[10px] text-[#71717a] mt-0.5">Feito por: <strong className="text-[#d4d4d8]">{who(ev)}</strong></p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-[#71717a]">{fmt(ev.createdAt)}</span>
                  {canDelete && ev.type === 'QUANTITY_REPORTED' && (
                    <button type="button" onClick={() => { setToDelete(ev); setMotivo(''); setError(null); }} title="Apagar este apontamento"
                      className="h-7 w-7 rounded-lg border border-rose-500/30 text-rose-400/80 hover:text-rose-300 hover:bg-rose-950/40 flex items-center justify-center">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length > shown.length && (
            <button type="button" onClick={() => setLimit(l => l + 150)} className="w-full py-2.5 text-xs font-bold text-blue-300 hover:bg-[#1a1a22] rounded-xl border border-[#242430]">
              Mostrar mais ({(rows.length - shown.length).toLocaleString('pt-BR')} restantes)
            </button>
          )}
        </div>
      )}

      {/* Confirmação de exclusão */}
      <Dialog open={!!toDelete} onOpenChange={(open) => { if (!open && !busy) setToDelete(null); }}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-[#f4f4f5] max-w-sm w-full rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-800/60 flex items-center justify-center text-rose-400 mb-2">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-white">Apagar apontamento?</DialogTitle>
          </DialogHeader>
          {toDelete && (
            <div className="space-y-3 py-1">
              <div className="bg-[#121215] border border-[#27272a] rounded-xl px-3 py-2.5 text-xs space-y-0.5">
                <div className="font-bold text-white">+{Number(toDelete.quantity || 0).toLocaleString('pt-BR')} un · OP {delOp?.number || '—'}</div>
                <div className="text-[#a1a1aa]">{fmt(toDelete.createdAt)} · {who(toDelete)}</div>
                {delOp && <div className="text-[#71717a]">Total da OP passa de {Number(delOp.producedQuantity || 0).toLocaleString('pt-BR')} para {Math.max(0, Number(delOp.producedQuantity || 0) - Number(toDelete.quantity || 0)).toLocaleString('pt-BR')} un</div>}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Motivo *</label>
                <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: apontado em dobro" className="w-full h-10 rounded-xl bg-[#121215] border border-[#27272a] text-xs text-white px-3" />
              </div>
              <p className="text-[11px] text-[#71717a]">A quantidade sai da OP e do dashboard. A exclusão fica registrada com seu nome.</p>
              {error && <p className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/40 rounded-lg px-2 py-1.5">{error}</p>}
            </div>
          )}
          <DialogFooter className="pt-2 gap-2 flex-col sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setToDelete(null)} disabled={busy} className="h-10 rounded-xl border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a] w-full sm:w-auto">Cancelar</Button>
            <Button type="button" onClick={confirmDelete} disabled={busy || !motivo.trim()} className="h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 w-full sm:w-auto">
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Apagar apontamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
