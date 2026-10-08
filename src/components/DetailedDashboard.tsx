import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, CalendarDays, LayoutGrid, Gauge, Factory, ListOrdered, RefreshCcw, ClipboardList, ListChecks,
  Download, Search, Package, FlaskConical, Scale, Layers, Target, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import {
  ProductionOrder, ProductionLine, UserProfile, ProductionEvent, MonthlyGoal, FactoryMonthlyGoal,
  WorkSession, LineChangeover,
} from '../types';
import { getWorkSessions, getChangeovers, isSleeveLineId, toLocalDateStr, getFactoryMonthlyGoals, getMonthlyGoals, getLineDailyGoals, getOpReferenceDateStr } from '../services/db';
import { buildProductionLedger, LedgerEntry, LedgerSector } from '../services/productionLedger';
import { calculateProductionTime, formatMsToHoursMinutes, getScheduledWindow } from '../lib/productionTime';
import { SetupHistory } from './SetupHistory';
import { ApontamentosHistorico } from './ApontamentosHistorico';
import { StaffOccurrencesSummary } from './StaffOccurrences';

/**
 * DASHBOARD DETALHADO — análise do período escolhido, em abas:
 *  Resumo · OEE · Linhas & Tempo · Produção por OP · Setups · Ocorrências
 * Todos os números de produção vêm do mesmo "livro de produção" usado pelo
 * Dashboard principal (services/productionLedger), então os dois sempre batem.
 * Unidades nunca se misturam: Envase/Sleev em Un, Manipulação/Pesagem em Kg.
 */

type Period = 'dia' | 'semana' | 'mes' | 'ano';
type Tab = 'resumo' | 'oee' | 'linhas' | 'ops' | 'apontamentos' | 'setups' | 'ocorrencias';

interface Props {
  ops: ProductionOrder[];
  lines: ProductionLine[];
  events: ProductionEvent[];
  users?: UserProfile[];
  goals?: MonthlyGoal[];
  factoryMonthlyGoals?: FactoryMonthlyGoal[];
  /** Conteúdo da aba OEE (o painel de OEE por setor, com o próprio filtro) */
  oeeSlot?: React.ReactNode;
  /** Dashboard de um setor só (telas do Envase, Manipulação e Pesagem). Sem valor = fábrica toda. */
  sector?: 'Envase' | 'Manipulação' | 'Pesagem';
  /** Dashboard de UMA linha (tela do líder do Envase): tudo filtrado para ela, com a meta diária da linha */
  lineId?: string | null;
}

const SECTOR_META: Record<LedgerSector, { label: string; unit: 'Un' | 'Kg'; color: string; icon: React.ComponentType<{ className?: string }>; text: string }> = {
  'Envase': { label: 'Envase', unit: 'Un', color: '#3b82f6', icon: Package, text: 'text-blue-300' },
  'Sleev': { label: 'Sleev', unit: 'Un', color: '#a855f7', icon: Layers, text: 'text-purple-300' },
  'Manipulação': { label: 'Manipulação', unit: 'Kg', color: '#06b6d4', icon: FlaskConical, text: 'text-cyan-300' },
  'Pesagem': { label: 'Pesagem', unit: 'Kg', color: '#f59e0b', icon: Scale, text: 'text-amber-300' },
};
const SECTORS: LedgerSector[] = ['Envase', 'Sleev', 'Manipulação', 'Pesagem'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtBR = (s: string) => s.split('-').reverse().join('/');
const nf = (n: number) => Math.round(n).toLocaleString('pt-BR');
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function periodRange(period: Period, anchor: string): [string, string] {
  const d = parseIso(anchor);
  if (period === 'dia') return [anchor, anchor];
  if (period === 'semana') {
    const dow = (d.getDay() + 6) % 7; // segunda = 0
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return [isoOf(start), isoOf(end)];
  }
  if (period === 'mes') return [isoOf(new Date(d.getFullYear(), d.getMonth(), 1)), isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
}

function shiftAnchor(period: Period, anchor: string, dir: -1 | 1): string {
  const d = parseIso(anchor);
  if (period === 'dia') d.setDate(d.getDate() + dir);
  else if (period === 'semana') d.setDate(d.getDate() + 7 * dir);
  else if (period === 'mes') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return isoOf(d);
}

function periodLabelOf(period: Period, start: string, end: string): string {
  const s = parseIso(start);
  if (period === 'dia') return s.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  if (period === 'semana') return `Semana de ${fmtBR(start)} a ${fmtBR(end)}`;
  if (period === 'mes') return s.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return `Ano de ${s.getFullYear()}`;
}

/** Dias úteis (seg–sex) de um mês — base da meta diária */
function workdaysInMonth(y: number, m: number): number {
  let n = 0;
  const last = new Date(y, m + 1, 0).getDate();
  for (let i = 1; i <= last; i++) { const w = new Date(y, m, i).getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function DetailedDashboard({ ops, lines: allLines, events, users = [], goals: goalsProp = [], factoryMonthlyGoals: factoryGoalsProp = [], oeeSlot, sector, lineId }: Props) {
  const lineIsSleeve = !!lineId && isSleeveLineId(lineId);
  // Escopo do setor: quais setores do livro de produção e quais linhas entram
  const sectorSet: LedgerSector[] = lineId ? [lineIsSleeve ? 'Sleev' : 'Envase'] : sector === 'Envase' ? ['Envase', 'Sleev'] : sector === 'Manipulação' ? ['Manipulação'] : sector === 'Pesagem' ? ['Pesagem'] : SECTORS;
  const lines = useMemo(() => allLines.filter(l => {
    if (lineId) return l.id === lineId;
    if (sector === 'Envase') return !/reator|pesagem|manipula/i.test(l.id) && !/reator/i.test(l.name);
    if (sector === 'Manipulação') return /reator/i.test(l.id) || /reator/i.test(l.name);
    if (sector === 'Pesagem') return false;
    return true;
  }), [allLines, sector, lineId]);
  const today = isoOf(new Date());
  const [tab, setTab] = useState<Tab>('resumo');
  const [period, setPeriod] = useState<Period>('dia');
  const [anchor, setAnchor] = useState(today);
  const [rangeStart, rangeEnd] = periodRange(period, anchor);
  const label = periodLabelOf(period, rangeStart, rangeEnd);
  const inRange = (day: string) => day >= rangeStart && day <= rangeEnd;

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(t); }, []);

  // Metas: usa as recebidas; nas telas dos setores (sem metas recebidas) busca sozinho
  const [loadedFactoryGoals, setLoadedFactoryGoals] = useState<FactoryMonthlyGoal[]>([]);
  const [loadedGoals, setLoadedGoals] = useState<MonthlyGoal[]>([]);
  const anchorYear = parseIso(anchor).getFullYear();
  useEffect(() => {
    if (factoryGoalsProp.length > 0 || goalsProp.length > 0) return;
    let cancelled = false;
    getFactoryMonthlyGoals(anchorYear).then(g => { if (!cancelled) setLoadedFactoryGoals(g); }).catch(() => {});
    getMonthlyGoals(anchorYear).then(g => { if (!cancelled) setLoadedGoals(g); }).catch(() => {});
    return () => { cancelled = true; };
  }, [anchorYear, factoryGoalsProp.length, goalsProp.length]);
  const factoryMonthlyGoals = factoryGoalsProp.length > 0 ? factoryGoalsProp : loadedFactoryGoals;
  const goals = goalsProp.length > 0 ? goalsProp : loadedGoals;

  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [changeovers, setChangeovers] = useState<LineChangeover[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getWorkSessions().then(l => { if (!cancelled) setWorkSessions(l); }).catch(() => {});
      getChangeovers().then(l => { if (!cancelled) setChangeovers(l); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ---------- Livro de produção (mesma fonte do Dashboard) ----------
  const ledger = useMemo(() => {
    const all = buildProductionLedger(ops, events);
    return lineId ? all.filter(e => e.lineId === lineId) : all;
  }, [ops, events, lineId]);
  const periodEntries = useMemo(() => ledger.filter(e => inRange(e.day)), [ledger, rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const t: Record<LedgerSector, number> = { 'Envase': 0, 'Sleev': 0, 'Manipulação': 0, 'Pesagem': 0 };
    let osms = 0;
    for (const e of periodEntries) { t[e.sector] += e.qty; if (e.sector === 'Pesagem') osms++; }
    return { ...t, osms };
  }, [periodEntries]);

  // OPs de Envase concluídas no período
  const envaseOpsDone = useMemo(() => ops.filter(o =>
    o.status === 'completed' && !o.isPartialRecord && (!o.setor || o.setor === 'Envase') &&
    (lineId ? o.lineId === lineId : !isSleeveLineId(o.lineId)) &&
    o.completedAt && inRange(toLocalDateStr(o.completedAt))
  ).length, [ops, rangeStart, rangeEnd, lineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Meta do Envase (meta mensal da fábrica) ----------
  // Linha: meta diária da linha (Metas de Produção) × dias úteis do mês
  const [lineDailyGoal, setLineDailyGoal] = useState<number>(0);
  useEffect(() => {
    if (!lineId) return;
    let cancelled = false;
    getLineDailyGoals().then(list => { if (!cancelled) setLineDailyGoal(list.find(g => g.lineId === lineId)?.goalQuantity || 0); }).catch(() => {});
    return () => { cancelled = true; };
  }, [lineId]);
  const monthGoal = (y: number, m: number): number => {
    if (lineId) return lineDailyGoal > 0 ? lineDailyGoal * workdaysInMonth(y, m) : 0;
    const f = factoryMonthlyGoals.find(g => g.year === y && g.month === m + 1);
    if (f && f.goalQuantity > 0) return f.goalQuantity;
    return goals.filter(g => g.year === y && g.month === m + 1).reduce((a, g) => a + (g.goalQuantity || 0), 0);
  };
  const periodGoal = useMemo(() => {
    // soma da meta diária (meta do mês ÷ dias úteis) de cada dia útil do período
    let total = 0;
    const s = parseIso(rangeStart);
    const e = parseIso(rangeEnd);
    for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const w = d.getDay();
      if (w === 0 || w === 6) continue;
      const g = monthGoal(d.getFullYear(), d.getMonth());
      const wd = workdaysInMonth(d.getFullYear(), d.getMonth());
      if (g > 0 && wd > 0) total += g / wd;
    }
    return Math.round(total);
  }, [rangeStart, rangeEnd, factoryMonthlyGoals, goals, lineDailyGoal, lineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Gráfico do Resumo ----------
  const [chartSector, setChartSector] = useState<LedgerSector>(lineIsSleeve ? 'Sleev' : sector === 'Manipulação' ? 'Manipulação' : sector === 'Pesagem' ? 'Pesagem' : 'Envase');
  const chartData = useMemo(() => {
    const byYearMonth = period === 'ano';
    // Dia/semana: mostra o mês inteiro em volta (contexto); mês: o mês; ano: 12 meses
    const [cs, ce] = period === 'dia' || period === 'semana' ? periodRange('mes', anchor) : [rangeStart, rangeEnd];
    if (byYearMonth) {
      const y = parseIso(rangeStart).getFullYear();
      const arr = MONTHS.map((m, i) => ({ label: m, value: 0, goal: (chartSector === 'Envase' || !!lineId) ? monthGoal(y, i) : 0, highlight: false }));
      for (const e of ledger) {
        if (e.sector !== chartSector || !e.day.startsWith(String(y))) continue;
        arr[Number(e.day.slice(5, 7)) - 1].value += chartSector === 'Pesagem' ? 1 : e.qty;
      }
      return arr;
    }
    const arr: { label: string; day: string; value: number; goal: number; highlight: boolean }[] = [];
    for (let d = parseIso(cs); isoOf(d) <= ce; d.setDate(d.getDate() + 1)) {
      const day = isoOf(d);
      const w = d.getDay();
      const g = (chartSector === 'Envase' || !!lineId) && w !== 0 && w !== 6
        ? Math.round(monthGoal(d.getFullYear(), d.getMonth()) / Math.max(1, workdaysInMonth(d.getFullYear(), d.getMonth())))
        : 0;
      arr.push({ label: String(d.getDate()), day, value: 0, goal: g, highlight: inRange(day) });
    }
    const idx = new Map(arr.map((a, i) => [a.day, i]));
    for (const e of ledger) {
      if (e.sector !== chartSector) continue;
      const i = idx.get(e.day);
      if (i !== undefined) arr[i].value += chartSector === 'Pesagem' ? 1 : e.qty;
    }
    return arr;
  }, [ledger, chartSector, period, anchor, rangeStart, rangeEnd, factoryMonthlyGoals, goals, lineDailyGoal]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartGoalLine = (chartSector === 'Envase' || !!lineId) && period !== 'ano'
    ? Math.round(monthGoal(parseIso(anchor).getFullYear(), parseIso(anchor).getMonth()) / Math.max(1, workdaysInMonth(parseIso(anchor).getFullYear(), parseIso(anchor).getMonth())))
    : 0;
  const chartUnit = chartSector === 'Pesagem' ? 'OSMs' : SECTOR_META[chartSector].unit;

  // ---------- Linhas & Tempo ----------
  const timeMetrics = useMemo(() => calculateProductionTime(events, ops, lines, {
    rangeStart, rangeEnd, referenceTime: nowTick, workSessions, changeovers,
  }), [events, ops, lines, rangeStart, rangeEnd, nowTick, workSessions, changeovers]);

  const lineRows = useMemo(() => {
    const prodByLine = new Map<string, { qty: number; unit: 'Un' | 'Kg' }>();
    for (const e of periodEntries) {
      if (!e.lineId || e.sector === 'Pesagem') continue;
      const cur = prodByLine.get(e.lineId) || { qty: 0, unit: e.unit };
      cur.qty += e.qty;
      prodByLine.set(e.lineId, cur);
    }
    const doneByLine = new Map<string, number>();
    for (const o of ops) {
      if (o.status !== 'completed' || o.isPartialRecord || !o.lineId || !o.completedAt) continue;
      if (!inRange(getOpReferenceDateStr(o))) continue;
      doneByLine.set(o.lineId, (doneByLine.get(o.lineId) || 0) + 1);
    }
    const order = (l: ProductionLine) => (/reator/i.test(l.id) ? 2 : isSleeveLineId(l.id) ? 1 : 0);
    return [...lines]
      .filter(l => !/pesagem/i.test(l.id))
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'pt-BR'))
      .map(l => {
        const m = timeMetrics.byLine[l.id];
        const p = prodByLine.get(l.id);
        const working = m?.workingMs || 0;
        const idle = m?.idleMs || 0;
        const setup = m?.changeoverMs || 0;
        const hours = working / 3600000;
        return {
          line: l,
          group: /reator/i.test(l.id) ? 'Manipulação' : isSleeveLineId(l.id) ? 'Sleev' : 'Envase',
          qty: p?.qty || 0,
          unit: /reator/i.test(l.id) ? 'Kg' : 'Un',
          done: doneByLine.get(l.id) || 0,
          working, idle, setup,
          overtime: m?.overtimeMs || 0,
          disp: working + idle > 0 ? Math.round((working / (working + idle)) * 1000) / 10 : null,
          perHour: hours > 0 && p?.qty ? Math.round(p.qty / hours) : null,
        };
      });
  }, [lines, timeMetrics, periodEntries, ops, rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps



  // ---------- Paradas: quando e por quê ----------
  // Cada pausa registrada pelo líder, recortada ao expediente da linha
  // (jornada do dia + expediente aberto/hora extra) — a noite não aparece.
  const [stopLine, setStopLine] = useState<string>(lineId || (sector === 'Manipulação' ? 'todas' : 'envase'));
  useEffect(() => { if (lineId) setStopLine(lineId); }, [lineId]);
  const stopLines = useMemo(() => lines.filter(l => (sector === 'Manipulação' ? /reator/i.test(l.id) : !/reator|pesagem|manipula/i.test(l.id))), [lines, sector]);
  const coverageFor = (lineId: string, dayMs: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    const w = getScheduledWindow(dayMs, lineId);
    if (w) out.push(w);
    const dk = isoOf(new Date(dayMs));
    for (const ws of workSessions) {
      if (ws.lineId !== lineId) continue;
      const a = new Date(ws.startedAt).getTime();
      if (isNaN(a) || isoOf(new Date(a)) !== dk) continue;
      const b = ws.endedAt ? new Date(ws.endedAt).getTime() : nowTick;
      if (b > a) out.push([a, b]);
    }
    return out;
  };
  const clipToCoverage = (lineId: string, a: number, b: number): Array<[number, number]> => {
    const pieces: Array<[number, number]> = [];
    for (let d = new Date(a); d.getTime() < b; d.setHours(24, 0, 0, 0)) {
      for (const [x, y] of coverageFor(lineId, d.getTime())) {
        const s2 = Math.max(a, x); const e2 = Math.min(b, y);
        if (e2 > s2) pieces.push([s2, e2]);
      }
    }
    pieces.sort((p1, p2) => p1[0] - p2[0]);
    const merged: Array<[number, number]> = [];
    for (const p2 of pieces) {
      const last = merged[merged.length - 1];
      if (last && p2[0] <= last[1]) last[1] = Math.max(last[1], p2[1]); else merged.push([p2[0], p2[1]]);
    }
    return merged;
  };
  const isEndOfDayStop = (reason?: string, obs?: string) =>
    /fim\s*de\s*expediente/i.test(reason || '') || /fim\s*d[eo]\s*expediente|fim\s*do\s*turno/i.test(obs || '');

  const stopRows = useMemo(() => {
    const opNum = new Map(ops.map(o => [String(o.id), o.number]));
    const rows: { key: string; lineId: string; start: number; end: number; ms: number; reason: string; obs: string; op: string }[] = [];
    for (const iv of timeMetrics.intervals || []) {
      if (iv.type !== 'IDLE' || !iv.lineId) continue;
      if (!stopLines.some(l => l.id === iv.lineId)) continue;
      if (isEndOfDayStop(iv.reason, iv.observation)) continue;
      const pieces = clipToCoverage(iv.lineId, iv.startMs, iv.endMs);
      if (pieces.length === 0) continue;
      const ms = pieces.reduce((acc, [x, y]) => acc + (y - x), 0);
      if (ms < 60000) continue;
      rows.push({
        key: `${iv.lineId}-${iv.startMs}-${iv.reason}`,
        lineId: iv.lineId,
        start: pieces[0][0],
        end: pieces[pieces.length - 1][1],
        ms,
        reason: iv.reason || 'Sem motivo',
        obs: String(iv.observation || '').trim(),
        op: iv.opId ? (opNum.get(String(iv.opId)) || '') : '',
      });
    }
    return rows.sort((a, b) => a.start - b.start);
  }, [timeMetrics, stopLines, workSessions, nowTick, ops]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRowsFiltered = useMemo(() => stopRows.filter(r =>
    stopLine === 'todas' ? true : stopLine === 'envase' ? !isSleeveLineId(r.lineId) : r.lineId === stopLine
  ), [stopRows, stopLine]);

  // Motivos de parada: mesma base da tabela (recortada ao expediente e com o
  // mesmo filtro de linha) — os totais sempre fecham com a lista abaixo.
  const pauseReasons = useMemo(() => {
    const m = new Map<string, { ms: number; count: number }>();
    for (const r of stopRowsFiltered) {
      const key = r.reason.trim();
      const cur = m.get(key) || { ms: 0, count: 0 };
      cur.ms += r.ms; cur.count += 1;
      m.set(key, cur);
    }
    return Array.from(m.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.ms - a.ms).slice(0, 10);
  }, [stopRowsFiltered]);

  // Linha do tempo do dia (só no período "Dia"): trabalhando × parado por linha
  const dayTimeline = useMemo(() => {
    if (period !== 'dia') return null;
    const dayMs = parseIso(rangeStart).getTime();
    let from = Infinity; let to = -Infinity;
    const perLine = stopLines.map(l => {
      const cov = coverageFor(l.id, dayMs);
      cov.forEach(([a, b]) => { from = Math.min(from, a); to = Math.max(to, b); });
      const work = (timeMetrics.intervals || [])
        .filter(iv => iv.type === 'WORKING' && iv.lineId === l.id)
        .map(iv => [iv.startMs, iv.endMs] as [number, number]);
      work.forEach(([a, b]) => { from = Math.min(from, a); to = Math.max(to, b); });
      return { line: l, cov, work, stops: stopRows.filter(r => r.lineId === l.id) };
    }).filter(x => x.work.length > 0 || x.stops.length > 0);
    if (!isFinite(from) || !isFinite(to) || to <= from) return null;
    from = new Date(from).setMinutes(0, 0, 0);
    to = Math.min(new Date(to).setMinutes(59, 59, 999) + 1, dayMs + 86400000);
    return { from, to, perLine };
  }, [period, rangeStart, stopLines, timeMetrics, stopRows, workSessions, nowTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Produção por OP ----------
  const [fSector, setFSector] = useState<'Todos' | LedgerSector>('Todos');
  const [fLine, setFLine] = useState('Todas');
  const [fSearch, setFSearch] = useState('');
  const lineName = (id?: string | null) => (id ? (lines.find(l => l.id === id)?.name || id) : '—');
  const userName = (id?: string | null) => (id ? (users.find(u => u.uid === id)?.name || '') : '');
  const opRows = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return periodEntries
      .filter(e => sectorSet.includes(e.sector))
      .filter(e => fSector === 'Todos' || e.sector === fSector)
      .filter(e => fLine === 'Todas' || e.lineId === fLine)
      .filter(e => !q || e.number.toLowerCase().includes(q) || e.product.toLowerCase().includes(q) || (e.lote || '').toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [periodEntries, fSector, fLine, fSearch, sector]); // eslint-disable-line react-hooks/exhaustive-deps
  const opTotals = useMemo(() => {
    let un = 0; let kg = 0;
    for (const e of opRows) { if (e.unit === 'Un') un += e.qty; else kg += e.qty; }
    return { un, kg };
  }, [opRows]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Dia', 'Hora', 'Setor', 'Linha', 'OP/OSM', 'Produto', 'Lote', 'Quantidade', 'Unidade', 'Situação da OP', 'Líder'].map(esc).join(';'),
      ...opRows.map(e => [
        fmtBR(e.day), new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), e.sector, lineName(e.lineId),
        e.number, e.product, e.lote || '', String(Math.round(e.qty)).replace('.', ','), e.unit, statusLabel(e.opStatus), userName(e.leaderId),
      ].map(esc).join(';')),
    ];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `producao_${rangeStart}_${rangeEnd}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- UI ----------
  const ALL_TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'resumo', label: 'Resumo', icon: LayoutGrid },
    { id: 'oee', label: 'OEE', icon: Gauge },
    { id: 'linhas', label: sector === 'Manipulação' ? 'Reatores & Tempo' : 'Linhas & Tempo', icon: Factory },
    { id: 'ops', label: sector === 'Pesagem' ? 'OSMs pesadas' : sector === 'Manipulação' ? 'Produção por OSM' : 'Produção por OP', icon: ListOrdered },
    { id: 'apontamentos', label: 'Apontamentos', icon: ListChecks },
    { id: 'setups', label: 'Setups', icon: RefreshCcw },
    { id: 'ocorrencias', label: 'Ocorrências', icon: ClipboardList },
  ];
  // Dashboard de setor: sem OEE e sem Ocorrências; Setups só no Envase; Pesagem não tem tempo de linha
  const TABS = ALL_TABS.filter(t => {
    if (!sector) return t.id !== 'oee' || !!oeeSlot;
    if (t.id === 'oee' || t.id === 'ocorrencias') return false;
    if (t.id === 'setups' || t.id === 'apontamentos') return sector === 'Envase';
    if (t.id === 'linhas') return sector !== 'Pesagem';
    return true;
  });
  const card = 'bg-[#121217] border border-[#22222b] rounded-2xl';
  const chip = (active: boolean) => `h-8 px-3 rounded-lg text-[11px] font-bold border transition-all ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#16161e] border-[#26262f] text-[#a1a1aa] hover:text-white'}`;
  const mainQty = lineIsSleeve ? totals['Sleev'] : totals['Envase'];
  const periodPct = periodGoal > 0 ? Math.round((mainQty / periodGoal) * 1000) / 10 : null;
  const lineRow = lineId ? lineRows.find(r => r.line.id === lineId) : undefined;
  const usesPeriodBar = tab !== 'oee';

  return (
    <div className="space-y-4">
      {/* Abas */}
      <div className="flex items-center gap-1 overflow-x-auto bg-[#111116] border border-[#202028] p-1.5 rounded-2xl">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 h-9 px-3.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${tab === t.id ? 'bg-blue-600 text-white shadow' : 'text-[#a1a1aa] hover:text-white hover:bg-[#1a1a22]'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Período (vale para todas as abas, menos OEE que tem o próprio filtro) */}
      {usesPeriodBar && (
        <div className={`${card} p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <CalendarDays className="w-4 h-4 text-[#71717a] mr-1" />
            {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano']] as [Period, string][]).map(([p, l]) => (
              <button key={p} onClick={() => setPeriod(p)} className={chip(period === p)}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} className="h-8 w-8 rounded-lg bg-[#16161e] border border-[#26262f] text-[#a1a1aa] hover:text-white flex items-center justify-center"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs font-bold text-white capitalize min-w-[180px] text-center">{label}</span>
            <button onClick={() => setAnchor(shiftAnchor(period, anchor, 1))} disabled={periodRange(period, shiftAnchor(period, anchor, 1))[0] > today}
              className="h-8 w-8 rounded-lg bg-[#16161e] border border-[#26262f] text-[#a1a1aa] hover:text-white flex items-center justify-center disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            <input type="date" value={anchor} max={today} onChange={e => e.target.value && setAnchor(e.target.value)}
              className="h-8 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-[11px] text-white [color-scheme:dark]" />
            {anchor !== today && <button onClick={() => setAnchor(today)} className={chip(false)}>Hoje</button>}
          </div>
        </div>
      )}

      {/* ===================== RESUMO ===================== */}
      {tab === 'resumo' && (
        <div className="space-y-4">
          {(sector === 'Manipulação' || sector === 'Pesagem') && (() => {
            const sec: LedgerSector = sector === 'Manipulação' ? 'Manipulação' : 'Pesagem';
            const n = periodEntries.filter(e => e.sector === sec).length;
            const kg = totals[sec];
            const avgDisp = (() => {
              const rows = lineRows.filter(r => r.disp !== null);
              return rows.length ? Math.round((rows.reduce((a, r) => a + (r.disp || 0), 0) / rows.length) * 10) / 10 : null;
            })();
            const days = new Set(periodEntries.filter(e => e.sector === sec).map(e => e.day)).size;
            const items: [string, string, string][] = sector === 'Manipulação'
              ? [
                  ['Kg manipulados', `${nf(kg)} kg`, 'text-cyan-300'],
                  ['OSMs concluídas', nf(n), 'text-white'],
                  ['Média por OSM', n ? `${nf(kg / n)} kg` : '—', 'text-white'],
                  ['Disponibilidade dos reatores', avgDisp !== null ? `${avgDisp}%` : '—', avgDisp === null ? 'text-[#71717a]' : avgDisp >= 85 ? 'text-emerald-300' : avgDisp >= 65 ? 'text-amber-300' : 'text-rose-300'],
                ]
              : [
                  ['OSMs pesadas', nf(n), 'text-amber-300'],
                  ['Kg pesados', `${nf(kg)} kg`, 'text-white'],
                  ['Média por OSM', n ? `${nf(kg / n)} kg` : '—', 'text-white'],
                  ['Média por dia', days ? `${nf(n / days)} OSMs` : '—', 'text-white'],
                ];
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {items.map(([l, v, c]) => (
                  <div key={l} className={`${card} p-4`}>
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa]">{l}</span>
                    <p className={`text-2xl font-black font-mono mt-1 ${c}`}>{v}</p>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className={`grid grid-cols-2 ${sector === 'Envase' && !lineId ? 'lg:grid-cols-2' : 'lg:grid-cols-4'} gap-3 ${sector === 'Manipulação' || sector === 'Pesagem' ? 'hidden' : ''}`}>
            {/* Envase com meta */}
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-300 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> {lineId ? (lines[0]?.name || 'Linha') : 'Envase'}</span>
                {periodPct !== null && <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${periodPct >= 100 ? 'bg-emerald-950 text-emerald-300' : periodPct >= 80 ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'}`}>{periodPct}% da meta</span>}
              </div>
              <p className="text-2xl font-black font-mono text-white mt-1">{nf(mainQty)} <span className="text-xs text-[#71717a]">un</span></p>
              <p className="text-[10px] text-[#71717a] mt-1">
                {periodGoal > 0 ? <>Meta do período: <span className="text-[#d4d4d8] font-mono">{nf(periodGoal)} un</span></> : 'Sem meta cadastrada'} · {envaseOpsDone} OP(s) concluída(s)
              </p>
              {periodGoal > 0 && (
                <div className="h-1.5 bg-[#1f1f27] rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, periodPct || 0)}%` }} />
                </div>
              )}
            </div>
            {lineId ? (
              <>
                {/* Linha: tempo e disponibilidade */}
                <div className={`${card} p-4`}>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa]">Disponibilidade</span>
                  <p className={`text-2xl font-black font-mono mt-1 ${lineRow?.disp == null ? 'text-[#71717a]' : lineRow.disp >= 85 ? 'text-emerald-300' : lineRow.disp >= 65 ? 'text-amber-300' : 'text-rose-300'}`}>{lineRow?.disp != null ? `${lineRow.disp}%` : '—'}</p>
                  <p className="text-[10px] text-[#71717a] mt-1">Ociosidade {lineRow?.disp != null ? `${Math.round((100 - lineRow.disp) * 10) / 10}%` : '—'}</p>
                </div>
                <div className={`${card} p-4`}>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa]">Tempo</span>
                  <p className="text-2xl font-black font-mono text-emerald-300 mt-1">{lineRow?.working ? formatMsToHoursMinutes(lineRow.working) : '—'}</p>
                  <p className="text-[10px] text-[#71717a] mt-1">trabalhado · ocioso {lineRow?.idle ? formatMsToHoursMinutes(lineRow.idle) : '—'}</p>
                </div>
                <div className={`${card} p-4`}>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#a1a1aa]">Produtividade</span>
                  <p className="text-2xl font-black font-mono text-white mt-1">{lineRow?.perHour ? `${nf(lineRow.perHour)}/h` : '—'}</p>
                  <p className="text-[10px] text-[#71717a] mt-1">un por hora trabalhada</p>
                </div>
              </>
            ) : (
            <>
            {/* Sleev */}
            <div className={`${card} p-4`}>
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-300 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Sleev</span>
              <p className="text-2xl font-black font-mono text-white mt-1">{nf(totals['Sleev'])} <span className="text-xs text-[#71717a]">un</span></p>
              <p className="text-[10px] text-[#71717a] mt-1">Acabamento — separado do Envase</p>
            </div>
            </>
            )}
            {!sector && (<>
            {/* Manipulação */}
            <div className={`${card} p-4`}>
              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> Manipulação</span>
              <p className="text-2xl font-black font-mono text-white mt-1">{nf(totals['Manipulação'])} <span className="text-xs text-[#71717a]">kg</span></p>
              <p className="text-[10px] text-[#71717a] mt-1">{periodEntries.filter(e => e.sector === 'Manipulação').length} OSM(s) concluída(s)</p>
            </div>
            {/* Pesagem */}
            <div className={`${card} p-4`}>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5"><Scale className="w-3.5 h-3.5" /> Pesagem</span>
              <p className="text-2xl font-black font-mono text-white mt-1">{nf(totals.osms)} <span className="text-xs text-[#71717a]">OSMs</span></p>
              <p className="text-[10px] text-[#71717a] mt-1">{nf(totals['Pesagem'])} kg pesados</p>
            </div>
            </>)}
          </div>

          {/* Gráfico — um setor por vez, uma unidade só */}
          <div className={`${card} p-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">
                  {period === 'ano' ? 'Produção por mês' : 'Produção por dia'} — {SECTOR_META[chartSector].label} ({chartUnit})
                </h3>
                <p className="text-[10px] text-[#71717a]">
                  {period === 'ano' ? `Ano de ${parseIso(rangeStart).getFullYear()}` : `Mês de ${parseIso(anchor).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`}
                  {period === 'dia' || period === 'semana' ? ' · período selecionado em destaque' : ''}
                  {chartSector === 'Envase' && chartGoalLine > 0 ? ` · linha = meta diária (${nf(chartGoalLine)} un)` : ''}
                  {chartSector === 'Envase' && period === 'ano' ? ' · marca = meta do mês' : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {sectorSet.length > 1 && sectorSet.map(s => (
                  <button key={s} onClick={() => setChartSector(s)} className={chip(chartSector === s)}>{SECTOR_META[s].label}</button>
                ))}
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#22222b" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} width={48}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip
                    cursor={{ fill: '#ffffff08' }}
                    contentStyle={{ background: '#18181f', border: '1px solid #2c2c38', borderRadius: 10, fontSize: 11 }}
                    labelStyle={{ color: '#d4d4d8' }}
                    labelFormatter={(l: any, p: any) => (p?.[0]?.payload?.day ? fmtBR(p[0].payload.day) : l)}
                    formatter={(v: any, name: any) => [`${nf(Number(v))} ${chartUnit}`, name === 'goal' ? 'Meta' : 'Produzido']}
                  />
                  {chartGoalLine > 0 && <ReferenceLine y={chartGoalLine} stroke="#10b981" strokeDasharray="4 4" />}
                  <Bar dataKey="value" name="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={SECTOR_META[chartSector].color} fillOpacity={period === 'dia' || period === 'semana' ? (d.highlight ? 1 : 0.35) : 0.9} />
                    ))}
                  </Bar>
                  {period === 'ano' && chartSector === 'Envase' && <Bar dataKey="goal" name="goal" fill="#10b981" fillOpacity={0.25} radius={[4, 4, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por linha (rápido) */}
          <div className={`${card} p-4 ${sector === 'Pesagem' ? 'hidden' : ''}`}>
            <h3 className="text-xs font-black uppercase tracking-wider text-white mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-blue-400" /> {sector === 'Manipulação' ? 'Produção por reator no período' : 'Produção por linha no período'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {lineRows.filter(r => r.qty > 0 || r.working > 0).map(r => (
                <div key={r.line.id} className="bg-[#16161e] border border-[#24242e] rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{r.line.name}</p>
                    <p className="text-[10px] text-[#71717a]">{r.group} · disponib. {r.disp !== null ? `${r.disp}%` : '—'}</p>
                  </div>
                  <p className="text-sm font-black font-mono text-white shrink-0">{nf(r.qty)} <span className="text-[10px] text-[#71717a]">{r.unit.toLowerCase()}</span></p>
                </div>
              ))}
              {lineRows.every(r => !(r.qty > 0 || r.working > 0)) && <p className="text-[11px] text-[#52525b]">Nenhuma produção no período.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ===================== OEE ===================== */}
      {tab === 'oee' && (oeeSlot || <p className="text-xs text-[#71717a]">OEE indisponível.</p>)}

      {/* ===================== LINHAS & TEMPO ===================== */}
      {tab === 'linhas' && (
        <div className="space-y-4">
          <div className={`${card} p-4 overflow-x-auto`}>
            <h3 className="text-xs font-black uppercase tracking-wider text-white mb-1 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-400" /> Linhas — produção e tempo</h3>
            <p className="text-[10px] text-[#71717a] mb-3">Disponibilidade = trabalhado ÷ (trabalhado + ocioso). Setup faz parte do ocioso. Hora extra = expediente fora da jornada.</p>
            <table className="w-full text-[11px] min-w-[760px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                  <th className="py-1.5 pr-3">Linha</th><th className="py-1.5 pr-3 text-right">Produzido</th><th className="py-1.5 pr-3 text-right">Por hora</th>
                  <th className="py-1.5 pr-3 text-right">OPs concl.</th><th className="py-1.5 pr-3 text-right">Trabalhado</th><th className="py-1.5 pr-3 text-right">Ocioso</th>
                  <th className="py-1.5 pr-3 text-right">Setup</th><th className="py-1.5 pr-3 text-right">Hora extra</th><th className="py-1.5 text-right">Disponib.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22222b]">
                {lineRows.map(r => (
                  <tr key={r.line.id} className="text-[#d4d4d8]">
                    <td className="py-2 pr-3"><span className="text-white font-semibold">{r.line.name}</span> <span className="text-[9px] text-[#52525b]">{r.group}</span></td>
                    <td className="py-2 pr-3 text-right font-mono text-white">{r.qty > 0 ? `${nf(r.qty)} ${r.unit.toLowerCase()}` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.perHour ? `${nf(r.perHour)}/h` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.done || '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-emerald-300">{r.working ? formatMsToHoursMinutes(r.working) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-amber-300">{r.idle ? formatMsToHoursMinutes(r.idle) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.setup ? formatMsToHoursMinutes(r.setup) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-violet-300">{r.overtime ? formatMsToHoursMinutes(r.overtime) : '—'}</td>
                    <td className="py-2 text-right font-mono font-bold">
                      {r.disp !== null ? <span className={r.disp >= 85 ? 'text-emerald-300' : r.disp >= 60 ? 'text-amber-300' : 'text-rose-300'}>{r.disp}%</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`${card} p-4`}>
            <h3 className="text-xs font-black uppercase tracking-wider text-white mb-0.5">Principais motivos de parada</h3>
            <p className="text-[10px] text-[#71717a] mb-3">Só dentro do expediente · {stopLine === 'todas' ? 'todas as linhas' : stopLine === 'envase' ? 'Envase 1 + 2' : lineName(stopLine)} (filtro da tabela "Paradas") · total {formatMsToHoursMinutes(stopRowsFiltered.reduce((a, r) => a + r.ms, 0))}</p>
            {pauseReasons.length === 0 ? (
              <p className="text-[11px] text-[#52525b]">Nenhuma pausa no período.</p>
            ) : (
              <div className="space-y-1.5">
                {pauseReasons.map(p => {
                  const max = pauseReasons[0].ms || 1;
                  return (
                    <div key={p.reason} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-[11px] text-[#d4d4d8] truncate" title={p.reason}>{p.reason}</span>
                      <div className="flex-1 h-4 bg-[#16161e] rounded overflow-hidden">
                        <div className="h-full bg-amber-500/70 rounded" style={{ width: `${Math.max(2, (p.ms / max) * 100)}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right text-[11px] font-mono text-white">{formatMsToHoursMinutes(p.ms)} <span className="text-[#71717a]">· {p.count}x</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Linha do tempo do dia */}
          {dayTimeline && (
            <div className={`${card} p-4`}>
              <h3 className="text-xs font-black uppercase tracking-wider text-white mb-1">Linha do tempo do dia</h3>
              <p className="text-[10px] text-[#71717a] mb-3"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 align-middle mr-1" />produzindo · <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500 align-middle mx-1" />parado (pausa) · <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#2a2a35] align-middle mx-1" />expediente sem OP rodando. Passe o mouse para ver o motivo.</p>
              <div className="space-y-2">
                {dayTimeline.perLine.map(({ line, cov, work, stops }) => {
                  const span = dayTimeline.to - dayTimeline.from;
                  const pos = (ms: number) => `${((ms - dayTimeline.from) / span) * 100}%`;
                  const wid = (a: number, b: number) => `${Math.max(0.3, ((b - a) / span) * 100)}%`;
                  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={line.id} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[11px] font-bold text-white truncate">{line.name}</span>
                      <div className="relative flex-1 h-6 bg-[#121217] rounded overflow-hidden border border-[#22222b]">
                        {cov.map(([a, b], i) => <div key={`c${i}`} className="absolute top-0 h-full bg-[#2a2a35]" style={{ left: pos(a), width: wid(a, b) }} />)}
                        {work.map(([a, b], i) => <div key={`w${i}`} className="absolute top-0 h-full bg-emerald-500/80" style={{ left: pos(a), width: wid(a, b) }} title={`Produzindo ${hhmm(a)}–${hhmm(b)}`} />)}
                        {stops.map(r => (
                          <div key={r.key} className="absolute top-0 h-full bg-amber-500 hover:bg-amber-400 cursor-help" style={{ left: pos(r.start), width: wid(r.start, r.end) }}
                            title={`${hhmm(r.start)}–${hhmm(r.end)} · ${formatMsToHoursMinutes(r.ms)}\n${r.reason}${r.obs ? ` — ${r.obs}` : ''}${r.op ? `\nOP ${r.op}` : ''}`} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0" />
                  <div className="relative flex-1 h-4">
                    {Array.from({ length: Math.floor((dayTimeline.to - dayTimeline.from) / 3600000) + 1 }, (_, i) => dayTimeline.from + i * 3600000).map(t => (
                      <span key={t} className="absolute text-[9px] text-[#71717a] -translate-x-1/2" style={{ left: `${((t - dayTimeline.from) / (dayTimeline.to - dayTimeline.from)) * 100}%` }}>
                        {new Date(t).getHours()}h
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Paradas: quando e por quê */}
          <div className={`${card} p-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Paradas — quando e por quê</h3>
                <p className="text-[10px] text-[#71717a]">Cada pausa dentro do expediente, com horário, motivo e o que o líder escreveu. Fim de expediente fica de fora.</p>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {sector !== 'Manipulação' && !lineId && <button onClick={() => setStopLine('envase')} className={chip(stopLine === 'envase')}>Envase</button>}
                {stopLines.map(l => <button key={l.id} onClick={() => setStopLine(l.id)} className={chip(stopLine === l.id)}>{l.name}</button>)}
                <button onClick={() => setStopLine('todas')} className={chip(stopLine === 'todas')}>Todas</button>
              </div>
            </div>
            {stopRowsFiltered.length === 0 ? (
              <p className="text-[11px] text-[#52525b] py-4 text-center">Nenhuma parada no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] min-w-[760px]">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                      {period !== 'dia' && <th className="py-1.5 pr-3">Dia</th>}
                      <th className="py-1.5 pr-3">Parou</th><th className="py-1.5 pr-3">Voltou</th><th className="py-1.5 pr-3 text-right">Duração</th>
                      <th className="py-1.5 pr-3">Linha</th><th className="py-1.5 pr-3">OP</th><th className="py-1.5 pr-3">Motivo</th><th className="py-1.5">O que aconteceu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#22222b]">
                    {stopRowsFiltered.map(r => (
                      <tr key={r.key} className="text-[#d4d4d8] align-top">
                        {period !== 'dia' && <td className="py-2 pr-3 font-mono">{fmtBR(isoOf(new Date(r.start)))}</td>}
                        <td className="py-2 pr-3 font-mono text-white">{new Date(r.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-2 pr-3 font-mono">{r.end >= nowTick - 60000 ? <span className="text-amber-300">parada agora</span> : new Date(r.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold text-amber-300">{formatMsToHoursMinutes(r.ms)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{lineName(r.lineId)}</td>
                        <td className="py-2 pr-3 font-mono">{r.op || '—'}</td>
                        <td className="py-2 pr-3 font-semibold text-white">{r.reason}</td>
                        <td className="py-2 text-[#a1a1aa]">{r.obs || (/^outro/i.test(r.reason) ? <span className="text-rose-400 italic">sem descrição</span> : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-[#71717a] mt-2">{stopRowsFiltered.length} parada(s) · total {formatMsToHoursMinutes(stopRowsFiltered.reduce((a, r) => a + r.ms, 0))}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== PRODUÇÃO POR OP ===================== */}
      {tab === 'ops' && (
        <div className={`${card} p-4 space-y-3`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">Produção por OP</h3>
              <p className="text-[10px] text-[#71717a]">O que foi produzido em cada OP, no dia em que foi apontado. Uma OP que rodou em vários dias aparece uma vez por dia.</p>
            </div>
            <button onClick={exportCsv} disabled={opRows.length === 0}
              className="h-8 px-3 rounded-lg bg-[#171720] hover:bg-[#20202c] border border-[#2b2b38] text-[11px] font-bold text-white flex items-center gap-1.5 disabled:opacity-40 self-start">
              <Download className="w-3.5 h-3.5 text-emerald-400" /> Exportar CSV
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={fSector} onChange={e => setFSector(e.target.value as any)} className="h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-xs text-white">
              <option value="Todos">Todos os setores</option>
              {sectorSet.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fLine} onChange={e => setFLine(e.target.value)} className="h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg px-2 text-xs text-white">
              <option value="Todas">Todas as linhas</option>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#52525b] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="OP, produto ou lote" className="w-full h-9 bg-[#0b0b0e] border border-[#25252c] rounded-lg pl-8 pr-2 text-xs text-white" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-1 rounded-lg bg-[#16161e] border border-[#24242e] text-[#a1a1aa]">{opRows.length} lançamento(s)</span>
            {opTotals.un > 0 && <span className="px-2 py-1 rounded-lg bg-blue-950/40 border border-blue-900/50 text-blue-200 font-mono">{nf(opTotals.un)} un</span>}
            {opTotals.kg > 0 && <span className="px-2 py-1 rounded-lg bg-cyan-950/40 border border-cyan-900/50 text-cyan-200 font-mono">{nf(opTotals.kg)} kg</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[820px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#71717a]">
                  <th className="py-1.5 pr-3">Dia</th><th className="py-1.5 pr-3">Setor / linha</th><th className="py-1.5 pr-3">OP</th>
                  <th className="py-1.5 pr-3">Produto</th><th className="py-1.5 pr-3">Lote</th><th className="py-1.5 pr-3 text-right">Quantidade</th>
                  <th className="py-1.5 pr-3">Situação</th><th className="py-1.5">Líder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22222b]">
                {opRows.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-[#52525b]">Nenhuma produção no período / filtro.</td></tr>
                ) : opRows.slice(0, 500).map(e => (
                  <tr key={e.key} className="text-[#d4d4d8]">
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{fmtBR(e.day)}<span className="block text-[9px] text-[#52525b]">{new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></td>
                    <td className="py-2 pr-3 whitespace-nowrap"><span className={`font-bold ${SECTOR_META[e.sector].text}`}>{e.sector}</span><span className="block text-[10px] text-[#71717a]">{e.sector === 'Pesagem' ? '—' : lineName(e.lineId)}</span></td>
                    <td className="py-2 pr-3 font-mono font-bold text-white">{e.number}</td>
                    <td className="py-2 pr-3 max-w-[280px] truncate" title={e.product}>{e.product}</td>
                    <td className="py-2 pr-3 font-mono text-[#a1a1aa]">{e.lote || '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-white whitespace-nowrap">{nf(e.qty)} {e.unit.toLowerCase()}</td>
                    <td className="py-2 pr-3">{statusLabel(e.opStatus)}</td>
                    <td className="py-2 text-[#a1a1aa]">{userName(e.leaderId) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {opRows.length > 500 && <p className="text-[10px] text-[#71717a] mt-2">Mostrando 500 de {opRows.length} — use os filtros ou o CSV para ver tudo.</p>}
          </div>
        </div>
      )}

      {/* ===================== SETUPS ===================== */}
      {/* ===================== APONTAMENTOS ===================== */}
      {tab === 'apontamentos' && (
        <ApontamentosHistorico
          ops={ops}
          events={events}
          lines={lines.filter(l => !/reator|pesagem|manipula/i.test(l.id) && !/reator/i.test(l.name))}
          users={users}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          lineId={lineId}
        />
      )}

      {tab === 'setups' && (
        <SetupHistory changeovers={changeovers} ops={ops} lines={lines} users={users}
          rangeStart={rangeStart} rangeEnd={rangeEnd} periodLabel={label} nowMs={nowTick} />
      )}

      {/* ===================== OCORRÊNCIAS ===================== */}
      {tab === 'ocorrencias' && (
        <StaffOccurrencesSummary lines={lines} rangeStart={rangeStart} rangeEnd={rangeEnd} periodLabel={label} />
      )}
    </div>
  );
}

function statusLabel(s: ProductionOrder['status']): string {
  return s === 'completed' ? 'Concluída' : s === 'in_progress' ? 'Em produção' : s === 'paused' ? 'Pausada' : 'No estoque';
}
