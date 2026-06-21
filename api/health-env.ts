// GET /api/health-env  —  ⚠️ TEMPORARY. DELETE AFTER VALIDATION. ⚠️
//
// Confirms that every required server env var is READABLE at runtime on the
// live Vercel deploy. It reports BOOLEANS ONLY — never the values — so it is
// safe to hit in a browser without leaking a secret. Even so, it exposes which
// vars are configured, so it must not live in the deployed app long-term.
//
// HOW TO USE:
//   1. Deploy, then open https://<your-app>.vercel.app/api/health-env
//   2. Confirm every field is `true` (and `allPresent: true`).
//   3. DELETE this file and redeploy. (See vercel-env-setup.md.)
//
// Mirrors the Web/Fetch function signature used by api/health.ts.

export function GET(): Response {
  // The 7 env vars documented in .env.example / vercel-env-setup.md.
  const present = {
    WHOOP_CLIENT_ID: Boolean(process.env.WHOOP_CLIENT_ID),
    WHOOP_CLIENT_SECRET: Boolean(process.env.WHOOP_CLIENT_SECRET),
    WHOOP_REDIRECT_URI: Boolean(process.env.WHOOP_REDIRECT_URI),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_ANON_KEY),
    TOKEN_ENCRYPTION_KEY: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
  };

  const allPresent = Object.values(present).every(Boolean);

  // Extra non-secret diagnostic: does TOKEN_ENCRYPTION_KEY decode to exactly
  // 32 bytes as lib/crypto.ts requires? Catches the hex-vs-base64 mistake
  // without revealing the key. (true/false only.)
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const tokenKeyDecodesTo32Bytes = raw ? Buffer.from(raw, 'base64').length === 32 : false;

  return Response.json({
    ok: allPresent && tokenKeyDecodesTo32Bytes,
    allPresent,
    present,
    tokenKeyDecodesTo32Bytes,
    note: 'TEMPORARY endpoint — delete /api/health-env.ts after validation.',
  });
}
