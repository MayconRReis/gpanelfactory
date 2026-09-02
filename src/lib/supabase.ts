import { createClient } from '@supabase/supabase-js';

const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const envKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ''
).trim();

export const supabaseUrl = envUrl;
export const supabaseAnonKey = envKey;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('placeholder') &&
  !supabaseUrl.includes('your-supabase-url') &&
  supabaseAnonKey.length > 20 &&
  supabaseAnonKey !== 'your-anon-key'
);

// Classifica erros de rede que merecem retry automático
export function isRetryableError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || err.error_description || err.details || err.hint || String(err) || '').toLowerCase();
  const code = (err.code || '').toString().toUpperCase();
  return (
    code === 'PGRST000' || code === 'PGRST001' || code === 'PGRST002' || code === 'PGRST003' ||
    code === '57P01' || code === '57P02' || code === '57P03' || code === '53300' ||
    code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' ||
    msg.includes('schema cache') || msg.includes('could not query the database') ||
    msg.includes('connection reset') || msg.includes('connection refused') ||
    msg.includes('failed to fetch') || msg.includes('networkerror') ||
    msg.includes('network error') || msg.includes('load failed') || msg.includes('timeout') ||
    err.status === 502 || err.status === 503 || err.status === 504 || err.status === 0
  );
}

// Classifica erros de fetch/rede (mais amplo que retryable)
export function isFetchOrNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || err.error_description || err.details || err.hint || String(err) || '').toLowerCase();
  return (
    isRetryableError(err) ||
    msg.includes('failed to fetch') || msg.includes('networkerror') ||
    msg.includes('network error') || msg.includes('load failed') ||
    msg.includes('fetch') || msg.includes('cors') || msg.includes('timeout') ||
    err.name === 'TypeError' || err.status === 0 ||
    err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'PGRST301'
  );
}

// Desativa o Supabase em runtime após falha irrecuperável de rede
export let isSupabaseRuntimeEnabled = isSupabaseConfigured;
export function disableSupabase() {
  if (isSupabaseRuntimeEnabled) {
    isSupabaseRuntimeEnabled = false;
    console.warn('[GPanel] Supabase desativado em runtime — modo offline ativado.');
  }
}

if (!isSupabaseConfigured) {
  console.error('[GPanel] Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env');
}

// Wrapper de fetch com retry automático (400ms) e fallback offline gracioso
const safeFetch: typeof fetch = async (input, init) => {
  if (!isSupabaseRuntimeEnabled) {
    return new Response(
      JSON.stringify({ code: 'PGRST000', message: 'Offline mode active', details: null, hint: null }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
  try {
    return await fetch(input, init);
  } catch (err: any) {
    if (isFetchOrNetworkError(err)) {
      try {
        await new Promise(r => setTimeout(r, 400));
        return await fetch(input, init);
      } catch (retryErr: any) {
        console.warn('[GPanel] Fetch falhou após retry — ativando modo offline:', retryErr?.message || retryErr);
        disableSupabase();
        return new Response(
          JSON.stringify({ code: 'PGRST000', message: 'Offline mode active', details: null, hint: null }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    throw err;
  }
};

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: isSupabaseConfigured,
      detectSessionInUrl: true,
    },
    global: {
      fetch: safeFetch,
    },
  }
);

