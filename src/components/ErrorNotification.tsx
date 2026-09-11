import { useEffect, useState } from 'react';
import { AlertCircle, Copy, Check, X } from 'lucide-react';

interface ErrorNotificationProps {
  /** Código copiável gerado por logError(), ex.: "GP-4F8K2". */
  code: string;
  /** Mensagem amigável para o operador (o detalhe técnico fica só no log/console). */
  message: string;
  /** Chamado ao clicar no X. Sem auto-dismiss por padrão — erro fica visível até o operador fechar. */
  onDismiss?: () => void;
}

/**
 * Notificação de erro com código copiável — para o operador repassar ao
 * coordenador/suporte sem precisar ler mensagem técnica em voz alta.
 * Segue a paleta escura do projeto (vermelho para estado de erro).
 */
export function ErrorNotification({ code, message, onDismiss }: ErrorNotificationProps) {
  const [copied, setCopied] = useState(false);

  // Reseta o "copiado" se o componente receber um novo erro (código diferente)
  useEffect(() => {
    setCopied(false);
  }, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (permissão negada, contexto não seguro) — o código
      // já está visível na tela para o operador selecionar manualmente.
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm px-4 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex flex-col gap-2 bg-rose-950/90 text-rose-200 border-rose-800 animate-in fade-in slide-in-from-top-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <span className="flex-1">{message}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-rose-400 hover:text-rose-200 transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-900 border border-rose-800/80 text-xs font-mono font-normal text-rose-100 transition-colors"
        title="Copiar código do erro"
      >
        <span>Código: {code}</span>
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-rose-300 shrink-0" />
        )}
      </button>
    </div>
  );
}
