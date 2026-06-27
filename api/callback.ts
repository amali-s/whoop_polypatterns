// GET /api/callback
//
// Step 2 of the WHOOP OAuth 2.0 Authorization Code flow. WHOOP redirects the
// browser here after the consent screen with `?code=...&state=...` (success)
// or `?error=...` (the user denied access, or something went wrong). This
// function:
//
//   1. Verifies CSRF: the `state` query param must equal the `state` we stashed
//      in an HttpOnly cookie from /api/auth. Mismatch / missing → 400, and we
//      do nothing else. The state cookie is cleared once read (single use).
//   2. Exchanges the `code` for tokens via a SERVER-SIDE POST to WHOOP's token
//      endpoint. This is the only place the Client Secret is used.
//   3. Stores the tokens server-side, never handing them to client JS.
//   4. Redirects the browser to the app (the SPA at "/").
//
// Endpoint + request shape confirmed against the live WHOOP developer docs
// (developer.whoop.com → OAuth / "Authenticating with WHOOP"), June 2026:
//   - Token URL:   https://api.prod.whoop.com/oauth/oauth2/token
//   - Body:        application/x-www-form-urlencoded
//   - Credentials: client_id + client_secret sent IN THE BODY
//                  ("Client Authentication: Send client credentials in body"),
//                  not an HTTP Basic Authorization header.
//   - Response:    { access_token, refresh_token, expires_in, scope,
//                    token_type: "bearer" }  (refresh_token requires the
//                    `offline` scope, which /api/auth requests.)
//
// TOKEN STORAGE — tradeoff (this task, Phase 1.3):
//   Tokens are written to HttpOnly + SameSite cookies, AES-256-GCM-encrypted
//   at rest with lib/crypto.ts. Rationale:
//     - HttpOnly means client-side JavaScript can never read them.
//     - App-level encryption means a stolen cookie file is useless without the
//       server's TOKEN_ENCRYPTION_KEY (matches the repo's "encrypt tokens at
//       rest" posture; never plaintext on disk).
//   Tradeoff vs. a server-side store: cookies are simple and stateless (no DB
//   round-trip), but they ride on the browser, are size-limited, and can't be
//   refreshed without the browser present. Phase 1.4 migrates the source of
//   truth to the encrypted Supabase `whoop_tokens` table (durable, refreshable
//   server-side via lib/supabase.ts + lib/crypto.ts); this cookie storage is
//   the minimal, self-contained version for the auth round-trip.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { encryptToken } from '../lib/crypto';

// WHOOP OAuth 2.0 token endpoint (see header note for verification).
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

// Must mirror the cookie name minted in /api/auth.
const STATE_COOKIE = 'whoop_oauth_state';

// Cookies that hold the (encrypted) tokens. Read only by future /api functions.
const ACCESS_COOKIE = 'whoop_access_token';
const REFRESH_COOKIE = 'whoop_refresh_token';

// Refresh tokens are long-lived; keep the cookie around so we can mint new
// access tokens later (Phase 1.5) without forcing a re-auth. 30 days is a
// conservative ceiling — WHOOP's actual refresh-token TTL governs validity.
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // seconds (30 days)

// Where to send the user once they're connected: the SPA landing/dashboard.
const APP_LANDING_PATH = '/';

// `Secure` is gated to production so the full loop works over plain
// http://localhost during dev. Applied IDENTICALLY here and in /api/auth — if
// the flags drift, the state cookie set by /api/auth won't come back here.
const isProd = process.env.NODE_ENV === 'production';

/** Shared cookie attributes for every cookie in the OAuth flow. */
function cookieAttrs(maxAge: number): string {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAge}`];
  if (isProd) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

/** Serialize a Set-Cookie header value (URL-encodes the value defensively). */
function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; ${cookieAttrs(maxAge)}`;
}

/** Expire a cookie immediately (same attributes, Max-Age=0). */
function clearCookie(name: string): string {
  return `${name}=; ${cookieAttrs(0)}`;
}

/** Parse the request's Cookie header into a name→value map. */
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

/** Redirect helper. */
function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  }
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

/** End with a JSON error (used for CSRF and server-side failures). */
function fail(res: ServerResponse, status: number, message: string, cookies: string[] = []): void {
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Parse query params from the raw request URL. We avoid @vercel/node's
  // req.query so this stays dependency-free (matching /api/auth).
  const url = new URL(req.url ?? '', 'http://localhost');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookies = parseCookies(req.headers.cookie);
  const expectedState = cookies[STATE_COOKIE];

  // ── 1. CSRF check FIRST, before touching anything else. ──────────────────
  // A missing or mismatched state means this callback was not initiated by us.
  // Reject with 400 and clear the (now-spent) state cookie.
  if (!state || !expectedState || state !== expectedState) {
    fail(res, 400, 'Invalid OAuth state.', [clearCookie(STATE_COOKIE)]);
    return;
  }

  // State verified — burn the cookie so it can't be replayed.
  const clearState = clearCookie(STATE_COOKIE);

  // ── 2. Did WHOOP send back an error instead of a code? ───────────────────
  // e.g. the user clicked "Deny" → ?error=access_denied. Redirect to the app
  // with a flag the SPA can surface, rather than dumping a raw error.
  if (oauthError) {
    redirect(res, `${APP_LANDING_PATH}?whoop_error=${encodeURIComponent(oauthError)}`, [
      clearState,
    ]);
    return;
  }

  if (!code) {
    fail(res, 400, 'Missing authorization code.', [clearState]);
    return;
  }

  // ── 3. Server config (secrets live ONLY in env vars). ────────────────────
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    // Don't leak which var is missing to the client.
    fail(res, 500, 'OAuth is not configured.', [clearState]);
    return;
  }

  // ── 4. Exchange the code for tokens (form-encoded, creds in body). ───────
  // redirect_uri MUST byte-match the one /api/auth sent, or WHOOP rejects it.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    fail(res, 502, 'Failed to reach the WHOOP token endpoint.', [clearState]);
    return;
  }

  if (!tokenRes.ok) {
    // Log the detail server-side for debugging; never echo it to the client
    // (it can include sensitive request context).
    const detail = await tokenRes.text().catch(() => '');
    console.error(`WHOOP token exchange failed: ${tokenRes.status} ${detail}`);
    fail(res, 502, 'WHOOP token exchange failed.', [clearState]);
    return;
  }

  let tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  try {
    tokens = (await tokenRes.json()) as typeof tokens;
  } catch {
    fail(res, 502, 'WHOOP returned an unparseable token response.', [clearState]);
    return;
  }

  const { access_token, refresh_token, expires_in } = tokens;
  if (!access_token) {
    fail(res, 502, 'WHOOP token response missing access_token.', [clearState]);
    return;
  }

  // ── 5. Store tokens server-side: HttpOnly + encrypted-at-rest cookies. ───
  // encryptToken() throws if TOKEN_ENCRYPTION_KEY is unset/wrong-sized — that's
  // a server misconfig, so surface a 500 rather than storing plaintext.
  const outCookies: string[] = [clearState];
  try {
    // Access-token cookie lifetime tracks WHOOP's expiry (fallback 1h).
    const accessMaxAge = typeof expires_in === 'number' && expires_in > 0 ? expires_in : 3600;
    outCookies.push(setCookie(ACCESS_COOKIE, encryptToken(access_token), accessMaxAge));
    if (refresh_token) {
      outCookies.push(
        setCookie(REFRESH_COOKIE, encryptToken(refresh_token), REFRESH_COOKIE_MAX_AGE),
      );
    }
  } catch (err) {
    console.error('Token encryption failed:', err);
    fail(res, 500, 'Failed to store tokens.', [clearState]);
    return;
  }

  // ── 6. Connected. Send the user to the app. ──────────────────────────────
  redirect(res, APP_LANDING_PATH, outCookies);
}
