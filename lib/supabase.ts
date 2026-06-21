// Server-only Supabase client (service-role).
//
// This helper is used inside /api serverless functions to read/write the
// Postgres tables defined in supabase/migrations. It authenticates with the
// SERVICE ROLE key, which has full admin access and BYPASSES Row Level
// Security — so it must never reach the browser.
//
// SECURITY:
//   - This module is server-only. It lives outside /src and must never be
//     imported into frontend code (it reads the service-role secret from
//     process.env). Mirrors the server-only contract in lib/crypto.ts.
//   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from env vars (set in
//     Vercel only — never committed). No values are hardcoded here.
//   - If frontend code ever needs Supabase, give it the ANON key with a
//     VITE_ prefix instead — never this client.
//
// This is Phase 0 scaffolding: the client factory is in place so Phase 1/2
// storage code can call getSupabaseAdmin() without re-reading env vars.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Return a singleton service-role Supabase client.
 * Throws (rather than silently failing) if either env var is missing, so a
 * misconfigured deploy fails loudly instead of writing nowhere.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) {
    return cached;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not set (server env var).');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (server env var).');
  }

  cached = createClient(url, serviceRoleKey, {
    auth: {
      // No browser session to manage in a stateless serverless function.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
