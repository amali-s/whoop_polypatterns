// GET /api/callback
//
// Step 2 of the WHOOP OAuth 2.0 Authorization Code flow. WHOOP redirects the
// browser here after the consent screen with `?code=...&state=...` (success)
// or `?error=...` (the user denied access, or something went wrong). This
// function:
//
//   1. Handles a provider error first: if WHOOP rejected the authorize request
//      (e.g. ?error=invalid_scope / access_denied), it redirects back here with
//      an empty/absent `state`, so we surface that error BEFORE the CSRF check
//      to avoid mislabeling it as "Invalid OAuth state".
//   2. Verifies CSRF on the success path: the `state` query param must equal the
//      `state` we stashed in an HttpOnly cookie from /api/auth. Mismatch /
//      missing → 400. The state cookie is cleared once read (single use).
//   3. Exchanges the `code` for tokens via a SERVER-SIDE POST to WHOOP's token
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
import { encryptToken } from './_lib/crypto.js';

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

  // The state cookie is single-use: clear it on every exit path below.
  const clearState = clearCookie(STATE_COOKIE);

  // ── 1. Provider error FIRST, before the CSRF check. ──────────────────────
  // If WHOOP rejects the authorize request itself (invalid_scope, access_denied,
  // etc.) it redirects here with ?error=... and OFTEN an empty or absent `state`.
  // If we ran the CSRF check first, that empty state would trip it and the real
  // problem would masquerade as "Invalid OAuth state" — which is exactly the
  // failure that hid an invalid_scope error during Phase 1.3. There is no `code`
  // on an error response, so no token exchange or other sensitive work happens
  // here; surfacing the provider's own error is safe. We forward the error code,
  // description, and hint (none of which contain secrets) so the SPA — and the
  // URL bar — show the true cause, and we log the full detail server-side.
  if (oauthError) {
    const errorDescription = url.searchParams.get('error_description') ?? '';
    const errorHint = url.searchParams.get('error_hint') ?? '';
    console.error(
      `WHOOP authorize error: ${oauthError}` +
        (errorDescription ? ` — ${errorDescription}` : '') +
        (errorHint ? ` (${errorHint})` : ''),
    );
    const params = new URLSearchParams({ whoop_error: oauthError });
    if (errorDescription) {
      params.set('whoop_error_description', errorDescription);
    }
    if (errorHint) {
      params.set('whoop_error_hint', errorHint);
    }
    redirect(res, `${APP_LANDING_PATH}?${params.toString()}`, [clearState]);
    return;
  }

  // ── 2. CSRF check on the SUCCESS path. ───────────────────────────────────
  // A genuine authorization response carries both `code` and the `state` we
  // minted in /api/auth. A missing or mismatched state means this callback was
  // not initiated by us → reject. The check is enforced here, immediately before
  // the token exchange, which is the operation it actually protects.
  if (!state || !expectedState || state !== expectedState) {
    fail(res, 400, 'Invalid OAuth state.', [clearState]);
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
