/**
 * Sistema de log de erros — GPanel Factory.
 *
 * Toda falha de operação de banco (Supabase) capturada nas telas deve passar por
 * `logError()`, que gera um código curto e copiável (formato "GP-XXXXX") e guarda
 * o erro completo (mensagem, stack, contexto) num log em memória + localStorage.
 *
 * O operador vê apenas o código na tela (via ErrorNotification) e pode repassá-lo
 * ao suporte/coordenador, que consegue localizar o erro completo com `getErrorLog()`
 * (base para uma futura tela de logs do coordenador).
 */

export interface ErrorLogEntry {
  code: string;
  context: string;
  message: string;
  detail?: string;
  createdAt: string;
  userId?: string;
}

const ERROR_LOG_STORAGE_KEY = 'SIG_PROD_ERROR_LOG_V1';
const MAX_ENTRIES = 200;

let inMemoryErrorLog: ErrorLogEntry[] = [];

function loadErrorLogFromStorage(): ErrorLogEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(ERROR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistErrorLog() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(inMemoryErrorLog.slice(0, MAX_ENTRIES)));
  } catch {
    // Armazenamento indisponível (modo privado, cota excedida etc.) — segue apenas em memória.
  }
}

inMemoryErrorLog = loadErrorLogFromStorage();

// Alfabeto sem 0/O/1/I/L — evita confusão ao ler o código em voz alta ou digitá-lo de volta.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateErrorCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `GP-${code}`;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'Erro desconhecido';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const anyErr = error as any;
    if (typeof anyErr.message === 'string') return anyErr.message;
    if (typeof anyErr.error_description === 'string') return anyErr.error_description;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Registra um erro capturado num catch block. Retorna a entrada criada (com o
 * código copiável) para a tela usar no toast/ErrorNotification.
 *
 * @param context Identifica de onde veio o erro, ex.: "PesagemScreen.handleSaveOSM".
 * @param error O valor capturado no catch (Error, PostgrestError, string, etc.).
 * @param userId uid do usuário logado, quando disponível — ajuda a rastrear o caso.
 */
export function logError(context: string, error: unknown, userId?: string): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    code: generateErrorCode(),
    context,
    message: extractMessage(error),
    detail: error instanceof Error ? error.stack : undefined,
    createdAt: new Date().toISOString(),
    userId,
  };

  inMemoryErrorLog = [entry, ...inMemoryErrorLog].slice(0, MAX_ENTRIES);
  persistErrorLog();

  // Mantém o console útil para debug local, prefixado com o código copiável.
  console.error(`[${entry.code}] ${context}:`, error);

  return entry;
}

/** Retorna o log de erros mais recente primeiro — usar numa futura tela de logs do coordenador. */
export function getErrorLog(): ErrorLogEntry[] {
  return inMemoryErrorLog;
}

/** Busca uma entrada específica pelo código (ex.: coordenador digita o código que o operador informou). */
export function findErrorByCode(code: string): ErrorLogEntry | null {
  const normalized = code.trim().toUpperCase();
  return inMemoryErrorLog.find(e => e.code === normalized) || null;
}

export function clearErrorLog(): void {
  inMemoryErrorLog = [];
  persistErrorLog();
}
