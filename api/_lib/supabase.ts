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

// ── Database availability classification (Phase 2.5) ────────────────────────
// Supabase pauses inactive free-tier projects (7 days of low activity, per
// https://supabase.com/docs/guides/platform/free-project-pausing — verified
// 2026-07-05; a paused project does NOT auto-resume on request, the owner must
// click "Resume project" in the dashboard). Requests to a paused/unavailable
// project fail at the INFRASTRUCTURE level, never as a PostgREST query error,
// and we want /api/session to tell the SPA "the database is unavailable, maybe
// waking" rather than a flat 500 that looks like an auth failure.
//
// What the supabase-js client actually surfaces (traced against the installed
// @supabase/postgrest-js 2.108.2 source, not guessed):
//   - A non-2xx HTTP response passes its status straight through on the
//     builder result (`const { error, status } = await ...`). A paused project
//     returns HTTP 540 "Project Paused" from Supabase's API gateway
//     (documented: https://supabase.com/docs/guides/troubleshooting/http-status-codes).
//   - A fetch-level failure (DNS, connection refused, socket timeout — what a
//     project mid-restore or mid-teardown produces) is CAUGHT by postgrest-js
//     (builders don't throw unless .throwOnError()) and returned as
//     `status: 0` with a synthetic error object.
// So the status number on the result is a complete, narrow signal; we never
// need to string-match error messages.

/** Supabase gateway statuses (and the postgrest-js network sentinel) that mean
 * "the project/database is unavailable", as opposed to a query/auth failure:
 *   0   — postgrest-js could not reach the endpoint at all (fetch threw)
 *   502/503/504 — gateway-level unavailable/timeout (infra, never PostgREST)
 *   540 — "Project Paused" (documented Supabase code for a paused project)
 *   544 — "Project API Gateway Timeout" (documented Supabase infra timeout)
 * Everything else (4xx auth/query errors, 500 from PostgREST) is a genuine
 * failure and must NOT be reported as "waking". */
export function isDbUnavailableStatus(status: number): boolean {
  return (
    status === 0 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 540 ||
    status === 544
  );
}

/**
 * Thrown by DB read/write helpers when the failure is the Supabase project
 * being unreachable/paused rather than a real query or integrity error.
 * /api/session maps this to `503 { connected:false, waking:true }` so the SPA
 * can show a "waking up" state instead of a misleading "not connected".
 * The message is deliberately generic — it may end up in server logs, never in
 * a client response, but it still names no internal dependency or secret.
 */
export class DatabaseUnavailableError extends Error {
  /** The gateway status that triggered classification (0 = unreachable). */
  readonly status: number;

  constructor(status: number) {
    super('Database temporarily unavailable.');
    this.name = 'DatabaseUnavailableError';
    this.status = status;
  }
}

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
