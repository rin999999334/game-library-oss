import { assertPublicKey } from './public-connection';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';
export const demoMode = import.meta.env?.MODE === 'demo';
const url = demoMode ? undefined : import.meta.env?.VITE_SUPABASE_URL ?? (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
const key = demoMode ? undefined : import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY : undefined);
assertPublicKey(key);
export const configured = demoMode || Boolean(url && key);
export const supabase = createClient<Database>(url || 'https://unconfigured.supabase.co', key || 'unconfigured', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) },
});
