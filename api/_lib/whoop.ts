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

import { getValidAccessToken } from './refresh.js';

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
 * Honoring this seeds Phase 2.7 rate-limit handling. Capped at MAX_BACKOFF_MS.
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

    // Retry only 429 and 5xx; all other 4xx are caller errors and final.
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxRetries) {
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
// Single-object endpoints: no pagination, returned as `unknown` (2.2 types them).

/** GET the member's basic profile. Scope: read:profile. */
export function getProfile(userId: string, config?: RequestConfig): Promise<unknown> {
  return whoopRequest<unknown>(userId, ENDPOINTS.profile, { config });
}

/** GET the member's body measurements. Scope: read:body_measurement. */
export function getBodyMeasurement(userId: string, config?: RequestConfig): Promise<unknown> {
  return whoopRequest<unknown>(userId, ENDPOINTS.bodyMeasurement, { config });
}

// Collection endpoints: aggregate all pages by default. Pass maxPages/maxRecords
// (or use fetchCollectionPage) to paginate manually.

/** GET physiological cycles (day strain). Scope: read:cycles. */
export function getCycles<T = unknown>(userId: string, options?: AggregateOptions): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.cycles, options);
}

/** GET recovery records (recovery %, HRV, RHR). Scope: read:recovery. */
export function getRecovery<T = unknown>(userId: string, options?: AggregateOptions): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.recovery, options);
}

/** GET sleep activities (stages, performance). Scope: read:sleep. */
export function getSleep<T = unknown>(userId: string, options?: AggregateOptions): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.sleep, options);
}

/** GET workout activities. Scope: read:workout. */
export function getWorkouts<T = unknown>(userId: string, options?: AggregateOptions): Promise<T[]> {
  return fetchCollection<T>(userId, ENDPOINTS.workouts, options);
}
