# Project state

## Roadmap status (Phase 3.2 — layout shell) — ✅ COMPLETE (verified locally in the dev server) (2026-07-07)

**What's done**

- **App shell** (`src/App.tsx` + `src/App.css` + `src/index.css`): sticky
  glass header (brand h1 · connection-status chip · Connect/Disconnect pill)
  over a centered main column (max-width 1200px) holding the pre-existing
  auth card and a new responsive `.dashboard-grid` with six placeholder
  chart cards (title + kind + "Chart coming soon" body). Plain CSS on the
  Phase 3.1 tokens; no Tailwind/CSS-in-JS; §1 tokens untouched.
- **Auth logic untouched**: `checkSessionWithRetry`, all four
  ConnectionStates, and the OAuth `whoop_error` banner are byte-for-byte the
  same logic — only the JSX around them changed. Markup deltas: the card's
  `h1` became `h2 "Connection"` (the header brand is now the page h1), and
  the connected card's Disconnect link MOVED to the header (one action, not
  two); the disconnected card keeps its primary Connect CTA and the header
  shows a compact one as well — both are the same `/api/auth` navigation
  driven by the same state.
- **Decisions (flagged, reversible)**: (a) **no sidebar/nav** — dashboard is
  the only destination until Phase 5; adding one later is a wrapper around
  `<main>`, nothing migrates (no router exists); (b) **sticky header** —
  status/action stay reachable while scrolling the grid; (c) **breakpoints**
  <640px → 1 col, 640–1023 → 2 cols, ≥1024 → 3 cols (six cards tile evenly
  at every step). All documented in design.md §2 (filled in from TODO); §3
  updated ONLY for the layout rows — chart/questionnaire/state rows still
  TODO.
- **Legacy dark-mode override removed** (`src/index.css`): the scaffold's
  `prefers-color-scheme: dark` block made the auth card dark-on-light inside
  the always-light Aero shell (caught in a dark-mode browser during
  verification). §1's confirmed direction is a light theme; `color-scheme`
  is now `light`. Dark mode returns properly (on §1 tokens) in Phase 3.5 if
  wanted.
- Verified on this machine: `npm run build` (frontend tsc + vite),
  `npm run typecheck:api`, `npm run lint`, `npm run format:check` all pass;
  dev server rendered and checked in the preview browser at 1280/685/375px
  (3/2/1 columns confirmed via computed `grid-template-columns`; sticky
  header confirmed while scrolled; loading → waking → disconnected states
  all seen live — under plain `vite dev` there is no `/api`, so the retry
  loop runs its budget and lands on the honest unreachable hint, which is
  the expected dev-only behavior).

**What's still open**

- Connected-state rendering was only typechecked, not seen live here (plain
  `vite dev` has no `/api/session`); the connected branch's logic is
  unchanged, only wrapped. Worth one glance on prod after deploy.
- The auth card still wears its legacy (pre-§1) purple-accent styling —
  migrating it to the Aero tokens is task 3.3 (component library), on
  purpose.

**What needs human action**

- Commit + push (`main` auto-deploys Vercel prod) — not committed by this
  session.

> **Note (2026-07-03):** this file was referenced as already existing with
> Phase 2.2 / 2.3 entries, but it was not found in the repo, its git history,
> or the working tree in this sandbox — so it was created fresh with the 2.4
> entry below. If your local copy lives elsewhere (untracked / another
> machine), merge this section into it and keep that one.

## Roadmap status (Phase 2.7 — rate-limit handling) — ✅ COMPLETE & LIVE-VERIFIED (2026-07-05)

**Facts verified against the live docs before coding**
(https://developer.whoop.com/docs/developing/rate-limiting, re-checked
2026-07-05 — matched the planning notes exactly):

- Two limits per client: **100 requests/minute** AND **10,000 requests/day**;
  breaching either returns **HTTP 429**.
- Every response carries draft-polli-ratelimit-headers-05 headers:
  `X-RateLimit-Limit` (multi-value, e.g.
  `"100, 100;window=60, 10000;window=86400"` — the FIRST value is the quota of
  whichever window the client is CLOSEST to exhausting; the `;window=60` /
  `;window=86400` params tell minute from day), `X-RateLimit-Remaining`, and
  `X-RateLimit-Reset` (seconds until Remaining resets).

**What's done (verified on this machine, 2026-07-05)**

- **`api/_lib/whoop.ts`** — all internal to `whoopRequest()` and its helpers;
  no public signature (`getProfile`/`getBodyMeasurement`/`getCycles`/
  `getRecovery`/`getSleep`/`getWorkouts`/`fetchCollection`/`fetchCollectionPage`)
  changed:
  - `parseRateLimitHeaders(limit, remaining, reset)` — pure and exported (same
    testability contract as `parseRetryAfter`). Identifies the closest window
    by matching the first bare number in `X-RateLimit-Limit` against the
    `;window=N` entries: exactly one match with window=60 → `'minute'`,
    86400 → `'day'`; missing/garbled/ambiguous → `'unknown'` (which keeps the
    safer retry behavior). Parsed off EVERY response, success and failure.
  - `WhoopRateLimitError extends WhoopApiError` carrying
    `{ window: 'minute' | 'day' | 'unknown', remaining, resetSeconds }` — now
    thrown for every 429 that is not retried further (previously a generic
    `WhoopApiError`). Carries status + endpoint path + WHOOP's body only, no
    token material (unchanged discipline).
  - **Day-window 429 fails FAST**: zero retries, zero sleeps — even when
    `Retry-After` is present. Rationale: the retry budget's 30s-capped waits
    cannot refill a quota that resets in up to 24h; they only burned function
    execution time. Minute/unknown 429s keep the pre-existing
    retry-with-backoff behavior, `Retry-After` still authoritative over the
    computed jittered backoff.
  - **Proactive throttle**: the most recent Remaining/Reset observation lives
    in module-level state (deliberately no locking — the module is server-only
    and sync.ts issues every request SEQUENTIALLY per its concurrency note).
    Before each logical request, if the last observed Remaining ≤
    `RATE_LIMIT_SAFETY_BUFFER` (**3**, a named constant), sleep out the
    remainder of the reported reset (capped at `MAX_BACKOFF_MS`) instead of
    firing into a real 429. Zero added latency when Remaining is comfortable
    (unit-asserted: no `setTimeout` call at all). Day-window observations are
    NOT slept on — same 24h rationale; the request fires and the fail-fast 429
    path reports it. Each observation is consumed once; `resetRateLimitTracking()`
    is exported for test isolation.
  - 5xx / network-failure / plain-4xx / 401 paths are byte-for-byte the same
    behavior as before (regression-covered).
- **`api/_lib/sync.ts`** — `classifyFetchError` gains one branch: a
  `WhoopRateLimitError` becomes a resource-level error string that names the
  window (`WHOOP rate limit hit (429, day window) @ /v2/cycle`), so the daily
  cron log says WHY a run stopped. Counts/status/window only — no tokens, no
  URLs with query strings. No orchestration change: after a day-window hit,
  the remaining resources fail equally fast (zero retries each), so the run
  ends quickly instead of looping; the next day's cron catches up (sync
  windows overlap by design).
- **Tests** (`npm run test:ratelimit`, `scripts/test-ratelimit.mjs` — same
  pattern as test-refresh: the REAL module graph, mocked global `fetch`, no
  creds, no network; plus a recorded-and-instant `setTimeout` patch so every
  backoff/Retry-After/throttle wait is asserted exactly and the script runs
  instantly): header parsing (docs example → minute; day-first → day; absent →
  null; bare/garbled/unknown-window → `'unknown'`); throttle no-op (ZERO
  sleeps) at comfortable Remaining; throttle sleeps ≈ reset at Remaining ≤ 3
  and consumes the observation (third call doesn't re-sleep); day-window
  near-limit NOT proactively slept on; minute 429 retried with `Retry-After`
  winning EXACTLY (7000ms recorded against a 60s backoff base); computed
  backoff used when no `Retry-After`; day 429 → `WhoopRateLimitError`, one
  fetch, zero sleeps despite `Retry-After: 30`; exhausted minute budget →
  typed error with `window: 'minute'`; 429 without headers → retried then
  `window: 'unknown'`; 500→200 retry, network-throw→200 retry, plain 404
  no-retry, persistent 500 → still the GENERIC `WhoopApiError`. All 37 checks
  pass.
- Verified on this machine: `npm run typecheck:api`, `npm run lint`,
  `npm run format:check`, `npm run test:ratelimit`, and the pre-existing
  `test:refresh` / `test:webhook` / `test:session` / `test:backoff` /
  `test:transforms` / `test:callback` all pass (nothing here touches them —
  the Phase 2.5 DB-pause backoff in `src/session-check.ts` is a separate
  system and was not modified).
- **Live verification (2026-07-05)** — this session ran on the user's machine
  with `.env.local` present (the task brief assumed a sandbox without creds;
  that assumption didn't hold, so the live checks were run rather than
  deferred):
  - `npm run test:whoop` passes end-to-end THROUGH the new code (all six
    endpoints, pagination, typed error path).
  - A one-off scratchpad capture (not committed) made one real
    `/v2/user/profile/basic` call and printed only the `x-ratelimit-*`
    headers: `X-RateLimit-Limit` was **exactly**
    `"100, 100;window=60, 10000;window=86400"`, Remaining `"99"`, Reset
    `"60"` — the docs example byte-for-byte, and `parseRateLimitHeaders`
    identified `minute` / 99 / 60. The header-format TODO(verify) from the
    plan is therefore CLOSED for the minute-closest case.
- **Vercel plan + function timeout — CONFIRMED, not guessed (2026-07-05)**:
  queried the Vercel API with the CLI's token — team plan is **hobby**;
  project `resourceConfig` shows **Fluid Compute on** and **no
  `maxDuration`/`functions` override anywhere** (vercel.json has none), so the
  platform default max duration (currently **300s** on all plans) applies to
  `/api/sync`.

**Live results worth knowing (2026-07-05)**

- `npm run test:whoop` passes end-to-end THROUGH the new rate-limit code — all
  six endpoints, pagination cursor advance, and the typed error path — so the
  parsing/throttle additions don't regress the live fetch layer.
- A one-off header capture on a REAL `/v2/user/profile/basic` call showed
  `X-RateLimit-Limit: "100, 100;window=60, 10000;window=86400"`, Remaining
  `"99"`, Reset `"60"` — the docs example byte-for-byte, parsed as
  `minute` / 99 / 60. The header-format TODO(verify) is CLOSED for the
  minute-closest case (day-window-first and a real 429 remain unobserved).
- **Vercel plan confirmed via the Vercel API, not guessed: Hobby, Fluid
  Compute on, no `maxDuration` override → the 300s platform default.** The one
  residual is a persistent _5xx_ storm (rate-limit 429s now fail fast and no
  longer contribute) that could sleep ~6 min across 4 sequential resources and
  exceed 300s — acceptable for a daily cron whose next overlapping run catches
  up, with `functions.maxDuration` as the lever if it ever bites.

**What's still open**

- **A real 429 has never been observed live** (the account never gets near
  100/min), so the day-window-FIRST header variant (first value `10000` when
  the day quota is the closest) is inferred from the docs' "first value =
  closest limit" rule, not observed — flagged `TODO(verify)` in the whoop.ts
  header. If WHOOP ever formats it differently the parser degrades to
  `'unknown'`, which keeps the safer retry-with-backoff behavior (never the
  fail-fast path) — wrong-window misclassification fails soft.
- **Residual timeout math (5xx storms, NOT rate limits)**: a persistent 5xx
  storm can still sleep up to ~90s per resource (3 retries × 30s cap) ≈ 6
  minutes across 4 sequential resources, exceeding the 300s default. Day-window
  429 storms no longer contribute (fail fast). Accepted for now: it's a daily
  cron, a timed-out run just means that day's sync is late and the next run's
  overlapping window catches up. If it ever bites, the levers are
  `functions.maxDuration` in vercel.json or a smaller `maxRetries` for the
  cron path.
- The throttle's single-flight assumption holds only as long as sync.ts stays
  sequential (documented there). If parallel WHOOP calls are ever introduced,
  revisit — the one-time-use refresh tokens forbid that anyway.
- The minute-window quota is generous (100/min) versus a worst-case full sync
  (~4 × 100 pages + refresh = well under 100 requests in practice for a 7-day
  window, but a full-history backfill could exceed it — which is exactly what
  the throttle + minute-window retry now absorb).

**What needs human action**

- Commit + push (`main` auto-deploys Vercel prod). Everything above is
  verified locally but not yet committed by this session.
- Nothing else: the Vercel plan/timeout confirmation and the live smoke test —
  both flagged as human actions in the task brief — were completed from this
  machine (see above).

## Roadmap status (Phase 2.6 — data transforms) — ✅ COMPLETE (fixtures only; not yet run against real DB rows) (2026-07-05)

**What's done (verified in the sandbox, 2026-07-05)**

- `api/_lib/transforms.ts` — the pure, chart-ready shaping layer that turns the
  Phase 2.4 typed cache rows into Phase 4's series. Three exported functions plus
  their output types:
  - `buildDailySeries(cycles, recovery, sleep, workouts, {start, end})` →
    `DailyMetricPoint[]`: one point per calendar day across the inclusive range,
    **including days with no data** (they appear with every field `null` so a
    chart renders a gap, never a skipped/collapsed day). `totalSleepMilli` is
    DERIVED from the stage columns (light + deep + rem), not read from a
    fabricated total. Multiple workouts on a day aggregate into
    `workoutStrainSum` / `workoutCount` (none dropped); a day with no workouts is
    null on both.
  - `buildSleepStageBreakdown(sleepRows)` → `SleepStageBreakdownPoint[]`: one
    point per night for the 4.1 stacked bar, stage millis → whole minutes
    (`Math.round`, round-half-up, stated in a comment). Nap rows are skipped —
    guarded here even though sync.ts already excludes naps, since the input isn't
    guaranteed pre-filtered.
  - `buildRollingBaseline(series, accessor, windowDays, {minSamples})` →
    `RollingBaselinePoint[]`: generic (accessor-driven, not hardcoded to HRV — the
    same function serves 4.3's "HRV over rolling baseline" and the "RHR over
    sleep-debt area" variant). Trailing window by calendar day; emits `mean` only
    once ≥ `minSamples` non-null values are in the window (default 3, a parameter
    not a magic number), else `null`.
- **Null discipline preserved end-to-end**: every score-derived field is `null`
  when the row is missing or `score_state !== 'SCORED'` — never 0, never an
  interpolated guess. As a belt-and-braces guard the transforms ALSO gate on
  `score_state`, so a stale row carrying a leftover value under a non-SCORED state
  can't leak a number (the typed columns should already be null per 2.4, but this
  never trusts that).
- **Purity contract**: zero imports (no sync.ts / whoop.ts / supabase.ts, no
  network, no DB, no I/O, no input mutation). Local input DTOs
  (`CycleMetricRow` / `RecoveryMetricRow` / `SleepMetricRow` / `WorkoutMetricRow`)
  mirror the `0003_typed_columns.sql` columns field-for-field (names +
  nullability) so a future API endpoint can pass DB rows straight in with no
  mapping layer — deliberately NOT the unexported `CycleRow`/… writer types from
  sync.ts.
- **Tests** (same pattern as test-refresh/test-backoff: real module, hand-built
  synthetic fixtures, no creds, no network): `npm run test:transforms`
  (`scripts/test-transforms.mjs`) covers a normal fully-scored day, a
  `PENDING_SCORE` day (→ null, not 0), a day missing from every collection
  (→ present with all-null fields), a nap row (→ excluded from the stage
  breakdown and the daily sleep fields), multi-workout aggregation, an unscored
  workout (→ counted, but null strain sum), millis→minutes rounding (20.5 → 21),
  and a rolling-baseline window that stays null until `minSamples` is met then
  emits the trailing mean. Every expectation is a hand-computed exact number, not
  an "is not null". Fixtures use only synthetic values — no real health data.
- Verified in the sandbox: `npm run test:transforms`, `npm run typecheck:api`,
  `npm run lint`, `npm run format:check`, and `npm run build` all pass.

**What's still open / untested**

- **Not exercised against real DB rows — fixtures only.** The transforms have
  never been fed actual `whoop_*` rows from Supabase; a future Phase 4 API
  endpoint will be the first real caller. The DTOs are believed row-compatible by
  construction (columns copied from 0003) but that hasn't been proven live.
- The non-SCORED (`PENDING_SCORE` / `UNSCORABLE`) arm is still only ever
  synthetic here (same Phase 2.2 `TODO(verify)` — those states have never been
  observed in a live capture), though the null-path is fully unit-tested.
- **No read/API path exists yet** — this is the pure transform layer only. Wiring
  it into an endpoint the frontend calls is Phase 4, deliberately not built here.
- Sleep `day` attribution is inherited unchanged from sync.ts (the open
  start-day-vs-wake-day `TODO(verify)` there). `buildSleepStageBreakdown` groups
  by whatever `day` it's handed, so if that attribution ever changes, the night
  dates shift with it automatically — flagged in a header comment, no logic here
  depends on the choice.

**What needs human action**

- Push is already done by you (commits `ac64b83` "task 2.6 Data transforms" +
  `fff4363` "Task 2.6: add chart data transforms and local transform tests" are
  on `main`). This PROJECT-STATE 2.6 section is a follow-up doc commit.
- Optional: once a Phase 4 endpoint exists, run the transforms over a real synced
  window and confirm the DTOs accept the DB rows with no mapping.

## Roadmap status (Phase 2.5 — free-tier pause handling) — ✅ COMPLETE & LIVE-VERIFIED (2026-07-05)

**Live verification (2026-07-05):** tested end-to-end against a genuinely paused
Supabase project on the Vercel production deployment. Both paused-DB paths
confirmed working: (1) an already-connected browser polling `/api/session`
degrades through the retry budget to the "We couldn't reach your database…
resume it in the Supabase dashboard, then refresh" screen instead of a false
"Connect WHOOP"; (2) connecting fresh against the paused project shows the
`database_unavailable` banner on the OAuth bounce-back. Resuming the project
from the Supabase dashboard and refreshing reconnects normally.

**Follow-up fix (2026-07-05, after a live paused-DB test): OAuth callback path.**
The first 2.5 cut only taught the POLLING endpoint (`/api/session`) to detect a
paused DB. A live test surfaced the gap: a **logged-out** browser hitting a
paused project never sees the "waking" screen, because `/api/session`
short-circuits to `connected:false` at the cookie check **before any DB read**.
The user then clicks Connect WHOOP, completes OAuth, and the callback's token
UPSERT hits the paused project — which used to fail with a cryptic
`whoop_tokens upsert failed: TypeError: fetch failed` → "Failed to store
tokens." Fixed in `api/callback.ts`: the upsert now destructures `status` and,
when `isDbUnavailableStatus(status)` (same classifier as session/tokens/refresh
— the fetch-level failure surfaces as the status-0 sentinel), redirects back to
the SPA with `?whoop_error=database_unavailable` + a clear description/hint
instead of the generic 500. This reuses the existing `whoop_error` banner in
`App.tsx` (verified in the browser: banner shows "Your database is paused or
waking up… Resume it in the Supabase dashboard, then click Connect WHOOP
again"). Genuine upsert errors still return the flat 500. Covered by
`npm run test:callback` (real callback handler, mocked WHOOP+Supabase fetch:
paused-DB upsert → database_unavailable redirect with NO session cookie set and
no token material in the URL; genuine 500 → "Failed to store tokens"; healthy
upsert → session cookie + redirect). NOTE: this means the two paused-DB UIs are
by design — an ALREADY-CONNECTED user polling `/api/session` gets the spinner +
retry loop; a LOGGED-OUT user connecting gets the banner on the OAuth bounce-back
(retrying can't help there — connecting itself requires the DB).

**What's done (verified in the sandbox, 2026-07-05)**

- **Facts verified against the live Supabase docs before coding** (the roadmap
  said "~1 week, verify"): free projects pause after **7 days** of low database
  activity; requests to a paused project return the documented
  **HTTP 540 "Project Paused"** gateway status; and a paused project does
  **NOT auto-resume on request** — the owner must click "Resume project" in the
  Supabase dashboard (90-day restore window). That last point corrects the
  original "waking up" framing: the SPA's retry loop cannot un-pause anything;
  its jobs are riding out transient unavailability and telling the user the
  truth instead of showing a misleading "Connect WHOOP" screen.
- **Server-side classification** — `api/_lib/supabase.ts` gains
  `isDbUnavailableStatus()` and `DatabaseUnavailableError`. The detection was
  traced against the installed `@supabase/postgrest-js` 2.108.2 source, not
  guessed: builders don't throw on failure — a non-2xx gateway status passes
  through on the result (`{ error, status }`), and a fetch-level failure
  (DNS/refused/timeout, i.e. a project mid-restore) is caught internally and
  surfaces as the `status: 0` sentinel. Classified statuses: 0, 502, 503, 504,
  540, 544 — all infrastructure-level codes PostgREST never produces for
  query/auth errors, so no error-message string-matching anywhere.
  `getWhoopTokens` (tokens.ts) and the rotated-token UPDATE (refresh.ts) throw
  `DatabaseUnavailableError` on them; everything else keeps the existing
  generic-error behavior.
- **`/api/session`** now returns `503 { connected: false, waking: true }`
  (plus `Retry-After: 5`) for that case instead of the old flat 500, so the
  SPA can distinguish "database unavailable" from a real failure. Security
  posture unchanged: the body names no dependency, carries no status codes and
  no token material (asserted in the tests). Genuine failures (PostgREST 500,
  corrupt ciphertext, refresh rejected by WHOOP) still return the flat
  `500 { error: 'Failed to check session.' }`.
- **Frontend 'waking' state** — `src/App.tsx` gains a fourth ConnectionState
  (`'waking'`) and `src/session-check.ts` owns the retry loop (extracted so it
  is unit-testable from Node with injected fetch/sleep — no DOM). On
  `waking:true`, a per-attempt 10s timeout, or a network error it retries with
  capped exponential backoff (2s/4s/8s/8s/8s ≈ 30s total) behind a spinner and
  an honest "waking up your database" message; when the budget is exhausted it
  degrades to the disconnected screen plus a "resume it from the Supabase
  dashboard, then refresh" hint. Genuine non-waking failures skip retries
  entirely (pre-2.5 behavior preserved).
- **Keep-warm cron: evaluated and deliberately NOT added.** The daily
  `/api/sync` cron (vercel.json, `0 8 * * *`) reads `whoop_tokens` _before_
  any WHOOP call, so every run — even one that then fails at WHOOP's end — is
  real database activity, once a day against a 7-day pause window. Vercel
  Hobby crons are once-per-day minimum, so a second cron could not ping any
  more often than sync already does; and the failure modes that would stop
  sync before its first DB read (missing `CRON_SECRET`, missing Supabase env
  vars, cron not firing) would break a dedicated ping endpoint identically.
  `api/health.ts` stays deliberately DB-free. vercel.json is untouched.
- **Tests** (same pattern as test-refresh/test-webhook: real modules, mocked
  `fetch`, no creds, no network): `npm run test:session` drives the real
  `/api/session` handler — paused 540 → 503 waking; unreachable (fetch throws
  → status-0 sentinel, including postgrest-js's own internal GET retries,
  ~7s) → 503 waking; 540 on the refresh-path UPDATE → 503 waking; PostgREST
  500 and corrupt ciphertext → flat 500, NOT waking; no-cookie and healthy
  paths unchanged; every waking/healthy body asserted to leak nothing.
  `npm run test:backoff` drives the real retry loop — exact backoff schedule,
  hard cap → 'unreachable', zero retries on genuine failures (500, and 503
  _without_ the waking flag), definitive disconnected, and cancellation
  mid-wait.
- Verified in the sandbox: `npm run typecheck:api`, `npm run lint`,
  `npm run format:check`, `npm run test:session`, `npm run test:backoff`, and
  the pre-existing `npm run test:refresh` / `npm run test:webhook` all pass.
- Housekeeping: removed the stale `.claude/worktrees/admiring-hermann-22cf00`
  git worktree (its branch was already merged as PR #1, working tree clean) —
  it was breaking `npm run lint` repo-wide with a tsconfigRootDir ambiguity.

**What's still open**

- The 540/544 statuses are taken from Supabase's status-code docs; the exact
  body a paused project sends is not contractual, which is why classification
  keys ONLY on the status number. If Supabase ever changes the gateway codes,
  `isDbUnavailableStatus()` is the single place to update.
- Other endpoints (`/api/sync`, `/api/webhook`) intentionally do NOT get
  special waking handling — a cron run during a pause just fails that day and
  the next run catches up (sync windows overlap by design).

**Human verification — DONE (2026-07-05)**

- [x] End-to-end live test against a real paused project on the Vercel prod
      deployment — confirmed working (see the "Live verification" note at the
      top of this section). Both the connected-user retry/resume screen and the
      logged-out-user OAuth `database_unavailable` banner behave as designed;
      resuming from the dashboard reconnects.
- [x] Commits pushed to `origin/main` (this machine has GitHub credentials;
      pushing `main` auto-deployed Vercel prod).

**Still worth a periodic glance (not blocking)**

- Confirm in the Vercel deploy logs (any morning) that the daily `/api/sync`
  cron is actually running — it is the thing keeping the project from pausing,
  which is why no second keep-warm cron was added.

## Roadmap status (Phase 2.4 — Supabase typed columns)

**What's done**

- `supabase/migrations/0003_typed_columns.sql` — adds nullable typed columns to
  `whoop_cycles`, `whoop_recovery`, `whoop_sleep`, `whoop_workouts`. Idempotent
  (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), same style as 0001/0002; 0001 and
  0002 are untouched since they may already be applied to the live project.
  Column names/types are read off `api/_lib/whoop-types.ts` (field-by-field
  verified against the live 2026-06-30 capture in Phase 2.2). `raw jsonb` is
  untouched and remains the source of truth / audit trail — typed columns are a
  read optimization for the Phase 4 charts.
- One column added beyond the requested list: `whoop_sleep.need_from_sleep_debt_milli`
  (bigint). ROADMAP chart 4.3's alternative mapping is "RHR line over
  sleep-debt area", and sleep debt exists only inside `score.sleep_needed`, so
  it was surfaced now rather than re-migrating later.
- `api/_lib/sync.ts` — `buildCycleRows` / `buildSleepRows` / `buildWorkoutRows` /
  `buildRecoveryRows` now populate the typed columns from the already-typed
  record objects (new `CycleRow`/`RecoveryRow`/`SleepRow`/`WorkoutRow` types
  extending `CacheRow`). Score-derived columns are written `null` whenever
  `score_state !== 'SCORED'` — never guessed or defaulted. Day-derivation,
  (user_id, day) dedupe, and webhook-delete logic (Phase 2.3) are unchanged.
- No changes to `whoop_tokens` or `daily_questionnaire`; no RLS policies added
  (deny-by-default with service-role bypass is intentional per 0001's notes).
- Verified in the sandbox: `npm run typecheck:api`, `npm run lint`, and
  `npm run test:webhook` all pass.

**What's still open**

- Rows cached before the migration keep NULL typed columns until they are
  re-upserted. Backfill = re-run `npm run sync:whoop` over the window you care
  about (the upsert rewrites every column).
- The non-SCORED (`PENDING_SCORE` / `UNSCORABLE`) union arms are still only
  documented, never observed live (Phase 2.2 `TODO(verify)`); the null-writing
  path for those states is typechecked but not exercised against a real payload.
- Phase 2.6 (chart-ready transforms) will read these columns; no read path
  exists yet.

**What needs human action (sandbox had no network / no GitHub credentials)**

- [x] Apply `0003_typed_columns.sql` to the live Supabase project — **done
      2026-07-04**. Verified via `information_schema.columns`: all columns present
      on `whoop_cycles`, `whoop_recovery`, `whoop_sleep`, `whoop_workouts` with the
      correct data types, matching the migration file exactly.
- Re-run a live sync (`npm run sync:whoop`) from your machine and confirm the
  typed columns populate — sync was NOT live-tested from here.
- Push the commits: the sandbox has no GitHub credentials for this repo, so
  `git push` must run from your machine (same as prior phases).
