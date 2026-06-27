// GET /api/auth
//
// Step 1 of the WHOOP OAuth 2.0 Authorization Code flow: redirect the browser
// to WHOOP's authorize endpoint. WHOOP then prompts the user to log in / grant
// access and redirects back to our WHOOP_REDIRECT_URI (the /api/callback route,
// built in a later task) with `?code=...&state=...`.
//
// This function holds NO secrets. It only needs the public client id and the
// registered redirect uri. The client SECRET is used solely in /api/callback
// to exchange the code for tokens.
//
// CSRF protection: we mint a cryptographically random `state`, send it to WHOOP
// as a query param, AND stash it in an HttpOnly cookie. /api/callback compares
// the `state` it receives against the cookie; a mismatch means the callback was
// not initiated by us and must be rejected.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// WHOOP OAuth 2.0 authorize endpoint.
// Confirmed against WHOOP developer docs (developer.whoop.com → OAuth):
//   authorize: https://api.prod.whoop.com/oauth/oauth2/auth
//   token:     https://api.prod.whoop.com/oauth/oauth2/token  (used in callback)
const WHOOP_AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';

// Space-delimited scopes. `offline` is required to receive a refresh token so
// we can keep syncing data without forcing the user to re-auth.
const WHOOP_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'offline',
].join(' ');

// Name of the cookie that carries the CSRF state for /api/callback to verify.
const STATE_COOKIE = 'whoop_oauth_state';
// Short lifetime — the user should complete the WHOOP consent screen promptly.
const STATE_COOKIE_MAX_AGE = 600; // seconds (10 minutes)

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  // Fail loudly (and without leaking which var is missing to the client) if the
  // server is misconfigured, rather than redirecting to a broken authorize URL.
  if (!clientId || !redirectUri) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'OAuth is not configured.' }));
    return;
  }

  // Cryptographically random, URL-safe CSRF token.
  const state = randomBytes(32).toString('hex');

  // URLSearchParams handles percent-encoding of every value for us.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: WHOOP_SCOPES,
    state,
  });

  // Store `state` in an HttpOnly cookie so it is never readable by client JS.
  // SameSite=Lax still sends the cookie on the top-level redirect back from
  // WHOOP, so /api/callback can read and verify it.
  //
  // `Secure` is gated to production so the cookie is actually sent over plain
  // http://localhost during dev (a Secure cookie is dropped on http). This MUST
  // stay in lockstep with the identical gate in /api/callback — if one sets
  // Secure and the other doesn't, the state cookie won't round-trip locally.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${STATE_COOKIE_MAX_AGE}`,
  );

  // 302 redirect to WHOOP's authorize endpoint.
  res.statusCode = 302;
  res.setHeader('Location', `${WHOOP_AUTHORIZE_URL}?${params.toString()}`);
  res.end();
}
