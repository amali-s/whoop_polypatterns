# Project state

> **Note (2026-07-03):** this file was referenced as already existing with
> Phase 2.2 / 2.3 entries, but it was not found in the repo, its git history,
> or the working tree in this sandbox — so it was created fresh with the 2.4
> entry below. If your local copy lives elsewhere (untracked / another
> machine), merge this section into it and keep that one.

## Roadmap status (Phase 2.5 — free-tier pause handling)

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

**What needs human action (cannot be verified from the sandbox)**

- A real pause cannot be triggered from here (it requires 7 days of genuine
  inactivity on the live project, and resuming is a manual dashboard action).
  To verify end-to-end for real: let the project pause (or temporarily pause
  it from the Supabase dashboard if the plan allows), load the SPA, and
  confirm (a) the spinner + "waking up your database" copy appears rather than
  the Connect WHOOP screen, (b) after ~30s it degrades to the disconnected
  screen WITH the resume-it-from-the-dashboard hint, and (c) after clicking
  Resume in the dashboard and the project coming back, a refresh reconnects
  normally.
- Confirm in the Vercel deploy logs (any morning) that the daily `/api/sync`
  cron is actually running — it is the thing keeping the project from pausing,
  which is why no second cron was added.
- Push the commits from your machine (sandbox has no GitHub credentials, same
  as prior phases).

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
