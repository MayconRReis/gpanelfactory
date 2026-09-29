import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Sparkles } from 'lucide-react';

/**
 * AVISO DE NOVA ATUALIZAÇÃO DISPONÍVEL
 * ------------------------------------------------------------------
 * Igual ao que já existe no Stoque+: enquanto o usuário está com a aba
 * aberta, um novo deploy pode ir ao ar (Vercel) sem que a página recarregue
 * sozinha — o JS antigo continua rodando em memória. Este componente
 * verifica periodicamente se já existe uma build mais nova publicada e,
 * se sim, BLOQUEIA a tela com uma janela pedindo para atualizar — ninguém
 * continua usando uma versão antiga (que pode gravar dados do jeito antigo).
 *
 * Mecanismo: `vite.config.ts` grava, a cada `vite build`, um `buildId`
 * único tanto DENTRO do bundle JS (via `define`, em `__APP_BUILD_ID__`)
 * quanto num arquivo estático `dist/version.json`. Comparamos o valor que
 * já está rodando (`__APP_BUILD_ID__`, fixo desde que a página carregou)
 * com o valor mais recente de `/version.json` (buscado com
 * `cache: 'no-store'` para nunca pegar uma cópia em cache) — quando eles
 * divergem, é porque um novo deploy aconteceu depois que esta aba abriu.
 */

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // verifica a cada 2 minutos

export function UpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
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
    window.addEventListener('focus', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  if (!updateAvailable || typeof document === 'undefined') return null;

  const doReload = () => {
    setReloading(true);
    // Recarrega pedindo a página nova ao servidor (sem cache)
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.toString());
  };

  // Janela que cobre a tela inteira e não pode ser fechada: bloqueia o uso
  // do app até recarregar.
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-title"
    >
      <div className="w-full max-w-sm bg-[#121217] border border-blue-800 rounded-3xl shadow-2xl shadow-blue-950/60 p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-blue-400" />
        </div>
        <div className="space-y-1.5">
          <h2 id="update-title" className="text-base font-black text-white uppercase tracking-wider">
            Nova versão do app
          </h2>
          <p className="text-sm text-[#d4d4d8] leading-relaxed">
            O sistema foi atualizado. Para continuar, atualize a página — assim todos usam a mesma versão e nada é gravado do jeito antigo.
          </p>
          <p className="text-[11px] text-[#71717a]">
            Se estava preenchendo algo, anote antes de atualizar.
          </p>
        </div>
        <button
          onClick={doReload}
          disabled={reloading}
          autoFocus
          className="w-full h-12 flex items-center justify-center gap-2 rounded-2xl text-sm font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-70 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
          {reloading ? 'Atualizando...' : 'Atualizar agora'}
        </button>
      </div>
    </div>,
    document.body
  );
}
