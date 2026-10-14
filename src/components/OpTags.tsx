import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, X, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { getOpTagsData, addOpTagType, deleteOpTagType, OpTagType } from '../services/db';

/**
 * ETIQUETAS DAS OPS (estilo Trello) — a Coordenação cria os tipos no
 * Cronograma (botão "Etiquetas") e escolhe as etiquetas de cada OP no
 * Editar OP. Elas aparecem no topo da OP (Cronograma, Estoque e tela da
 * linha), como o selo de Retrabalho.
 *
 * Os dados ficam num cache único do app: qualquer tela que use
 * useOpTags() é atualizada quando alguém chama refreshOpTags().
 */

// Classes completas (o Tailwind só gera o que aparece escrito no código)
export const TAG_COLORS: Record<string, { label: string; badge: string; dot: string }> = {
  emerald: { label: 'Verde', badge: 'bg-emerald-950 text-emerald-300 border-emerald-700/60', dot: 'bg-emerald-500' },
  sky: { label: 'Azul', badge: 'bg-sky-950 text-sky-300 border-sky-700/60', dot: 'bg-sky-500' },
  violet: { label: 'Roxo', badge: 'bg-violet-950 text-violet-300 border-violet-700/60', dot: 'bg-violet-500' },
  amber: { label: 'Amarelo', badge: 'bg-amber-950 text-amber-300 border-amber-700/60', dot: 'bg-amber-500' },
  orange: { label: 'Laranja', badge: 'bg-orange-950 text-orange-300 border-orange-700/60', dot: 'bg-orange-500' },
  rose: { label: 'Vermelho', badge: 'bg-rose-950 text-rose-300 border-rose-700/60', dot: 'bg-rose-500' },
  pink: { label: 'Rosa', badge: 'bg-pink-950 text-pink-300 border-pink-700/60', dot: 'bg-pink-500' },
  slate: { label: 'Cinza', badge: 'bg-slate-800 text-slate-200 border-slate-600/60', dot: 'bg-slate-400' },
};
const colorOf = (c: string) => TAG_COLORS[c] || TAG_COLORS.slate;

// ---------------- cache compartilhado ----------------
type TagState = { types: OpTagType[]; byOp: Map<string, string[]>; error: string | null; loaded: boolean };
let state: TagState = { types: [], byOp: new Map(), error: null, loaded: false };
const listeners = new Set<(s: TagState) => void>();
let loading: Promise<void> | null = null;

export function refreshOpTags(): Promise<void> {
  if (!loading) {
    loading = getOpTagsData().then(res => {
      state = { ...res, loaded: true };
      listeners.forEach(l => l(state));
    }).finally(() => { loading = null; });
  }
  return loading;
}

export function useOpTags(): TagState {
  const [s, setS] = useState<TagState>(state);
  useEffect(() => {
    listeners.add(setS);
    if (!state.loaded) refreshOpTags();
    else setS(state);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

// ---------------- etiquetas no topo da OP ----------------
export function OpTagBadges({ opId, size = 'sm' }: { opId: string; size?: 'sm' | 'md' }) {
  const { types, byOp } = useOpTags();
  const ids = byOp.get(String(opId));
  if (!ids?.length) return null;
  const tags = types.filter(t => ids.includes(t.id));
  const cls = size === 'md' ? 'text-xs px-3 py-1 rounded-xl' : 'text-[9px] px-1.5 py-0.2 rounded';
  return (
    <>
      {tags.map(t => (
        <span key={t.id} className={`${cls} font-black uppercase border whitespace-nowrap ${colorOf(t.color).badge}`}>
          {t.name}
        </span>
      ))}
    </>
  );
}

// ---------------- seletor (Editar OP) ----------------
export function OpTagPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { types, error, loaded } = useOpTags();
  if (!loaded) return <p className="text-[10px] text-[#71717a]">Carregando etiquetas…</p>;
  if (error) return <p className="text-[10px] text-rose-300">{error}</p>;
  if (types.length === 0) return <p className="text-[10px] text-[#71717a]">Nenhuma etiqueta criada — crie pelo botão <strong>Etiquetas</strong> no Cronograma.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map(t => {
        const on = selected.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(on ? selected.filter(x => x !== t.id) : [...selected, t.id])}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-bold border flex items-center gap-1 transition-all ${on ? colorOf(t.color).badge + ' ring-1 ring-white/25' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`}
          >
            {on ? <Check className="w-3 h-3" /> : <span className={`w-2 h-2 rounded-full ${colorOf(t.color).dot}`} />}
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- gerenciar tipos (Cronograma) ----------------
export function OpTagManagerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-8 px-3 rounded-lg bg-[#16161e] hover:bg-[#1e1e28] border border-[#2a2a36] text-[#d4d4d8] text-[11px] font-bold flex items-center gap-1.5"
        title="Criar ou remover as etiquetas das OPs (Datado, Ag. datação…)"
      >
        <Tag className="w-3.5 h-3.5" /> Etiquetas
      </button>
      {open && <OpTagManagerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function OpTagManagerModal({ onClose }: { onClose: () => void }) {
  const { types, byOp, error, loaded } = useOpTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const usage = (id: string) => Array.from(byOp.values()).filter(ids => ids.includes(id)).length;

  const add = async () => {
    setBusy(true); setMsg(null);
    const res = await addOpTagType(name, color, (types[types.length - 1]?.sort || 0) + 1);
    setBusy(false);
    if (!res.ok) { setMsg(res.error || 'Não foi possível criar.'); return; }
    setName('');
    await refreshOpTags();
  };
  const remove = async (t: OpTagType) => {
    const n = usage(t.id);
    if (!window.confirm(`Remover a etiqueta "${t.name}"?${n ? ` Ela sai de ${n} OP(s).` : ''}`)) return;
    setBusy(true); setMsg(null);
    const res = await deleteOpTagType(t.id);
    setBusy(false);
    if (!res.ok) { setMsg(res.error || 'Não foi possível remover.'); return; }
    await refreshOpTags();
  };

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-[#121216] border border-[#222228] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-[#222228] flex items-center justify-between">
          <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2"><Tag className="w-4 h-4 text-blue-400" /> Etiquetas das OPs</h3>
          <button onClick={onClose} className="text-[#71717a] hover:text-white p-1.5 rounded-lg hover:bg-[#1f1f28]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-[#71717a]">Crie os tipos de etiqueta. Para colocar numa OP, use <strong className="text-[#d4d4d8]">Editar OP</strong>.</p>

          <div className="space-y-2">
            {!loaded ? <p className="text-[11px] text-[#71717a]">Carregando…</p>
              : error ? <p className="text-[11px] text-rose-300">{error}</p>
              : types.length === 0 ? <p className="text-[11px] text-[#52525b]">Nenhuma etiqueta ainda.</p>
              : types.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-2 bg-[#0b0b0e] border border-[#222228] rounded-lg px-3 py-2">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${colorOf(t.color).badge}`}>{t.name}</span>
                  <span className="text-[10px] text-[#71717a] ml-auto">{usage(t.id)} OP(s)</span>
                  <button type="button" onClick={() => remove(t)} disabled={busy} className="p-1 rounded text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40" title="Remover etiqueta">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
          </div>

          <div className="border-t border-[#222228] pt-3 space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">Nova etiqueta</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value.slice(0, 30)); setMsg(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) add(); }}
              placeholder="Ex.: Ag. rótulo"
              className="w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-3 text-xs text-[#f4f4f5] focus:outline-none focus:border-blue-500"
            />
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TAG_COLORS).map(([k, c]) => (
                <button key={k} type="button" onClick={() => setColor(k)} title={c.label}
                  className={`h-7 px-2 rounded-lg border text-[10px] font-bold flex items-center gap-1 ${color === k ? c.badge + ' ring-1 ring-white/30' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa]'}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />{c.label}
                </button>
              ))}
            </div>
            {name.trim() && (
              <p className="text-[10px] text-[#71717a]">Prévia: <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${colorOf(color).badge}`}>{name.trim()}</span></p>
            )}
            <button type="button" onClick={add} disabled={busy || !name.trim()}
              className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Criar etiqueta
            </button>
            {msg && <p className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">{msg}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
