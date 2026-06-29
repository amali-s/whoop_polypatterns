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
// Responses (always JSON):
//   200 { connected: false }                                  — no/invalid session
//   200 { connected: true, userId, scope, expiresAt }         — linked
//   500 { connected: false, error: 'Failed to check session.' } — unexpected error

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getWhoopTokens, SESSION_COOKIE, decodeSession } from './_lib/tokens.js';

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
    // The cookie pointed at a member id; confirm a token row still exists. If the
    // row was deleted (e.g. via /api/logout on another device) the session is
    // stale, so report disconnected.
    const tokens = await getWhoopTokens(userId);
    if (!tokens) {
      json(res, 200, { connected: false });
      return;
    }
    json(res, 200, {
      connected: true,
      userId: tokens.userId,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
    });
  } catch (err) {
    // getWhoopTokens throws on a real integrity/key problem (e.g. ciphertext that
    // won't decrypt). Log server-side; return a generic, token-free response.
    console.error('Session check failed:', err);
    json(res, 500, { connected: false, error: 'Failed to check session.' });
  }
}
