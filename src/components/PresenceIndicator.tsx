import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * QUEM ESTÁ EM CADA LINHA — usa o Presence do Supabase Realtime: cada aba com
 * a tela de uma linha aberta "se anuncia" num canal único das linhas (com a
 * linha em que está) e some sozinha ao fechar ou trocar de linha. Nada é
 * gravado no banco.
 */

export interface LineViewer {
  uid: string;
  name: string;
}

/** Pessoas com a tela de cada linha aberta agora (lineId → pessoas). */
export function useLinePresence(uid: string | undefined, name: string | undefined, lineId: string | null | undefined) {
  const [byLine, setByLine] = useState<Map<string, LineViewer[]>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const readyRef = useRef(false);
  const meRef = useRef({ uid, name, lineId });
  meRef.current = { uid, name, lineId };

  useEffect(() => {
    if (!isSupabaseConfigured || !uid) return;
    // Chave única por aba; a mesma pessoa em dois aparelhos conta uma vez por linha (pelo uid)
    const tabKey = `${uid}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel('presence:linhas', { config: { presence: { key: tabKey } } });
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ uid?: string; name?: string; lineId?: string }>>;
        const map = new Map<string, Map<string, LineViewer>>();
        for (const metas of Object.values(state)) {
          for (const m of metas) {
            if (!m?.uid || !m.lineId) continue;
            const line = map.get(m.lineId) || new Map<string, LineViewer>();
            if (!line.has(m.uid)) line.set(m.uid, { uid: m.uid, name: (m.name || '').trim() || 'Sem nome' });
            map.set(m.lineId, line);
          }
        }
        const out = new Map<string, LineViewer[]>();
        for (const [lid, people] of map) out.set(lid, [...people.values()].sort((a, b) => a.name.localeCompare(b.name)));
        setByLine(out);
      })
      .subscribe(async status => {
        if (status !== 'SUBSCRIBED') return;
        readyRef.current = true;
        const me = meRef.current;
        if (me.lineId) await channel.track({ uid: me.uid, name: me.name || '', lineId: me.lineId });
      });
    return () => {
      readyRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [uid]);

  // Trocou de linha (ou de nome): atualiza o anúncio sem reabrir o canal
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !readyRef.current || !uid) return;
    if (lineId) channel.track({ uid, name: name || '', lineId });
    else channel.untrack();
  }, [uid, name, lineId]);

  return byLine;
}

interface IndicatorProps {
  viewers: LineViewer[];
  selfUid?: string;
  /** Ex.: "Envase 1" — aparece no título da lista. */
  lineName?: string;
}

/** Bolinha verde pulsando + nº de pessoas; passando o mouse (ou tocando) mostra os nomes. */
export function PresenceIndicator({ viewers, selfUid, lineName }: IndicatorProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Toque fora fecha a lista (tablet)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const label = useMemo(
    () => `${viewers.length} ${viewers.length === 1 ? 'pessoa' : 'pessoas'} no ${lineName || 'nesta linha'} agora`,
    [viewers.length, lineName]
  );

  if (viewers.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        className="flex items-center gap-2 bg-[#121217] border border-[#22222a] px-3 py-1.5 rounded-xl text-xs font-mono text-[#a1a1aa] hover:border-emerald-800/70 transition-colors"
      >
        <PresenceDot />
        <span className="font-bold text-emerald-300">{viewers.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 min-w-[200px] max-w-[280px] rounded-xl border border-[#27272a] bg-[#121216] shadow-2xl p-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#71717a] px-1.5 pb-1.5">{label}</div>
          <ViewerList viewers={viewers} selfUid={selfUid} />
        </div>
      )}
    </div>
  );
}

export function PresenceDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

export function ViewerList({ viewers, selfUid }: { viewers: LineViewer[]; selfUid?: string }) {
  return (
    <ul className="max-h-64 overflow-y-auto">
      {viewers.map(v => (
        <li key={v.uid} className="flex items-center gap-2 px-1.5 py-1 text-xs text-[#f4f4f5]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="truncate">{v.name}{v.uid === selfUid ? <span className="text-[#71717a]"> (você)</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}
