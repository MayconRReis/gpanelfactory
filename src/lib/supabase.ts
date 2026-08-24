import { createClient } from '@supabase/supabase-js';

const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

// Use environment variables if present, or the provided project credentials
export const supabaseUrl = envUrl || 'https://dmebcmxyeyvdntwalceu.supabase.co';
export const supabaseAnonKey = envKey || 'sb_publishable_clNlxpAAXoEvgoeQ6tKp9g_A_ZYJ7mW';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('placeholder-project') &&
  supabaseAnonKey !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy'
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
