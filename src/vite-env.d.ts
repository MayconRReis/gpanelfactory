/// <reference types="vite/client" />

// Identificador único da build atual, injetado pelo vite.config.ts (`define`)
// a cada `vite build` — usado por src/components/UpdateNotifier.tsx para
// detectar quando existe um deploy mais novo que o carregado na aba aberta.
declare const __APP_BUILD_ID__: string;
