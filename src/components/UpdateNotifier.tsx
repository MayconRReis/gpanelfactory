import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';

/**
 * AVISO DE NOVA ATUALIZAÇÃO DISPONÍVEL
 * ------------------------------------------------------------------
 * Igual ao que já existe no Stoque+: enquanto o usuário está com a aba
 * aberta, um novo deploy pode ir ao ar (Vercel) sem que a página recarregue
 * sozinha — o JS antigo continua rodando em memória. Este componente
 * verifica periodicamente se já existe uma build mais nova publicada e,
 * se sim, mostra um cartão discreto convidando a recarregar a página.
 *
 * Mecanismo: `vite.config.ts` grava, a cada `vite build`, um `buildId`
 * único tanto DENTRO do bundle JS (via `define`, em `__APP_BUILD_ID__`)
 * quanto num arquivo estático `dist/version.json`. Comparamos o valor que
 * já está rodando (`__APP_BUILD_ID__`, fixo desde que a página carregou)
 * com o valor mais recente de `/version.json` (buscado com
 * `cache: 'no-store'` para nunca pegar uma cópia em cache) — quando eles
 * divergem, é porque um novo deploy aconteceu depois que esta aba abriu.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // verifica a cada 5 minutos

export function UpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const currentBuildIdRef = useRef<string>(
    typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
  );

  useEffect(() => {
    // Sem buildId conhecido (ex.: rodando em `vite dev`, onde `define` não
    // é injetado da mesma forma) não há como comparar — não verifica.
    if (!currentBuildIdRef.current) return;

    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.buildId && data.buildId !== currentBuildIdRef.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // Sem rede / offline no momento — silencioso, tenta de novo no próximo ciclo.
      }
    };

    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

    // Também verifica assim que o usuário volta pra aba (ex.: deixou aberto
    // de um turno pro outro) — não precisa esperar o próximo ciclo de 5min.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 sm:left-auto sm:right-5 sm:translate-x-0 z-[100] w-[calc(100%-2.5rem)] sm:w-auto sm:max-w-sm">
      <div className="bg-blue-950/95 border border-blue-800 rounded-2xl shadow-2xl shadow-blue-950/50 px-4 py-3.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-blue-100">Nova atualização disponível</p>
          <p className="text-[11px] text-blue-300/80 leading-snug">
            Recarregue a página para usar a versão mais recente do sistema.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
        <button
          onClick={() => setDismissed(true)}
          title="Fechar (o aviso volta a aparecer na próxima verificação, a cada 5 minutos)"
          className="shrink-0 text-blue-300/60 hover:text-blue-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
