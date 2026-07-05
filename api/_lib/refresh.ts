// Server-only WHOOP access-token refresh (Phase 1.5).
//
// getWhoopTokens (lib/tokens.ts) reads + decrypts the durable whoop_tokens row;
// this module is the consumer its header comment promised ("Phase 1.5 refresh
// ... reuse it"). It exposes a single helper the rest of the server calls to
// always get a VALID access token: it proactively refreshes via refresh-token
// rotation before the access token expires, persists the rotated tokens back to
// Supabase, and returns the fresh token for the current request only.
//
// SECURITY:
//   - Server-only. Like tokens.ts/crypto.ts/supabase.ts it composes the
//     service-role Supabase client and TOKEN_ENCRYPTION_KEY, so it must NEVER be
//     imported into /src.
//   - Plaintext tokens exist only in the value the helpers return, for the
//     duration of one serverless request. Nothing here logs token material; on
//     a refresh failure we log only the HTTP status + WHOOP's error body (which
//     does not contain the secret) server-side, never echoed to a client.
//
// REFRESH REQUEST SHAPE — confirmed against the live WHOOP developer docs
// (developer.whoop.com → OAuth, "Refresh Token" section), June 2026. Mirrors the
// authorization_code exchange in api/callback.ts exactly:
//   - Token URL:   https://api.prod.whoop.com/oauth/oauth2/token  (POST)
//   - Body:        application/x-www-form-urlencoded
//   - Params:      grant_type=refresh_token, refresh_token=<decrypted>,
//                  client_id, client_secret, and scope=offline. The docs' sample
//                  refresh payload includes scope:"offline" (the scope that mints
//                  a refresh token), so we resend it.
//   - Credentials: client_id + client_secret IN THE BODY (not Basic auth).
//   - Response:    { access_token, refresh_token, expires_in, scope,
//                    token_type:"bearer" } — same shape as the code exchange.
//
// CONFIRMED vs. ASSUMED (the ROADMAP flagged these as unconfirmed):
//   - ROTATION (confirmed): WHOOP ROTATES the refresh token. Per the docs,
//     "the refresh token from the refresh response is now the valid refresh
//     token, and your app must use the new refresh token on the subsequent
//     refresh request" — and the old access token is invalidated. So we MUST
//     persist the new refresh_token on every refresh. If WHOOP ever omits one we
//     keep the existing token (the column is NOT NULL) rather than dropping it.
//   - TTL (confirmed variable): the docs' sample response shows
//     "expires_in": 3600 (1 hour) but state the TTL is whatever `expires_in`
//     reports per response. We never hardcode 1h except as the same fallback
//     callback.ts uses when expires_in is absent.

import { encryptToken } from './crypto.js';
import { DatabaseUnavailableError, getSupabaseAdmin, isDbUnavailableStatus } from './supabase.js';
import { getWhoopTokens, type WhoopTokens } from './tokens.js';

// WHOOP OAuth 2.0 token endpoint — identical to api/callback.ts (see header).
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const TOKENS_TABLE = 'whoop_tokens';

// Refresh when fewer than this many milliseconds remain on the access token (or
// when expiry is unknown). A 5-minute skew comfortably covers clock drift and
// the round-trip of the request the caller is about to make with the token.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Thrown when getValidAccessToken is asked for a token but no row exists for the
 * member (never connected, or the row was deleted). Callers that distinguish
 * "not connected" from a real failure — e.g. /api/session — should prefer
 * ensureFreshTokens, which returns null instead of throwing for this case.
 */
export class NotConnectedError extends Error {
  constructor(userId: string) {
    super(`No WHOOP tokens for user ${userId}.`);
    this.name = 'NotConnectedError';
  }
}

/** True when the access token is unknown-expiry or within the refresh skew. */
function isNearExpiry(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return true;
  }
  return expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
}

/**
 * Return up-to-date tokens for a member, refreshing first if the access token is
 * at/near expiry. Returns null when no row exists (the member is not connected),
 * mirroring getWhoopTokens so callers can map null → disconnected. Throws on a
 * genuine failure (decrypt/integrity problem, or a refresh rejected by WHOOP)
 * rather than masking it as "not connected".
 *
 * The returned WhoopTokens hold PLAINTEXT tokens for the current request only;
 * never serialize them to a client.
 */
export async function ensureFreshTokens(userId: string): Promise<WhoopTokens | null> {
  const current = await getWhoopTokens(userId);
  if (!current) {
    return null;
  }
  if (!isNearExpiry(current.expiresAt)) {
    // Plenty of life left — hand back the existing token, row untouched.
    return current;
  }
  return refreshTokens(current);
}

/**
 * Always return a usable access token for a member, refreshing if needed.
 * Throws NotConnectedError when no row exists (this overload returns a bare
 * string, so it cannot signal "not connected" with null).
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = await ensureFreshTokens(userId);
  if (!tokens) {
    throw new NotConnectedError(userId);
  }
  return tokens.accessToken;
}

/**
 * Perform the refresh-token rotation for an already-read row and persist the
 * result. Separated from ensureFreshTokens so the decision (near expiry?) and
 * the action (refresh) read cleanly.
 *
 * CONCURRENCY CAVEAT (serverless, no lock): two requests can each see the token
 * near expiry and both POST a refresh. Because WHOOP rotates, the FIRST refresh
 * invalidates the refresh token the SECOND one is sending, so the second gets a
 * non-2xx (invalid_grant). For a single-user app a mutex/advisory-lock is
 * over-engineering; instead we mitigate: on a non-2xx we re-read the row, and if
 * a concurrent request has just stored a now-fresh token we use that rather than
 * surfacing a spurious failure. Only if the re-read row is still near expiry do
 * we treat the rejection as a real error. This never writes null over the
 * NOT-NULL refresh token and never corrupts the row.
 */
async function refreshTokens(current: WhoopTokens): Promise<WhoopTokens> {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Same posture as callback.ts: don't leak which var is missing.
    throw new Error('WHOOP OAuth is not configured (client id/secret).');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    // The scope that mints a refresh token; the docs' refresh sample resends it.
    scope: 'offline',
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    // Network failure reaching WHOOP — a real failure, not "not connected".
    console.error('WHOOP token refresh: failed to reach token endpoint:', err);
    throw new Error('Failed to reach the WHOOP token endpoint.', { cause: err });
  }

  if (!tokenRes.ok) {
    // Log status + body server-side for debugging; never echo to a client and
    // never log token material (the body is WHOOP's OAuth error, not the token).
    const detail = await tokenRes.text().catch(() => '');
    console.error(`WHOOP token refresh failed: ${tokenRes.status} ${detail}`);

    // Concurrency mitigation: a 4xx here is most likely because a concurrent
    // request already rotated (invalidated) this refresh token. Re-read the row;
    // if it is now fresh, another request did the work — use its token.
    const reread = await getWhoopTokens(current.userId);
    if (reread && !isNearExpiry(reread.expiresAt)) {
      return reread;
    }
    throw new Error('WHOOP token refresh failed.');
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
    throw new Error('WHOOP returned an unparseable refresh response.');
  }

  const { access_token, refresh_token, expires_in, scope } = tokens;
  if (!access_token) {
    throw new Error('WHOOP refresh response missing access_token.');
  }
  // Rotation: persist the NEW refresh token. If WHOOP ever omits one, KEEP the
  // existing token — the column is NOT NULL and dropping it would brick refresh.
  const nextRefreshToken = refresh_token ?? current.refreshToken;
  // Absolute expiry from expires_in (now + seconds); fall back to 1h if absent,
  // exactly like callback.ts.
  const ttlSeconds = typeof expires_in === 'number' && expires_in > 0 ? expires_in : 3600;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  // WHOOP may not echo scope on refresh; keep the previously stored scope then.
  const nextScope = scope ?? current.scope;
  const now = new Date();

  // Encrypt before any DB write (callback.ts contract). encryptToken throws if
  // TOKEN_ENCRYPTION_KEY is unset/wrong-sized — a real integrity error, surfaced.
  const accessTokenEncrypted = encryptToken(access_token);
  const refreshTokenEncrypted = encryptToken(nextRefreshToken);

  const { error, status } = await getSupabaseAdmin()
    .from(TOKENS_TABLE)
    .update({
      access_token_encrypted: accessTokenEncrypted,
      refresh_token_encrypted: refreshTokenEncrypted,
      expires_at: expiresAt.toISOString(),
      scope: nextScope,
      updated_at: now.toISOString(),
    })
    .eq('user_id', current.userId);
  if (error) {
    // Phase 2.5: a paused/unreachable project surfaces here too (rare — the
    // read in getWhoopTokens usually catches it first, but the project can go
    // away between the read and this write). Same classification as tokens.ts.
    // Note: WHOOP already rotated the tokens above, so this loses the rotation
    // — the next refresh attempt will be rejected and recover via the re-read
    // path in the !tokenRes.ok branch, or ultimately require re-auth. That
    // pre-existing risk is unchanged; we only classify the error better.
    if (isDbUnavailableStatus(status)) {
      throw new DatabaseUnavailableError(status);
    }
    // error.message can carry row context; log server-side, don't echo it.
    console.error(`whoop_tokens refresh update failed: ${error.message}`);
    throw new Error('Failed to store refreshed tokens.');
  }

  // Return the fresh, decrypted tokens for the current request only.
  return {
    userId: current.userId,
    accessToken: access_token,
    refreshToken: nextRefreshToken,
    expiresAt,
    scope: nextScope,
  };
}
