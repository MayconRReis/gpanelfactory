import React, { useMemo, useState } from 'react';
import { RefreshCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { LineChangeover, ProductionLine, ProductionOrder, UserProfile } from '../types';

/**
 * LISTA DE SETUPS (troca de produto) — cada setup registrado pelo botão
 * "Setup" do líder de Envase, no período do filtro do dashboard: linha,
 * horário, duração, tipo (mesmo tipo / produto diferente), OP anterior e
 * OP seguinte. Só mostra o que foi registrado — nada estimado.
 */

interface SetupHistoryProps {
  changeovers: LineChangeover[];
  ops: ProductionOrder[];
  lines: ProductionLine[];
  users: UserProfile[];
  /** 'AAAA-MM-DD' inclusivo; sem valor = sem limite */
  rangeStart?: string;
  rangeEnd?: string;
  periodLabel?: string;
  nowMs: number;
  /** Botões ou controle de escopo (ex.: Dia vs Mês) */
  scopeToggle?: React.ReactNode;
}

const TYPE_LABEL: Record<string, string> = {
  same: 'Mesmo tipo',
  different: 'Produto diferente',
};

function localDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '0min';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
}

export function SetupHistory({ changeovers, ops, lines, users, rangeStart, rangeEnd, periodLabel, nowMs, scopeToggle }: SetupHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const opById = new Map(ops.map(o => [o.id, o]));
    const lineName = (id: string) => lines.find(l => l.id === id)?.name || id;
    const userName = (id?: string | null) => (id ? users.find(u => u.uid === id)?.name || '' : '');
    return changeovers
      .filter(c => !/reator/i.test(c.lineId))
      .map(c => {
        const startMs = new Date(c.startedAt).getTime();
        const endMs = c.endedAt ? new Date(c.endedAt).getTime() : NaN;
        const open = isNaN(endMs);
        return {
          ...c,
          startMs,
          endMs: open ? nowMs : endMs,
          open,
          day: localDateStr(startMs),
          lineName: lineName(c.lineId),
          prev: c.previousOpId ? opById.get(c.previousOpId) : undefined,
          next: c.nextOpId ? opById.get(c.nextOpId) : undefined,
          who: userName(c.startedBy),
        };
      })
      .filter(r => !isNaN(r.startMs))
      .filter(r => (!rangeStart || r.day >= rangeStart) && (!rangeEnd || r.day <= rangeEnd))
      .sort((a, b) => b.startMs - a.startMs);
  }, [changeovers, ops, lines, users, rangeStart, rangeEnd, nowMs]);

  const summary = useMemo(() => {
    const closed = rows.filter(r => !r.open);
    const byType = (t: 'same' | 'different' | null) => {
      const list = closed.filter(r => (r.setupType || null) === t);
      const total = list.reduce((acc, r) => acc + (r.endMs - r.startMs), 0);
      return { count: list.length, avg: list.length > 0 ? total / list.length : 0 };
    };
    return { same: byType('same'), different: byType('different'), none: byType(null), total: rows.length };
  }, [rows]);

  const visible = expanded ? rows : rows.slice(0, 8);

  return (
    <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshCcw className="w-4 h-4 text-orange-400" />
          <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">Setups do Envase</h3>
          {periodLabel && (
            <span className="bg-[#1a1a22] text-[#d4d4d8] border border-[#2c2c3c] px-1.5 py-0.5 rounded text-[9px] font-bold font-mono">
              {periodLabel}
            </span>
          )}
          {scopeToggle}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#a1a1aa]">
          <span><strong className="text-white">{summary.total}</strong> setup(s)</span>
          {summary.same.count > 0 && (
            <span>Mesmo tipo: <strong className="text-emerald-300">{summary.same.count}</strong> · média <strong className="text-white">{fmtDuration(summary.same.avg)}</strong></span>
          )}
          {summary.different.count > 0 && (
            <span>Produto diferente: <strong className="text-orange-300">{summary.different.count}</strong> · média <strong className="text-white">{fmtDuration(summary.different.avg)}</strong></span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-5 text-center text-[11px] text-[#52525b]">Nenhum setup registrado no período</div>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[#71717a] uppercase tracking-wider text-[9px]">
                  <th className="py-1.5 pr-3 font-bold">Linha</th>
                  <th className="py-1.5 pr-3 font-bold">Data</th>
                  <th className="py-1.5 pr-3 font-bold">Início – Fim</th>
                  <th className="py-1.5 pr-3 font-bold">Duração</th>
                  <th className="py-1.5 pr-3 font-bold">Tipo</th>
                  <th className="py-1.5 pr-3 font-bold">OP anterior</th>
                  <th className="py-1.5 pr-3 font-bold">OP seguinte</th>
                  <th className="py-1.5 font-bold">Líder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22222b]">
                {visible.map(r => (
                  <tr key={r.id} className="text-[#d4d4d8]">
                    <td className="py-2 pr-3 font-bold text-white whitespace-nowrap">{r.lineName}</td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{new Date(r.startMs).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                      {new Date(r.startMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {r.open ? <span className="text-orange-300">em andamento</span> : new Date(r.endMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2 pr-3 font-mono font-bold text-white whitespace-nowrap">{fmtDuration(r.endMs - r.startMs)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.setupType ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${r.setupType === 'same' ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50' : 'bg-orange-950/60 text-orange-300 border-orange-800/50'}`}>
                          {TYPE_LABEL[r.setupType]}
                        </span>
                      ) : (
                        <span className="text-[#52525b]">não informado</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.prev ? <><span className="font-mono text-white">{r.prev.number}</span> <span className="text-[#71717a]">{r.prev.product}</span></> : <span className="text-[#52525b]">—</span>}</td>
                    <td className="py-2 pr-3">{r.next ? <><span className="font-mono text-white">{r.next.number}</span> <span className="text-[#71717a]">{r.next.product}</span></> : <span className="text-[#52525b]">—</span>}</td>
                    <td className="py-2 whitespace-nowrap">{r.who || <span className="text-[#52525b]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões */}
          <div className="md:hidden space-y-2">
            {visible.map(r => (
              <div key={r.id} className="bg-[#0f0f14] border border-[#22222b] rounded-xl p-3 text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white">{r.lineName}</span>
                  <span className="font-mono font-bold text-white">{fmtDuration(r.endMs - r.startMs)}{r.open ? ' · em andamento' : ''}</span>
                </div>
                <div className="text-[#a1a1aa] font-mono">
                  {new Date(r.startMs).toLocaleDateString('pt-BR')} · {new Date(r.startMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  {!r.open && ` – ${new Date(r.endMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                </div>
                <div>
                  {r.setupType ? (
                    <span className={r.setupType === 'same' ? 'text-emerald-300 font-bold' : 'text-orange-300 font-bold'}>{TYPE_LABEL[r.setupType]}</span>
                  ) : (
                    <span className="text-[#52525b]">Tipo não informado</span>
                  )}
                  {r.who && <span className="text-[#71717a]"> · {r.who}</span>}
                </div>
                <div className="text-[#a1a1aa]">
                  De: <span className="text-white font-mono">{r.prev?.number || '—'}</span>{r.prev?.product ? ` ${r.prev.product}` : ''}
                </div>
                <div className="text-[#a1a1aa]">
                  Para: <span className="text-white font-mono">{r.next?.number || '—'}</span>{r.next?.product ? ` ${r.next.product}` : ''}
                </div>
              </div>
            ))}
          </div>

          {rows.length > 8 && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="w-full h-8 rounded-lg bg-[#1a1a22] text-[11px] font-bold text-[#a1a1aa] hover:text-white flex items-center justify-center gap-1 cursor-pointer"
            >
              {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Mostrar menos</> : <><ChevronDown className="w-3.5 h-3.5" /> Ver todos ({rows.length})</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}
