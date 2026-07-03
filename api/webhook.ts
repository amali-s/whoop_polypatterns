// POST /api/webhook — WHOOP push updates (Phase 2.3, Trigger B — OPTIONAL).
//
// Near-real-time counterpart to the daily cron (api/sync.ts). WHOOP can POST an
// event when a member's recovery/sleep/workout changes; we verify the signature,
// then update the cache for that member so it is fresh within seconds instead of
// up to a day. Create/update events re-sync a short recent window; `*.deleted`
// events HARD-delete the matching cached row (see deleteRecord in sync.ts).
//
// ⚠️ HUMAN SETUP REQUIRED — this endpoint is INERT until you:
//   1. Set WHOOP_WEBHOOK_SECRET (see the signing-secret TODO below).
//   2. Register this URL + events in the WHOOP Developer Dashboard.
//   With WHOOP_WEBHOOK_SECRET unset it returns 501 and does nothing. The daily
//   cron is the fully-working primary path; this is an enhancement.
//
// ── SIGNATURE VERIFICATION ────────────────────────────────────────────────────
// Implemented per WHOOP's webhook docs fetched live this session
// (https://developer.whoop.com/docs/developing/webhooks/):
//   * Headers:  X-WHOOP-Signature            (base64 HMAC)
//               X-WHOOP-Signature-Timestamp  (ms since epoch)
//   * Signed string: `${timestamp}${rawRequestBody}` (timestamp header value
//     concatenated with the RAW, un-reparsed request body).
//   * MAC: HMAC-SHA256, base64-encoded, compared constant-time to the header.
//
// TODO(verify) — SIGNING SECRET IDENTITY: the docs describe the secret as "the
//   secret key for your app" (i.e. your WHOOP client secret). We read it from a
//   dedicated WHOOP_WEBHOOK_SECRET env var so it can be rotated independently and
//   so this file never imports WHOOP_CLIENT_SECRET. When you configure webhooks,
//   set WHOOP_WEBHOOK_SECRET to whatever value the dashboard designates as the
//   webhook signing secret (likely your client secret). CONFIRM in the dashboard
//   before enabling — do not assume.
// TODO(verify) — REPLAY WINDOW: the docs do not specify a max age for
//   X-WHOOP-Signature-Timestamp. We enforce a conservative 5-minute window below
//   as defense-in-depth; loosen/remove only if WHOOP documents otherwise.
// EVENT `id` SEMANTICS (confirmed against WHOOP's webhook docs this session):
//   For the v2 webhook model, `id` is — per event — the workout UUID, the sleep
//   UUID, or (for recovery) the associated SLEEP UUID. For CREATE/UPDATE we still
//   do NOT fetch by `id`: we re-sync a short recent window of the affected
//   resource (idempotent), because the WHOOP client only exposes date-windowed
//   collection fetches. For `*.deleted` we DO use `id` to find the row to remove
//   (deleteRecord in sync.ts maps each id shape to the right column). We handle
//   only v2 ids: this app's client/types are v2 and a v2 app receives v2 events;
//   a v1 numeric id would need different matching and is not expected here.
//
// NOTE: WHOOP emits recovery/sleep/workout events but NOT cycle events, so cycle
//   updates still arrive only via the daily cron. That is expected.
//
// SECURITY / LOGGING: server-only. On an invalid signature we return 401 and log
//   nothing sensitive (no body, no headers, no secret). We log the event `type`
//   and counts only.

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  deleteRecord,
  syncRecovery,
  syncSleep,
  syncWorkouts,
  type ResourceSyncSummary,
  type SyncResource,
} from './_lib/sync.js';

/** Re-sync this many days around the event — wide enough to catch the record. */
const WEBHOOK_LOOKBACK_DAYS = 2;
/** Reject events whose signature timestamp is older than this (replay guard). */
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

/** WHOOP webhook event payload (fields we rely on; extras ignored). */
interface WhoopWebhookEvent {
  user_id: number;
  /**
   * v2 resource id: the workout/sleep UUID, or (recovery) the linked sleep UUID.
   * Used to locate the row to remove on `*.deleted`; NOT used to fetch on
   * create/update (we re-sync a window instead). See header.
   */
  id: number | string;
  /** e.g. "recovery.updated", "sleep.deleted", "workout.updated". */
  type: string;
  trace_id?: string;
}

/** Verify the base64 HMAC-SHA256 over `timestamp + rawBody`. Constant-time. */
function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.WHOOP_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Reject a timestamp that is too old/too far in the future (replay guard). */
function timestampFresh(timestamp: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Math.abs(Date.now() - ts) <= MAX_SIGNATURE_AGE_MS;
}

/** Resource families WHOOP emits events for (no cycle events — see header). */
type WebhookResource = 'recovery' | 'sleep' | 'workout';

/** Event `type` prefix → resource family. Null = event we don't handle. */
function resourceFor(type: string): WebhookResource | null {
  if (type.startsWith('recovery.')) {
    return 'recovery';
  }
  if (type.startsWith('sleep.')) {
    return 'sleep';
  }
  if (type.startsWith('workout.')) {
    return 'workout';
  }
  return null;
}

/** Webhook resource family → the sync/cache resource name it maps to. */
const SYNC_RESOURCE: Record<WebhookResource, SyncResource> = {
  recovery: 'recovery',
  sleep: 'sleep',
  workout: 'workouts',
};

/** Create/update: re-sync a short recent window of the affected resource. */
function resyncResource(resource: WebhookResource, userId: string): Promise<ResourceSyncSummary> {
  const window = { lookbackDays: WEBHOOK_LOOKBACK_DAYS };
  switch (resource) {
    case 'recovery':
      return syncRecovery(userId, window);
    case 'sleep':
      return syncSleep(userId, window);
    case 'workout':
      return syncWorkouts(userId, window);
  }
}

export async function POST(request: Request): Promise<Response> {
  // Inert until the human configures the signing secret (see header).
  if (!process.env.WHOOP_WEBHOOK_SECRET) {
    return new Response('Webhook not configured', { status: 501 });
  }

  // Read the RAW body — signature is computed over these exact bytes, so we must
  // not JSON.parse before verifying.
  const rawBody = await request.text();
  const signature = request.headers.get('x-whoop-signature') ?? '';
  const timestamp = request.headers.get('x-whoop-signature-timestamp') ?? '';

  if (!timestampFresh(timestamp) || !verifySignature(rawBody, timestamp, signature)) {
    // Log nothing sensitive; a bare 401 is all an unverified caller gets.
    return new Response('Invalid signature', { status: 401 });
  }

  let event: WhoopWebhookEvent;
  try {
    event = JSON.parse(rawBody) as WhoopWebhookEvent;
  } catch {
    return new Response('Bad payload', { status: 400 });
  }

  const userId = String(event.user_id);
  const resource = resourceFor(event.type);
  if (!resource) {
    // Unknown/ignored event type — ACK so WHOOP doesn't retry.
    console.log(`webhook: ignored event type=${event.type}`);
    return Response.json({ ok: true, ignored: true });
  }

  // ── DELETE: WHOOP dropped a record → hard-delete our cached copy. ──────────
  if (event.type.endsWith('.deleted')) {
    try {
      const summary = await deleteRecord(SYNC_RESOURCE[resource], userId, String(event.id));
      console.log(`webhook: type=${event.type} deleted=${summary.deleted}`);
      return Response.json({
        ok: !summary.error,
        resource: summary.resource,
        deleted: summary.deleted,
      });
    } catch (err) {
      console.error('webhook: delete failed:', err instanceof Error ? err.name : 'unknown');
      return Response.json({ ok: false, error: 'delete failed' });
    }
  }

  // ── CREATE / UPDATE: re-sync a short recent window of the resource. ────────
  try {
    const summary = await resyncResource(resource, userId);
    console.log(
      `webhook: type=${event.type} ${summary.resource}=${summary.upserted}/${summary.fetched}`,
    );
    return Response.json({ ok: true, resource: summary.resource, upserted: summary.upserted });
  } catch (err) {
    // Includes SyncReauthRequiredError — surface as a soft failure; the member
    // must re-auth. 200 avoids WHOOP retry storms for a token that won't recover.
    console.error('webhook: sync failed:', err instanceof Error ? err.name : 'unknown');
    return Response.json({ ok: false, error: 'sync failed' });
  }
}
