import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Printer, Save, Plus, Trash2, ChevronLeft, ChevronRight, Info, Loader2 } from 'lucide-react';
import {
  ProductionLine,
  ProductionOrder,
  ProductionEvent,
  MonthlyGoal,
  FactoryMonthlyGoal,
  LineDailyGoal,
  WorkSession,
  LineHeadcount,
  LineChangeover,
  DailyReportManual,
  StaffOccurrence,
} from '../types';
import {
  toLocalDateStr,
  getOpReferenceDateStr,
  isPartialFinishEvent,
  computeProductionByLineAndDay,
  getWorkSessions,
  getLineHeadcounts,
  getChangeovers,
  getHeadcountForLineDay,
  getDailyReports,
  saveDailyReport,
  getStaffOccurrences,
  sumStaffOccurrences,
  STAFF_OCCURRENCE_LABELS,
} from '../services/db';
import { calculateProductionTime, formatMsToHoursMinutes } from '../lib/productionTime';

/**
 * RELATÓRIO DO DIA — mesmo modelo do "Relatório Diário de Produção" que a
 * Coordenação já envia (indicadores, quadro do dia, principais pontos,
 * segurança, evolução do Envase no mês e produção mensal), mais os dados que
 * o app registra (produção/tempos/equipe por linha, paradas e setups).
 *
 * - Números de produção, tempos e equipe: SÓ dos registros do app.
 * - Quadro do dia (atestados/faltas/atrasos/saídas), principais pontos e
 *   segurança: digitados pelo Coordenador e salvos em daily_reports.
 * - "Baixar PDF / Imprimir" abre a folha numa janela própria e chama a
 *   impressão do navegador (dá para salvar como PDF).
 */

interface DailyReportProps {
  lines: ProductionLine[];
  ops: ProductionOrder[];
  events: ProductionEvent[];
  goals?: MonthlyGoal[];
  factoryMonthlyGoals?: FactoryMonthlyGoal[];
  lineDailyGoals?: LineDailyGoal[];
  userId?: string | null;
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DEFAULT_TOPICS = ['Pesagem', 'Manipulação', 'Envase', 'Mão de obra', 'Hora extra', 'Energia'];
const DEFAULT_SAFETY = 'Sem acidente ou incidente registrado hoje.';

const nf = (n: number, digits = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pctf = (n: number | null) => (n === null ? '—' : `${nf(n, 1)}%`);
const milf = (n: number) => (n > 0 ? `${nf(Math.round(n / 1000))} mil` : '—');

function shiftDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const ddmm = (dateStr: string) => dateStr.split('-').reverse().slice(0, 2).join('/');

const isReactorId = (id?: string | null) => !!id && /reator|pesagem|manipula/i.test(id);
function isEnvaseOp(op: ProductionOrder): boolean {
  if (op.setor === 'Pesagem' || op.setor === 'Manipulação') return false;
  if (op.tipoDocumento === 'OSM') return false;
  if (isReactorId(op.lineId)) return false;
  return true;
}

function emptyManual(date: string): DailyReportManual {
  return {
    date,
    atestados: 0,
    faltas: 0,
    atrasos: 0,
    saidasAntecipadas: 0,
    pontos: DEFAULT_TOPICS.map(t => ({ titulo: t, texto: '' })),
    seguranca: DEFAULT_SAFETY,
  };
}

export function DailyReport({ lines, ops, events, goals = [], factoryMonthlyGoals = [], lineDailyGoals = [], userId }: DailyReportProps) {
  const todayStr = toLocalDateStr(new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [year, month] = selectedDate.split('-').map(Number); // month 1-12
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

  // ---------- dados auxiliares do app ----------
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [headcounts, setHeadcounts] = useState<LineHeadcount[]>([]);
  const [changeovers, setChangeovers] = useState<LineChangeover[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getWorkSessions(), getLineHeadcounts(), getChangeovers()]).then(([ws, hc, co]) => {
      if (cancelled) return;
      setWorkSessions(ws);
      setHeadcounts(hc);
      setChangeovers(co);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ---------- parte digitada (daily_reports) ----------
  const [monthReports, setMonthReports] = useState<DailyReportManual[]>([]);
  const [manual, setManual] = useState<DailyReportManual>(() => emptyManual(todayStr));
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const loadMonth = useCallback(async () => {
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;
    const { reports, error } = await getDailyReports(monthStart, monthEnd);
    setLoadError(error);
    setMonthReports(reports);
    return reports;
  }, [year, month, monthStart]);

  useEffect(() => {
    let cancelled = false;
    loadMonth().then(reports => {
      if (cancelled) return;
      const found = reports.find(r => r.date === selectedDate);
      setManual(found ? { ...found, pontos: found.pontos.length > 0 ? found.pontos : emptyManual(selectedDate).pontos } : emptyManual(selectedDate));
      setDirty(false);
      setSaveMsg(null);
    });
    return () => { cancelled = true; };
  }, [selectedDate, loadMonth]);

  const savedForDay = monthReports.some(r => r.date === selectedDate);

  const updateManual = (patch: Partial<DailyReportManual>) => {
    setManual(m => ({ ...m, ...patch }));
    setDirty(true);
    setSaveMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const { error } = await saveDailyReport({ ...manual, date: selectedDate }, userId);
    setSaving(false);
    if (error) {
      setSaveMsg({ type: 'error', text: /daily_reports|relation|does not exist/i.test(error) ? 'A tabela do relatório ainda não existe no banco — rode sql/add_daily_reports.sql no Supabase.' : `Não foi possível salvar: ${error}` });
      return;
    }
    setDirty(false);
    setSaveMsg({ type: 'ok', text: 'Relatório salvo.' });
    loadMonth();
  };

  // ---------- produção do Envase por dia (e por linha) ----------
  // OP com apontamentos: vale o dia de cada apontamento/pausa/conclusão
  // (mesma regra do "Dashboard Diário"). OP sem nenhum apontamento
  // (histórico importado): vale o dia em que foi fechada.
  const envaseProduction = useMemo(() => {
    const envOps = ops.filter(o => o && !o.isPartialRecord && isEnvaseOp(o));
    const envIds = new Set(envOps.map(o => String(o.id)));
    const envEvents = events.filter(e => e.opId && envIds.has(String(e.opId)));
    const withQty = new Set(
      envEvents
        .filter(e => e.type === 'QUANTITY_REPORTED' || ((e.type === 'PAUSED' || e.type === 'FINISHED') && e.quantity !== undefined && e.quantity !== null))
        .map(e => String(e.opId))
    );
    const byLineDay: Record<string, Record<string, number>> = computeProductionByLineAndDay(envEvents, envOps);
    for (const op of envOps) {
      if (withQty.has(String(op.id))) continue;
      const qty = Number(op.producedQuantity) || 0;
      if (qty <= 0) continue;
      const day = getOpReferenceDateStr(op);
      if (!day) continue;
      const key = op.lineId || 'sem-linha';
      const m = byLineDay[key] || (byLineDay[key] = {});
      m[day] = (m[day] || 0) + qty;
    }
    const byDay = new Map<string, number>();
    const sleeveByDay = new Map<string, number>();
    for (const [lineId, days] of Object.entries(byLineDay)) {
      if (isReactorId(lineId)) continue;
      // Sleev é métrica separada (acabamento) — não soma no Envase
      const target = /sle+v/i.test(lineId) ? sleeveByDay : byDay;
      for (const [day, q] of Object.entries(days)) target.set(day, (target.get(day) || 0) + Number(q || 0));
    }
    return { byDay, sleeveByDay, byLineDay };
  }, [ops, events]);

  const sumSleeve = (from: string, to: string) => {
    let t = 0;
    for (const [day, q] of envaseProduction.sleeveByDay.entries()) if (day >= from && day <= to) t += q;
    return t;
  };
  const sumEnvase = (from: string, to: string) => {
    let t = 0;
    for (const [day, q] of envaseProduction.byDay.entries()) if (day >= from && day <= to) t += q;
    return t;
  };

  // ---------- Pesagem (OSMs) e Manipulação (kg) ----------
  const countPesagem = (from: string, to: string) =>
    ops.filter(o => !o.isPartialRecord && o.setor === 'Pesagem').filter(o => {
      const d = getOpReferenceDateStr(o);
      return d >= from && d <= to;
    }).length;
  const sumManip = (from: string, to: string) =>
    ops.filter(o => !o.isPartialRecord && o.setor === 'Manipulação' && o.status === 'completed').reduce((acc, o) => {
      const d = getOpReferenceDateStr(o);
      return d >= from && d <= to ? acc + (Number(o.producedQuantity) || 0) : acc;
    }, 0);

  // ---------- Rendimento do Envase (mesma regra do Dashboard) ----------
  const rendimento = (from: string, to: string): number | null => {
    const partialQtyByOp = new Map<string, number>();
    for (const ev of events) {
      if (!ev.opId || !isPartialFinishEvent(ev)) continue;
      const q = Number(ev.quantity) || 0;
      if (q > 0) partialQtyByOp.set(String(ev.opId), (partialQtyByOp.get(String(ev.opId)) || 0) + q);
    }
    let produced = 0;
    let expected = 0;
    for (const op of ops) {
      if (op.status !== 'completed' || op.isPartialRecord || !isEnvaseOp(op) || /sle+v/i.test(String(op.lineId || ''))) continue;
      const d = getOpReferenceDateStr(op);
      if (!d || d < from || d > to) continue;
      const partial = partialQtyByOp.get(String(op.id)) || 0;
      const exp = (Number(op.plannedQuantity) || 0) + partial;
      if (exp <= 0) continue;
      const prod = (Number(op.producedQuantity) || 0) + partial;
      produced += Math.min(Math.max(prod, 0), exp);
      expected += exp;
    }
    return expected > 0 ? Math.round((produced / expected) * 1000) / 10 : null;
  };

  const indicators = useMemo(() => ({
    pesagemDia: countPesagem(selectedDate, selectedDate),
    pesagemMes: countPesagem(monthStart, selectedDate),
    manipDia: sumManip(selectedDate, selectedDate),
    manipMes: sumManip(monthStart, selectedDate),
    envaseDia: sumEnvase(selectedDate, selectedDate),
    envaseMes: sumEnvase(monthStart, selectedDate),
    sleeveDia: sumSleeve(selectedDate, selectedDate),
    sleeveMes: sumSleeve(monthStart, selectedDate),
    rendDia: rendimento(selectedDate, selectedDate),
    rendMes: rendimento(monthStart, selectedDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ops, events, envaseProduction, selectedDate, monthStart]);

  // ---------- Linhas de envase no dia (tempos, equipe, setups) ----------
  // Tabela de linhas mostra Envase + Sleev (Sleev como acabamento, fora dos totais do Envase)
  const envaseLines = useMemo(() => lines.filter(l => !isReactorId(l.id) && !/reator/i.test(l.name)), [lines]);
  const isSleeveLine = (l: ProductionLine) => /sle+v/i.test(l.id) || /sle+v/i.test(l.name);
  const dayTime = useMemo(() => calculateProductionTime(events, ops, lines, {
    targetDate: selectedDate,
    referenceTime: Date.now(),
    workSessions,
    changeovers,
  }), [events, ops, lines, selectedDate, workSessions, changeovers]);

  const lineRows = useMemo(() => envaseLines.map(l => {
    const m = dayTime.byLine[l.id];
    const produced = envaseProduction.byLineDay[l.id]?.[selectedDate] || 0;
    const goal = lineDailyGoals.find(g => g.lineId === l.id)?.goalQuantity || 0;
    const team = getHeadcountForLineDay(headcounts, l.id, selectedDate);
    const daySetups = changeovers.filter(c => c.lineId === l.id && toLocalDateStr(c.startedAt) === selectedDate);
    const setupMs = daySetups.reduce((acc, c) => {
      const a = new Date(c.startedAt).getTime();
      const b = c.endedAt ? new Date(c.endedAt).getTime() : NaN;
      return !isNaN(a) && !isNaN(b) && b > a ? acc + (b - a) : acc;
    }, 0);
    const working = m?.workingMs || 0;
    const idle = m?.idleMs || 0;
    return {
      id: l.id,
      name: l.name,
      produced,
      goal,
      goalPct: goal > 0 ? Math.round((produced / goal) * 1000) / 10 : null,
      working,
      idle,
      disp: working + idle > 0 ? Math.round((working / (working + idle)) * 1000) / 10 : null,
      overtime: m?.overtimeMs || 0,
      setups: daySetups.length,
      setupMs,
      team,
    };
  }), [envaseLines, dayTime, envaseProduction, selectedDate, lineDailyGoals, headcounts, changeovers]);

  const appAbsences = lineRows.reduce((acc, r) => acc + (r.team?.absent || 0), 0);

  // ---------- Paradas do dia (Envase) por motivo ----------
  const pauseRows = useMemo(() => {
    const map = new Map<string, { count: number; ms: number }>();
    for (const l of envaseLines.filter(x => !isSleeveLine(x))) {
      for (const p of dayTime.byLine[l.id]?.pauses || []) {
        const k = p.reason || 'Sem motivo';
        const cur = map.get(k) || { count: 0, ms: 0 };
        cur.count += 1;
        cur.ms += p.durationMs;
        map.set(k, cur);
      }
    }
    return Array.from(map.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.ms - a.ms);
  }, [envaseLines, dayTime]);

  // ---------- Evolução do Envase no mês ----------
  const monthDays = useMemo(() => {
    const out: { day: string; qty: number }[] = [];
    for (const [day, q] of envaseProduction.byDay.entries()) {
      if (day >= monthStart && day <= selectedDate && q !== 0) out.push({ day, qty: q });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }, [envaseProduction, monthStart, selectedDate]);
  const monthAvg = monthDays.length > 0 ? Math.round(monthDays.reduce((a, d) => a + d.qty, 0) / monthDays.length) : 0;

  // ---------- Produção mensal (Jan → mês do relatório) ----------
  const monthly = useMemo(() => {
    const rows = Array.from({ length: month }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const from = `${year}-${mm}-01`;
      const to = i + 1 === month ? selectedDate : `${year}-${mm}-31`;
      return { label: MONTHS[i], qty: sumEnvase(from, to) };
    });
    const withData = rows.filter(r => r.qty > 0);
    const avg = withData.length > 0 ? withData.reduce((a, r) => a + r.qty, 0) / withData.length : 0;
    const factoryGoal = factoryMonthlyGoals.find(g => g.year === year && g.month === month)?.goalQuantity;
    const legacyGoal = goals.filter(g => g.year === year && g.month === month).reduce((a, g) => a + (g.goalQuantity || 0), 0);
    const goal = factoryGoal ?? (legacyGoal > 0 ? legacyGoal : null);
    return { rows, avg, goal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envaseProduction, year, month, selectedDate, factoryMonthlyGoals, goals]);

  // ---------- Ocorrências de pessoal lançadas pelos líderes (staff_occurrences) ----------
  const [monthOccurrences, setMonthOccurrences] = useState<StaffOccurrence[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => getStaffOccurrences(monthStart, selectedDate).then(res => { if (!cancelled) setMonthOccurrences(res.list); });
    load();
    // atualiza sozinho: a cada 1 min e quando a janela volta ao foco
    const timer = window.setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [monthStart, selectedDate]);
  const OCC_ORDER = ['falta', 'atestado', 'atraso', 'saida_antecipada', 'acidente', 'incidente', 'hora_extra', 'free_balde'];
  const dayOccurrences = useMemo(() => monthOccurrences
    .filter(o => o.date === selectedDate)
    .sort((a, b) => OCC_ORDER.indexOf(a.type) - OCC_ORDER.indexOf(b.type) || a.lineId.localeCompare(b.lineId) || a.createdAt.localeCompare(b.createdAt)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [monthOccurrences, selectedDate]);
  const dayOccTotals = useMemo(() => sumStaffOccurrences(dayOccurrences), [dayOccurrences]);
  const dayHasAppOcc = dayOccurrences.some(o => ['falta', 'atraso', 'atestado', 'saida_antecipada'].includes(o.type));

  // Quadro do dia: nos dias com lançamentos dos líderes vale o app; nos dias
  // sem lançamento, vale o número digitado aqui (relatórios antigos).
  const dayQuadro = useMemo(() => ({
    atestados: dayHasAppOcc ? dayOccTotals.atestado : manual.atestados,
    faltas: dayHasAppOcc ? dayOccTotals.falta : manual.faltas,
    atrasos: dayHasAppOcc ? dayOccTotals.atraso : manual.atrasos,
    saidas: dayHasAppOcc ? dayOccTotals.saida_antecipada : manual.saidasAntecipadas,
    horaExtra: dayOccTotals.hora_extra,
    freeBalde: dayOccTotals.free_balde,
    acidentes: dayOccTotals.acidente,
    incidentes: dayOccTotals.incidente,
  }), [dayHasAppOcc, dayOccTotals, manual]);

  // ---------- Quadro do dia: total do mês (até a data) ----------
  const monthTotals = useMemo(() => {
    const t = { atestados: 0, faltas: 0, atrasos: 0, saidas: 0, horaExtra: 0, freeBalde: 0, acidentes: 0, incidentes: 0 };
    const byDay = new Map<string, StaffOccurrence[]>();
    for (const o of monthOccurrences) {
      if (o.date < monthStart || o.date > selectedDate) continue;
      const l = byDay.get(o.date) || [];
      l.push(o);
      byDay.set(o.date, l);
    }
    const days = new Set<string>([...Array.from(byDay.keys()), ...monthReports.map(r => r.date).filter(d => d >= monthStart && d <= selectedDate), selectedDate]);
    for (const d of days) {
      const occ = byDay.get(d) || [];
      const sum = sumStaffOccurrences(occ);
      const hasApp = occ.some(o => ['falta', 'atraso', 'atestado', 'saida_antecipada'].includes(o.type));
      const rep = d === selectedDate ? manual : monthReports.find(r => r.date === d);
      t.atestados += hasApp ? sum.atestado : Number(rep?.atestados) || 0;
      t.faltas += hasApp ? sum.falta : Number(rep?.faltas) || 0;
      t.atrasos += hasApp ? sum.atraso : Number(rep?.atrasos) || 0;
      t.saidas += hasApp ? sum.saida_antecipada : Number(rep?.saidasAntecipadas) || 0;
      t.horaExtra += sum.hora_extra;
      t.freeBalde += sum.free_balde;
      t.acidentes += sum.acidente;
      t.incidentes += sum.incidente;
    }
    return t;
  }, [monthOccurrences, monthReports, manual, monthStart, selectedDate]);

  const occLineName = (id: string) =>
    id === 'setor-manipulacao' ? 'Manipulação' : id === 'setor-pesagem' ? 'Pesagem' : lines.find(l => l.id === id)?.name || id;
  const safetyOcc = dayOccurrences.filter(o => o.type === 'acidente' || o.type === 'incidente');

  const filledPontos = manual.pontos.filter(p => p.texto.trim());

  // ---------- Impressão / PDF ----------
  const sheetRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const w = window.open('', '_blank');
    if (!w) {
      setSaveMsg({ type: 'error', text: 'O navegador bloqueou a janela de impressão — libere pop-ups para este site.' });
      return;
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(n => n.outerHTML).join('\n');
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>Relatório Diário de Produção ${ddmm(selectedDate)}</title>${styles}
      <style>@page{size:A4;margin:12mm}html,body{background:#fff!important;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report-sheet{box-shadow:none!important;border:none!important;margin:0 auto!important;max-width:none!important}</style>
      </head><body>${sheet.outerHTML}</body></html>`);
    w.document.close();
    const go = () => { w.focus(); w.print(); };
    // espera as folhas de estilo carregarem
    setTimeout(go, 600);
  };

  // ---------- Estilos da folha (claro, igual ao PDF) ----------
  const th = 'border border-[#b7c4d6] bg-[#dce6f1] px-2 py-1 text-left font-bold text-[#1f2937]';
  const thc = th.replace('text-left', 'text-center');
  const td = 'border border-[#c9d1dc] px-2 py-1 text-[#1f2937]';
  const tdc = td + ' text-center';
  const tdTotal = 'border border-[#c9d1dc] bg-[#e2efda] px-2 py-1 text-center font-semibold text-[#1f2937]';
  const h2 = 'text-[13px] font-bold text-[#111827] mt-4 mb-1.5';

  const input = 'w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2.5 text-xs text-[#f4f4f5]';

  return (
    <div className="space-y-4">
      {/* Cabeçalho da tela */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#111116] border border-[#202028] p-4 rounded-2xl">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#f4f4f5] flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-400" /> Relatório do Dia
          </h2>
          <p className="text-xs text-[#71717a] mt-0.5">
            Produção, tempos e equipe vêm dos registros do app. Quadro do dia, principais pontos e segurança são preenchidos aqui.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#0e0e12] border border-[#222228] rounded-xl p-1">
            <button type="button" onClick={() => setSelectedDate(d => shiftDay(d, -1))} className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5" title="Dia anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="h-8 bg-transparent text-xs text-[#f4f4f5] px-1 [color-scheme:dark]"
            />
            <button
              type="button"
              onClick={() => setSelectedDate(d => (d < todayStr ? shiftDay(d, 1) : d))}
              disabled={selectedDate >= todayStr}
              className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5 disabled:opacity-30"
              title="Próximo dia"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {dirty ? 'Salvar' : savedForDay ? 'Salvo' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="h-9 px-3 rounded-xl bg-[#1a1a22] hover:bg-[#23232e] border border-[#2c2c3c] text-[#f4f4f5] text-xs font-bold flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Baixar PDF / Imprimir
          </button>
        </div>
      </div>

      {(saveMsg || loadError) && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-semibold border ${
          saveMsg?.type === 'ok' ? 'bg-emerald-950/50 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/50 border-rose-800/50 text-rose-300'
        }`}>
          {saveMsg ? saveMsg.text : `Não foi possível ler os relatórios salvos (${loadError}). Se for a primeira vez, rode sql/add_daily_reports.sql no Supabase.`}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start">
        {/* ---------------- Preenchimento (Coordenação) ---------------- */}
        <div className="bg-[#121217] border border-[#22222b] rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider mb-2">Quadro do dia</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['atestados', 'Atestados'],
                ['faltas', 'Faltas'],
                ['atrasos', 'Atrasos'],
                ['saidasAntecipadas', 'Saídas antecipadas'],
              ] as const).map(([key, label]) => (
                <label key={key} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-[#a1a1aa]">{label}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={String(manual[key] ?? 0)}
                    onChange={e => updateManual({ [key]: Math.max(0, parseInt(e.target.value || '0', 10) || 0) } as Partial<DailyReportManual>)}
                    className={input}
                  />
                </label>
              ))}
            </div>
            <p className={`text-[11px] mt-2 flex items-start gap-1.5 ${dayHasAppOcc ? 'text-emerald-300' : 'text-[#71717a]'}`}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                {dayHasAppOcc
                  ? `Os líderes lançaram ${dayOccurrences.length} ocorrência(s) hoje — o quadro usa os lançamentos do app; os campos acima valem só para dias sem lançamento.`
                  : 'Sem lançamentos dos líderes neste dia — o quadro usa os números digitados acima.'}
              </span>
            </p>
            <p className="text-[11px] text-[#71717a] mt-1 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Faltas lançadas pelos líderes nas linhas de envase neste dia: <strong className="text-[#d4d4d8]">{appAbsences}</strong>
                {appAbsences > 0 && manual.faltas !== appAbsences && (
                  <button type="button" onClick={() => updateManual({ faltas: appAbsences })} className="ml-1.5 text-blue-400 hover:text-blue-300 font-bold">
                    usar esse número
                  </button>
                )}
              </span>
            </p>
          </div>

          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider mb-2">Principais pontos do dia</h3>
            <div className="space-y-2.5">
              {manual.pontos.map((p, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={p.titulo}
                      onChange={e => updateManual({ pontos: manual.pontos.map((x, i) => (i === idx ? { ...x, titulo: e.target.value } : x)) })}
                      placeholder="Tópico"
                      className={`${input} h-8 font-bold`}
                    />
                    <button
                      type="button"
                      onClick={() => updateManual({ pontos: manual.pontos.filter((_, i) => i !== idx) })}
                      className="p-1.5 rounded-lg text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 shrink-0"
                      title="Remover tópico"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={p.texto}
                    onChange={e => updateManual({ pontos: manual.pontos.map((x, i) => (i === idx ? { ...x, texto: e.target.value } : x)) })}
                    placeholder="Em branco = não aparece no relatório"
                    rows={2}
                    className="w-full bg-[#0b0b0e] border border-[#25252c] rounded-lg p-2 text-xs text-[#f4f4f5] resize-y"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => updateManual({ pontos: [...manual.pontos, { titulo: '', texto: '' }] })}
                className="w-full h-8 rounded-lg border border-dashed border-[#2c2c3c] text-[11px] font-bold text-[#a1a1aa] hover:text-white flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar tópico
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider mb-2">Segurança</h3>
            <textarea
              value={manual.seguranca}
              onChange={e => updateManual({ seguranca: e.target.value })}
              rows={2}
              className="w-full bg-[#0b0b0e] border border-[#25252c] rounded-lg p-2 text-xs text-[#f4f4f5] resize-y"
            />
          </div>
        </div>

        {/* ---------------- Folha do relatório (igual ao PDF) ---------------- */}
        <div className="overflow-x-auto">
          <div ref={sheetRef} className="report-sheet bg-white text-[#1f2937] rounded-xl shadow-xl mx-auto max-w-[820px] p-8 text-[11.5px] leading-snug font-sans">
            <div className="text-center">
              <div className="text-[18px] tracking-wide text-[#374151]"><span className="font-black">YBERA</span><span className="font-light">GROUP</span></div>
              <div className="text-[15px] font-bold text-[#111827] mt-2">RELATÓRIO DIÁRIO DE PRODUÇÃO</div>
              <div className="text-[11px] text-[#6b7280]">{MONTHS[month - 1]} • {ddmm(selectedDate)}</div>
            </div>

            {/* 1. Indicadores */}
            <div className={h2}>1. Indicadores de produção</div>
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={th}>Indicador</th><th className={thc}>Resultado do dia</th><th className={thc}>Acumulado de {MONTHS[month - 1].toLowerCase()}</th></tr>
              </thead>
              <tbody>
                <tr><td className={td + ' font-bold'}>Pesagem</td><td className={tdc}>{nf(indicators.pesagemDia)} OPs</td><td className={tdc}>{nf(indicators.pesagemMes)} OPs</td></tr>
                <tr><td className={td + ' font-bold'}>Manipulação</td><td className={tdc}>{nf(indicators.manipDia)} kg</td><td className={tdc}>{nf(indicators.manipMes)} kg</td></tr>
                <tr><td className={td + ' font-bold'}>Envase</td><td className={tdc}>{nf(indicators.envaseDia)} un.</td><td className={tdc}>{nf(indicators.envaseMes)} un.</td></tr>
                <tr><td className={td + ' font-bold'}>Rendimento do Envase</td><td className={tdc}>{pctf(indicators.rendDia)}</td><td className={tdc}>{pctf(indicators.rendMes)}</td></tr>
                <tr><td className={td + ' font-bold'}>Sleev (acabamento)</td><td className={tdc}>{nf(indicators.sleeveDia)} un.</td><td className={tdc}>{nf(indicators.sleeveMes)} un.</td></tr>
              </tbody>
            </table>

            {/* 2. Quadro do dia */}
            <div className={h2}>2. Quadro do dia</div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thc}>Período</th><th className={thc}>Atestados</th><th className={thc}>Faltas</th><th className={thc}>Atrasos</th>
                  <th className={thc}>Saídas antecipadas</th><th className={thc}>Hora extra</th><th className={thc}>Free do balde</th><th className={thc}>Acidentes / Incidentes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={tdc + ' font-bold'}>Hoje</td>
                  <td className={tdc}>{nf(dayQuadro.atestados)}</td>
                  <td className={tdc}>{nf(dayQuadro.faltas)}</td>
                  <td className={tdc}>{nf(dayQuadro.atrasos)}</td>
                  <td className={tdc}>{nf(dayQuadro.saidas)}</td>
                  <td className={tdc}>{nf(dayQuadro.horaExtra)}</td>
                  <td className={tdc}>{nf(dayQuadro.freeBalde)}</td>
                  <td className={tdc}>{nf(dayQuadro.acidentes)} / {nf(dayQuadro.incidentes)}</td>
                </tr>
                <tr>
                  <td className={tdTotal}>Total do mês</td>
                  <td className={tdTotal}>{nf(monthTotals.atestados)}</td>
                  <td className={tdTotal}>{nf(monthTotals.faltas)}</td>
                  <td className={tdTotal}>{nf(monthTotals.atrasos)}</td>
                  <td className={tdTotal}>{nf(monthTotals.saidas)}</td>
                  <td className={tdTotal}>{nf(monthTotals.horaExtra)}</td>
                  <td className={tdTotal}>{nf(monthTotals.freeBalde)}</td>
                  <td className={tdTotal}>{nf(monthTotals.acidentes)} / {nf(monthTotals.incidentes)}</td>
                </tr>
              </tbody>
            </table>

            <div className="text-[12.5px] font-bold text-[#111827] mt-3 mb-1">Ocorrências de pessoal do dia</div>
            {dayOccurrences.length === 0 ? (
              <p className="text-[#9ca3af] italic">Nenhuma ocorrência de pessoal lançada no dia.</p>
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>Linha / setor</th><th className={th}>Tipo</th><th className={th}>Colaborador</th><th className={th}>Motivo / detalhe</th></tr></thead>
                  <tbody>
                    {dayOccurrences.map(o => (
                      <tr key={o.id}>
                        <td className={td}>{occLineName(o.lineId)}</td>
                        <td className={td}>{STAFF_OCCURRENCE_LABELS[o.type]}</td>
                        <td className={td}>{o.employeeName || '—'}{o.type === 'free_balde' && o.quantity > 1 ? ` · ${o.quantity} pessoas` : ''}</td>
                        <td className={td}>{o.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* 3. Principais pontos */}
            <div className={h2}>3. Principais pontos do dia</div>
            {filledPontos.length === 0 ? (
              <p className="text-[#9ca3af] italic">Nenhum ponto registrado.</p>
            ) : (
              <div className="space-y-0.5">
                {filledPontos.map((p, i) => (
                  <p key={i}>{p.titulo.trim() && <strong>{p.titulo.trim()}: </strong>}{p.texto.trim()}</p>
                ))}
              </div>
            )}

            <div className="text-[12.5px] font-bold text-[#111827] mt-3 mb-1">Segurança</div>
            {safetyOcc.length > 0 ? (
              <div className="space-y-0.5">
                {safetyOcc.map(o => (
                  <p key={o.id}><strong>{STAFF_OCCURRENCE_LABELS[o.type]}</strong> — {occLineName(o.lineId)}{o.employeeName ? ` · ${o.employeeName}` : ''}{o.reason ? `: ${o.reason}` : ''}</p>
                ))}
                {manual.seguranca.trim() && manual.seguranca.trim() !== DEFAULT_SAFETY && <p>{manual.seguranca.trim()}</p>}
              </div>
            ) : (
              <p>{manual.seguranca.trim() || DEFAULT_SAFETY}</p>
            )}

            {/* 4. Linhas de envase (dados do app) */}
            <div className={h2}>4. Linhas de envase no dia</div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Linha</th>
                  <th className={thc}>Produzido</th>
                  <th className={thc}>Meta do dia</th>
                  <th className={thc}>Trabalhado</th>
                  <th className={thc}>Ocioso</th>
                  <th className={thc}>Disp.</th>
                  <th className={thc}>Hora extra</th>
                  <th className={thc}>Setups</th>
                  <th className={thc}>Equipe</th>
                </tr>
              </thead>
              <tbody>
                {lineRows.map(r => (
                  <tr key={r.id}>
                    <td className={td + ' font-bold'}>{r.name}{/sle+v/i.test(r.id) || /sle+v/i.test(r.name) ? <span className="font-normal text-[#6b7280]"> (acabamento)</span> : null}</td>
                    <td className={tdc}>{nf(r.produced)} un.</td>
                    <td className={tdc}>{r.goal > 0 ? `${nf(r.goal)} (${pctf(r.goalPct)})` : '—'}</td>
                    <td className={tdc}>{r.working > 0 ? formatMsToHoursMinutes(r.working) : '—'}</td>
                    <td className={tdc}>{r.working + r.idle > 0 ? formatMsToHoursMinutes(r.idle) : '—'}</td>
                    <td className={tdc}>{pctf(r.disp)}</td>
                    <td className={tdc}>{r.overtime >= 60000 ? formatMsToHoursMinutes(r.overtime) : '—'}</td>
                    <td className={tdc}>{r.setups > 0 ? `${r.setups} · ${formatMsToHoursMinutes(r.setupMs)}` : '—'}</td>
                    <td className={tdc}>{r.team ? `${r.team.present}${r.team.absent > 0 ? ` (${r.team.absent} falta${r.team.absent > 1 ? 's' : ''})` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 5. Paradas */}
            <div className={h2}>5. Paradas do Envase</div>
            {pauseRows.length === 0 ? (
              <p className="text-[#9ca3af] italic">Nenhuma parada registrada.</p>
            ) : (
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Motivo</th><th className={thc}>Paradas</th><th className={thc}>Tempo</th></tr></thead>
                <tbody>
                  {pauseRows.map(p => (
                    <tr key={p.reason}><td className={td}>{p.reason}</td><td className={tdc}>{p.count}</td><td className={tdc}>{formatMsToHoursMinutes(p.ms)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 6 e 7. Evolução no mês + Produção mensal */}
            <div className="grid grid-cols-2 gap-6 items-start">
              <div>
                <div className={h2}>6. Evolução do Envase no mês</div>
                <table className="w-full border-collapse">
                  <thead><tr><th className={thc}>Dia</th><th className={thc}>Envase (un.)</th></tr></thead>
                  <tbody>
                    {monthDays.length === 0 ? (
                      <tr><td className={tdc} colSpan={2}>Sem produção no mês</td></tr>
                    ) : monthDays.map(d => (
                      <tr key={d.day}><td className={tdc}>{ddmm(d.day)}</td><td className={tdc}>{nf(d.qty)}</td></tr>
                    ))}
                    <tr><td className={tdTotal}>MÉDIA</td><td className={tdTotal}>{nf(monthAvg)} un.</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <div className={h2}>7. Produção Mensal ({MONTHS[0].slice(0, 3)}–{MONTHS[month - 1].slice(0, 3)}/{String(year).slice(2)})</div>
                <table className="w-full border-collapse">
                  <thead><tr><th className={thc}>Mês</th><th className={thc}>Envase</th></tr></thead>
                  <tbody>
                    {monthly.rows.map(r => (
                      <tr key={r.label}><td className={tdc}>{r.label}</td><td className={tdc}>{milf(r.qty)}</td></tr>
                    ))}
                    <tr><td className={tdTotal}>Média Ano</td><td className={tdTotal}>{milf(monthly.avg)}</td></tr>
                    <tr><td className={tdTotal}>Meta {MONTHS[month - 1]}</td><td className={tdTotal}>{monthly.goal ? milf(monthly.goal) : '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-5 text-[11px] italic font-semibold text-[#6b7280]">Elaborado pela Coordenação</p>
          </div>
        </div>
      </div>
    </div>
  );
}
