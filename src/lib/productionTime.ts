import { ProductionEvent, ProductionOrder, ProductionLine, WorkSession, LineChangeover } from '../types';

export interface TimelineInterval {
  opId?: string;
  lineId?: string;
  /** Chave de "recurso" (setor + turno) — usada para agregar tempo quando a
   * OP não está presa a uma linha cadastrada (comum no histórico importado),
   * sem misturar o tempo de recursos diferentes como se fosse um só. */
  resourceKey?: string;
  type: 'WORKING' | 'IDLE';
  startMs: number;
  endMs: number;
  durationMs: number;
  reason?: string;
  observation?: string;
}

export interface LineTimeMetrics {
  lineId: string;
  lineName?: string;
  workingMs: number;
  idleMs: number;
  totalMs: number;
  workingHours: number;
  idleHours: number;
  totalHours: number;
  workingFormatted: string;
  idleFormatted: string;
  disponibilidade: number; // 0 a 100% (Working / (Working + Idle))
  pauseCount: number;
  pauses: { reason: string; durationMs: number; createdAt: string }[];
  /** Tempo de expediente da linha no período (só quando workSessions é informado). */
  sessionMs?: number;
  /** Parte do expediente fora da jornada padrão = hora extra (só com workSessions). */
  overtimeMs?: number;
  /** true quando algum trecho do período teve expediente registrado pelo botão. */
  hasExplicitSession?: boolean;
  /** Parte do ocioso que foi troca de produto (botão "Iniciar troca"). Só com workSessions. */
  changeoverMs?: number;
}

/**
 * Jornada padrão da fábrica (hora local). Segunda a quinta 7h–17h, sexta
 * 7h–16h, fim de semana sem jornada (tudo que for feito é hora extra).
 * Índice = Date.getDay() (0 = domingo).
 */
/**
 * Pausa de INTERVALO (almoço/café): até 1h por pausa não conta como
 * ociosidade. O que passar de 1h numa mesma pausa volta a contar.
 */
export const BREAK_ALLOWANCE_MS = 60 * 60 * 1000;
export function isBreakPauseReason(reason?: string | null): boolean {
  return /^\s*intervalo/i.test(String(reason || ''));
}

export const WORK_SCHEDULE: Record<number, { start: number; end: number } | null> = {
  0: null,
  1: { start: 7, end: 17 },
  2: { start: 7, end: 17 },
  3: { start: 7, end: 17 },
  4: { start: 7, end: 17 },
  5: { start: 7, end: 16 },
  6: null,
};

/**
 * EXPEDIENTE AUTOMÁTICO
 * A partir desta data, nos dias de jornada (seg–sex), toda linha que tem OP
 * no dia começa o expediente sozinha no horário de início da jornada (7h) e,
 * se o líder não encerrar, termina sozinha no fim da jornada (17h / 16h na
 * sexta). Parada dentro desse horário conta como ociosa. O botão "Iniciar
 * expediente" só é necessário para começar ANTES das 7h (hora extra).
 * Dias passados em que NENHUMA linha da fábrica teve atividade (feriado,
 * folga) não geram expediente automático.
 */
export const AUTO_SHIFT_START_DATE = '2026-09-30';

function localDayStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Janela da jornada padrão de um dia (hora local), ou null em fim de semana. */
export function getScheduledWindow(dayMs: number): [number, number] | null {
  const d = new Date(dayMs);
  const win = WORK_SCHEDULE[d.getDay()];
  if (!win) return null;
  const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
  return [new Date(y, m, dd, win.start, 0, 0, 0).getTime(), new Date(y, m, dd, win.end, 0, 0, 0).getTime()];
}

/**
 * A linha "tem OP no dia"? — OP programada para o dia nesta linha, OP
 * finalizada nesta linha no dia, ou (hoje) OP ainda aberta na fila da linha.
 */
export function lineHasOpOnDay(lineId: string, dayStr: string, ops: ProductionOrder[], todayStr: string): boolean {
  return ops.some(op => {
    if (!op || op.lineId !== lineId) return false;
    if (op.id && String(op.id).startsWith('imp-')) return false;
    if (op.isPartialRecord) return false;
    if (op.scheduledDate === dayStr) return true;
    if (op.completedAt && localDayStr(new Date(op.completedAt).getTime()) === dayStr) return true;
    if (dayStr === todayStr && op.status !== 'completed') return true;
    return false;
  });
}

/**
 * Trecho de expediente automático de uma linha num dia, ou null.
 * `factoryHadActivity` = alguma linha trabalhou ou abriu expediente no dia
 * (só é exigido para dias passados; hoje o ocioso aparece desde as 7h).
 */
export function getAutoShiftRange(
  lineId: string,
  dayMs: number,
  ops: ProductionOrder[],
  sessions: WorkSession[],
  refTime: number,
  factoryHadActivity: boolean
): [number, number] | null {
  const dayStr = localDayStr(dayMs);
  if (dayStr < AUTO_SHIFT_START_DATE) return null;
  const win = getScheduledWindow(dayMs);
  if (!win) return null;
  const todayStr = localDayStr(refTime);
  if (dayStr > todayStr) return null;
  if (dayStr < todayStr && !factoryHadActivity) return null;
  if (!lineHasOpOnDay(lineId, dayStr, ops, todayStr)) return null;

  let [start, end] = win;
  // Encerrado pelo líder antes do fim da jornada (e sem outro expediente
  // aberto depois): o automático termina ali.
  const daySessions = sessions.filter(ss => ss.lineId === lineId && localDayStr(new Date(ss.startedAt).getTime()) === dayStr);
  if (daySessions.length > 0 && daySessions.every(ss => !!ss.endedAt)) {
    const lastEnd = Math.max(...daySessions.map(ss => new Date(ss.endedAt as string).getTime()).filter(n => !isNaN(n)));
    if (isFinite(lastEnd) && lastEnd < end) end = lastEnd;
  }
  end = Math.min(end, refTime);
  return end > start ? [start, end] : null;
}

/**
 * Estado do expediente automático AGORA (para as telas): ativo quando é dia
 * de jornada, já passou das 7h, ainda não deu o fim da jornada, a linha tem
 * OP hoje e o líder não encerrou o expediente de hoje.
 */
export function getAutoShiftNow(
  lineId: string,
  ops: ProductionOrder[],
  sessions: WorkSession[],
  now: number = Date.now()
): { active: boolean; startMs: number | null; endMs: number | null } {
  const win = getScheduledWindow(now);
  const none = { active: false, startMs: null as number | null, endMs: null as number | null };
  if (!win || now < win[0] || now >= win[1]) return none;
  const range = getAutoShiftRange(lineId, now, ops, sessions, now, true);
  if (!range) return none;
  // Ainda "vale" só se não foi encerrado agora há pouco (range termina em now)
  if (range[1] < now) return none;
  return { active: true, startMs: win[0], endMs: win[1] };
}

export interface FactoryTimeMetrics {
  workingMs: number;
  idleMs: number;
  totalMs: number;
  workingHours: number;
  idleHours: number;
  totalHours: number;
  workingFormatted: string;
  idleFormatted: string;
  disponibilidade: number; // 0 a 100%
  byLine: Record<string, LineTimeMetrics>;
  /** Tempo agregado por "recurso" (setor + turno) — ex.: "Envase|Manhã". Útil
   * pra tirar uma média por recurso quando as OPs não têm linha cadastrada
   * (histórico), sem somar o tempo de vários recursos como se fosse 1 só. */
  byResource: Record<string, { workingMs: number; idleMs: number }>;
  intervals: TimelineInterval[];
}

/**
 * Formata milissegundos em "Xh Ym" ou "Xh Ymin"
 * Ex: 3600000 -> "1h 00m" | 0 -> "0h 00m"
 */
export function formatMsToHoursMinutes(ms: number): string {
  if (!ms || ms <= 0 || isNaN(ms)) return '0h 00m';
  const totalMinutes = Math.round(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Formata horas decimais em "Xh Ym"
 */
export function formatDecimalHoursToHM(hoursDecimal: number): string {
  if (!hoursDecimal || hoursDecimal <= 0 || isNaN(hoursDecimal)) return '0h 00m';
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Calcula a taxa de produção por hora (rendimento) dividindo a quantidade produzida pelas horas trabalhadas.
 * Ex: 3.600 peças em 2 horas trabalhadas = 1.800 un/h.
 *
 * @param producedQty Quantidade total produzida
 * @param workingMs Tempo trabalhado em milissegundos
 * @returns { producedPerHour: number, workingHours: number, formatted: string }
 */
export function calculateProductionRatePerHour(
  producedQty: number,
  workingMs: number
): {
  producedPerHour: number;
  workingHours: number;
  formatted: string;
} {
  if (!producedQty || producedQty <= 0 || !workingMs || workingMs <= 0) {
    return { producedPerHour: 0, workingHours: 0, formatted: '0 un/h' };
  }
  const workingHours = workingMs / (1000 * 60 * 60);
  if (workingHours <= 0.005) {
    // Menos de ~18 segundos trabalhados
    return { producedPerHour: 0, workingHours, formatted: '0 un/h' };
  }
  const producedPerHour = Math.round(producedQty / workingHours);
  return {
    producedPerHour,
    workingHours,
    formatted: `${producedPerHour.toLocaleString('pt-BR')} un/h`,
  };
}

/**
 * Obtém os limites de timestamp (início e fim) para um dia em formato YYYY-MM-DD
 * Se targetDate for omitido, usa a data atual local.
 */
export function getDayBoundaries(targetDate?: string): { startMs: number; endMs: number } {
  let date: Date;
  if (targetDate) {
    const parts = targetDate.split('-');
    if (parts.length === 3) {
      date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      date = new Date(targetDate);
    }
  } else {
    date = new Date();
  }

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
  return { startMs: start, endMs: end };
}

/**
 * Calcula o tempo real trabalhado e o tempo ocioso (paradas) com exatidão OEE:
 *
 * - Tempo Trabalhado: soma dos intervalos reais em que a linha/OP esteve em atividade efetiva
 *   (desde STARTED até PAUSED ou FINISHED, ou até o momento atual se estiver em progresso).
 * - Tempo Ocioso: soma dos intervalos de paradas registradas
 *   (desde PAUSED até RESUMED ou FINISHED, ou até o momento atual se estiver pausada).
 *
 * Exemplo OEE:
 * Envase 1 trabalhou por 9 horas no total, porém 3 horas ficou parado aguardando insumos:
 * - Tempo Trabalhado = 6 horas
 * - Tempo Ocioso = 3 horas
 * - Disponibilidade = 6h / 9h = 66,7%
 *
 * @param events Lista de ProductionEvent gravados
 * @param ops Lista de ProductionOrder
 * @param lines Lista de linhas de produção
 * @param options Opções de filtro: targetDate ('YYYY-MM-DD' para filtrar o dia), referenceTime (timestamp atual)
 */
export function calculateProductionTime(
  events: ProductionEvent[] = [],
  ops: ProductionOrder[] = [],
  lines: ProductionLine[] = [],
  options?: {
    targetDate?: string; // e.g. '2026-09-19' para métricas de um único dia (hoje)
    rangeStart?: string; // 'YYYY-MM-DD' — início de um intervalo (ex.: mês, ano)
    rangeEnd?: string; // 'YYYY-MM-DD' — fim de um intervalo (ex.: hoje)
    referenceTime?: number; // timestamp atual (ms), default Date.now()
    filterLineId?: string; // se quiser restringir a uma linha
    /** Expedientes registrados pelo botão Iniciar/Encerrar expediente. Quando
     * informado, o ocioso da linha passa a ser: tempo de expediente − tempo
     * trabalhado (fora do expediente nada conta como ocioso). */
    workSessions?: WorkSession[];
    /** Trocas de produto registradas — viram uma fatia do ocioso ("Troca de produto"). */
    changeovers?: LineChangeover[];
  }
): FactoryTimeMetrics {
  const refTime = options?.referenceTime || Date.now();

  // Um único dia (targetDate) OU um intervalo (rangeStart/rangeEnd) — usado
  // pelos filtros de período do dashboard (Dia / Mês / Ano). Sem nenhum dos
  // dois, não há filtro de data (modo "Geral" = todo o histórico).
  let dateBoundaries: { startMs: number; endMs: number } | null = null;
  if (options?.targetDate) {
    dateBoundaries = getDayBoundaries(options.targetDate);
  } else if (options?.rangeStart || options?.rangeEnd) {
    const startMs = options.rangeStart ? getDayBoundaries(options.rangeStart).startMs : -Infinity;
    const endMs = options.rangeEnd ? getDayBoundaries(options.rangeEnd).endMs : Infinity;
    dateBoundaries = { startMs, endMs };
  }

  // 1. Mapeia OP por ID para consulta rápida
  const opMap = new Map<string, ProductionOrder>();
  for (const op of ops) {
    if (op && op.id) {
      opMap.set(op.id, op);
    }
  }

  // 2. Mapeia eventos ordenados cronologicamente
  const sortedEvents = [...(events || [])]
    .filter(e => e && e.createdAt && !isNaN(new Date(e.createdAt).getTime()))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Agrupa eventos por OP
  const eventsByOp = new Map<string, ProductionEvent[]>();
  for (const ev of sortedEvents) {
    const opId = ev.opId || 'orphan';
    const list = eventsByOp.get(opId) || [];
    list.push(ev);
    eventsByOp.set(opId, list);
  }

  // Lista de todos os intervalos brutos reconstruídos
  const allIntervals: TimelineInterval[] = [];

  // Helper para adicionar intervalo respeitando filtro de data (clamp)
  const pushInterval = (
    type: 'WORKING' | 'IDLE',
    startMs: number,
    endMs: number,
    opId?: string,
    lineId?: string,
    reason?: string,
    observation?: string,
    resourceKey?: string
  ) => {
    let actualStart = startMs;
    let actualEnd = Math.min(endMs, refTime);

    if (actualEnd <= actualStart) return;

    // Se temos filtro de data, restringe o intervalo ao dia desejado
    if (dateBoundaries) {
      actualStart = Math.max(actualStart, dateBoundaries.startMs);
      actualEnd = Math.min(actualEnd, dateBoundaries.endMs);
      if (actualEnd <= actualStart) return;
    }

    if (options?.filterLineId && lineId && lineId !== options.filterLineId) {
      return;
    }

    allIntervals.push({
      opId,
      lineId,
      resourceKey,
      type,
      startMs: actualStart,
      endMs: actualEnd,
      durationMs: actualEnd - actualStart,
      reason,
      observation,
    });
  };

  // Trechos de INTERVALO dentro da tolerância (até 1h por pausa), por linha —
  // não são ociosidade e, com expediente, também saem da base do expediente.
  const breakRangesByLine = new Map<string, Array<[number, number]>>();
  const pushPause = (
    startMs: number,
    endMs: number,
    opId: string,
    lineId: string | undefined,
    reason: string | undefined,
    observation: string | undefined,
    resourceKey: string
  ) => {
    if (!isBreakPauseReason(reason)) {
      pushInterval('IDLE', startMs, endMs, opId, lineId, reason, observation, resourceKey);
      return;
    }
    const allowanceEnd = Math.min(endMs, startMs + BREAK_ALLOWANCE_MS);
    // parte tolerada: guarda (recortada pelo filtro de data / agora) sem contar como ocioso
    let a = startMs;
    let b = Math.min(allowanceEnd, refTime);
    if (dateBoundaries) {
      a = Math.max(a, dateBoundaries.startMs);
      b = Math.min(b, dateBoundaries.endMs);
    }
    if (lineId && b > a) {
      const list = breakRangesByLine.get(lineId) || [];
      list.push([a, b]);
      breakRangesByLine.set(lineId, list);
    }
    // o que passar de 1h conta como ociosidade normal
    if (endMs > allowanceEnd) {
      pushInterval('IDLE', allowanceEnd, endMs, opId, lineId, `${reason} (acima de 1h)`, observation, resourceKey);
    }
  };

  // Chave de recurso (setor + turno) de uma OP — usada só como agregação
  // auxiliar (byResource), nunca pra decidir o que é ocioso/trabalhado.
  const resourceKeyOf = (op?: ProductionOrder): string =>
    `${op?.setor || 'geral'}|${op?.scheduledShift || 'turno'}`;

  // 3. Reconstrução para cada OP que tem eventos
  const processedOpIds = new Set<string>();

  for (const [opId, opEvents] of eventsByOp.entries()) {
    if (opId === 'orphan') continue;
    processedOpIds.add(opId);

    const op = opMap.get(opId);
    // Linha "padrão" da OP — só usada quando o evento não diz a linha.
    const lineId = op?.lineId || opEvents[0]?.lineId;
    // Linha em que o trecho ATUAL (desde o último evento) aconteceu. Antes
    // todo o histórico da OP ia pra linha em que ela está AGORA: uma OP que
    // envasou no Envase 1 e depois foi pro Sleev (ou uma parcial retomada em
    // outra linha) levava as horas do Envase 1 junto pro Sleev.
    let segmentLineId: string | undefined = lineId || undefined;
    const resourceKey = resourceKeyOf(op);

    // Onde começaram os intervalos da sessão atual desta OP — se vier um
    // CANCELLED (início por engano), tudo desde o último STARTED é descartado.
    let sessionIntervalStart = allIntervals.length;
    let sessionBreakMarks: Array<{ lineId: string; count: number }> = [];
    let currentState: 'IDLE' | 'WORKING' | 'PAUSED' | 'FINISHED' = 'IDLE';
    let lastChangeTime: number | null = null;
    let lastPauseReason: string | undefined = undefined;
    let lastPauseObs: string | undefined = undefined;

    for (const ev of opEvents) {
      const evTime = new Date(ev.createdAt).getTime();
      if (isNaN(evTime)) continue;
      // Início de trecho (STARTED/RESUMED/PAUSED): a linha vem do próprio evento.
      const eventLineId = ev.lineId || lineId || undefined;

      if (ev.type === 'CANCELLED') {
        // Descarta a sessão cancelada: intervalos e trechos de intervalo
        // (almoço) registrados desde o último STARTED desta OP
        for (let k = allIntervals.length - 1; k >= sessionIntervalStart; k--) {
          if (allIntervals[k].opId === opId) allIntervals.splice(k, 1);
        }
        // (as OPs são processadas uma de cada vez, então o que entrou depois do
        // STARTED — inclusive numa linha nova — veio desta sessão)
        for (const [lineKey, list] of breakRangesByLine.entries()) {
          const mark = sessionBreakMarks.find(m => m.lineId === lineKey);
          list.length = mark ? Math.min(list.length, mark.count) : 0;
        }
        sessionBreakMarks = [];
        currentState = 'IDLE';
        lastChangeTime = null;
        lastPauseReason = undefined;
        lastPauseObs = undefined;
        continue;
      }

      if (ev.type === 'STARTED') {
        sessionIntervalStart = allIntervals.length;
        sessionBreakMarks = Array.from(breakRangesByLine.entries()).map(([lineId, list]) => ({ lineId, count: list.length }));
        if (currentState === 'WORKING' && lastChangeTime !== null) {
          pushInterval('WORKING', lastChangeTime, evTime, opId, segmentLineId, undefined, undefined, resourceKey);
        } else if (currentState === 'PAUSED' && lastChangeTime !== null) {
          pushPause(lastChangeTime, evTime, opId, segmentLineId, lastPauseReason, lastPauseObs, resourceKey);
        }
        currentState = 'WORKING';
        lastChangeTime = evTime;
        segmentLineId = eventLineId;
        lastPauseReason = undefined;
        lastPauseObs = undefined;
      } else if (ev.type === 'PAUSED') {
        if (currentState === 'WORKING' && lastChangeTime !== null) {
          pushInterval('WORKING', lastChangeTime, evTime, opId, segmentLineId, undefined, undefined, resourceKey);
        }
        currentState = 'PAUSED';
        lastChangeTime = evTime;
        segmentLineId = eventLineId;
        lastPauseReason = ev.reason;
        lastPauseObs = ev.observation;
      } else if (ev.type === 'RESUMED') {
        if (currentState === 'PAUSED' && lastChangeTime !== null) {
          pushPause(lastChangeTime, evTime, opId, segmentLineId, lastPauseReason, lastPauseObs, resourceKey);
        }
        currentState = 'WORKING';
        lastChangeTime = evTime;
        segmentLineId = eventLineId;
        lastPauseReason = undefined;
        lastPauseObs = undefined;
      } else if (ev.type === 'FINISHED') {
        if (currentState === 'WORKING' && lastChangeTime !== null) {
          pushInterval('WORKING', lastChangeTime, evTime, opId, segmentLineId, undefined, undefined, resourceKey);
        } else if (currentState === 'PAUSED' && lastChangeTime !== null) {
          pushPause(lastChangeTime, evTime, opId, segmentLineId, lastPauseReason, lastPauseObs, resourceKey);
        }
        currentState = 'FINISHED';
        lastChangeTime = null;
        lastPauseReason = undefined;
        lastPauseObs = undefined;
      }
    }

    // Se a OP continua aberta (sem evento FINISHED) — SÓ estende o intervalo
    // até "agora" (refTime) quando o status REAL da OP confirma que ela está
    // genuinamente em andamento/pausada agora (op.status). Antes, o `||
    // currentState === 'WORKING'` fazia isso também para qualquer OP cujo
    // último evento fosse STARTED sem FINISHED correspondente — e isso
    // incluía OPs do histórico marcadas `completed` mas com HORA FIM em
    // branco na planilha (então só o STARTED foi importado como evento). Sem
    // saber a hora real de término (o histórico nem grava completed_at),
    // essas OPs "vazavam" como se estivessem trabalhando até o instante
    // atual — inflando qualquer dia, inclusive hoje, com horas que nunca
    // aconteceram. Agora, sem completedAt e sem um status que confirme
    // atividade real agora, simplesmente não contamos nada pra esse
    // intervalo (nem como trabalhado, nem como ocioso) — mais honesto do que
    // inventar uma duração pra um dado que não temos.
    if (lastChangeTime !== null && currentState !== 'FINISHED') {
      if (op?.status === 'completed' && op.completedAt) {
        const completedMs = new Date(op.completedAt).getTime();
        if (!isNaN(completedMs) && completedMs > lastChangeTime) {
          if (currentState === 'PAUSED') {
            pushPause(lastChangeTime, completedMs, opId, segmentLineId, lastPauseReason, lastPauseObs, resourceKey);
          } else {
            pushInterval('WORKING', lastChangeTime, completedMs, opId, segmentLineId, undefined, undefined, resourceKey);
          }
        }
      } else if (op?.status === 'paused') {
        pushPause(lastChangeTime, refTime, opId, segmentLineId, lastPauseReason, lastPauseObs, resourceKey);
      } else if (op?.status === 'in_progress') {
        pushInterval('WORKING', lastChangeTime, refTime, opId, segmentLineId, undefined, undefined, resourceKey);
      }
    }
  }

  // 3.5. Ociosidade REAL entre OPs consecutivas do mesmo setor/turno/dia — usa
  // só os horários reais de início (STARTED, vindo de HORA INICIO) e fim
  // (FINISHED, vindo de HORA FIM) já registrados/importados para cada OP.
  // Nunca inventa nenhum número: só soma o intervalo em que NENHUMA OP daquele
  // grupo estava em andamento, e nunca antes da 1ª OP nem depois da última do
  // dia (não presumimos hora de início/fim de turno). Quando há mais de uma
  // equipe/linha rodando em paralelo no mesmo setor, os intervalos são
  // mesclados antes de procurar os gaps — assim nunca conta como ociosidade um
  // período em que ao menos uma equipe estava de fato trabalhando.
  interface OpSpan { opId: string; startMs: number; endMs: number; lineId?: string; resourceKey: string }
  const spansByGroup = new Map<string, OpSpan[]>();

  for (const [opId, opEvents] of eventsByOp.entries()) {
    if (opId === 'orphan') continue;
    // Inícios cancelados (iniciados por engano) não contam
    const lastCancelMs = opEvents
      .filter(e => e.type === 'CANCELLED')
      .reduce((max, e) => Math.max(max, new Date(e.createdAt).getTime()), -Infinity);
    const started = opEvents
      .filter(e => e.type === 'STARTED' && new Date(e.createdAt).getTime() > lastCancelMs)
      .map(e => new Date(e.createdAt).getTime())
      .filter(t => !isNaN(t));
    const finished = opEvents
      .filter(e => e.type === 'FINISHED')
      .map(e => new Date(e.createdAt).getTime())
      .filter(t => !isNaN(t));
    if (started.length === 0 || finished.length === 0) continue;

    const startMs = Math.min(...started);
    const endMs = Math.max(...finished);
    if (endMs <= startMs) continue;

    const op = opMap.get(opId);
    const resourceKey = resourceKeyOf(op);
    const dayKey = new Date(startMs).toISOString().slice(0, 10);
    const groupKey = `${resourceKey}|${dayKey}`;
    const list = spansByGroup.get(groupKey) || [];
    list.push({ opId, startMs, endMs, lineId: op?.lineId || undefined, resourceKey });
    spansByGroup.set(groupKey, list);
  }

  for (const spans of spansByGroup.values()) {
    if (spans.length < 2) continue;
    spans.sort((a, b) => a.startMs - b.startMs);

    // Mescla intervalos sobrepostos/adjacentes em blocos únicos de "ocupado"
    const merged: { startMs: number; endMs: number; lineId?: string; resourceKey: string }[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, s.endMs);
        if (last.lineId && s.lineId && last.lineId !== s.lineId) last.lineId = undefined;
      } else {
        merged.push({ startMs: s.startMs, endMs: s.endMs, lineId: s.lineId, resourceKey: s.resourceKey });
      }
    }

    // Soma os intervalos ENTRE blocos ocupados consecutivos como ociosidade real
    for (let i = 1; i < merged.length; i++) {
      const gapStart = merged[i - 1].endMs;
      const gapEnd = merged[i].startMs;
      if (gapEnd > gapStart) {
        const commonLineId = merged[i - 1].lineId === merged[i].lineId ? merged[i - 1].lineId : undefined;
        pushInterval(
          'IDLE',
          gapStart,
          gapEnd,
          undefined,
          commonLineId,
          'Intervalo sem OP em andamento (horários reais de início/fim)',
          undefined,
          merged[i].resourceKey
        );
      }
    }
  }

  // 4. Fallback para OPs ativas ou concluídas que NÃO possuem eventos granulares de log
  for (const op of ops) {
    if (processedOpIds.has(op.id)) continue;

    const opCreatedMs = op.createdAt ? new Date(op.createdAt).getTime() : NaN;
    if (isNaN(opCreatedMs)) continue;
    const resourceKey = resourceKeyOf(op);

    if (op.status === 'in_progress') {
      pushInterval('WORKING', opCreatedMs, refTime, op.id, op.lineId || undefined, undefined, undefined, resourceKey);
    } else if (op.status === 'paused') {
      pushInterval('IDLE', opCreatedMs, refTime, op.id, op.lineId || undefined, undefined, undefined, resourceKey);
    } else if (op.status === 'completed' && op.completedAt) {
      const completedMs = new Date(op.completedAt).getTime();
      if (!isNaN(completedMs) && completedMs > opCreatedMs) {
        // Considera o tempo de execução como trabalho
        pushInterval('WORKING', opCreatedMs, completedMs, op.id, op.lineId || undefined, undefined, undefined, resourceKey);
      }
    }
  }

  // 5. Agrega métricas consolidadas e por linha
  let totalWorkingMs = 0;
  let totalIdleMs = 0;

  const byLine: Record<string, LineTimeMetrics> = {};

  // Inicializa linhas cadastradas
  for (const line of lines) {
    byLine[line.id] = {
      lineId: line.id,
      lineName: line.name,
      workingMs: 0,
      idleMs: 0,
      totalMs: 0,
      workingHours: 0,
      idleHours: 0,
      totalHours: 0,
      workingFormatted: '0h 00m',
      idleFormatted: '0h 00m',
      disponibilidade: 0,
      pauseCount: 0,
      pauses: [],
    };
  }

  const byResource: Record<string, { workingMs: number; idleMs: number }> = {};

  // Processa intervalos
  for (const interval of allIntervals) {
    if (interval.type === 'WORKING') {
      totalWorkingMs += interval.durationMs;
    } else if (interval.type === 'IDLE') {
      totalIdleMs += interval.durationMs;
    }

    if (interval.resourceKey) {
      const entry = byResource[interval.resourceKey] || { workingMs: 0, idleMs: 0 };
      if (interval.type === 'WORKING') entry.workingMs += interval.durationMs;
      else entry.idleMs += interval.durationMs;
      byResource[interval.resourceKey] = entry;
    }

    const lId = interval.lineId;
    if (lId) {
      if (!byLine[lId]) {
        const foundLine = lines.find(l => l.id === lId);
        byLine[lId] = {
          lineId: lId,
          lineName: foundLine?.name || lId,
          workingMs: 0,
          idleMs: 0,
          totalMs: 0,
          workingHours: 0,
          idleHours: 0,
          totalHours: 0,
          workingFormatted: '0h 00m',
          idleFormatted: '0h 00m',
          disponibilidade: 0,
          pauseCount: 0,
          pauses: [],
        };
      }

      if (interval.type === 'WORKING') {
        byLine[lId].workingMs += interval.durationMs;
      } else if (interval.type === 'IDLE') {
        byLine[lId].idleMs += interval.durationMs;
        byLine[lId].pauseCount += 1;
        if (interval.reason) {
          byLine[lId].pauses.push({
            reason: interval.reason,
            durationMs: interval.durationMs,
            createdAt: new Date(interval.startMs).toISOString(),
          });
        }
      }
    }
  }

  // Uma linha só trabalha UMA vez em cada instante. Antes os intervalos de
  // todas as OPs da linha eram simplesmente somados — se duas OPs ficassem
  // "em produção" ao mesmo tempo na mesma linha (ex.: uma iniciada por engano
  // e nunca finalizada/cancelada), as horas dobravam e o dia passava das
  // horas reais do relógio. Agora o trabalhado da linha é a UNIÃO dos
  // intervalos trabalhados, e o ocioso só conta onde ela não estava trabalhando.
  const mergeRanges = (ranges: Array<[number, number]>): Array<[number, number]> => {
    const sorted = ranges.filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
    const out: Array<[number, number]> = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  };
  const rangesLength = (ranges: Array<[number, number]>) => ranges.reduce((acc, r) => acc + (r[1] - r[0]), 0);
  const subtractRanges = (base: Array<[number, number]>, cut: Array<[number, number]>) => {
    const out: Array<[number, number]> = [];
    for (const [bs, be] of base) {
      let cursor = bs;
      for (const [cs, ce] of cut) {
        if (ce <= cursor || cs >= be) continue;
        if (cs > cursor) out.push([cursor, Math.min(cs, be)]);
        cursor = Math.max(cursor, ce);
        if (cursor >= be) break;
      }
      if (cursor < be) out.push([cursor, be]);
    }
    return out;
  };
  const rangesByLine = new Map<string, { working: Array<[number, number]>; idle: Array<[number, number]> }>();
  for (const interval of allIntervals) {
    if (!interval.lineId) continue;
    const entry = rangesByLine.get(interval.lineId) || { working: [], idle: [] };
    if (interval.type === 'WORKING') entry.working.push([interval.startMs, interval.endMs]);
    else if (interval.type === 'IDLE') entry.idle.push([interval.startMs, interval.endMs]);
    rangesByLine.set(interval.lineId, entry);
  }
  const sessionsOpt = options?.workSessions;
  if (!sessionsOpt) {
    for (const [lId, entry] of rangesByLine.entries()) {
      if (!byLine[lId]) continue;
      const workingUnion = mergeRanges(entry.working);
      const idleUnion = subtractRanges(mergeRanges(entry.idle), workingUnion);
      byLine[lId].workingMs = rangesLength(workingUnion);
      byLine[lId].idleMs = rangesLength(idleUnion);
    }
  } else {
    // ---- Com controle de expediente ----
    // Cobertura = expedientes registrados (resolvidos) + , nos dias em que a
    // linha trabalhou SEM expediente registrado (esqueceram de iniciar), o
    // trecho do primeiro ao último trabalho do dia. Ocioso = cobertura −
    // trabalhado; hora extra = cobertura fora da jornada padrão.
    const dayKey = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const clampRange = (r: [number, number]): [number, number] | null => {
      let a = r[0];
      let b = Math.min(r[1], refTime);
      if (dateBoundaries) {
        a = Math.max(a, dateBoundaries.startMs);
        b = Math.min(b, dateBoundaries.endMs);
      }
      return b > a ? [a, b] : null;
    };
    const scheduledRangesFor = (fromMs: number, toMs: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      const cursor = new Date(fromMs);
      cursor.setHours(0, 0, 0, 0);
      while (cursor.getTime() <= toMs) {
        const win = WORK_SCHEDULE[cursor.getDay()];
        if (win) {
          const y = cursor.getFullYear(), m = cursor.getMonth(), d = cursor.getDate();
          out.push([new Date(y, m, d, win.start, 0, 0, 0).getTime(), new Date(y, m, d, win.end, 0, 0, 0).getTime()]);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return out;
    };

    // Trabalhado BRUTO (sem o recorte do filtro de data) por linha — usado pra
    // descobrir onde termina um expediente que ficou aberto num dia passado.
    const lineIdsWithData = new Set<string>([
      ...Array.from(rangesByLine.keys()),
      ...sessionsOpt.map(ss => ss.lineId),
    ]);

    // Expediente automático: dias do período a partir de AUTO_SHIFT_START_DATE
    const autoDays: number[] = [];
    {
      const [ay, am, ad] = AUTO_SHIFT_START_DATE.split('-').map(Number);
      let from = new Date(ay, am - 1, ad).getTime();
      if (dateBoundaries && isFinite(dateBoundaries.startMs)) from = Math.max(from, dateBoundaries.startMs);
      let to = refTime;
      if (dateBoundaries && isFinite(dateBoundaries.endMs)) to = Math.min(to, dateBoundaries.endMs);
      const cur = new Date(from);
      cur.setHours(0, 0, 0, 0);
      while (cur.getTime() <= to) {
        autoDays.push(cur.getTime());
        cur.setDate(cur.getDate() + 1);
      }
    }
    // Dias com alguma atividade na fábrica (qualquer linha trabalhou ou abriu expediente)
    const activeFactoryDays = new Set<string>();
    for (const entry of rangesByLine.values()) {
      for (const r of entry.working) activeFactoryDays.add(dayKey(r[0]));
    }
    for (const ss of sessionsOpt) {
      const t = new Date(ss.startedAt).getTime();
      if (!isNaN(t)) activeFactoryDays.add(dayKey(t));
    }
    if (autoDays.length > 0) {
      for (const l of lines) {
        if (options?.filterLineId && l.id !== options.filterLineId) continue;
        if (ops.some(op => op && op.lineId === l.id)) lineIdsWithData.add(l.id);
      }
    }

    for (const lId of lineIdsWithData) {
      if (!byLine[lId]) {
        if (!lines.some(l => l.id === lId)) continue; // expediente de linha que não entra neste cálculo
        const foundLine = lines.find(l => l.id === lId);
        byLine[lId] = {
          lineId: lId, lineName: foundLine?.name || lId,
          workingMs: 0, idleMs: 0, totalMs: 0, workingHours: 0, idleHours: 0, totalHours: 0,
          workingFormatted: '0h 00m', idleFormatted: '0h 00m', disponibilidade: 0, pauseCount: 0, pauses: [],
        };
      }
      const entry = rangesByLine.get(lId) || { working: [], idle: [] };
      const workingUnion = mergeRanges(entry.working);

      const explicit: Array<[number, number]> = [];
      for (const ws of sessionsOpt) {
        if (ws.lineId !== lId) continue;
        const startMs = new Date(ws.startedAt).getTime();
        if (isNaN(startMs)) continue;
        let endMs = ws.endedAt ? new Date(ws.endedAt).getTime() : NaN;
        if (isNaN(endMs)) {
          const sameDayWork = workingUnion.filter(r => dayKey(r[0]) === dayKey(startMs) && r[1] > startMs);
          const lastWorkEnd = sameDayWork.length > 0 ? Math.max(...sameDayWork.map(r => r[1])) : startMs;
          const sched = getScheduledWindow(startMs);
          if (sched && startMs < sched[1] && localDayStr(startMs) >= AUTO_SHIFT_START_DATE) {
            // Não encerrado: vale até o fim da jornada (ou até a última OP,
            // se a produção passou do horário — isso é hora extra).
            endMs = Math.min(refTime, Math.max(sched[1], lastWorkEnd));
          } else if (dayKey(startMs) === dayKey(refTime)) {
            endMs = refTime; // aberto hoje fora da jornada: vai até agora
          } else {
            // Esqueceram de encerrar num dia passado: termina no último
            // trabalho daquele dia (sem trabalho, o expediente não conta).
            endMs = lastWorkEnd;
          }
        }
        const c = clampRange([startMs, endMs]);
        if (c) explicit.push(c);
      }
      const explicitUnion = mergeRanges(explicit);

      // Dias com trabalho mas sem nenhum expediente registrado
      const explicitDays = new Set(explicitUnion.map(r => dayKey(r[0])));
      const implicitByDay = new Map<string, [number, number]>();
      for (const r of workingUnion) {
        const k = dayKey(r[0]);
        if (explicitDays.has(k)) continue;
        const cur = implicitByDay.get(k);
        implicitByDay.set(k, cur ? [Math.min(cur[0], r[0]), Math.max(cur[1], r[1])] : [r[0], r[1]]);
      }
      // Expediente automático (7h até o fim da jornada, ou até o líder encerrar)
      const autoRanges: Array<[number, number]> = [];
      for (const dayMs of autoDays) {
        const r = getAutoShiftRange(lId, dayMs, ops, sessionsOpt, refTime, activeFactoryDays.has(dayKey(dayMs)));
        if (!r) continue;
        const c = clampRange(r);
        if (c) autoRanges.push(c);
      }

      // O trabalho fora do expediente registrado também é coberto (conta como trabalhado, nunca como ocioso)
      const coverage = mergeRanges([...explicitUnion, ...autoRanges, ...Array.from(implicitByDay.values()), ...workingUnion]);

      // Intervalo tolerado (até 1h) não é ocioso nem conta na base do expediente
      const breaksUnion = subtractRanges(mergeRanges(breakRangesByLine.get(lId) || []), workingUnion);
      const effectiveCoverage = subtractRanges(coverage, breaksUnion);
      const idleUnion = subtractRanges(effectiveCoverage, workingUnion);
      const coverageMs = rangesLength(effectiveCoverage);
      let overtimeMs = 0;
      if (coverage.length > 0) {
        const scheduled = mergeRanges(scheduledRangesFor(coverage[0][0], coverage[coverage.length - 1][1]));
        overtimeMs = rangesLength(subtractRanges(effectiveCoverage, scheduled));
      }

      // Troca de produto: trechos marcados pelo líder que caem no ocioso da linha
      // (troca aberta hoje vai até agora; aberta em dia passado vai até o fim do
      // expediente daquele dia — o recorte pelo ocioso já limita isso).
      const changeoverRanges: Array<[number, number]> = [];
      for (const co of options?.changeovers || []) {
        if (co.lineId !== lId) continue;
        const a = new Date(co.startedAt).getTime();
        if (isNaN(a)) continue;
        let b = co.endedAt ? new Date(co.endedAt).getTime() : NaN;
        if (isNaN(b)) {
          const d = new Date(a);
          b = dayKey(a) === dayKey(refTime) ? refTime : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        }
        const c = clampRange([a, b]);
        if (c) changeoverRanges.push(c);
      }
      const changeoverUnion = mergeRanges(changeoverRanges);
      const changeoverInIdle = subtractRanges(changeoverUnion, subtractRanges(changeoverUnion, idleUnion));

      byLine[lId].workingMs = rangesLength(workingUnion);
      byLine[lId].idleMs = rangesLength(idleUnion);
      byLine[lId].changeoverMs = rangesLength(changeoverInIdle);
      byLine[lId].sessionMs = coverageMs;
      byLine[lId].overtimeMs = overtimeMs;
      byLine[lId].hasExplicitSession = explicitUnion.length > 0;
    }
  }

  // Finaliza cálculos por linha (horas decimais, formatações e OEE de Disponibilidade)
  for (const lId of Object.keys(byLine)) {
    const item = byLine[lId];
    item.totalMs = item.workingMs + item.idleMs;
    item.workingHours = item.workingMs / (1000 * 60 * 60);
    item.idleHours = item.idleMs / (1000 * 60 * 60);
    item.totalHours = item.totalMs / (1000 * 60 * 60);
    item.workingFormatted = formatMsToHoursMinutes(item.workingMs);
    item.idleFormatted = formatMsToHoursMinutes(item.idleMs);
    item.disponibilidade = item.totalMs > 0
      ? Math.round((item.workingMs / item.totalMs) * 1000) / 10
      : 0;
  }

  // Com expediente, o total da fábrica passa a ser a soma do que foi apurado
  // por linha (já sem sobreposição, sem madrugada e sem intervalo tolerado),
  // mais o que não tem linha (histórico importado, agregado por recurso).
  if (sessionsOpt) {
    let w = 0;
    let i = 0;
    for (const item of Object.values(byLine)) {
      w += item.workingMs;
      i += item.idleMs;
    }
    for (const interval of allIntervals) {
      if (interval.lineId) continue;
      if (interval.type === 'WORKING') w += interval.durationMs;
      else i += interval.durationMs;
    }
    totalWorkingMs = w;
    totalIdleMs = i;
  }

  const factoryTotalMs = totalWorkingMs + totalIdleMs;
  const factoryWorkingHours = totalWorkingMs / (1000 * 60 * 60);
  const factoryIdleHours = totalIdleMs / (1000 * 60 * 60);
  const factoryTotalHours = factoryTotalMs / (1000 * 60 * 60);

  const factoryDisponibilidade = factoryTotalMs > 0
    ? Math.round((totalWorkingMs / factoryTotalMs) * 1000) / 10
    : 0;

  return {
    workingMs: totalWorkingMs,
    idleMs: totalIdleMs,
    totalMs: factoryTotalMs,
    workingHours: factoryWorkingHours,
    idleHours: factoryIdleHours,
    totalHours: factoryTotalHours,
    workingFormatted: formatMsToHoursMinutes(totalWorkingMs),
    idleFormatted: formatMsToHoursMinutes(totalIdleMs),
    disponibilidade: factoryDisponibilidade,
    byLine,
    byResource,
    intervals: allIntervals,
  };
}
