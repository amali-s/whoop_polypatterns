// GET /api/health
//
// Lightweight liveness probe for the Vercel serverless runtime.
// No auth, no secrets, no database — just confirms functions are deployed
// and reachable. Useful as a deploy smoke test and uptime check.
//
// Uses Vercel's Web/Fetch function signature (export named HTTP methods that
// return a standard `Response`). This needs no extra dependencies.
export function GET(): Response {
  return Response.json({ ok: true });
}
