// Server-only WHOOP API v2 client (Phase 2.1 — the fetch layer).
//
// This is the single place the rest of Phase 2 (types in 2.2, sync/caching in
// 2.3/2.4) goes through to read WHOOP data. It does NOT model full response
// shapes (2.2) and does NOT write to Supabase (2.3/2.4): it is purely the typed,
// retrying, paginating fetch layer. Collection responses are returned as
// `unknown[]` / a minimal generic envelope so 2.2 can plug real interfaces in
// without reshaping this module — every helper is generic in its record type.
//
// SECURITY:
//   - Server-only. It composes api/_lib/refresh.ts (which reads
//     TOKEN_ENCRYPTION_KEY + the service-role Supabase client), so it must NEVER
//     be imported into /src — same contract as crypto.ts / supabase.ts /
//     tokens.ts / refresh.ts.
//   - The caller passes a `userId`; the access token is resolved internally per
//     request via getValidAccessToken() and injected as `Authorization: Bearer
//     <token>`. We never re-implement decryption/refresh here, and the token
//     value never leaves this module: it is not logged, not stored on errors,
//     and not echoed to a client. WhoopApiError carries only status + endpoint
//     path + WHOOP's own error body (which does not contain our token).
//
// VERIFIED-AGAINST-SPEC (WHOOP OpenAPI, fetched live, June 2026):
//   Source: https://api.prod.whoop.com/developer/doc/openapi.json (the same
//   document callback.ts cites). Confirmed, not assumed from memory:
//     - Single server url: `https://api.prod.whoop.com/developer` → API_BASE_URL.
//     - Collection paths (GET): /v2/cycle, /v2/recovery, /v2/activity/sleep,
//       /v2/activity/workout. Single-object paths (GET): /v2/user/profile/basic,
//       /v2/user/measurement/body.
//     - Pagination REQUEST params: `limit` (int32, default 10, MAXIMUM 25) and
//       `nextToken` (string cursor). Date-range params: `start` / `end`, both
//       `date-time` strings (ISO-8601 / RFC-3339, e.g. new Date().toISOString()).
//     - Pagination RESPONSE shape: `{ records: T[], next_token?: string }`. NOTE
//       the asymmetry — the cursor is sent as `nextToken` (camelCase) but
//       returned as `next_token` (snake_case). When `next_token` is absent there
//       are no more pages.
//     - Required OAuth scope per endpoint (read:cycles / read:recovery /
//       read:sleep / read:workout / read:profile / read:body_measurement) — all
//       six are already requested by api/auth.ts, so a 401/403 here is a real
//       signal, not a missing-scope misconfiguration.
//
// RATE LIMITS (Phase 2.7 — verified against the live docs 2026-07-05,
// https://developer.whoop.com/docs/developing/rate-limiting):
//     - Two limits per client: 100 requests/minute AND 10,000 requests/day.
//       Breaching either returns HTTP 429.
//     - Every response carries draft-polli-ratelimit-headers-05 headers, e.g.
//         X-RateLimit-Limit:     "100, 100;window=60, 10000;window=86400"
//         X-RateLimit-Remaining: "98"
//         X-RateLimit-Reset:     "3"   (seconds until Remaining resets)
//       X-RateLimit-Limit lists ALL applicable limits; the FIRST bare number is
//       the quota of whichever window the client is closest to exhausting, and
//       matching it against the `;window=60` / `;window=86400` entries tells a
//       minute-window warning apart from a day-window one.
//     - Handling here: parseRateLimitHeaders() reads the headers off EVERY
//       response; a day-window 429 fails fast as WhoopRateLimitError (a capped
//       30s backoff cannot refill a quota that resets in up to 24h — retrying
//       only burns function time); a minute-window/unknown 429 keeps the
//       retry-with-backoff behavior (Retry-After authoritative when present);
//       and a small proactive throttle sleeps until the reported reset when
//       Remaining drops to RATE_LIMIT_SAFETY_BUFFER or below, so a sequential
//       multi-request sync stops just short of a real 429 instead of eating it.
//     - The multi-value X-RateLimit-Limit format was OBSERVED LIVE (2026-07-05,
//       one real /v2/user/profile/basic call): exactly
//       "100, 100;window=60, 10000;window=86400" with Remaining "99" / Reset
//       "60" — matching the docs example byte-for-byte, parsed as the minute
//       window. TODO(verify): the day-window-first variant (first number 10000
//       when the day quota is the closest) is inferred from the docs' "first
//       value = closest limit" rule, never observed live — nor has a real 429.

import { getValidAccessToken } from './refresh.js';
import type {
  WhoopProfile,
  WhoopBodyMeasurement,
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from './whoop-types.js';

// ── Endpoints (verified against the live OpenAPI spec — see header) ──────────
/** WHOOP API v2 server base. Mirrors WHOOP_PROFILE_URL's prefix in callback.ts. */
export const API_BASE_URL = 'https://api.prod.whoop.com/developer';

/** Resource paths, relative to API_BASE_URL. */
export const ENDPOINTS = {
  profile: '/v2/user/profile/basic',
  bodyMeasurement: '/v2/user/measurement/body',
  cycles: '/v2/cycle',
  recovery: '/v2/recovery',
  sleep: '/v2/activity/sleep',
  workouts: '/v2/activity/workout',
} as const;

// ── Tunable defaults (all overridable per call) ─────────────────────────────
/** WHOOP caps `limit` at 25; default to the max for the fewest round-trips. */
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = MAX_LIMIT;

/** Retries are ON TOP of the first attempt (so 3 → up to 4 total attempts). */
const DEFAULT_MAX_RETRIES = 3;
/** Exponential backoff base; delay ≈ base * 2^attempt + jitter. */
const DEFAULT_BACKOFF_BASE_MS = 500;
/** Ceiling on any single backoff/Retry-After wait, so we never hang a function. */
const MAX_BACKOFF_MS = 30_000;

// Loop guards for transparent aggregation (configurable per call). Generous for
// a single-user app, but finite so a misbehaving cursor can't spin forever.
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_RECORDS = 10_000;

// ── Rate-limit tunables (Phase 2.7 — see the RATE LIMITS header note) ────────
/** The two quota windows WHOOP reports, in seconds (60s and 86400s). */
const MINUTE_WINDOW_SECONDS = 60;
const DAY_WINDOW_SECONDS = 86_400;
/**
 * Proactive-throttle buffer: when the last observed X-RateLimit-Remaining is at
 * or below this, sleep until the reported reset instead of firing and eating a
 * real 429. Small on purpose — a normal single-user sync never gets near the
 * 100/min quota, so this must be a zero-latency no-op in the common case.
 */
const RATE_LIMIT_SAFETY_BUFFER = 3;

// ── Errors ──────────────────────────────────────────────────────────────────
/**
 * Thrown for any non-success WHOOP response (and for network/parse failures
 * that survive the retry budget). Carries the HTTP status, the endpoint PATH
 * (never the full URL with a token — there is none; the token rides a header),
 * and WHOOP's own error body. NEVER contains token material.
 *
 * `status === 0` denotes a transport/parse failure (no HTTP response received).
 */
export class WhoopApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  /** WHOOP's error payload (parsed JSON if possible, else raw text, else null). */
  readonly body: unknown;

  constructor(
    message: string,
    opts: { status: number; endpoint: string; body?: unknown; cause?: unknown },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'WhoopApiError';
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.body = opts.body ?? null;
  }
}

/**
 * A 401 from WHOOP. Surfaced as a DISTINCT type because the refresh layer
 * (api/_lib/refresh.ts) should have handed us a valid token — so a 401 means the
 * token/scope genuinely failed (revoked grant, scope removed) and the caller
 * must treat it as "re-auth required", not retry. Never retried.
 */
export class WhoopAuthError extends WhoopApiError {
  constructor(opts: { endpoint: string; body?: unknown }) {
    super('WHOOP rejected the access token (401). Re-authentication required.', {
      status: 401,
      endpoint: opts.endpoint,
      body: opts.body,
    });
    this.name = 'WhoopAuthError';
  }
}

/** Which WHOOP quota window a rate-limit observation refers to. */
export type WhoopRateLimitWindow = 'minute' | 'day' | 'unknown';

/**
 * Rate-limit state parsed off a response's X-RateLimit-* headers. `window` is
 * whichever quota the client is CLOSEST to exhausting (the first value in the
 * multi-value X-RateLimit-Limit header); `remaining`/`resetSeconds` describe
 * that window. Fields are null when the corresponding header is missing/bad.
 */
export interface WhoopRateLimitInfo {
  window: WhoopRateLimitWindow;
  remaining: number | null;
  resetSeconds: number | null;
}

/**
 * A 429 that will not be retried further. Distinct from the generic
 * WhoopApiError so callers (sync.ts, the cron) can log WHICH quota was hit and
 * react accordingly: a `day` window means the quota refills in up to 24h —
 * stop for the day, don't loop; `minute` means the budget was spent on retries
 * that never cleared a <=60s window (rare); `unknown` means WHOOP sent a 429
 * without parseable rate-limit headers. Carries no token material.
 */
export class WhoopRateLimitError extends WhoopApiError {
  readonly window: WhoopRateLimitWindow;
  /** X-RateLimit-Remaining at the final 429 (usually 0), or null if absent. */
  readonly remaining: number | null;
  /** Seconds until the exhausted window resets, or null if absent. */
  readonly resetSeconds: number | null;

  constructor(opts: {
    endpoint: string;
    body?: unknown;
    window: WhoopRateLimitWindow;
    remaining: number | null;
    resetSeconds: number | null;
  }) {
    super(`WHOOP rate limit exceeded (429, ${opts.window} window).`, {
      status: 429,
      endpoint: opts.endpoint,
      body: opts.body,
    });
    this.name = 'WhoopRateLimitError';
    this.window = opts.window;
    this.remaining = opts.remaining;
    this.resetSeconds = opts.resetSeconds;
  }
}

// ── Shared option/result shapes ─────────────────────────────────────────────
/** Per-request transport tuning. Defaults apply when a field is omitted. */
export interface RequestConfig {
  /** Retries on top of the first attempt (429, 5xx, network). Default 3. */
  maxRetries?: number;
  /** Exponential backoff base in ms. Default 500. */
  backoffBaseMs?: number;
  /** Optional cancellation signal (forwarded to fetch). */
  signal?: AbortSignal;
}

/** Date-range + page-size query for collection endpoints. */
export interface CollectionQuery {
  /** Inclusive lower bound, ISO date-time (e.g. new Date().toISOString()). */
  start?: string;
  /** Exclusive upper bound, ISO date-time. */
  end?: string;
  /** Page size, 1..25. Clamped to WHOOP's max of 25; defaults to 25. */
  limit?: number;
}

/** Minimal v2 collection envelope. 2.2 supplies the real record type `T`. */
export interface WhoopCollection<T = unknown> {
  records: T[];
  next_token?: string;
}

/** One page of a collection, cursor normalized to `nextToken` (or null at end). */
export interface WhoopPage<T = unknown> {
  records: T[];
  nextToken: string | null;
}

/** Options for the transparent multi-page aggregator. */
export interface AggregateOptions extends CollectionQuery, RequestConfig {
  /** Stop after this many pages (loop guard). Default 100. */
  maxPages?: number;
  /** Stop after accumulating this many records (loop guard). Default 10000. */
  maxRecords?: number;
}

// ── Internals ───────────────────────────────────────────────────────────────
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Full jitter exponential backoff, capped at MAX_BACKOFF_MS. */
function backoffDelay(attempt: number, baseMs: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** attempt);
  return Math.random() * exp;
}

/**
 * Parse a Retry-After header (delta-seconds OR an HTTP-date) into ms, or null.
 * Authoritative over the computed backoff when present (Phase 2.7 keeps that
 * contract). Capped at MAX_BACKOFF_MS.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX_BACKOFF_MS, Number(trimmed) * 1000);
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) {
    return null;
  }
  return Math.min(MAX_BACKOFF_MS, Math.max(0, when - Date.now()));
}

// ── Rate-limit header parsing + proactive throttle (Phase 2.7) ──────────────
/** Parse a header expected to hold a non-negative integer, or null. */
function parseNonNegativeInt(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

/**
 * Identify which quota window the multi-value X-RateLimit-Limit header says the
 * client is closest to exhausting. Per draft-polli-ratelimit-headers-05 (and
 * WHOOP's docs example "100, 100;window=60, 10000;window=86400"), the FIRST
 * bare number is the quota of the closest window; the `;window=N` entries name
 * each quota's window in seconds. We match the first number against the
 * windowed entries — exactly one match with window=60 → 'minute', 86400 →
 * 'day'; anything unparseable or ambiguous → 'unknown' (which keeps the safer
 * retry-with-backoff behavior).
 */
function identifyWindow(limitHeader: string | null): WhoopRateLimitWindow {
  if (!limitHeader) {
    return 'unknown';
  }
  const items = limitHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    return 'unknown';
  }
  const head = /^(\d+)/.exec(items[0]);
  if (!head) {
    return 'unknown';
  }
  const activeQuota = Number(head[1]);
  const matchedWindows: number[] = [];
  for (const item of items) {
    const m = /^(\d+)\s*;.*\bwindow=(\d+)/.exec(item);
    if (m && Number(m[1]) === activeQuota) {
      matchedWindows.push(Number(m[2]));
    }
  }
  if (matchedWindows.length !== 1) {
    return 'unknown';
  }
  if (matchedWindows[0] === MINUTE_WINDOW_SECONDS) {
    return 'minute';
  }
  if (matchedWindows[0] === DAY_WINDOW_SECONDS) {
    return 'day';
  }
  return 'unknown';
}

/**
 * Pure parser for the three X-RateLimit-* headers (pass `headers.get(...)`
 * values). Returns null when none of the three headers are present (a response
 * that carries no rate-limit info at all — nothing to observe).
 */
export function parseRateLimitHeaders(
  limitHeader: string | null,
  remainingHeader: string | null,
  resetHeader: string | null,
): WhoopRateLimitInfo | null {
  if (limitHeader === null && remainingHeader === null && resetHeader === null) {
    return null;
  }
  return {
    window: identifyWindow(limitHeader),
    remaining: parseNonNegativeInt(remainingHeader),
    resetSeconds: parseNonNegativeInt(resetHeader),
  };
}

/**
 * Most recently observed rate-limit state, module-level. This module is
 * server-only and effectively single-flight (sync.ts issues every request
 * SEQUENTIALLY — see its CONCURRENCY note), so a plain variable is sufficient;
 * no cross-request locking is needed or attempted.
 */
let lastRateLimitObservation: {
  window: WhoopRateLimitWindow;
  remaining: number;
  resetSeconds: number;
  observedAtMs: number;
} | null = null;

/** Record a response's rate-limit headers for the next request's throttle. */
function observeRateLimit(info: WhoopRateLimitInfo | null): void {
  if (!info || info.remaining === null || info.resetSeconds === null) {
    return;
  }
  lastRateLimitObservation = {
    window: info.window,
    remaining: info.remaining,
    resetSeconds: info.resetSeconds,
    observedAtMs: Date.now(),
  };
}

/** Clear the throttle state (test isolation / independent runs). */
export function resetRateLimitTracking(): void {
  lastRateLimitObservation = null;
}

/**
 * Proactive throttle: if the last response said we are within
 * RATE_LIMIT_SAFETY_BUFFER requests of a minute-window limit, sleep out the
 * remainder of the reported reset before firing, instead of eating a real 429.
 * A no-op (zero added latency) whenever remaining is comfortably above the
 * buffer — the normal single-user case. Day-window exhaustion is deliberately
 * NOT slept on: a capped wait can't refill a quota that resets in up to 24h,
 * so we let the request go and the 429 fail-fast path surface
 * WhoopRateLimitError instead. Each observation is consumed once — the next
 * response re-observes.
 */
async function throttleIfNearLimit(): Promise<void> {
  const obs = lastRateLimitObservation;
  if (!obs || obs.window === 'day' || obs.remaining > RATE_LIMIT_SAFETY_BUFFER) {
    return;
  }
  const elapsedMs = Date.now() - obs.observedAtMs;
  const waitMs = Math.min(MAX_BACKOFF_MS, obs.resetSeconds * 1000 - elapsedMs);
  lastRateLimitObservation = null;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

/** Clamp a caller-supplied limit into WHOOP's accepted 1..25 range. */
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

/**
 * Core request: resolve a fresh access token, GET `path`, retry transient
 * failures with backoff, and return the parsed JSON typed as `T`. This is the
 * one place auth, retry, and error normalization live.
 */
async function whoopRequest<T>(
  userId: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; config?: RequestConfig } = {},
): Promise<T> {
  const { query, config = {} } = opts;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  // Proactive throttle FIRST (Phase 2.7): if the previous response said we are
  // about to hit the minute quota, sleep out the reset before doing anything.
  await throttleIfNearLimit();

  // Resolve the token ONCE per logical request. ensureFreshTokens' 5-minute skew
  // comfortably covers the retry window; aggregation re-resolves per page.
  const accessToken = await getValidAccessToken(userId);

  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let attempt = 0;
  // Loop until success, a non-retryable error, or the retry budget is spent.
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: config.signal,
      });
    } catch (err) {
      // Transport failure (DNS, reset, abort). Treat as retryable up to the cap.
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt, backoffBaseMs));
        attempt += 1;
        continue;
      }
      throw new WhoopApiError('Network failure reaching the WHOOP API.', {
        status: 0,
        endpoint: path,
        cause: err,
      });
    }

    // Observe the rate-limit headers off EVERY response — success and failure —
    // so the next request's proactive throttle sees the freshest state.
    const rateInfo = parseRateLimitHeaders(
      res.headers.get('x-ratelimit-limit'),
      res.headers.get('x-ratelimit-remaining'),
      res.headers.get('x-ratelimit-reset'),
    );
    observeRateLimit(rateInfo);

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch (err) {
        throw new WhoopApiError('WHOOP returned an unparseable JSON response.', {
          status: res.status,
          endpoint: path,
          cause: err,
        });
      }
    }

    // Non-2xx: read WHOOP's error body once (safe — it is WHOOP's OAuth/API error
    // payload, never our token). Prefer parsed JSON, fall back to raw text.
    const rawBody = await res.text().catch(() => '');
    let body: unknown = rawBody || null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        // keep the text
      }
    }

    // 401: distinct, non-retryable — the refresh layer gave us a token, so this
    // is a real token/scope failure the caller must surface as "re-auth".
    if (res.status === 401) {
      throw new WhoopAuthError({ endpoint: path, body });
    }

    // 429 (Phase 2.7): which window is exhausted decides everything. The DAY
    // window resets in up to 24h, so capped 30s backoffs can't help — fail fast
    // with ZERO retries rather than burning function time. Minute/unknown keep
    // the retry-with-backoff behavior (a <=60s window CAN clear inside the
    // budget), with Retry-After authoritative when present. When the budget is
    // spent, the final throw is the typed WhoopRateLimitError either way.
    if (res.status === 429) {
      const window = rateInfo?.window ?? 'unknown';
      if (window === 'day' || attempt >= maxRetries) {
        throw new WhoopRateLimitError({
          endpoint: path,
          body,
          window,
          remaining: rateInfo?.remaining ?? null,
          resetSeconds: rateInfo?.resetSeconds ?? null,
        });
      }
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      await sleep(retryAfter ?? backoffDelay(attempt, backoffBaseMs));
      attempt += 1;
      continue;
    }

    // Retry 5xx; all other 4xx are caller errors and final.
    if (res.status >= 500 && attempt < maxRetries) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      await sleep(retryAfter ?? backoffDelay(attempt, backoffBaseMs));
      attempt += 1;
      continue;
    }

    throw new WhoopApiError(`WHOOP API request to ${path} failed with status ${res.status}.`, {
      status: res.status,
      endpoint: path,
      body,
    });
  }
}

// ── Pagination helpers (generic; 2.2 plugs the record type) ─────────────────
/**
 * Fetch a SINGLE page of a collection. Exposed for callers that want to drive
 * pagination themselves (e.g. a sync job that checkpoints each cursor). Pass the
 * `next_token` from a previous page as `nextToken` to advance; a null/absent
 * `nextToken` in the result means there are no more pages.
 */
export async function fetchCollectionPage<T = unknown>(
  userId: string,
  path: string,
  params: CollectionQuery & RequestConfig & { nextToken?: string | null } = {},
): Promise<WhoopPage<T>> {
  const data = await whoopRequest<WhoopCollection<T>>(userId, path, {
    query: {
      limit: clampLimit(params.limit),
      start: params.start,
      end: params.end,
      // REQUEST param is camelCase `nextToken` (response is snake `next_token`).
      nextToken: params.nextToken ?? undefined,
    },
    config: params,
  });
  return { records: data.records ?? [], nextToken: data.next_token ?? null };
}

/**
 * Transparently follow the cursor and return the fully-aggregated list across
 * pages. Guarded by maxPages / maxRecords so a runaway cursor can't loop
 * forever; on hitting a guard it returns what it has so far (it never throws for
 * "too much data"). For per-page control, use fetchCollectionPage instead.
 */
export async function fetchCollection<T = unknown>(
  userId: string,
  path: string,
  options: AggregateOptions = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;

  const all: T[] = [];
  let nextToken: string | null = null;
  let pages = 0;

  do {
    const page: WhoopPage<T> = await fetchCollectionPage<T>(userId, path, {
      ...options,
      nextToken,
    });
    all.push(...page.records);
    nextToken = page.nextToken;
    pages += 1;
  } while (nextToken && pages < maxPages && all.length < maxRecords);

  return all;
}

// ── Typed resource surface (one function per resource) ──────────────────────
// Default record types come from ./whoop-types (2.2, verified against a live
// payload); every function stays generic so a caller can override `T`.
// Single-object endpoints: no pagination.

/** GET the member's basic profile. Scope: read:profile. */
export function getProfile<T = WhoopProfile>(userId: string, config?: RequestConfig): Promise<T> {
  return whoopRequest<T>(userId, ENDPOINTS.profile, { config });
}

/** GET the member's body measurements. Scope: read:body_measurement. */
export function getBodyMeasurement<T = WhoopBodyMeasurement>(
  userId: string,
  config?: RequestConfig,
): Promise<T> {
  return whoopRequest<T>(userId, ENDPOINTS.bodyMeasurement, { config });
}

// Collection endpoints: aggregate all pages by default. Pass maxPages/maxRecords
// (or use fetchCollectionPage) to paginate manually.

/** GET physiological cycles (day strain). Scope: read:cycles. */
export function getCycles<T = WhoopCycle>(
  userId: string,
  options?: AggregateOptions,
): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.cycles, options);
}

/** GET recovery records (recovery %, HRV, RHR). Scope: read:recovery. */
export function getRecovery<T = WhoopRecovery>(
  userId: string,
  options?: AggregateOptions,
): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.recovery, options);
}

/** GET sleep activities (stages, performance). Scope: read:sleep. */
export function getSleep<T = WhoopSleep>(userId: string, options?: AggregateOptions): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.sleep, options);
}

/** GET workout activities. Scope: read:workout. */
export function getWorkouts<T = WhoopWorkout>(
  userId: string,
  options?: AggregateOptions,
): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.workouts, options);
}
