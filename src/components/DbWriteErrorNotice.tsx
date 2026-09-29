import { useEffect, useState } from 'react';
import { AlertTriangle, X, Users } from 'lucide-react';
import { onDbWriteFailure, DbWriteFailure, onOpConflict, OpConflict } from '../services/db';

const STATUS_LABEL: Record<string, string> = {
  pending: 'aguardando início',
  in_progress: 'em andamento',
  paused: 'pausada',
  completed: 'concluída',
};

/**
 * Aviso fixo na tela quando o banco NÃO gravou uma ação (iniciar, pausar,
 * retomar, apontar, concluir OP, registrar evento). Fica até a pessoa
 * fechar — para ninguém repetir o apontamento achando que foi, nem seguir
 * trabalhando com a tela mostrando algo que não está no sistema.
 */
export function DbWriteErrorNotice() {
  const [failures, setFailures] = useState<DbWriteFailure[]>([]);
  const [conflict, setConflict] = useState<OpConflict | null>(null);

  useEffect(() => onDbWriteFailure(f => setFailures(prev => [f, ...prev].slice(0, 3))), []);
  useEffect(() => onOpConflict(c => setConflict(c)), []);
  // O aviso de conflito some sozinho depois de alguns segundos
  useEffect(() => {
    if (!conflict) return;
    const t = setTimeout(() => setConflict(null), 12000);
    return () => clearTimeout(t);
  }, [conflict]);

  if (failures.length === 0 && conflict) {
    return (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-24px)] max-w-lg">
        <div className="bg-amber-950/95 border border-amber-600 text-amber-100 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 backdrop-blur-md">
          <Users className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-amber-300">
              {conflict.context}: ação não repetida{conflict.opNumber ? ` — OP ${conflict.opNumber}` : ''}
            </p>
            <p className="text-xs mt-1">
              Esta OP já estava <strong>{STATUS_LABEL[conflict.currentStatus] || conflict.currentStatus}</strong>
              {conflict.byName ? <> — alterada por <strong>{conflict.byName}</strong></> : ' — outro líder já tinha alterado'}
              {conflict.atIso ? ` às ${new Date(conflict.atIso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.
              {' '}A tela foi atualizada com a situação real.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConflict(null)}
            className="text-amber-300 hover:text-white p-1 rounded-lg hover:bg-amber-900/60"
            title="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (failures.length === 0) return null;
  const last = failures[0];

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-24px)] max-w-lg">
      <div className="bg-rose-950/95 border border-rose-700 text-rose-100 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 backdrop-blur-md">
        <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black uppercase tracking-wider text-rose-300">
            Não foi salvo: {last.context}{last.opNumber ? ` — OP ${last.opNumber}` : ''}
          </p>
          <p className="text-xs mt-1">
            O sistema não aceitou esta ação, então ela <strong>não foi registrada</strong>. Não repita o apontamento; avise o coordenador.
          </p>
          <p className="text-[10px] text-rose-300/80 mt-1 font-mono break-words">
            {new Date(last.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {last.message}
          </p>
          {failures.length > 1 && (
            <p className="text-[10px] text-rose-300/70 mt-1">+{failures.length - 1} outra(s) falha(s) recente(s)</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFailures([])}
          className="text-rose-300 hover:text-white p-1 rounded-lg hover:bg-rose-900/60"
          title="Fechar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
