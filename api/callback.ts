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
//   3. Encrypts the tokens and upserts them into the Supabase `whoop_tokens`
//      table (server-side source of truth), then hands the browser only an
//      opaque session cookie that references that row — never the tokens.
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
// TOKEN STORAGE — Phase 1.4 (durable, server-side source of truth):
//   The access/refresh tokens are AES-256-GCM-encrypted with lib/crypto.ts and
//   UPSERTED into the Supabase `whoop_tokens` table, keyed by the WHOOP member
//   id (user_id). Re-auth overwrites the existing row. The table stores
//   CIPHERTEXT only; encryption happening before the DB write means even the DB
//   operator never sees raw tokens.
//
//   The browser holds NO tokens. It receives ONE opaque, HttpOnly session
//   cookie (lib/tokens.ts → encodeSession) whose value is encryptToken(user_id).
//   Later /api functions decode it to a user_id and use getWhoopTokens() to read
//   + decrypt the tokens from Supabase. Why a session cookie over a server-side
//   session store: this app has no sessions table, the member id alone is enough
//   to key the row, and encrypting it reuses the existing crypto helper to make
//   the cookie both opaque (hides the member id) and tamper-evident (the GCM
//   auth tag stops a client swapping in another id) with no new infrastructure.
//
//   This supersedes Phase 1.3, where the tokens themselves lived in encrypted
//   cookies: that was simple and stateless but rode the browser, was
//   size-limited, and couldn't be refreshed without the browser present. The
//   row in Supabase is durable and refreshable server-side (Phase 1.5).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { encryptToken } from './_lib/crypto.js';
import { getSupabaseAdmin, isDbUnavailableStatus } from './_lib/supabase.js';
import { SESSION_COOKIE, encodeSession } from './_lib/tokens.js';

// WHOOP OAuth 2.0 token endpoint (see header note for verification).
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

// WHOOP API v2 "get basic profile" endpoint. We call it with the freshly minted
// access token solely to learn the member's stable `user_id`, which keys the
// whoop_tokens row (the token response itself does not include any member id).
//
// VERIFIED-AGAINST-SPEC (WHOOP OpenAPI, June 2026):
// https://api.prod.whoop.com/developer/doc/openapi.json declares the server url
// `https://api.prod.whoop.com/developer` and the path `/v2/user/profile/basic`,
// so the full URL below is correct (the `/developer` prefix is confirmed, not
// assumed). Method GET, scope read:profile (requested by /api/auth), auth via
// `Authorization: Bearer <access_token>`; response JSON includes
// { user_id, email, first_name, last_name } — we read `user_id`.
const WHOOP_PROFILE_URL = 'https://api.prod.whoop.com/developer/v2/user/profile/basic';

// Must mirror the cookie name minted in /api/auth.
const STATE_COOKIE = 'whoop_oauth_state';

// The session cookie tracks the access-token lifetime loosely; the durable row
// (refreshable server-side, Phase 1.5) is the real source of truth, so a
// conservative 30-day ceiling here just bounds how long a browser stays linked
// before it must re-auth. WHOOP's refresh-token TTL governs actual validity.
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // seconds (30 days)

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

  const { access_token, refresh_token, expires_in, scope } = tokens;
  if (!access_token) {
    fail(res, 502, 'WHOOP token response missing access_token.', [clearState]);
    return;
  }
  // The whoop_tokens.refresh_token_encrypted column is NOT NULL and we need the
  // refresh token to keep syncing server-side (Phase 1.5), so a missing one is a
  // hard failure here rather than a half-stored row. /api/auth requests the
  // `offline` scope precisely so WHOOP returns it.
  if (!refresh_token) {
    fail(res, 502, 'WHOOP token response missing refresh_token (offline scope?).', [clearState]);
    return;
  }

  // ── 5. Identify the member: GET the basic profile for a stable user_id. ──
  // This is the only id we can key the token row on; the token response has none.
  let userId: string;
  try {
    const profileRes = await fetch(WHOOP_PROFILE_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) {
      const detail = await profileRes.text().catch(() => '');
      console.error(`WHOOP profile fetch failed: ${profileRes.status} ${detail}`);
      fail(res, 502, 'Failed to fetch WHOOP profile.', [clearState]);
      return;
    }
    const profile = (await profileRes.json()) as { user_id?: number | string };
    if (profile.user_id === undefined || profile.user_id === null) {
      fail(res, 502, 'WHOOP profile response missing user_id.', [clearState]);
      return;
    }
    // Stored as text (the row's primary key is text — member ids are not assumed
    // numeric); String() normalizes whether WHOOP sends a number or a string.
    userId = String(profile.user_id);
  } catch {
    fail(res, 502, 'Failed to reach the WHOOP profile endpoint.', [clearState]);
    return;
  }

  // ── 6. Encrypt + upsert the tokens into whoop_tokens (source of truth). ──
  // encryptToken() throws if TOKEN_ENCRYPTION_KEY is unset/wrong-sized, and the
  // DB write can fail; either way we surface a 500 rather than store plaintext
  // or leave the browser thinking it connected. The row holds CIPHERTEXT only.
  try {
    const accessTokenEncrypted = encryptToken(access_token);
    const refreshTokenEncrypted = encryptToken(refresh_token);
    // Absolute expiry from expires_in (now + seconds); fall back to 1h if absent.
    const ttlSeconds = typeof expires_in === 'number' && expires_in > 0 ? expires_in : 3600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const now = new Date().toISOString();

    const { error, status } = await getSupabaseAdmin()
      .from('whoop_tokens')
      .upsert(
        {
          user_id: userId,
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          expires_at: expiresAt,
          scope: scope ?? null,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      // error.message can carry row context; log server-side, don't echo it.
      console.error(`whoop_tokens upsert failed: ${error.message}`);
      // Phase 2.5: a paused/unreachable free-tier Supabase project fails HERE,
      // during the OAuth callback, as a gateway status / fetch-level failure
      // (postgrest-js surfaces it as status 0/540/etc — see supabase.ts). This
      // is the path a LOGGED-OUT user hits: /api/session short-circuits to
      // connected:false without a DB read, so they never see the polling
      // "waking" screen — they click Connect WHOOP and land here. Instead of a
      // cryptic "Failed to store tokens", redirect back to the SPA with a clear,
      // banner-friendly message telling them the DB is paused and to resume it.
      // We reuse the existing whoop_error banner mechanism; the message names no
      // internal dependency beyond "database" and carries no token material.
      if (isDbUnavailableStatus(status)) {
        const params = new URLSearchParams({
          whoop_error: 'database_unavailable',
          whoop_error_description:
            'Your database is paused or waking up, so we couldn’t save your connection.',
          whoop_error_hint:
            'Free-tier Supabase projects pause after inactivity. Resume it in the Supabase dashboard, then click Connect WHOOP again.',
        });
        redirect(res, `${APP_LANDING_PATH}?${params.toString()}`, [clearState]);
        return;
      }
      fail(res, 500, 'Failed to store tokens.', [clearState]);
      return;
    }
  } catch (err) {
    console.error('Token encryption/storage failed:', err);
    fail(res, 500, 'Failed to store tokens.', [clearState]);
    return;
  }

  // ── 7. Hand the browser only an opaque session cookie referencing the row. ─
  // encodeSession() = encryptToken(user_id): tamper-evident + hides the id.
  let sessionCookie: string;
  try {
    sessionCookie = setCookie(SESSION_COOKIE, encodeSession(userId), SESSION_COOKIE_MAX_AGE);
  } catch (err) {
    console.error('Session cookie encoding failed:', err);
    fail(res, 500, 'Failed to establish session.', [clearState]);
    return;
  }

  // ── 8. Connected. Send the user to the app. ──────────────────────────────
  redirect(res, APP_LANDING_PATH, [clearState, sessionCookie]);
}
