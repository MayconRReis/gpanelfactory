import React, { useMemo, useState } from 'react';
import { Layers, Plus, GripVertical, Package, AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Lock, Search, X } from 'lucide-react';
import { ProductionLine, ProductionOrder } from '../types';

interface CronogramaBoardProps {
  lines: ProductionLine[];
  ops: ProductionOrder[];
  /**
   * Arrasta um card de OP para dentro de uma coluna de linha (atribui/reatribui
   * a linha). `scheduledDate` é o dia (aba selecionada no Kanban) para o qual a
   * OP deve ser agendada nessa linha.
   */
  onAssignToQueue: (opId: string, lineId: string, scheduledDate?: string) => Promise<void>;
  /** Arrasta um card de OP de volta para a coluna "Estoque" (remove a linha). */
  onUnassign: (opId: string) => Promise<void>;
  /**
   * Solta um card sobre outro DENTRO da mesma coluna — reordena a fila de
   * produção daquela coluna. `scheduledDate` (quando a coluna é uma linha)
   * restringe a reordenação apenas às OPs daquele dia, já que o quadro agora
   * mostra só o dia selecionado por vez.
   */
  onReorderColumn: (columnId: string, orderedOpIds: string[], scheduledDate?: string) => Promise<void>;
  /** Botão "+" no topo de cada coluna de linha — abre o modal de vincular OP do estoque. */
  onOpenAssignModal: (line: ProductionLine) => void;
  /** Clique em um card de OP para editar seus dados. */
  onOpenEditOpModal?: (op: ProductionOrder) => void;
}

export const BACKLOG_COLUMN_ID = '__estoque__';

// "Hoje" em data local (YYYY-MM-DD) — nunca usar `new Date().toISOString()`
// aqui: isso converte para UTC e erra o dia entre ~21h e 23h59 no horário de
// Brasília (mesmo cuidado já tomado em CoordinatorDashboard/LeaderScreen).
function getLocalDateStr(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

interface WeekDay {
  dateStr: string;
  weekdayLabel: string;
  dayOfMonth: number;
}

// Monta os 7 dias (Segunda a Domingo) da semana que contém `reference`. O
// cronograma raramente é planejado além de uma semana, então o quadro
// trabalha sempre em cima da semana atual.
function buildWeekDays(reference: Date): WeekDay[] {
  const dow = reference.getDay(); // 0=Dom..6=Sáb
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(reference);
  monday.setDate(reference.getDate() + diffToMonday);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      dateStr: getLocalDateStr(d),
      weekdayLabel: WEEKDAY_LABELS[d.getDay()],
      dayOfMonth: d.getDate(),
    };
  });
}

export function CronogramaBoard({
  lines,
  ops,
  onAssignToQueue,
  onUnassign,
  onReorderColumn,
  onOpenAssignModal,
  onOpenEditOpModal,
}: CronogramaBoardProps) {
  const [draggingOpId, setDraggingOpId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Sobre qual card específico o item arrastado está pairando agora — usado
  // para desenhar o indicador de "vai entrar aqui" e para decidir a posição
  // exata de inserção ao soltar dentro da MESMA coluna (reordenar a fila).
  const [dragOverOpId, setDragOverOpId] = useState<string | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  // Dias (Seg a Dom) da semana em exibição, para as abas de navegação do
  // Kanban. `weekOffset` deixa o coordenador avançar/voltar semanas — por
  // exemplo, numa sexta-feira, avançar uma semana pra já organizar a
  // segunda-feira seguinte.
  const todayStr = useMemo(() => getLocalDateStr(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => {
    const reference = new Date();
    reference.setDate(reference.getDate() + weekOffset * 7);
    return buildWeekDays(reference);
  }, [weekOffset]);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Busca dentro da coluna "Estoque / Sem Linha" — o board não tem paginação,
  // então quando o estoque acumula muitas OPs sem linha fica difícil achar
  // uma específica só rolando a coluna.
  const [backlogSearchTerm, setBacklogSearchTerm] = useState('');

  const weekRangeLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = weekDays[0];
    const last = weekDays[6];
    return `${String(first.dayOfMonth).padStart(2, '0')} a ${String(last.dayOfMonth).padStart(2, '0')}`;
  }, [weekDays]);

  const goToWeek = (offset: number) => {
    setWeekOffset(offset);
    const reference = new Date();
    reference.setDate(reference.getDate() + offset * 7);
    const days = buildWeekDays(reference);
    // Ao trocar de semana, seleciona automaticamente "hoje" (se a semana
    // exibida for a atual) ou a segunda-feira da semana escolhida.
    setSelectedDate(offset === 0 ? todayStr : days[0].dateStr);
  };

  // Quantas OPs já estão agendadas (em alguma linha) em cada dia da semana —
  // exibido como contador em cada aba, pra dar uma visão rápida da carga.
  const countsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const op of ops) {
      if (op.lineId && op.scheduledDate && op.status !== 'completed') {
        map[op.scheduledDate] = (map[op.scheduledDate] || 0) + 1;
      }
    }
    return map;
  }, [ops]);

  // OPs sem linha atribuída (ainda no estoque) e não concluídas — a ordem já
  // vem por `sequence` (a consulta ao Supabase em getAllOPs ordena por essa
  // coluna), então também dá pra reordenar esta coluna. O Estoque mostra
  // TODAS as OPs pendentes de linha, independente do dia selecionado nas
  // abas — elas ainda não têm uma data de produção "travada".
  const backlogOps = useMemo(
    () => ops.filter(o => !o.lineId && o.status !== 'completed'),
    [ops]
  );

  // Lista exibida na coluna Estoque, já filtrada pela busca (o contador no
  // topo da coluna continua mostrando o total real, sem o filtro).
  const visibleBacklogOps = useMemo(() => {
    const term = backlogSearchTerm.trim().toLowerCase();
    if (!term) return backlogOps;
    return backlogOps.filter(op =>
      op.number.toLowerCase().includes(term) ||
      op.product.toLowerCase().includes(term) ||
      (op.lote ? op.lote.toLowerCase().includes(term) : false) ||
      (op.granel ? op.granel.toLowerCase().includes(term) : false)
    );
  }, [backlogOps, backlogSearchTerm]);

  // Colunas de linha mostram só as OPs agendadas para o dia selecionado.
  const opsByLine = useMemo(() => {
    const map: Record<string, ProductionOrder[]> = {};
    for (const line of lines) {
      map[line.id] = ops
        .filter(o => o.lineId === line.id && o.status !== 'completed' && o.scheduledDate === selectedDate)
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }
    return map;
  }, [lines, ops, selectedDate]);

  const columnOps = (columnId: string): ProductionOrder[] =>
    columnId === BACKLOG_COLUMN_ID ? backlogOps : (opsByLine[columnId] || []);

  const handleDragStart = (e: React.DragEvent, opId: string) => {
    e.dataTransfer.setData('text/plain', opId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingOpId(opId);
  };

  const handleDragEnd = () => {
    setDraggingOpId(null);
    setDragOverColumn(null);
    setDragOverOpId(null);
  };

  const handleDragOverColumn = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
  };

  // Pairar sobre um card específico — prende o evento (stopPropagation) pra
  // não deixar o onDragOver da coluna "vazar" e atrapalhar o indicador.
  const handleDragOverCard = (e: React.DragEvent, columnId: string, opId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
    if (dragOverOpId !== opId) setDragOverOpId(opId);
  };

  // Solto em cima de um card específico. Reordenar por arrastar-e-soltar
  // DENTRO da mesma coluna foi removido daqui (virou instável/imprevisível
  // na prática — ver os botões de seta ▲▼ em cada card, que fazem esse
  // reordenamento de forma explícita e sem ambiguidade). Este handler agora
  // só cuida de reatribuir a linha quando o card vem de OUTRA coluna/estoque,
  // soltando-o na posição do card-alvo dentro da nova coluna.
  const handleDropOnCard = async (e: React.DragEvent, columnId: string, targetOpId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const opId = e.dataTransfer.getData('text/plain') || draggingOpId;
    setDragOverColumn(null);
    setDragOverOpId(null);
    setDraggingOpId(null);
    if (!opId || opId === targetOpId) return;

    const op = ops.find(o => o.id === opId);
    if (!op) return;

    const currentColumnId = op.lineId || BACKLOG_COLUMN_ID;
    // Mesma coluna — não reordena mais por drag, só pelas setas ▲▼ do card.
    if (currentColumnId === columnId) return;

    setIsDropping(true);
    try {
      // Veio de outra coluna — primeiro reatribui a linha (ou tira do
      // estoque), depois posiciona na posição do card-alvo dentro da nova coluna.
      if (columnId === BACKLOG_COLUMN_ID) {
        await onUnassign(opId);
      } else {
        await onAssignToQueue(opId, columnId, selectedDate);
      }

      const currentIds = columnOps(columnId)
        .filter(o => o.id !== opId)
        .map(o => o.id);
      const targetIdx = currentIds.indexOf(targetOpId);
      const insertAt = targetIdx === -1 ? currentIds.length : targetIdx;
      const newOrder = [...currentIds.slice(0, insertAt), opId, ...currentIds.slice(insertAt)];

      await onReorderColumn(columnId, newOrder, columnId === BACKLOG_COLUMN_ID ? undefined : selectedDate);
    } finally {
      setIsDropping(false);
    }
  };

  // Move o card uma posição para cima/baixo DENTRO da mesma coluna — troca
  // de lugar com o vizinho imediato. Substitui o antigo reordenamento por
  // arrastar-sobre-outro-card dentro da mesma coluna, que na prática estava
  // dando problema (soltar na posição errada, indicador visual impreciso).
  const handleMoveInColumn = async (columnId: string, opId: string, direction: 'up' | 'down') => {
    const currentIds = columnOps(columnId).map(o => o.id);
    const idx = currentIds.indexOf(opId);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= currentIds.length) return;

    const newOrder = [...currentIds];
    [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];

    setIsDropping(true);
    try {
      await onReorderColumn(columnId, newOrder, columnId === BACKLOG_COLUMN_ID ? undefined : selectedDate);
    } finally {
      setIsDropping(false);
    }
  };

  // Solto na área vazia da coluna (fora de qualquer card específico) —
  // comportamento antigo: só atribui/reatribui a linha, indo pro fim da fila.
  const handleDropOnColumn = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    const opId = e.dataTransfer.getData('text/plain') || draggingOpId;
    setDragOverColumn(null);
    setDragOverOpId(null);
    setDraggingOpId(null);
    if (!opId) return;

    const op = ops.find(o => o.id === opId);
    if (!op) return;

    // Já está na mesma coluna — nada a fazer (o drop já teria sido tratado
    // pelo card individual caso fosse sobre um card).
    if (columnId === BACKLOG_COLUMN_ID && !op.lineId) return;
    if (op.lineId === columnId) return;

    setIsDropping(true);
    try {
      if (columnId === BACKLOG_COLUMN_ID) {
        await onUnassign(opId);
      } else {
        await onAssignToQueue(opId, columnId, selectedDate);
      }
    } finally {
      setIsDropping(false);
    }
  };

  const renderCard = (op: ProductionOrder, columnId: string) => {
    const isCritical = op.priority === 'Crítica' || op.priority === 'Alta';
    const isDragOverTarget = dragOverOpId === op.id && draggingOpId !== op.id;
    // OP em produção ou pausada já tem horário de início real registrado —
    // mover ou editar o card daqui pra frente bagunçaria os dados de
    // Disponibilidade/Ociosidade (ver cancelOP/calculateProductionTime), então
    // trava o card nesses dois status: só dá pra pausar/retomar/concluir pela
    // tela de operação da linha.
    const isLocked = op.status === 'in_progress' || op.status === 'paused';

    // Posição do card dentro da coluna (pra saber se mostra/desabilita as
    // setas ▲▼ de reordenar — não dá pra subir o primeiro nem descer o
    // último). Usa a lista completa da coluna (não a filtrada pela busca),
    // já que a busca só afeta o que é exibido, não a fila real.
    const colIds = columnOps(columnId).map(o => o.id);
    const posIdx = colIds.indexOf(op.id);
    const canMoveUp = posIdx > 0;
    const canMoveDown = posIdx !== -1 && posIdx < colIds.length - 1;

    return (
      <div
        key={op.id}
        draggable={!isLocked}
        onDragStart={(e) => (isLocked ? e.preventDefault() : handleDragStart(e, op.id))}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOverCard(e, columnId, op.id)}
        onDrop={(e) => handleDropOnCard(e, columnId, op.id)}
        onClick={() => !isLocked && onOpenEditOpModal && onOpenEditOpModal(op)}
        className={`p-2.5 rounded-xl border text-xs transition-all shadow-sm select-none ${
          isLocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
        } ${
          draggingOpId === op.id ? 'opacity-30' : 'opacity-100'
        } ${
          op.status === 'in_progress'
            ? 'bg-emerald-950/70'
            : op.status === 'paused'
            ? 'bg-amber-950/40'
            : op.priority === 'Crítica'
            ? 'bg-red-950/60 hover:border-red-500'
            : op.priority === 'Alta'
            ? 'bg-orange-950/50 hover:border-orange-500'
            : 'bg-[#181822] hover:border-blue-500'
        } ${
          isDragOverTarget
            ? 'border-blue-400 ring-2 ring-blue-500/40'
            : op.status === 'in_progress'
            ? 'border-emerald-700/60'
            : op.status === 'paused'
            ? 'border-amber-700/50'
            : op.priority === 'Crítica'
            ? 'border-red-800/60'
            : op.priority === 'Alta'
            ? 'border-orange-800/50'
            : 'border-[#2c2c3c]'
        }`}
        title={
          isLocked
            ? `Esta OP está ${op.status === 'in_progress' ? 'em produção' : 'pausada'} — não é possível mover ou editar por aqui enquanto estiver assim. Use a tela de operação da linha.`
            : 'Use as setas ▲▼ para reordenar dentro desta coluna, ou arraste para outra coluna para reatribuir'
        }
      >
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
            {isLocked ? (
              <Lock className="w-3 h-3 text-[#52525b] shrink-0" />
            ) : (
              <GripVertical className="w-3 h-3 text-[#52525b] shrink-0" />
            )}
            <span className="font-mono font-bold text-white text-[11px] shrink-0">OP {op.number}</span>
            {op.isSleeve && (
              <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-600/60 uppercase">
                Sleev
              </span>
            )}
            {op.status === 'in_progress' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500 text-black uppercase">
                Produzindo
              </span>
            ) : op.status === 'paused' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500 text-black uppercase">
                Pausada
              </span>
            ) : isCritical ? (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-red-900/80 text-red-300 border border-red-700/50 flex items-center gap-0.5">
                <AlertTriangle className="w-2.5 h-2.5" />
                {op.priority}
              </span>
            ) : null}
          </div>
          {/* Setas para reordenar a fila dentro da mesma coluna — troca de
              lugar com o vizinho imediato acima/abaixo. Substitui o antigo
              arrastar-sobre-outro-card, que dava problema. Mais largas que
              o resto do card pra facilitar o clique. */}
          {!isLocked && (
            <div className="flex flex-col shrink-0 -my-1 -mr-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canMoveUp) handleMoveInColumn(columnId, op.id, 'up');
                }}
                disabled={!canMoveUp}
                title="Mover para cima"
                className={`leading-none flex items-center justify-center w-6 h-4 rounded transition-colors ${
                  canMoveUp ? 'text-[#a1a1aa] hover:text-blue-400 hover:bg-white/5 cursor-pointer' : 'text-[#2c2c3c] cursor-not-allowed'
                }`}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canMoveDown) handleMoveInColumn(columnId, op.id, 'down');
                }}
                disabled={!canMoveDown}
                title="Mover para baixo"
                className={`leading-none flex items-center justify-center w-6 h-4 rounded transition-colors ${
                  canMoveDown ? 'text-[#a1a1aa] hover:text-blue-400 hover:bg-white/5 cursor-pointer' : 'text-[#2c2c3c] cursor-not-allowed'
                }`}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[#d4d4d8] font-medium line-clamp-1 leading-tight" title={op.product}>
          {op.product}
        </p>
        <div className="flex items-center justify-between text-[10px] text-[#a1a1aa] mt-1.5 pt-1 border-t border-white/5">
          <span className="font-bold text-[#f4f4f5]">
            {op.plannedQuantity.toLocaleString('pt-BR')} {op.unidade || 'un'}
          </span>
          {op.lote && <span className="font-mono text-emerald-400">{op.lote}</span>}
        </div>
        {/* No Estoque a OP ainda não está numa coluna de dia — mostra a data
            agendada (se houver uma de uma atribuição anterior) como dica. */}
        {columnId === BACKLOG_COLUMN_ID && op.scheduledDate && (
          <div className="flex items-center gap-1 text-[9px] text-[#71717a] mt-1">
            <CalendarDays className="w-2.5 h-2.5" />
            <span>Agendada: {op.scheduledDate.split('-').reverse().slice(0, 2).join('/')}</span>
          </div>
        )}
        {op.status === 'in_progress' && (
          <div className="w-full bg-black/40 rounded-full h-1 mt-1.5 overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.round(((op.producedQuantity || 0) / (op.plannedQuantity || 1)) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto custom-scrollbar pb-2">
      {/* Navegação de semana — por padrão mostra a semana atual (Seg a Dom),
          mas dá pra avançar/voltar (ex.: numa sexta, já organizar a segunda
          seguinte clicando em "Próxima semana"). */}
      <div className="flex items-center gap-2 mb-2 min-w-max">
        <button
          type="button"
          onClick={() => goToWeek(weekOffset - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22] transition-colors shrink-0"
          title="Semana anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="text-[11px] font-bold text-[#d4d4d8] uppercase tracking-wide shrink-0 min-w-[90px] text-center">
          {weekOffset === 0 ? 'Semana Atual' : weekOffset > 0 ? `+${weekOffset} sem.` : `${weekOffset} sem.`}
          <span className="block text-[10px] text-[#71717a] font-semibold normal-case">{weekRangeLabel}</span>
        </span>

        <button
          type="button"
          onClick={() => goToWeek(weekOffset + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c22] transition-colors shrink-0"
          title="Próxima semana"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {weekOffset !== 0 && (
          <button
            type="button"
            onClick={() => goToWeek(0)}
            className="h-7 px-2.5 rounded-lg text-[10px] font-bold uppercase text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 border border-blue-800/40 transition-colors shrink-0"
          >
            Hoje
          </button>
        )}
      </div>

      {/* Abas de dia da semana em exibição — cada coluna de linha mostra só
          as OPs agendadas para o dia selecionado aqui. */}
      <div className="flex items-center gap-1.5 mb-3 min-w-max">
        <CalendarDays className="w-3.5 h-3.5 text-[#71717a] shrink-0 mr-1" />
        {weekDays.map((day) => {
          const isSelected = day.dateStr === selectedDate;
          const isToday = day.dateStr === todayStr;
          const count = countsByDate[day.dateStr] || 0;
          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => setSelectedDate(day.dateStr)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-colors ${
                isSelected
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#121216] border-[#222228] text-[#a1a1aa] hover:border-blue-700/60 hover:text-[#e4e4e7]'
              }`}
              title={isToday ? 'Hoje' : undefined}
            >
              <span className="uppercase">
                {day.weekdayLabel} {String(day.dayOfMonth).padStart(2, '0')}
              </span>
              {isToday && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-white' : 'bg-emerald-400'}`}
                />
              )}
              {count > 0 && (
                <span
                  className={`text-[9px] font-bold px-1 rounded-full ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-[#1a1a22] text-[#a1a1aa]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 min-w-max">
        {/* Coluna: Estoque / Fila Geral (OPs sem linha) */}
        <div
          onDragOver={(e) => handleDragOverColumn(e, BACKLOG_COLUMN_ID)}
          onDrop={(e) => handleDropOnColumn(e, BACKLOG_COLUMN_ID)}
          className={`w-[260px] shrink-0 bg-[#0e0e12] border rounded-2xl flex flex-col max-h-[calc(100vh-260px)] transition-colors ${
            dragOverColumn === BACKLOG_COLUMN_ID ? 'border-blue-500' : 'border-[#222228]'
          }`}
        >
          <div className="p-3 border-b border-[#1f1f26] flex items-center justify-between gap-2 sticky top-0 bg-[#0e0e12] rounded-t-2xl z-10">
            <div className="flex items-center gap-1.5 min-w-0">
              <Package className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
              <span className="text-xs font-bold text-[#a1a1aa] uppercase tracking-wide truncate">Estoque / Sem Linha</span>
            </div>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1a1a22] text-[#a1a1aa] shrink-0">
              {backlogOps.length}
            </span>
          </div>
          {/* Busca dentro do Estoque — filtra por OP, Produto, Lote ou Granel */}
          <div className="px-2.5 pt-2 sticky top-[45px] bg-[#0e0e12] z-10">
            <div className="relative">
              <Search className="w-3 h-3 text-[#52525b] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={backlogSearchTerm}
                onChange={(e) => setBacklogSearchTerm(e.target.value)}
                placeholder="Buscar no estoque..."
                className="w-full h-7 pl-6 pr-6 text-[10px] bg-[#131318] border border-[#232330] rounded-lg text-[#f4f4f5] placeholder:text-[#52525b] focus:outline-none focus:border-blue-600/60"
              />
              {backlogSearchTerm && (
                <button
                  type="button"
                  onClick={() => setBacklogSearchTerm('')}
                  title="Limpar busca"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#52525b] hover:text-[#f4f4f5]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-[80px]">
            {visibleBacklogOps.length === 0 ? (
              <p className="text-[11px] text-[#52525b] text-center py-6">
                {backlogOps.length === 0 ? 'Nenhuma OP em estoque' : 'Nenhuma OP encontrada para essa busca'}
              </p>
            ) : (
              visibleBacklogOps.map((op) => renderCard(op, BACKLOG_COLUMN_ID))
            )}
          </div>
        </div>

        {/* Uma coluna por linha de produção */}
        {lines.map((line) => {
          const lineOps = opsByLine[line.id] || [];
          const isOver = dragOverColumn === line.id;
          return (
            <div
              key={line.id}
              onDragOver={(e) => handleDragOverColumn(e, line.id)}
              onDrop={(e) => handleDropOnColumn(e, line.id)}
              className={`w-[260px] shrink-0 bg-[#121216] border rounded-2xl flex flex-col max-h-[calc(100vh-260px)] transition-colors ${
                isOver ? 'border-blue-500' : 'border-[#222228]'
              }`}
            >
              <div className="p-3 border-b border-[#1f1f26] flex items-center justify-between gap-2 sticky top-0 bg-[#121216] rounded-t-2xl z-10">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      line.status === 'active'
                        ? 'bg-emerald-500 animate-pulse'
                        : line.status === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-[#52525b]'
                    }`}
                  />
                  <span className="text-xs font-bold text-[#f4f4f5] truncate">{line.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenAssignModal(line)}
                    title={`Vincular OP do estoque a ${line.name}`}
                    className="p-1 rounded-lg text-[#71717a] hover:text-blue-400 hover:bg-blue-950/40 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-[80px]">
                {lineOps.length === 0 ? (
                  <p className="text-[11px] text-[#52525b] text-center py-6 px-2">
                    Nenhuma OP agendada para {weekDays.find(d => d.dateStr === selectedDate)?.weekdayLabel}. Arraste uma OP aqui.
                  </p>
                ) : (
                  lineOps.map((op) => renderCard(op, line.id))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isDropping && (
        <p className="text-[11px] text-blue-400 font-semibold mt-2 flex items-center gap-1.5">
          <Layers className="w-3 h-3 animate-pulse" /> Atualizando fila de produção...
        </p>
      )}
    </div>
  );
}
