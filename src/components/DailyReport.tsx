import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Printer, Plus, Trash2, ChevronLeft, ChevronRight, Info, Loader2, Download } from 'lucide-react';
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
import { calculateProductionTime, formatMsToHoursMinutes, getScheduledWindow } from '../lib/productionTime';
import { buildProductionLedger } from '../services/productionLedger';

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
    // Um tópico em branco por padrão — o Coordenador adiciona os que precisar
    pontos: [{ titulo: '', texto: '' }],
    seguranca: '',
    dss: '',
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

  // Salva automaticamente ao baixar/imprimir (não existe mais botão Salvar).
  // Retorna true se gravou (ou se não havia nada novo para gravar).
  const saveReport = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    const { error } = await saveDailyReport({ ...manual, date: selectedDate }, userId);
    setSaving(false);
    if (error) {
      setSaveMsg({ type: 'error', text: /daily_reports|relation|does not exist/i.test(error) ? 'A tabela do relatório ainda não existe no banco — rode sql/add_daily_reports.sql no Supabase.' : `Não foi possível salvar o relatório: ${error}` });
      return false;
    }
    setDirty(false);
    loadMonth();
    return true;
  };

  // Trocar de dia com alterações pendentes: salva antes, para não perder o que foi digitado
  const goToDate = async (d: string) => {
    if (dirty) await saveReport();
    setSelectedDate(d);
  };

  // ---------- produção do Envase por dia (e por linha) ----------
  // OP com apontamentos: vale o dia de cada apontamento/pausa/conclusão
  // (mesma regra do "Dashboard Diário"). OP sem nenhum apontamento
  // (histórico importado): vale o dia em que foi fechada.
  // Mesma fonte do Dashboard e do Dashboard Detalhado (services/productionLedger)
  const envaseProduction = useMemo(() => {
    const ledger = buildProductionLedger(ops, events);
    const byLineDay: Record<string, Record<string, number>> = {};
    const byDay = new Map<string, number>();
    const sleeveByDay = new Map<string, number>();
    for (const e of ledger) {
      if (e.sector !== 'Envase' && e.sector !== 'Sleev') continue;
      const key = e.lineId || 'sem-linha';
      const m = byLineDay[key] || (byLineDay[key] = {});
      m[e.day] = (m[e.day] || 0) + e.qty;
      const target = e.sector === 'Sleev' ? sleeveByDay : byDay;
      target.set(e.day, (target.get(e.day) || 0) + e.qty);
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
      // Ociosidade em % = ocioso ÷ (trabalhado + ocioso) — complemento da disponibilidade
      idlePct: working + idle > 0 ? Math.round((idle / (working + idle)) * 1000) / 10 : null,
      overtime: m?.overtimeMs || 0,
      setups: daySetups.length,
      setupMs,
      team,
    };
  }), [envaseLines, dayTime, envaseProduction, selectedDate, lineDailyGoals, headcounts, changeovers]);

  // Média das linhas que tiveram expediente/trabalho no dia (média simples por linha)
  const lineAvg = useMemo(() => {
    const withTime = lineRows.filter(r => r.working + r.idle > 0);
    const n = withTime.length;
    if (n === 0) return null;
    const avg = (f: (r: typeof withTime[number]) => number) => withTime.reduce((a, r) => a + f(r), 0) / n;
    return {
      n,
      working: avg(r => r.working),
      idle: avg(r => r.idle),
      idlePct: Math.round(avg(r => r.idlePct || 0) * 10) / 10,
      disp: Math.round(avg(r => r.disp || 0) * 10) / 10,
    };
  }, [lineRows]);

  const appAbsences = lineRows.reduce((acc, r) => acc + (r.team?.absent || 0), 0);

  // ---------- Paradas do dia (Envase) por motivo ----------
  const pauseRows = useMemo(() => {
    const map = new Map<string, { count: number; ms: number; details: { at: string; line: string; ms: number; obs: string; op: string }[] }>();
    for (const l of envaseLines.filter(x => !isSleeveLine(x))) {
      for (const p of dayTime.byLine[l.id]?.pauses || []) {
        const k = p.reason || 'Sem motivo';
        // "Fim de expediente" não é parada de produção — fica fora do relatório
        // (também quando o líder escolheu "Outro" e escreveu "fim de expediente")
        if (/fim\s*de\s*expediente/i.test(k) || /fim\s*d[eo]\s*expediente|fim\s*do\s*turno/i.test(String(p.observation || ''))) continue;
        // Só o pedaço da pausa dentro do expediente da linha (jornada + expediente
        // aberto/hora extra). Sem isso, uma pausa ainda aberta (ex.: Limpeza no fim
        // do dia) continuava "subindo" a noite inteira.
        const pStart = new Date(p.createdAt).getTime();
        const pEnd = pStart + p.durationMs;
        const cov: Array<[number, number]> = [];
        const sched = getScheduledWindow(pStart, l.id);
        if (sched) cov.push(sched);
        for (const ws of workSessions) {
          if (ws.lineId !== l.id) continue;
          const a = new Date(ws.startedAt).getTime();
          if (isNaN(a) || toLocalDateStr(ws.startedAt) !== selectedDate) continue;
          const b = ws.endedAt ? new Date(ws.endedAt).getTime() : Date.now();
          if (b > a) cov.push([a, b]);
        }
        cov.sort((x, y) => x[0] - y[0]);
        let clippedMs = 0;
        let lastEnd = -Infinity;
        for (const [a, b] of cov) {
          const s2 = Math.max(pStart, a, lastEnd);
          const e2 = Math.min(pEnd, b);
          if (e2 > s2) clippedMs += e2 - s2;
          lastEnd = Math.max(lastEnd, b);
        }
        if (clippedMs < 60000) continue;
        const cur = map.get(k) || { count: 0, ms: 0, details: [] };
        cur.count += 1;
        cur.ms += clippedMs;
        // Observação digitada pelo líder (ex.: o que foi o "Outro")
        const obs = String(p.observation || '').trim();
        if (obs) {
          cur.details.push({
            at: p.createdAt,
            line: l.name,
            ms: clippedMs,
            obs,
            op: p.opId ? (ops.find(o => String(o.id) === String(p.opId))?.number || '') : '',
          });
        }
        map.set(k, cur);
      }
    }
    return Array.from(map.entries())
      .map(([reason, v]) => ({ reason, ...v, details: v.details.sort((x, y) => x.at.localeCompare(y.at)) }))
      .sort((a, b) => b.ms - a.ms);
  }, [envaseLines, dayTime, ops, workSessions, selectedDate]);

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
  const OCC_ORDER = ['falta', 'atestado', 'atraso', 'saida_antecipada', 'retorno', 'acidente', 'incidente', 'hora_extra', 'free_balde'];
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
    retornos: dayOccTotals.retorno,
    freeBalde: dayOccTotals.free_balde,
    acidentes: dayOccTotals.acidente,
    incidentes: dayOccTotals.incidente,
  }), [dayHasAppOcc, dayOccTotals, manual]);

  // ---------- Quadro do dia: total do mês (até a data) ----------
  const monthTotals = useMemo(() => {
    const t = { atestados: 0, faltas: 0, atrasos: 0, saidas: 0, horaExtra: 0, retornos: 0, freeBalde: 0, acidentes: 0, incidentes: 0 };
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
      t.retornos += sum.retorno;
      t.freeBalde += sum.free_balde;
      t.acidentes += sum.acidente;
      t.incidentes += sum.incidente;
    }
    return t;
  }, [monthOccurrences, monthReports, manual, monthStart, selectedDate]);

  const occLineName = (id: string) =>
    id === 'setor-manipulacao' ? 'Manipulação' : id === 'setor-pesagem' ? 'Pesagem' : id === 'setor-estoque-mepa' ? 'Estoque ME/PA' : id === 'setor-estoque-mp' ? 'Estoque MP' : id === 'setor-estoque' ? 'Estoque' : lines.find(l => l.id === id)?.name || id;
  const safetyOcc = dayOccurrences.filter(o => o.type === 'acidente' || o.type === 'incidente');

  const filledPontos = manual.pontos.filter(p => p.texto.trim());

  // ---------- Impressão / PDF ----------
  const sheetRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // salva em segundo plano (a janela precisa abrir na hora do clique, senão o navegador bloqueia)
    saveReport();
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

  // ---------- Baixar PDF direto (sem abrir a impressão) ----------
  // Carrega sob demanda html-to-image (foto da folha, renderizada pelo próprio
  // navegador — funciona com as cores do Tailwind) e jsPDF (monta o A4).
  const [downloading, setDownloading] = useState(false);
  const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(el);
  });
  const handleDownload = async () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    setDownloading(true);
    setSaveMsg(null);
    const saved = await saveReport();
    try {
      const w = window as any;
      if (!w.htmlToImage) await loadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js');
      if (!w.jspdf?.jsPDF) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const dataUrl: string = await w.htmlToImage.toPng(sheet, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { boxShadow: 'none', borderRadius: '0', margin: '0' },
      });
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('imagem')); img.src = dataUrl; });
      const pdf = new w.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const margin = 8;
      const pageW = 210 - margin * 2;
      const pageH = 297 - margin * 2;
      const imgH = (img.height * pageW) / img.width;
      // Folha maior que uma página: repete a imagem deslocada em cada página
      let offset = 0;
      let page = 0;
      while (offset < imgH - 0.5) {
        if (page > 0) pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', margin, margin - offset, pageW, imgH);
        // cobre as margens (o pedaço da imagem que vaza para fora da área útil)
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, 210, margin, 'F');
        pdf.rect(0, 297 - margin, 210, margin, 'F');
        offset += pageH;
        page++;
      }
      pdf.save(`Relatorio_Diario_${selectedDate.split('-').reverse().join('-')}.pdf`);
      if (saved) setSaveMsg({ type: 'ok', text: 'Relatório salvo e PDF baixado.' });
    } catch (err) {
      console.error('[DailyReport] Erro ao gerar PDF:', err);
      setSaveMsg({ type: 'error', text: 'Não foi possível gerar o PDF direto (sem internet para carregar o gerador?). Use "Imprimir" e escolha "Salvar como PDF".' });
    } finally {
      setDownloading(false);
    }
  };

  // ---------- Valores extras para a folha ----------
  const workdaysOfMonth = (() => {
    let n = 0;
    const last = new Date(year, month, 0).getDate();
    for (let i = 1; i <= last; i++) { const w = new Date(year, month - 1, i).getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  })();
  const dayGoal = monthly.goal && workdaysOfMonth > 0 ? Math.round(monthly.goal / workdaysOfMonth) : null;
  const dayGoalPct = dayGoal ? Math.round((indicators.envaseDia / dayGoal) * 1000) / 10 : null;
  const monthGoalPct = monthly.goal ? Math.round((indicators.envaseMes / monthly.goal) * 1000) / 10 : null;
  const pauseTotalMs = pauseRows.reduce((a2, p) => a2 + p.ms, 0);
  const tone = (pct: number | null, good = 90, warn = 70) =>
    pct === null ? '#6b7280' : pct >= good ? '#059669' : pct >= warn ? '#d97706' : '#dc2626';
  const weekday = (() => { const [y, m, d] = selectedDate.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' }); })();
  const monthMaxDay = Math.max(1, dayGoal || 0, ...monthDays.map(d => d.qty));
  const monthlyMax = Math.max(1, monthly.goal || 0, ...monthly.rows.map(r => r.qty));

  // ---------- Estilos da folha (clara, pronta para imprimir) ----------
  const th = 'px-2 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-wide text-[#475569] border-b-2 border-[#cbd5e1]';
  const thc = th.replace('text-left', 'text-center');
  const td = 'px-2 py-1.5 text-[#1f2937] border-b border-[#e5e7eb]';
  const tdc = td + ' text-center';
  const h2 = 'flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-[#0f172a] mt-5 mb-2 pb-1 border-b border-[#e2e8f0]';
  const num = (n: number) => <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#0f172a] text-white text-[10px] font-black">{n}</span>;

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
            <button type="button" onClick={() => goToDate(shiftDay(selectedDate, -1))} className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5" title="Dia anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={e => e.target.value && goToDate(e.target.value)}
              className="h-8 bg-transparent text-xs text-[#f4f4f5] px-1 [color-scheme:dark]"
            />
            <button
              type="button"
              onClick={() => selectedDate < todayStr && goToDate(shiftDay(selectedDate, 1))}
              disabled={selectedDate >= todayStr}
              className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5 disabled:opacity-30"
              title="Próximo dia"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {dirty && (
            <span className="text-[11px] text-amber-300 font-semibold" title="As alterações são salvas automaticamente ao baixar ou imprimir">
              alterações não salvas
            </span>
          )}
          {!dirty && savedForDay && <span className="text-[11px] text-emerald-400 font-semibold">salvo</span>}
          <button
            type="button"
            onClick={handlePrint}
            className="h-9 px-3 rounded-xl bg-[#1a1a22] hover:bg-[#23232e] border border-[#2c2c3c] text-[#f4f4f5] text-xs font-bold flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloading ? 'Gerando PDF...' : 'Baixar PDF'}
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
            <h3 className="text-xs font-black text-white uppercase tracking-wider mb-1">Quadro do dia</h3>
            <p className="text-[11px] text-[#71717a] mb-2">Automático — vem das Ocorrências de Pessoal lançadas pelos líderes.</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['Faltas', dayQuadro.faltas],
                ['Atestados', dayQuadro.atestados],
                ['Atrasos', dayQuadro.atrasos],
                ['Saídas antec.', dayQuadro.saidas],
                ['Retornos', dayQuadro.retornos],
                ['Hora extra', dayQuadro.horaExtra],
              ] as [string, number][]).map(([label, v]) => (
                <div key={label} className="bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 py-1.5 text-center">
                  <div className="text-[9px] uppercase font-bold text-[#71717a]">{label}</div>
                  <div className={`text-base font-black font-mono ${v > 0 ? 'text-white' : 'text-[#52525b]'}`}>{v}</div>
                </div>
              ))}
            </div>
            {!dayHasAppOcc && (manual.faltas + manual.atestados + manual.atrasos + manual.saidasAntecipadas) > 0 && (
              <p className="text-[11px] mt-2 text-amber-300 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>Dia antigo, sem lançamentos no app — o quadro usa os números digitados naquela época.</span>
              </p>
            )}
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
              placeholder={`Em branco = "${DEFAULT_SAFETY}"`}
              className="w-full bg-[#0b0b0e] border border-[#25252c] rounded-lg p-2 text-xs text-[#f4f4f5] resize-y"
            />
            <h3 className="text-xs font-black text-white uppercase tracking-wider mt-3 mb-2">DSS</h3>
            <textarea
              value={manual.dss || ''}
              onChange={e => updateManual({ dss: e.target.value })}
              rows={2}
              placeholder="Tema do Diálogo de Segurança — em branco = não aparece no relatório"
              className="w-full bg-[#0b0b0e] border border-[#25252c] rounded-lg p-2 text-xs text-[#f4f4f5] resize-y"
            />
          </div>
        </div>

        {/* ---------------- Folha do relatório (A4, pronta para imprimir) ---------------- */}
        <div className="overflow-x-auto">
          <div ref={sheetRef} className="report-sheet bg-white text-[#1f2937] rounded-xl shadow-xl mx-auto max-w-[820px] p-8 text-[11px] leading-snug font-sans">
            {/* Cabeçalho */}
            <div className="flex items-end justify-between border-b-4 border-[#0f172a] pb-3">
              <div>
                <div className="text-[17px] tracking-wide text-[#0f172a]"><span className="font-black">YBERA</span><span className="font-light">GROUP</span></div>
                <div className="text-[15px] font-black text-[#0f172a] mt-1">Relatório Diário de Produção</div>
              </div>
              <div className="text-right">
                <div className="text-[22px] font-black text-[#0f172a] leading-none">{selectedDate.split('-').reverse().join('/')}</div>
                <div className="text-[11px] text-[#64748b] capitalize mt-1">{weekday}</div>
              </div>
            </div>

            {/* 1. Destaques */}
            <div className={h2}>{num(1)} Destaques do dia</div>
            <div className="grid grid-cols-3 gap-2">
              {/* Envase */}
              <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-3 col-span-1">
                <div className="text-[9.5px] font-black uppercase tracking-wider text-[#1d4ed8]">Envase</div>
                <div className="text-[22px] font-black text-[#0f172a] leading-tight">{nf(indicators.envaseDia)} <span className="text-[11px] font-semibold text-[#64748b]">un</span></div>
                {dayGoal ? (
                  <>
                    <div className="h-1.5 bg-white rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, dayGoalPct || 0)}%`, background: tone(dayGoalPct, 100, 80) }} /></div>
                    <div className="text-[10px] text-[#475569] mt-1">Meta do dia {nf(dayGoal)} · <strong style={{ color: tone(dayGoalPct, 100, 80) }}>{pctf(dayGoalPct)}</strong></div>
                  </>
                ) : <div className="text-[10px] text-[#64748b] mt-1">Sem meta cadastrada</div>}
                <div className="text-[10px] text-[#475569] mt-0.5">Mês: <strong>{nf(indicators.envaseMes)} un</strong>{monthGoalPct !== null ? ` (${pctf(monthGoalPct)} da meta)` : ''}</div>
              </div>
              {/* Rendimento + Disponibilidade */}
              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="text-[9.5px] font-black uppercase tracking-wider text-[#475569]">Rendimento do Envase</div>
                <div className="text-[22px] font-black leading-tight" style={{ color: tone(indicators.rendDia, 95, 85) }}>{pctf(indicators.rendDia)}</div>
                <div className="text-[10px] text-[#475569]">Mês: <strong>{pctf(indicators.rendMes)}</strong></div>
                <div className="text-[9.5px] text-[#64748b] mt-0.5">produzido ÷ esperado das OPs concluídas</div>
              </div>
              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="text-[9.5px] font-black uppercase tracking-wider text-[#475569]">Disponibilidade das linhas</div>
                <div className="text-[22px] font-black leading-tight" style={{ color: tone(lineAvg?.disp ?? null, 85, 65) }}>{lineAvg ? pctf(lineAvg.disp) : '—'}</div>
                <div className="text-[10px] text-[#475569]">Ociosidade: <strong>{lineAvg ? pctf(lineAvg.idlePct) : '—'}</strong></div>
                <div className="text-[9.5px] text-[#64748b] mt-0.5">média {lineAvg ? (lineAvg.n === 1 ? 'de 1 linha' : `das ${lineAvg.n} linhas`) : 'das linhas'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { label: 'Manipulação', dia: `${nf(indicators.manipDia)} kg`, mes: `${nf(indicators.manipMes)} kg`, color: '#0e7490', bg: '#ecfeff', border: '#a5f3fc' },
                { label: 'Pesagem', dia: `${nf(indicators.pesagemDia)} OSMs`, mes: `${nf(indicators.pesagemMes)} OSMs`, color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
                { label: 'Sleev (acabamento)', dia: `${nf(indicators.sleeveDia)} un`, mes: `${nf(indicators.sleeveMes)} un`, color: '#7e22ce', bg: '#faf5ff', border: '#e9d5ff' },
              ].map(k => (
                <div key={k.label} className="rounded-lg border px-3 py-2 flex items-center justify-between" style={{ background: k.bg, borderColor: k.border }}>
                  <div>
                    <div className="text-[9.5px] font-black uppercase tracking-wider" style={{ color: k.color }}>{k.label}</div>
                    <div className="text-[15px] font-black text-[#0f172a]">{k.dia}</div>
                  </div>
                  <div className="text-right text-[10px] text-[#475569]">Mês<br /><strong>{k.mes}</strong></div>
                </div>
              ))}
            </div>

            {/* 2. Linhas de envase */}
            <div className={h2}>{num(2)} Linhas de envase no dia</div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Linha</th>
                  <th className={thc}>Produzido</th>
                  <th className={thc}>Trabalhado</th>
                  <th className={thc}>Ocioso</th>
                  <th className={th + ' w-[150px]'}>Disponibilidade</th>
                  <th className={thc}>Hora extra</th>
                  <th className={thc}>Setups</th>
                  <th className={thc}>Equipe</th>
                </tr>
              </thead>
              <tbody>
                {lineRows.map(r => (
                  <tr key={r.id}>
                    <td className={td + ' font-bold'}>{r.name}{/sle+v/i.test(r.id) || /sle+v/i.test(r.name) ? <span className="block font-normal text-[9.5px] text-[#64748b]">acabamento</span> : null}</td>
                    <td className={tdc}>
                      <strong>{nf(r.produced)}</strong> un
                      {r.goal > 0 && <span className="block text-[9.5px]" style={{ color: tone(r.goalPct, 100, 80) }}>meta {nf(r.goal)} · {pctf(r.goalPct)}</span>}
                    </td>
                    <td className={tdc}>{r.working > 0 ? formatMsToHoursMinutes(r.working) : '—'}</td>
                    <td className={tdc}>{r.working + r.idle > 0 ? <>{formatMsToHoursMinutes(r.idle)}<span className="block text-[9.5px] text-[#64748b]">{pctf(r.idlePct)}</span></> : '—'}</td>
                    <td className={td}>
                      {r.disp !== null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r.disp}%`, background: tone(r.disp, 85, 65) }} /></div>
                          <strong className="w-11 text-right" style={{ color: tone(r.disp, 85, 65) }}>{pctf(r.disp)}</strong>
                        </div>
                      ) : '—'}
                    </td>
                    <td className={tdc}>{r.overtime >= 60000 ? formatMsToHoursMinutes(r.overtime) : '—'}</td>
                    <td className={tdc}>{r.setups > 0 ? <>{r.setups}<span className="block text-[9.5px] text-[#64748b]">{formatMsToHoursMinutes(r.setupMs)}</span></> : '—'}</td>
                    <td className={tdc}>{r.team ? <>{r.team.present}{r.team.absent > 0 && <span className="block text-[9.5px] text-[#dc2626]">{r.team.absent} falta{r.team.absent > 1 ? 's' : ''}</span>}</> : '—'}</td>
                  </tr>
                ))}
                {lineAvg && (
                  <tr className="bg-[#f1f5f9]">
                    <td className={td + ' font-black'}>Média {lineAvg.n === 1 ? '(1 linha)' : `das ${lineAvg.n} linhas`}</td>
                    <td className={tdc}>—</td>
                    <td className={tdc + ' font-bold'}>{formatMsToHoursMinutes(lineAvg.working)}</td>
                    <td className={tdc + ' font-bold'}>{formatMsToHoursMinutes(lineAvg.idle)}<span className="block text-[9.5px]">{pctf(lineAvg.idlePct)}</span></td>
                    <td className={td}>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-2 bg-white rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${lineAvg.disp}%`, background: tone(lineAvg.disp, 85, 65) }} /></div>
                        <strong className="w-11 text-right" style={{ color: tone(lineAvg.disp, 85, 65) }}>{pctf(lineAvg.disp)}</strong>
                      </div>
                    </td>
                    <td className={tdc}>—</td><td className={tdc}>—</td><td className={tdc}>—</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-[9.5px] text-[#64748b] mt-1">Disponibilidade = trabalhado ÷ (trabalhado + ocioso). Ociosidade é o complemento. Intervalos tolerados (almoço até 1h, café até 15 min) não contam.</p>

            {/* 3. Paradas */}
            <div className={h2}>{num(3)} Paradas do Envase {pauseTotalMs > 0 && <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-[#64748b]">total {formatMsToHoursMinutes(pauseTotalMs)}</span>}</div>
            {pauseRows.length === 0 ? (
              <p className="text-[#94a3b8] italic">Nenhuma parada registrada.</p>
            ) : (
              <div className="space-y-1">
                {pauseRows.map(p => (
                  <div key={p.reason}>
                    <div className="flex items-center gap-2">
                      <span className="w-44 shrink-0 truncate font-semibold" title={p.reason}>{p.reason}</span>
                      <div className="flex-1 h-3 bg-[#f1f5f9] rounded overflow-hidden"><div className="h-full rounded bg-[#f59e0b]" style={{ width: `${Math.max(2, (p.ms / (pauseRows[0].ms || 1)) * 100)}%` }} /></div>
                      <span className="w-32 shrink-0 text-right"><strong>{formatMsToHoursMinutes(p.ms)}</strong> <span className="text-[#64748b]">· {p.count}x · {Math.round((p.ms / (pauseTotalMs || 1)) * 100)}%</span></span>
                    </div>
                    {/* O que o líder escreveu em cada parada (principalmente no "Outro") */}
                    {p.details.length > 0 && (
                      <ul className="ml-4 mt-0.5 mb-1 pl-2 border-l-2 border-[#fde68a] space-y-0.5">
                        {p.details.map((d, i) => (
                          <li key={i} className="text-[10px] text-[#334155]">
                            <span className="font-mono text-[#64748b]">{new Date(d.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            {' · '}{d.line}{d.op ? ` · OP ${d.op}` : ''}{' · '}{formatMsToHoursMinutes(d.ms)}
                            {' — '}<span className="italic">{d.obs}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.details.length === 0 && /^outro/i.test(p.reason) && (
                      <p className="ml-4 text-[10px] italic text-[#dc2626]">Sem descrição informada pelo líder.</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 4. Pessoas */}
            <div className={h2}>{num(4)} Pessoas</div>
            <div className="grid grid-cols-7 gap-1.5">
              {[
                ['Faltas', dayQuadro.faltas, monthTotals.faltas, '#dc2626'],
                ['Atestados', dayQuadro.atestados, monthTotals.atestados, '#0284c7'],
                ['Atrasos', dayQuadro.atrasos, monthTotals.atrasos, '#d97706'],
                ['Saídas antec.', dayQuadro.saidas, monthTotals.saidas, '#ea580c'],
                ['Retornos', dayQuadro.retornos, monthTotals.retornos, '#0d9488'],
                ['Hora extra', dayQuadro.horaExtra, monthTotals.horaExtra, '#7c3aed'],
                ['Acid. / Incid.', `${dayQuadro.acidentes}/${dayQuadro.incidentes}`, `${monthTotals.acidentes}/${monthTotals.incidentes}`, '#b91c1c'],
              ].map(([label, d, m, color]) => (
                <div key={label as string} className="rounded-lg border border-[#e2e8f0] px-2 py-1.5 text-center">
                  <div className="text-[9px] font-bold uppercase text-[#64748b] leading-tight">{label as string}</div>
                  <div className="text-[17px] font-black leading-tight" style={{ color: (typeof d === 'number' ? d > 0 : d !== '0/0') ? (color as string) : '#94a3b8' }}>{typeof d === 'number' ? nf(d) : d}</div>
                  <div className="text-[9px] text-[#64748b]">mês: {typeof m === 'number' ? nf(m) : m}</div>
                </div>
              ))}
            </div>
            {dayOccurrences.length > 0 && (
              <table className="w-full border-collapse mt-2">
                <thead><tr><th className={th}>Linha / setor</th><th className={th}>Tipo</th><th className={thc}>Hora</th><th className={th}>Colaborador</th><th className={th}>Motivo / detalhe</th></tr></thead>
                <tbody>
                  {dayOccurrences.map(o => (
                    <tr key={o.id}>
                      <td className={td}>{occLineName(o.lineId)}</td>
                      <td className={td + ' font-semibold'}>{STAFF_OCCURRENCE_LABELS[o.type]}</td>
                      <td className={tdc}>{o.occurredTime || '—'}</td>
                      <td className={td}>{o.employeeName || '—'}</td>
                      <td className={td + ' text-[#475569]'}>{o.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 5. Pontos e segurança */}
            <div className={h2}>{num(5)} Principais pontos e segurança</div>
            <div className={`rounded-lg px-3 py-2 mb-2 border ${safetyOcc.length > 0 ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-[#f0fdf4] border-[#bbf7d0]'}`}>
              <div className={`text-[9.5px] font-black uppercase tracking-wider ${safetyOcc.length > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>Segurança</div>
              {safetyOcc.length > 0 ? (
                <div className="space-y-0.5 mt-0.5">
                  {safetyOcc.map(o => (
                    <p key={o.id}><strong>{STAFF_OCCURRENCE_LABELS[o.type]}</strong> — {occLineName(o.lineId)}{o.employeeName ? ` · ${o.employeeName}` : ''}{o.reason ? `: ${o.reason}` : ''}</p>
                  ))}
                  {manual.seguranca.trim() && manual.seguranca.trim() !== DEFAULT_SAFETY && <p>{manual.seguranca.trim()}</p>}
                </div>
              ) : (
                <p className="mt-0.5">{manual.seguranca.trim() || DEFAULT_SAFETY}</p>
              )}
            </div>
            {(manual.dss || '').trim() && (
              <div className="rounded-lg px-3 py-2 mb-2 border bg-[#eff6ff] border-[#bfdbfe]">
                <div className="text-[9.5px] font-black uppercase tracking-wider text-[#1d4ed8]">DSS — Diálogo de Segurança</div>
                <p className="mt-0.5 whitespace-pre-line">{(manual.dss || '').trim()}</p>
              </div>
            )}
            {filledPontos.length === 0 ? (
              <p className="text-[#94a3b8] italic">Nenhum ponto registrado.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filledPontos.map((p, i) => (
                  <div key={i} className="rounded-lg border border-[#e2e8f0] px-3 py-2">
                    {p.titulo.trim() && <div className="text-[9.5px] font-black uppercase tracking-wider text-[#475569]">{p.titulo.trim()}</div>}
                    <p className="whitespace-pre-line">{p.texto.trim()}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 6. Envase no mês */}
            <div className={h2}>{num(6)} Envase em {MONTHS[month - 1].toLowerCase()}
              <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-[#64748b]">média {nf(monthAvg)} un/dia{dayGoal ? ` · meta ${nf(dayGoal)} un/dia` : ''}</span>
            </div>
            {monthDays.length === 0 ? (
              <p className="text-[#94a3b8] italic">Sem produção no mês.</p>
            ) : (
              <div className="relative h-[140px] flex items-end gap-[3px] pt-3">
                {/* linha tracejada = meta diária (as barras usam 100px de altura acima dos rótulos dos dias) */}
                {dayGoal ? <div className="absolute left-0 right-0 border-t-2 border-dashed border-[#059669]" style={{ bottom: `${14 + (dayGoal / monthMaxDay) * 100}px` }} /> : null}
                {monthDays.map(d => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                    <span className="text-[7.5px] text-[#475569] leading-none mb-0.5">{d.qty >= 1000 ? `${Math.round(d.qty / 100) / 10}k` : nf(d.qty)}</span>
                    <div className="w-full rounded-t" style={{ height: `${Math.max(2, (d.qty / monthMaxDay) * 100)}px`, background: d.day === selectedDate ? '#1d4ed8' : dayGoal && d.qty >= dayGoal ? '#60a5fa' : '#93c5fd' }} />
                    <span className="text-[8px] text-[#64748b] h-[14px] leading-[14px] border-t border-[#cbd5e1] w-full text-center">{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 7. Produção mensal */}
            <div className={h2}>{num(7)} Produção mensal do Envase — {year}
              <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-[#64748b]">média {milf(monthly.avg)}{monthly.goal ? ` · meta ${MONTHS[month - 1].toLowerCase()} ${milf(monthly.goal)}` : ''}</span>
            </div>
            <div className="h-[110px] flex items-end gap-2 border-b border-[#cbd5e1] pt-4">
              {monthly.rows.map((r, i) => (
                <div key={r.label} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-[8.5px] font-semibold text-[#334155] mb-0.5">{milf(r.qty)}</span>
                  <div className="w-full rounded-t" style={{ height: `${Math.max(2, (r.qty / monthlyMax) * 80)}px`, background: i === month - 1 ? '#1d4ed8' : '#93c5fd' }} />
                  <span className="text-[8.5px] text-[#64748b] mt-0.5">{r.label.slice(0, 3)}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-2 border-t border-[#e2e8f0] flex justify-between text-[9.5px] text-[#64748b]">
              <span className="italic font-semibold">Elaborado pela Coordenação</span>
              <span>Painel Industrial · dados dos registros do app</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
