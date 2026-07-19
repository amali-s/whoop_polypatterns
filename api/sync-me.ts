// POST /api/sync-me — user-triggered "Sync now" for the CALLING member only.
//
// WHY THIS EXISTS: /api/sync is the scheduled path and is gated by a shared
// secret (CRON_SECRET). That secret must NEVER reach the browser, so the
// dashboard cannot call it. This endpoint is the browser-safe sibling: it
// authenticates with the same HttpOnly `whoop_session` cookie every other read
// endpoint uses, and syncs exactly one member — whoever the cookie resolves to.
//
// It exists because the cron can only run once a day on Vercel Hobby, so a
// member who wants today's numbers before tomorrow's run needs a manual pull.
//
// SECURITY POSTURE:
//   - POST ONLY. The session cookie is SameSite=Lax, which means it IS sent on
//     cross-site top-level GET navigations but NOT on cross-site POSTs. Making
//     this POST-only is therefore the CSRF defence: a hostile page cannot cause
//     an authenticated sync by embedding an <img>/<a> or issuing a form POST.
//     Do not "helpfully" add a GET arm — that would reopen the hole.
//   - NO CRON_SECRET involvement, in either direction. This handler never reads
//     it and never emits it.
//   - The member id comes ONLY from decoding the cookie server-side. The caller
//     cannot name a different user to sync — there is no user parameter.
//   - The sync window is FIXED (the same 7-day default the cron uses). The
//     caller cannot request an arbitrary/wide backfill, so a repeated press
//     cannot be turned into a WHOOP-quota-draining 400-day pull.
//   - Responses carry counts and status only — never token material, never
//     database error text. Details go to console.error.
//
// COOLDOWN (best effort, honestly labelled): `lastSyncAt` is module state, so
// it is shared only within ONE warm serverless instance — it is NOT a
// distributed rate limiter and a determined caller can evade it by racing cold
// starts. It exists to swallow double-clicks and impatient repeat presses,
// which is the realistic failure mode for a single-user dashboard. The real
// protection against exhausting WHOOP's quota is sync.ts's own rate-limit
// classification (Phase 2.7), which surfaces a 429 as a resource-level error
// instead of hammering.
//
// Responses (always JSON):
//   200 { ok: true, results }              — sync ran; per-resource counts
//   200 { ok: false, reauthRequired: true }— WHOOP rejected the token; reconnect
//   401 { error: 'Not authenticated.' }    — no/invalid session cookie
//   405 { error: 'Method not allowed.' }   — anything other than POST
//   429 { error, retryAfterSeconds }       — inside the cooldown window
//   503 { waking: true } (+ Retry-After)   — database unavailable/paused
//   500 { error: 'Sync failed.' }          — unexpected error

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE, decodeSession } from './_lib/tokens.js';
import { DatabaseUnavailableError } from './_lib/supabase.js';
import { syncAll } from './_lib/sync.js';

/** Minimum gap between manual syncs for one member (best effort — see header). */
const COOLDOWN_MS = 60_000;

/** member id → last manual sync start (ms). Warm-instance-local by design. */
const lastSyncAt = new Map<string, number>();

/** Parse the request's Cookie header into a name→value map (matches session.ts). */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) {
      out[name] = decodeURIComponent(value);
    }
  }
  return out;
}

/** End with a JSON body at the given status. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // POST-only is load-bearing for CSRF (see header) — not a style choice.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'Method not allowed.' });
    return;
  }

  // Identity comes from the cookie alone; there is deliberately no user param.
  const cookies = parseCookies(req.headers.cookie);
  const userId = decodeSession(cookies[SESSION_COOKIE]);
  if (!userId) {
    json(res, 401, { error: 'Not authenticated.' });
    return;
  }

  const now = Date.now();
  const previous = lastSyncAt.get(userId);
  if (previous !== undefined && now - previous < COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((COOLDOWN_MS - (now - previous)) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    json(res, 429, { error: 'Already synced a moment ago.', retryAfterSeconds });
    return;
  }
  // Stamp BEFORE the work, so a second press while this one is still running is
  // rejected rather than starting a duplicate concurrent sync.
  lastSyncAt.set(userId, now);

  try {
    // No window argument: sync.ts's DEFAULT_LOOKBACK_DAYS (7) applies, matching
    // the cron exactly. The caller cannot widen this.
    const summary = await syncAll(userId);

    if (summary.reauthRequired) {
      // WHOOP rejected the token. Not a server fault, and retrying won't help —
      // the SPA should prompt a reconnect.
      console.error(`Manual sync: re-auth required for user ${userId}.`);
      json(res, 200, { ok: false, reauthRequired: true });
      return;
    }

    // ResourceSyncSummary is counts + an optional non-secret status string, so
    // it is safe to return verbatim (its own doc comment says as much).
    console.log(`Manual sync ok for user ${userId}:`, JSON.stringify(summary.results));
    json(res, 200, { ok: true, results: summary.results });
  } catch (err) {
    // A failed run shouldn't hold the cooldown — let the member retry promptly.
    lastSyncAt.delete(userId);

    if (err instanceof DatabaseUnavailableError) {
      console.error(`Manual sync: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    // Log the detail server-side; the client gets a generic body only.
    console.error('Manual sync failed:', err);
    json(res, 500, { error: 'Sync failed.' });
  }
}
