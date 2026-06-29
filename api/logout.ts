// GET /api/logout
//
// Ends the browser's WHOOP session by clearing the HttpOnly `whoop_session`
// cookie and redirecting back to the app. This only unlinks THIS browser — the
// encrypted token row in Supabase is left intact (it stays the durable source of
// truth, refreshable server-side), so this is a logout, not a revoke.
//
// The cookie is cleared with Max-Age=0 and the EXACT same attributes used to set
// it in /api/callback (Path, HttpOnly, SameSite, and Secure in prod). A browser
// only overwrites a cookie when name + Path (+ Domain) match, so these must stay
// in lockstep with callback.ts's cookieAttrs — otherwise the cookie lingers.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE } from './_lib/tokens.js';

// Gate `Secure` to production so the clear works over plain http://localhost in
// dev, matching the set-side gate in /api/callback.
const isProd = process.env.NODE_ENV === 'production';

// Where to send the user after logging out: the SPA landing page.
const APP_LANDING_PATH = '/';

/** Cookie attributes for the clear — must mirror callback.ts's cookieAttrs(0). */
function clearCookie(name: string): string {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=0`];
  if (isProd) {
    attrs.push('Secure');
  }
  return `${name}=; ${attrs.join('; ')}`;
}

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
  res.statusCode = 302;
  res.setHeader('Location', APP_LANDING_PATH);
  res.end();
}
