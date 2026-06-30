// GET /api/session
//
// Connection-status endpoint for the SPA. The browser can't read the
// `whoop_session` cookie itself (it's HttpOnly), so it asks this function
// whether the current session is valid. We decode the opaque session cookie
// server-side to a WHOOP member id and confirm a token row still exists for it.
//
// SECURITY:
//   - Returns NO token material — only the boolean status plus non-sensitive
//     metadata (the member id the cookie already references, the granted scope,
//     and the access-token expiry). The tokens themselves never leave the server.
//   - Mirrors /api/callback's posture: on a server-side failure we log the detail
//     and return a generic response, never leaking which env var / dependency is
//     at fault.
//
// TOKEN FRESHNESS (Phase 1.5):
//   The SPA polls this endpoint, which makes it the natural place to keep the
//   stored access token fresh. We read through ensureFreshTokens (lib/refresh.ts)
//   rather than getWhoopTokens directly: if the access token is at/near expiry it
//   transparently runs the refresh-token rotation, persists the rotated tokens,
//   and returns the refreshed row — so the scope/expiresAt below reflect the
//   refreshed token. ensureFreshTokens still returns the decrypted tokens, but we
//   surface ONLY scope + expiresAt here; the access/refresh tokens never enter
//   the response.
//
// Responses (always JSON):
//   200 { connected: false }                                  — no/invalid session
//   200 { connected: true, userId, scope, expiresAt }         — linked
//   500 { connected: false, error: 'Failed to check session.' } — unexpected error

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE, decodeSession } from './_lib/tokens.js';
import { ensureFreshTokens } from './_lib/refresh.js';

/** Parse the request's Cookie header into a name→value map (matches callback.ts). */
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
  // Decode the opaque session cookie → member id. A missing/tampered/old-key
  // cookie decodes to null, which is simply "not connected" — not an error.
  const cookies = parseCookies(req.headers.cookie);
  const userId = decodeSession(cookies[SESSION_COOKIE]);
  if (!userId) {
    json(res, 200, { connected: false });
    return;
  }

  try {
    // The cookie pointed at a member id; confirm a token row still exists AND is
    // fresh. ensureFreshTokens refreshes a near-expiry access token in place and
    // returns null only when the row is genuinely gone (e.g. /api/logout on
    // another device) — that is "not connected", not an error. A refresh that
    // fails at WHOOP's end (network/non-2xx) THROWS and is handled below as a
    // real failure, so we never report connected with a stale/expired token.
    const tokens = await ensureFreshTokens(userId);
    if (!tokens) {
      json(res, 200, { connected: false });
      return;
    }
    // Only non-sensitive metadata leaves the server — never the tokens.
    json(res, 200, {
      connected: true,
      userId: tokens.userId,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
    });
  } catch (err) {
    // ensureFreshTokens throws on a real problem: a ciphertext that won't decrypt
    // (integrity/key) or a refresh rejected by WHOOP. Log server-side; return a
    // generic, token-free response. Crucially we do NOT downgrade this to
    // connected:false — the row may still exist; the token just couldn't be
    // refreshed right now.
    console.error('Session check failed:', err);
    json(res, 500, { connected: false, error: 'Failed to check session.' });
  }
}
