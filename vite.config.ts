import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Identificador único desta build — usado pelo aviso "Nova atualização
  // disponível" (ver src/components/UpdateNotifier.tsx). Prioriza o hash do
  // commit que a Vercel expõe automaticamente durante o build
  // (VERCEL_GIT_COMMIT_SHA); sem isso (dev local, outro provedor), cai para
  // o timestamp do build — de qualquer forma, único a cada novo deploy.
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // Grava dist/version.json com o mesmo buildId injetado no bundle via
        // `define` abaixo — é esse arquivo estático que o UpdateNotifier
        // consulta periodicamente para saber se já existe um deploy mais
        // novo que o carregado na aba aberta.
        name: 'gpanel-write-version-json',
        apply: 'build',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ buildId }),
          });
        },
      },
    ],
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
