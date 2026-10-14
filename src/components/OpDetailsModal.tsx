import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Info, Clock, Timer, PauseCircle, PlayCircle, CheckCircle2, AlertTriangle, ClipboardList, Package, User, Gauge, ChevronDown, ChevronUp,
} from 'lucide-react';
import { ProductionEvent, ProductionLine, ProductionOrder, UserProfile } from '../types';
import { buildOpHistory } from '../lib/opHistory';
import { formatMsToHoursMinutes } from '../lib/productionTime';
import { getReworkInfoByOp } from '../services/db';
import { GranelBadge } from './GranelBadge';

/**
 * DETALHES DA OP — tudo o que o app sabe sobre a OP: cadastro, produção,
 * tempo de envase (trabalhado), tempo parado e ocioso, quem iniciou e quem
 * finalizou, cada pausa (motivo, observação, quem pausou/retomou),
 * apontamentos, conclusões parciais, justificativas de atraso e a linha do
 * tempo completa dos registros.
 */

interface Props {
  op: ProductionOrder;
  ops: ProductionOrder[];
  events: ProductionEvent[];
  lines: ProductionLine[];
  users: UserProfile[];
  onClose: () => void;
}

const fmtDateTime = (t: number | null) =>
  t === null ? '—' : new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtTime = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDur = (msv: number) => (msv < 60000 ? `${Math.round(msv / 1000)}s` : formatMsToHoursMinutes(msv));
const nf = (n: number) => n.toLocaleString('pt-BR');

const EVENT_LABEL: Record<string, string> = {
  STARTED: 'Iniciou',
  PAUSED: 'Pausou',
  RESUMED: 'Retomou',
  FINISHED: 'Finalizou',
  QUANTITY_REPORTED: 'Apontamento',
  CANCELLED: 'Cancelou o início',
};
const EVENT_COLOR: Record<string, string> = {
  STARTED: 'text-emerald-300',
  PAUSED: 'text-amber-300',
  RESUMED: 'text-sky-300',
  FINISHED: 'text-purple-300',
  QUANTITY_REPORTED: 'text-blue-300',
  CANCELLED: 'text-rose-300',
};

function Stat({ label, value, sub, tone = 'text-white', icon }: { label: string; value: string; sub?: string; tone?: string; icon?: ReactNode }) {
  return (
    <div className="bg-[#0b0b0e] border border-[#222228] rounded-xl p-3">
      <div className="text-[10px] text-[#71717a] uppercase font-bold flex items-center gap-1.5">{icon}{label}</div>
      <div className={`text-lg font-black font-mono mt-0.5 ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#71717a] mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-black uppercase tracking-wider text-[#d4d4d8] flex items-center gap-1.5">
        {icon}{title}{right && <span className="ml-auto normal-case tracking-normal font-semibold text-[#71717a]">{right}</span>}
      </h4>
      {children}
    </section>
  );
}

export function OpDetailsModal({ op, ops, events, lines, users, onClose }: Props) {
  const [showTimeline, setShowTimeline] = useState(false);
  const h = useMemo(() => buildOpHistory(op, events), [op, events]);
  const rework = useMemo(() => getReworkInfoByOp(events.filter(e => String(e.opId) === String(op.id))).get(String(op.id)), [events, op.id]);

  const who = (id?: string | null) => (id ? users.find(u => u.uid === id)?.name || 'Usuário' : '—');
  const lineName = (id?: string | null) => (id ? lines.find(l => l.id === id)?.name || id : '—');
  const unit = op.unidade || 'un';
  const progress = op.plannedQuantity > 0 ? Math.round((op.producedQuantity / op.plannedQuantity) * 1000) / 10 : null;
  const plannedMs = Number(op.plannedHours) > 0 ? Number(op.plannedHours) * 3600000 : 0;
  const perf = plannedMs > 0 && h.workingMs > 0 ? Math.round((plannedMs / h.workingMs) * 1000) / 10 : null;
  const rate = h.workingMs > 60000 ? Math.round(op.producedQuantity / (h.workingMs / 3600000)) : 0;
  const totalSpan = h.workingMs + h.stoppedMs;
  const statusLabel = op.status === 'in_progress' ? 'Em produção' : op.status === 'paused' ? 'Pausada' : op.status === 'completed' ? 'Concluída' : 'Em estoque';
  const statusStyle = op.status === 'in_progress' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/50'
    : op.status === 'paused' ? 'bg-amber-950/80 text-amber-300 border-amber-800/50'
    : op.status === 'completed' ? 'bg-purple-950/80 text-purple-300 border-purple-800/50'
    : 'bg-blue-950/60 text-blue-300 border-blue-800/40';
  const pauseByReason = useMemo(() => {
    const m = new Map<string, { count: number; ms: number; idle: number }>();
    for (const p of h.pauses) {
      const cur = m.get(p.reason) || { count: 0, ms: 0, idle: 0 };
      cur.count += 1; cur.ms += p.durationMs; cur.idle += p.idleMs;
      m.set(p.reason, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].ms - a[1].ms);
  }, [h.pauses]);

  const info: [string, ReactNode][] = [
    ['Tipo / setor', `${op.tipoDocumento || 'OP'}${op.setor ? ` · ${op.setor}` : ''}`],
    ['Indústria', op.industria || '—'],
    ['Lote', op.lote || '—'],
    ['Granel', op.granel ? <span className="inline-flex items-center gap-1.5">{op.granel}<GranelBadge granel={op.granel} ops={ops} /></span> : '—'],
    ['Prioridade', op.priority],
    ['Linha atual', op.lineId ? lineName(op.lineId) : 'Disponível no estoque'],
    ['Linhas em que rodou', h.lineIds.length ? h.lineIds.map(lineName).join(', ') : '—'],
    ['Programada', op.scheduledDate ? `${op.scheduledDate.split('-').reverse().join('/')}${op.scheduledEndDate && op.scheduledEndDate !== op.scheduledDate ? ` a ${op.scheduledEndDate.split('-').reverse().join('/')}` : ''}${op.scheduledShift ? ` · ${op.scheduledShift}` : ''}` : '—'],
    ['Tempo previsto', plannedMs > 0 ? formatMsToHoursMinutes(plannedMs) : '—'],
    ['Cadastrada em', fmtDateTime(op.createdAt ? new Date(op.createdAt).getTime() : null)],
    ['Turno da conclusão', op.finishedShift || '—'],
    ['Acabamento Sleev', op.isSleeve ? 'Sim' : 'Não'],
  ];

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[130] flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-[#121216] border border-[#222228] w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-[#222228] bg-blue-950/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wide">Detalhes da OP</h3>
                <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full font-mono font-bold">#{op.number}</span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${statusStyle}`}>{statusLabel}</span>
                {rework && !rework.done && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-orange-950/80 text-orange-300 border-orange-800/50">Retrabalho</span>}
              </div>
              <p className="text-xs text-[#a1a1aa] mt-1">{op.product}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#71717a] hover:text-white p-2 rounded-lg hover:bg-[#1f1f28] transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5 overflow-y-auto">
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              icon={<Package className="w-3 h-3" />}
              label="Produzido"
              value={`${nf(op.producedQuantity)} ${unit}`}
              sub={`de ${nf(op.plannedQuantity)} ${unit}${progress !== null ? ` · ${progress}%` : ''}${op.rejectedQuantity ? ` · perdas ${nf(op.rejectedQuantity)}` : ''}`}
              tone="text-emerald-300"
            />
            <Stat
              icon={<Timer className="w-3 h-3" />}
              label="Tempo de envase"
              value={h.workingMs > 0 ? formatMsToHoursMinutes(h.workingMs) : '—'}
              sub={plannedMs > 0 ? `previsto ${formatMsToHoursMinutes(plannedMs)}${perf !== null ? ` · performance ${perf}%` : ''}` : 'sem tempo previsto'}
              tone={plannedMs > 0 && h.workingMs > plannedMs ? 'text-rose-300' : 'text-white'}
            />
            <Stat
              icon={<Clock className="w-3 h-3" />}
              label="Tempo ocioso"
              value={h.idleMs > 0 ? formatMsToHoursMinutes(h.idleMs) : '0h 00m'}
              sub={`parado ${formatMsToHoursMinutes(h.stoppedMs)}${totalSpan > 0 ? ` · disponib. ${Math.round((h.workingMs / (h.workingMs + h.idleMs || 1)) * 1000) / 10}%` : ''}`}
              tone={h.idleMs > 0 ? 'text-amber-300' : 'text-white'}
            />
            <Stat
              icon={<PauseCircle className="w-3 h-3" />}
              label="Pausas"
              value={String(h.pauses.length)}
              sub={rate > 0 ? `ritmo ${nf(rate)} ${unit}/h` : (h.reports.length ? `${h.reports.length} apontamento(s)` : undefined)}
            />
          </div>

          {/* Quem iniciou / finalizou */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-[#0b0b0e] border border-[#222228] rounded-xl p-3 flex items-start gap-2.5">
              <PlayCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="text-[10px] text-[#71717a] uppercase font-bold">Iniciou</div>
                <div className="text-white font-semibold">{h.startedAt !== null ? who(h.startedBy) : 'Ainda não iniciada'}</div>
                {h.startedAt !== null && <div className="text-[11px] text-[#a1a1aa]">{fmtDateTime(h.startedAt)}</div>}
                {h.cancelledCount > 0 && <div className="text-[10px] text-rose-300 mt-0.5">{h.cancelledCount} início(s) cancelado(s) antes</div>}
              </div>
            </div>
            <div className="bg-[#0b0b0e] border border-[#222228] rounded-xl p-3 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="text-[10px] text-[#71717a] uppercase font-bold">Finalizou</div>
                <div className="text-white font-semibold">{h.finishedAt !== null ? (h.finishedBy ? who(h.finishedBy) : who(op.leaderId)) : 'Ainda não finalizada'}</div>
                {h.finishedAt !== null && <div className="text-[11px] text-[#a1a1aa]">{fmtDateTime(h.finishedAt)}{op.finishedShift ? ` · ${op.finishedShift}` : ''}</div>}
                {h.startedAt !== null && h.finishedAt !== null && <div className="text-[10px] text-[#71717a] mt-0.5">do início ao fim: {formatMsToHoursMinutes(h.finishedAt - h.startedAt)}</div>}
              </div>
            </div>
          </div>

          {/* Justificativas de atrasos / tempos excedidos */}
          <Section title="Atrasos e justificativas" icon={<AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}>
            {h.justifications.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Nenhum atraso ou tempo excedido justificado nesta OP.</p>
            ) : (
              <div className="space-y-1.5">
                {h.justifications.map((j, i) => (
                  <div key={i} className="bg-rose-950/20 border border-rose-900/40 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-rose-300">{j.what}</span>
                      <span className="text-[10px] text-[#71717a] font-mono">{fmtDateTime(j.at)} · {who(j.by)}</span>
                    </div>
                    <p className="text-[#e4e4e7] mt-0.5 italic">{j.text}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Pausas */}
          <Section
            title="Pausas"
            icon={<PauseCircle className="w-3.5 h-3.5 text-amber-400" />}
            right={h.pauses.length ? `${h.pauses.length} · parado ${formatMsToHoursMinutes(h.stoppedMs)} · ocioso ${formatMsToHoursMinutes(h.idleMs)}` : undefined}
          >
            {h.pauses.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Sem pausas registradas.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {pauseByReason.map(([reason, v]) => (
                    <span key={reason} className="text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-950/40 text-amber-200 border-amber-800/40">
                      {reason}: {v.count}x · {formatMsToHoursMinutes(v.ms)}
                    </span>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] min-w-[640px]">
                    <thead>
                      <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                        <th className="py-1.5 pr-3">Motivo</th><th className="py-1.5 pr-3">Horário</th><th className="py-1.5 pr-3 text-right">Duração</th>
                        <th className="py-1.5 pr-3 text-right">Ocioso</th><th className="py-1.5 pr-3">Observação / justificativa</th><th className="py-1.5">Pausou → retomou</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#22222b]">
                      {h.pauses.map((p, i) => (
                        <tr key={i} className="text-[#d4d4d8] align-top">
                          <td className="py-1.5 pr-3 font-semibold text-white">{p.reason}</td>
                          <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                            {new Date(p.startMs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {fmtTime(p.startMs)}–{p.endMs !== null ? fmtTime(p.endMs) : 'agora'}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-right">{fmtDur(p.durationMs)}</td>
                          <td className={`py-1.5 pr-3 font-mono text-right ${p.idleMs > 0 ? 'text-amber-300' : 'text-[#52525b]'}`}>{p.idleMs > 0 ? fmtDur(p.idleMs) : '—'}</td>
                          <td className="py-1.5 pr-3 text-[#a1a1aa]">
                            {p.observation || (!p.justification ? '—' : '')}
                            {p.justification && <span className="block text-rose-300 italic">Justificativa: {p.justification}</span>}
                          </td>
                          <td className="py-1.5 text-[#a1a1aa] whitespace-nowrap">{who(p.pausedBy)} → {p.endMs !== null ? who(p.resumedBy) : '…'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>

          {/* Apontamentos e parciais */}
          {(h.reports.length > 0 || h.partials.length > 0) && (
            <Section title="Apontamentos e conclusões parciais" icon={<ClipboardList className="w-3.5 h-3.5 text-blue-400" />}>
              <div className="space-y-1">
                {[
                  ...h.reports.map(r => ({ at: r.at, text: `Apontou ${nf(r.qty)} ${unit}`, by: r.by, extra: r.lineId ? lineName(r.lineId) : '' })),
                  ...h.partials.map(p => ({ at: p.at, text: `Conclusão parcial: ${nf(p.qty)} ${unit}`, by: p.by, extra: p.observation })),
                ].sort((a, b) => a.at - b.at).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs bg-[#0b0b0e] border border-[#222228] rounded-lg px-3 py-1.5">
                    <span className="text-white">{r.text}{r.extra ? <span className="text-[#71717a]"> · {r.extra}</span> : null}</span>
                    <span className="text-[10px] text-[#71717a] font-mono shrink-0">{fmtDateTime(r.at)} · {who(r.by)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Retrabalho */}
          {rework && (
            <Section title="Retrabalho" icon={<AlertTriangle className="w-3.5 h-3.5 text-orange-400" />}>
              <p className="text-xs text-[#d4d4d8] bg-orange-950/20 border border-orange-900/40 rounded-lg px-3 py-2">
                Faltava: <strong className="text-white">{rework.reason}</strong> · {nf(rework.quantity)} {unit} envasadas em {new Date(rework.since).toLocaleDateString('pt-BR')}
                {rework.done ? ' · retrabalho concluído' : ' · aguardando retrabalho'}
              </p>
            </Section>
          )}

          {/* Cadastro */}
          <Section title="Cadastro da OP" icon={<User className="w-3.5 h-3.5 text-[#a1a1aa]" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 bg-[#0b0b0e] border border-[#222228] rounded-xl p-3 text-xs">
              {info.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 border-b border-[#18181e] pb-1">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold">{k}</span>
                  <span className="text-[#f4f4f5] font-semibold text-right">{v}</span>
                </div>
              ))}
              {op.observation && (
                <div className="sm:col-span-2 pt-1">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Observação</span>
                  <span className="text-[#d4d4d8]">{op.observation}</span>
                </div>
              )}
            </div>
          </Section>

          {/* Linha do tempo completa */}
          <Section
            title="Linha do tempo"
            icon={<Gauge className="w-3.5 h-3.5 text-[#a1a1aa]" />}
            right={
              <button type="button" onClick={() => setShowTimeline(v => !v)} className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                {showTimeline ? <>Ocultar <ChevronUp className="w-3 h-3" /></> : <>Ver todos os {h.events.length} registros <ChevronDown className="w-3 h-3" /></>}
              </button>
            }
          >
            {showTimeline && (
              h.events.length === 0 ? (
                <p className="text-[11px] text-[#52525b]">Nenhum registro de produção para esta OP.</p>
              ) : (
                <div className="border-l-2 border-[#26262f] ml-1.5 pl-3 space-y-1.5">
                  {h.events.map(e => (
                    <div key={e.id} className="text-xs">
                      <span className="font-mono text-[10px] text-[#71717a]">{fmtDateTime(new Date(e.createdAt).getTime())}</span>{' '}
                      <span className={`font-bold ${EVENT_COLOR[e.type] || 'text-white'}`}>{EVENT_LABEL[e.type] || e.type}</span>
                      <span className="text-[#a1a1aa]"> · {who(e.leaderId)}{e.lineId ? ` · ${lineName(e.lineId)}` : ''}</span>
                      {e.reason && <span className="text-amber-200"> · {e.reason}</span>}
                      {e.quantity !== undefined && e.quantity !== null && Number(e.quantity) > 0 && <span className="text-blue-200"> · {nf(Number(e.quantity))} {unit}</span>}
                      {e.observation && String(e.observation).trim() && <span className="block text-[11px] text-[#71717a] italic">{String(e.observation).trim()}</span>}
                    </div>
                  ))}
                </div>
              )
            )}
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-[#222228] flex justify-end">
          <button type="button" onClick={onClose}
            className="h-9 px-4 bg-[#181822] hover:bg-[#222230] border border-[#2e2e3e] text-[#a1a1aa] hover:text-[#f4f4f5] text-xs font-bold rounded-xl transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
