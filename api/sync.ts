// GET|POST /api/sync — scheduled WHOOP → Supabase sync (Phase 2.3, Trigger A).
//
// PRIMARY sync path. Vercel Cron hits this once a day (see vercel.json), and it
// pulls a recent window of each WHOOP resource for every connected member and
// upserts it into Postgres via api/_lib/sync.ts. The dashboard then reads OUR
// database, not the WHOOP API, on every load.
//
// SCHEDULE / HOBBY LIMITS (confirmed against
//   https://vercel.com/docs/cron-jobs/usage-and-pricing this session):
//   Hobby allows up to 100 crons/project but a MINIMUM INTERVAL of once per day —
//   a sub-daily expression (e.g. "0 * * * *" or "*/30 * * * *") FAILS at deploy.
//   Precision is per-hour (±59 min) and the timezone is always UTC. Our
//   vercel.json uses "0 8 * * *" (daily ~08:00 UTC), which is Hobby-valid.
//
// AUTH — shared secret (never publicly triggerable):
//   Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}` when
//   the CRON_SECRET env var is set on the project (confirmed against
//   https://vercel.com/docs/cron-jobs/manage-cron-jobs — "Securing cron jobs").
//   We require an exact match and 401 otherwise, so a random internet GET can't
//   trigger a sync. The same secret is what the manual backfill script sends.
//
// KEEP-WARM (roadmap 2.5): the daily hit also keeps the free-tier Supabase
//   project from auto-pausing (each run issues real queries), so the DB is awake
//   for the morning dashboard load. That is a deliberate side effect of the cron.
//
// SECURITY / LOGGING: server-only (imports the service-role sync layer). We log
//   COUNTS ONLY — never tokens, never the CRON_SECRET, never raw health fields.
//
// Uses Vercel's Web/Fetch function signature (like api/health.ts): export named
// HTTP methods that take a `Request` and return a `Response`. No extra deps.

import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from './_lib/supabase.js';
import { syncAll, type SyncWindow, type UserSyncSummary } from './_lib/sync.js';

/** Cap on how wide a manual `?days=` backfill may request (guards runaway loops). */
const MAX_BACKFILL_DAYS = 400;

/** Constant-time string compare that won't throw on differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** True iff the request carries the correct `Authorization: Bearer <CRON_SECRET>`. */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: with no secret configured, nothing may trigger a sync.
    console.error('CRON_SECRET is not set — refusing to run sync.');
    return false;
  }
  const header = request.headers.get('authorization') ?? '';
  return safeEqual(header, `Bearer ${secret}`);
}

/**
 * Translate query params into a sync window. Cron sends none → incremental
 * default (last 7 days, per sync.ts). Manual backfill can pass ?days=90 for a
 * wide window, or explicit ?start=/?end= ISO date-times.
 */
function windowFromRequest(request: Request): SyncWindow {
  const params = new URL(request.url).searchParams;
  const start = params.get('start') ?? undefined;
  const end = params.get('end') ?? undefined;
  const daysRaw = params.get('days');
  const window: SyncWindow = {};
  if (start) {
    window.start = start;
  }
  if (end) {
    window.end = end;
  }
  if (daysRaw && !start) {
    const days = Number(daysRaw);
    if (Number.isFinite(days) && days > 0) {
      window.lookbackDays = Math.min(MAX_BACKFILL_DAYS, Math.trunc(days));
    }
  }
  return window;
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const window = windowFromRequest(request);

  // Resolve members to sync from the token store. Single-user today, but we
  // iterate rows so this generalizes to multi-user without a code change.
  const { data: rows, error } = await getSupabaseAdmin()
    .from('whoop_tokens')
    .select('user_id');
  if (error) {
    console.error('sync: failed to list whoop_tokens:', error.message);
    return Response.json({ ok: false, error: 'Failed to list members.' }, { status: 500 });
  }

  const users = (rows ?? []).map((r) => r.user_id as string);
  const summaries: UserSyncSummary[] = [];
  let reauthCount = 0;

  for (const userId of users) {
    try {
      const summary = await syncAll(userId, window);
      if (summary.reauthRequired) {
        reauthCount += 1;
      }
      summaries.push(summary);
    } catch (err) {
      // Never let one member's unexpected failure abort the whole run.
      console.error('sync: unexpected failure for a member:', err);
      summaries.push({
        userId,
        window: { start: window.start ?? '', end: window.end ?? '' },
        results: [
          {
            resource: 'cycles',
            fetched: 0,
            upserted: 0,
            skipped: 0,
            deduped: 0,
            errored: 0,
            error: 'unexpected failure',
          },
        ],
      });
    }
  }

  // COUNTS-ONLY logging: safe to appear in Vercel runtime logs.
  console.log(
    `sync: members=${users.length} reauthRequired=${reauthCount} ` +
      summaries
        .map(
          (s) =>
            `[${s.userId ? 'user' : '?'}:` +
            s.results.map((r) => `${r.resource}=${r.upserted}/${r.fetched}`).join(',') +
            ']',
        )
        .join(' '),
  );

  return Response.json({
    ok: true,
    members: users.length,
    reauthRequired: reauthCount,
    summaries,
  });
}

// Cron triggers via GET; POST is accepted for manual/curl use with the same auth.
export function GET(request: Request): Promise<Response> {
  return handle(request);
}
export function POST(request: Request): Promise<Response> {
  return handle(request);
}
