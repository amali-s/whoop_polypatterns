# WHOOP Dashboard — Build Roadmap

A phased plan for building a web UI that connects to your WHOOP app, pulls your data, and visualizes it with custom charts plus a daily questionnaire.

**Stack:** React + TypeScript + Vite (frontend) · D3.js (visualizations) · **Vercel** (hosting + serverless functions for WHOOP OAuth) · **Supabase** (Postgres for tokens + data + questionnaire) — both on **free tier**

> **Accuracy note:** The WHOOP API details below were verified against the WHOOP developer docs in June 2026 and reflect **API v2** (v1 is being deprecated — see the v1→v2 migration guide). APIs change; verify every endpoint, scope, and URL against the live docs at https://developer.whoop.com before relying on it. Anything I'm not fully certain of is flagged inline.

---

## Key architectural decision (read first)

> **Data-source decision (confirmed June 2026):** The **WHOOP cloud API (OAuth)** is the **primary, confirmed source** — it fully supports **WHOOP 5.0** and delivers every metric automatically. A direct-from-band Bluetooth path (read raw sensor data off the strap, decode and score it locally, no cloud) was evaluated. It works today only for **WHOOP 4.0** (via projects like `openwhoop`); on the **5.0** the deep-metric protocol (recovery, strain, sleep) is **not yet publicly reverse-engineered**, so that path is captured as an exploratory R&D track in **Phase 7** — not on the critical path. _(Verify project/protocol status before relying on it; this space moves fast.)_

Your WHOOP "app" gives you a **Client ID** and **Client Secret** from the WHOOP Developer Dashboard. The **Client Secret must never live in frontend code** — a React/Vite bundle is fully visible to anyone. The locked-in architecture:

```
[ React + Vite SPA ]      [ Vercel Serverless Functions ]     [ WHOOP API ]
   charts + UI         →     /api/auth, /api/callback,      →    OAuth + data
   (hosted on Vercel)        /api/whoop/* — hold Client
                             Secret in Vercel env vars,
                             do OAuth token exchange
                                      │
                                      ▼
                            [ Supabase Postgres ]
                            encrypted tokens + WHOOP
                            data + questionnaire
```

**Why this combo:** Vercel hosts the Vite frontend _and_ the OAuth/serverless functions in one project, so the Client Secret stays server-side in Vercel's env vars. Supabase holds tokens and data. Both run comfortably on free tier for a single user.

> **Free-tier reality:** No BAA on free tier — fine here, since you store only your own WHOOP data and HIPAA doesn't bind individuals. The privacy lever is in _your_ code: encrypt tokens at the app level before storing (Phase 1.4) and never log secrets/health fields. Note Supabase **pauses inactive free projects** — verified against the live docs 2026-07-05: pause after **7 days of low database activity**, requests to a paused project return **HTTP 540 "Project Paused"**, and the project does **NOT auto-resume on request** — the owner must click "Resume project" in the Supabase dashboard (90-day restore window). Handled in Phase 2.5.

---

## Phase 0 — Foundations & project setup

**Goal:** A running repo, a scaffolded app, and a clear architecture before any feature work.

- [ ] **0.1 Create the GitHub repository**
  - Create repo (private recommended while it holds health data wiring).
  - Add `.gitignore` (Node template) — confirm `.env`, `node_modules`, build output are ignored.
  - Add `README.md` (project summary, setup steps) and this `ROADMAP.md`.
  - Choose a license (or keep private with none).
  - Set up branch protection on `main` (require PR) if you want discipline.
- [ ] **0.2 Scaffold the frontend**
  - `npm create vite@latest` → React + TypeScript template. _(Verify the exact command/flags against current Vite docs — the CLI prompts change.)_
  - Add ESLint + Prettier; pick a styling approach (see Phase 4).
  - Confirm dev server runs and commits a clean baseline.
- [ ] **0.3 Set up Vercel** — connect the GitHub repo to a Vercel project; confirm the Vite app deploys. Add an `/api` folder for serverless functions (Vercel auto-deploys these as endpoints). Add a health-check function to confirm it runs. Document required vars in `.env.example` (no real secrets committed); set the real ones in Vercel's env-var settings.
- [ ] **0.4 Set up Supabase** — create a free-tier project, **pick the region nearest you**, and save the project URL + keys into Vercel env vars (never the frontend). Create initial tables: `whoop_tokens`, plus placeholders for synced data and questionnaire (schema firmed up in Phase 2/5). Enable Row Level Security.
- [ ] **0.5 Repo structure** — single repo (monorepo): Vite app at root, serverless functions in `/api`. Simplest for a solo Vercel build.
- [ ] **0.6 Create `Skills.md`** — a living index of the skills, tools, and knowledge each phase relies on (e.g. `theme-factory`, `figma-to-code-generator`, Figma MCP, D3, OAuth 2.0). Pull from the "Skills / knowledge to lean on" notes in this roadmap so it's a single reference for what to use where.
- [ ] **0.7 Create `design.md`** — the design spec / source of truth for the UI: design tokens (colors, typography, spacing), layout/grid, component inventory, and the chart→WHOOP-metric mappings (from Phase 4). Feeds Phase 3 and Phase 4 and keeps styling decisions in one place.

**Skills / knowledge to lean on**

- **Knowledge:** Git/GitHub basics (branches, PRs), Vite project setup, monorepo layout, `.gitignore` hygiene, environment-variable management.
- **Tooling:** I can run the scaffolding and Git commands for you in the workspace, and I have a GitHub/web browser path if you want me to help create the repo interactively.

---

## Phase 1 — WHOOP API connection (auth)

**Goal:** Securely authenticate a WHOOP member and obtain a usable access token.

WHOOP uses **OAuth 2.0 Authorization Code flow**. Verified endpoints (June 2026):

- Authorize: `https://api.prod.whoop.com/oauth/oauth2/auth`
- Token: `https://api.prod.whoop.com/oauth/oauth2/token`
- API base: `https://api.prod.whoop.com`
- Scopes: `offline`, `read:profile`, `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, and (worth verifying) `read:body_measurement`. The `offline` scope is what returns a **refresh token**.

- [x] **1.1 Register redirect URI** in the WHOOP Developer Dashboard — registered prod URI: `https://whooppolypatterns.vercel.app/api/callback` (also set as `WHOOP_REDIRECT_URI` in Vercel). For local dev use `http://localhost:3000/api/callback`. Redirect URIs must match exactly — note the path is `/api/callback`, not `/callback`.
- [x] **1.2 Build the authorize redirect** — a Vercel function (`/api/auth`) constructs the authorize URL with `client_id`, `redirect_uri`, `response_type=code`, `scope`, and a `state` param (CSRF protection).
- [x] **1.3 Handle the callback** — `/api/callback` exchanges the `code` for `access_token` + `refresh_token` (Client Secret from Vercel env vars, server-side only). **Done:** implemented in `api/callback.ts` (state check, code exchange, encrypted token upsert, session cookie, SPA redirect with `whoop_error` banner on failure); live-tested end-to-end on prod and covered by `npm run test:callback` (see Phase 2.5 notes).
- [x] **1.4 Token storage with app-level encryption** — before writing tokens to the Supabase `whoop_tokens` table, **encrypt them in the function** (e.g. AES-256-GCM using a key held only in Vercel env vars). This way even the DB operator sees ciphertext, not your raw WHOOP tokens. Never put tokens in `localStorage` or in the frontend. _(Verify the exact crypto API you use against current Node docs.)_
- [x] **1.5 Token refresh** — implemented in `api/_lib/refresh.ts`: `ensureFreshTokens(userId)` / `getValidAccessToken(userId)` read the row via `getWhoopTokens`, and when the access token is within a 5-minute skew of expiry (or has unknown expiry) POST `grant_type=refresh_token` to the token endpoint, then re-encrypt + persist the rotated tokens and recompute `expires_at`. Wired into `/api/session` so SPA polling keeps the token fresh without ever exposing token material. **Confirmed against live docs (June 2026):** (a) refresh rotates — each refresh returns a NEW `refresh_token` and invalidates the old access token, so we persist the new refresh token every time (and keep the existing one if WHOOP ever omits it, since the column is NOT NULL); (b) the refresh body needs `grant_type`, `refresh_token`, `client_id`, `client_secret`, and `scope` (we resend `offline`, per the docs' sample payload), creds in the body like the code exchange; (c) TTL is variable, reported per-response via `expires_in` (sample shows `3600`), so we never hardcode it except as the same 1h fallback `callback.ts` uses. **Assumed/not separately verified:** exact refresh-token (not access-token) lifetime is not documented as a fixed value, so re-auth is still required if the refresh token itself ever lapses or is revoked. **Concurrency caveat (documented + mitigated, not locked):** two simultaneous serverless requests could both refresh and the second would be rejected because the first rotated the token — on a refresh-rejected response we re-read the row and use the freshly stored token rather than corrupting the row. Unit-tested via `npm run test:refresh` (no creds, mocks `fetch`): no-refresh-when-fresh, rotate+persist, omitted-refresh-token, rejected-refresh, rotation race, and missing row.
- [x] **1.6 Auth state in the UI** — "Connect WHOOP" button → redirect → connected state.

**Skills / knowledge to lean on**

- **Knowledge:** OAuth 2.0 Authorization Code flow, `state`/CSRF, refresh-token rotation, secure secret storage, CORS between SPA and proxy.
- **Reference:** WHOOP OAuth guide and the "Authenticating with Passport" tutorial (Passport.js strategy) if you use Node — verify it's current.

---

## Phase 2 — Data layer (fetch, model, store)

**Goal:** Reliable, typed access to WHOOP data feeding the charts.

WHOOP v2 resources you'll likely use: **Cycles** (physiological cycles / strain), **Recovery** (recovery %, HRV, RHR), **Sleep** (stages, performance), **Workouts**, **Profile**, **Body Measurement**.

- [x] **2.1 API client** — implemented in `api/_lib/whoop.ts` (server-only): one typed function per resource (`getProfile`, `getBodyMeasurement`, `getCycles`, `getRecovery`, `getSleep`, `getWorkouts`) over a central request core. Auth header injected via `getValidAccessToken()` (Phase 1.5) per request — no token material logged or leaked. Transparent cursor pagination (`fetchCollection`) plus a single-page helper (`fetchCollectionPage`), guarded by configurable max-pages/max-records. Retries 429/5xx/network with exponential backoff + jitter and honors `Retry-After` (seeds Phase 2.7); never retries other 4xx; 401 → distinct `WhoopAuthError`; all failures throw a typed `WhoopApiError` (status + endpoint + WHOOP error body). **Verified against the live OpenAPI spec** (base `…/developer`; paths `/v2/cycle`, `/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`, `/v2/user/profile/basic`, `/v2/user/measurement/body`; pagination `limit`≤25 + `nextToken` → `records[]`/`next_token`; `start`/`end` ISO date-time; scopes already granted by `/api/auth`). Records stay generic (`unknown[]`) for Phase 2.2 to type. Live smoke test: `npm run test:whoop` (`scripts/test-whoop.mjs`) — all six endpoints 2xx, cursor advances, typed error path, no tokens/health fields printed.
- [x] **2.2 TypeScript types** — implemented in `api/_lib/whoop-types.ts`: `WhoopProfile`, `WhoopBodyMeasurement`, `WhoopCycle`, `WhoopRecovery`, `WhoopSleep`, `WhoopWorkout`, each derived field-by-field from a real captured payload (`scripts/capture-whoop-samples.mjs` → gitignored `whoop-samples/`, deleted after review — never committed). Cycle/Recovery/Sleep/Workout are discriminated unions on `score_state` (`'SCORED'` → `score` populated; `'PENDING_SCORE' | 'UNSCORABLE'` → `score: null`). Wired into `api/_lib/whoop.ts` as the default generic (`getCycles<T = WhoopCycle>`, etc.), still overridable. Human-reviewed field-by-field against the raw JSON — full match, no mismatches. **Known gaps from a single-sample capture** (flagged inline as `TODO(verify)`, not blocking): only the `'SCORED'` arm of each union was observed live; `WhoopCycle.end`, `v1_id`, and `WhoopWorkoutScore.distance_meter`/`altitude_gain_meter`/`altitude_change_meter` were only seen `null` (unconfirmed whether always-nullable vs. just unset in this sample — e.g. `distance_meter` was null because the captured workout was pilates, no GPS). `npm run typecheck:api`, `npm run lint`, and `npm run test:whoop` (rerun locally against live Supabase — the build sandbox couldn't reach Supabase, so this had to be confirmed on your machine) all pass. **2.2 is fully closed.**
- [x] **2.3 Caching / sync strategy** — store fetched WHOOP data in Supabase so charts read from your DB, not WHOOP on every load. **Webhooks** are available (configurable v1/v2 in the dashboard) to get pushed updates; or a scheduled sync (Vercel Cron on free tier — verify current limits).
  - **Webhook `*.deleted` handling (2026-07-03, closes the delete gap from the 2026-07-02 review):** `*.deleted` events now HARD-delete the matching cached row (was: create/update only). Confirmed against the live webhook docs that deletions are distinct per-resource types (`recovery.deleted` / `sleep.deleted` / `workout.deleted`) carrying a v2 resource id. `deleteRecord()` (`api/_lib/sync.ts`) maps each id to the right column: workout/sleep UUID → `whoop_id`; **recovery → `raw->>'sleep_id'`, since the webhook id is the linked _sleep_ UUID whereas the stored `whoop_id` is the cycle_id** (this also resolves the old `TODO(verify)` on recovery id semantics in `api/webhook.ts`). Hard delete (no schema change) — the tables are a pure WHOOP cache. Signature verification / counts-only logging unchanged. Unit-tested via `npm run test:webhook` (`scripts/test-webhook.mjs`, no creds, mocks `fetch`): per-resource delete keying, bad-signature and stale-timestamp → 401 with the DB untouched, unconfigured-secret → 501, and uncached record → `deleted=0` no-op.
- [x] **2.4 Supabase schema** — tables for cycles, recovery, sleep, workouts keyed by date; this gives chart history and lets you join questionnaire data (Phase 5). **Implemented (2026-07-03):** `supabase/migrations/0003_typed_columns.sql` adds nullable typed columns to all four synced tables (idempotent `ADD COLUMN IF NOT EXISTS`, matching 0001/0002; 0001/0002 untouched since they may already be applied). Columns are read off `api/_lib/whoop-types.ts` (verified against the live 2026-06-30 capture, Phase 2.2) and cover the Phase 4 chart metrics: cycles → strain/kilojoule/HR/start/end/offset; recovery → recovery %, RHR, HRV, SpO2, skin temp, calibrating; sleep → stage totals, performance/efficiency/consistency %, respiratory rate, disturbances, nap, start/end/offset, plus `need_from_sleep_debt_milli` (added beyond the original list for chart 4.3's sleep-debt-area option — it lives only in `score.sleep_needed`); workouts → sport, strain, HR, kilojoule, distance, start/end/offset. `raw jsonb` stays the source of truth — typed columns are a read optimization only. Row builders in `api/_lib/sync.ts` populate them from the already-typed records; score-derived columns are written NULL whenever `score_state !== 'SCORED'` (WHOOP returns `score: null` in those states — never guessed). Day-derivation, (user_id, day) dedupe, and webhook-delete logic (2.3) unchanged. `npm run typecheck:api`, `npm run lint`, `npm run test:webhook` pass in the sandbox; **the migration has NOT been applied to live Supabase and sync has NOT been live-tested — both need to happen from your machine** (see PROJECT-STATE.md). Rows cached before the migration keep NULL typed columns until re-upserted — backfill by re-running `npm run sync:whoop` over the desired window.
- [x] **2.5 Handle free-tier pause** — **Implemented & LIVE-VERIFIED (2026-07-05).** **Verified against the live Supabase docs first:** free projects pause after **7 days** of low database activity; a paused project's API returns the documented **HTTP 540 "Project Paused"**; and — correcting the roadmap's original assumption — a paused project does **NOT auto-resume when a request arrives**: the owner must click "Resume project" in the dashboard (90-day restore window). **Server:** DB failures are now classified by gateway status (traced against the installed `@supabase/postgrest-js` 2.108.2 source, not guessed: non-2xx statuses pass through on the builder result; fetch-level failures are caught and surface as the `status: 0` sentinel). `api/_lib/supabase.ts` exports `isDbUnavailableStatus()` (0/502/503/504/540/544 — infra-only codes PostgREST never produces for query/auth errors) + `DatabaseUnavailableError`; `tokens.ts`/`refresh.ts` throw it on those statuses; `/api/session` maps it to **`503 { connected:false, waking:true }`** (+ `Retry-After`) instead of the old flat 500, leaking no token material, status codes, or dependency names. Genuine failures (PostgREST 500, corrupt ciphertext, rejected WHOOP refresh) still return the flat 500. **Frontend:** new `'waking'` ConnectionState in `src/App.tsx`, driven by `src/session-check.ts` — retries `waking:true` responses and timeouts/network errors with capped exponential backoff (2s/4s/8s/8s/8s ≈ 30s budget; 10s per-attempt timeout), shows a spinner + honest copy meanwhile, and on exhaustion degrades to the disconnected screen with a "resume your project from the Supabase dashboard" hint (since resume is manual, the retry loop's job is riding out transient blips and being honest — not un-pausing). **Keep-warm cron: deliberately NOT added.** The daily `/api/sync` cron already reads `whoop_tokens` before touching WHOOP, so every run is real DB activity well inside the 7-day window; Hobby crons are once-a-day minimum so a second cron can't ping more often; and the failure modes that would stop sync before the DB (missing `CRON_SECRET`/env vars) would break a dedicated ping identically. A second cron would be pure redundancy. Unit-tested via `npm run test:session` (real `/api/session` handler, mocked fetch: paused 540 → 503 waking; unreachable status-0 → 503 waking; refresh-path UPDATE 540; genuine 500/corrupt-ciphertext NOT classified as waking; no-leak assertions) and `npm run test:backoff` (real retry loop, injected fetch/sleep: exact schedule, cap, no-retry on genuine failures, cancellation). **Follow-up (same day):** a live paused-DB test surfaced that a _logged-out_ browser hits the paused project through the OAuth callback (not `/api/session`, which short-circuits to `connected:false` before any DB read), so `api/callback.ts` now classifies the token-upsert failure the same way and redirects to the SPA with a `database_unavailable` banner instead of a cryptic "Failed to store tokens" (covered by `npm run test:callback`). **LIVE-VERIFIED end-to-end** against a genuinely paused project on Vercel prod: connected-user retry/resume screen and logged-out-user OAuth banner both behave as designed; resuming from the Supabase dashboard reconnects. See PROJECT-STATE.md.
- [x] **2.6 Data transforms** — `api/_lib/transforms.ts`: pure, import-free functions that turn the typed cache rows into chart-ready series — `buildDailySeries` (one point per calendar day across a range, gaps included, null-not-0), `buildSleepStageBreakdown` (per-night stacked stages in minutes, naps skipped) and a generic `buildRollingBaseline` (trailing-window mean with a `minSamples` floor, accessor-driven so it serves both HRV-over-baseline and RHR-over-sleep-debt). No side effects, no imports from sync/whoop/supabase. Unit-tested with hand-built fixtures via `npm run test:transforms`. Not yet exercised against real DB rows (fixtures only); the API endpoint that serves these to the frontend is Phase 4 wiring, not built here. See PROJECT-STATE.md.
- [x] **2.7 Rate-limit handling** — **Implemented (2026-07-05).** **Verified against the live docs first** (https://developer.whoop.com/docs/developing/rate-limiting, checked 2026-07-05): two limits per client — **100 requests/minute AND 10,000 requests/day**; every response carries draft-polli-ratelimit-headers-05 headers (`X-RateLimit-Limit` e.g. `"100, 100;window=60, 10000;window=86400"` — the FIRST value is the quota of whichever window the client is closest to exhausting, and the `;window=60`/`;window=86400` entries distinguish minute from day — plus `X-RateLimit-Remaining` and `X-RateLimit-Reset` in seconds); breach → HTTP 429. **Built in `api/_lib/whoop.ts`** (internal to `whoopRequest()` — no public signature changed): (a) pure `parseRateLimitHeaders()` reads the three headers off EVERY response (success and failure) and identifies the closest window (`minute`/`day`/`unknown`); (b) typed `WhoopRateLimitError extends WhoopApiError` carrying `{ window, remaining, resetSeconds }`, thrown for every 429 that is not retried further; (c) **day-window 429s now fail FAST with zero retries** — the old behavior burned the retry budget on 30s-capped backoffs that cannot refill a quota that resets in up to 24h; minute/unknown 429s keep the existing retry-with-backoff (a ≤60s window CAN clear inside the budget), with `Retry-After` still authoritative over the computed backoff; (d) **proactive throttle**: the last observed Remaining/Reset lives in module-level state (safe — the module is server-only and sync.ts issues every call sequentially), and when Remaining ≤ `RATE_LIMIT_SAFETY_BUFFER` (3) the next request sleeps out the reported reset instead of eating a real 429 — a zero-latency no-op at normal single-user volume, and deliberately skipped for day-window observations. `sync.ts`'s `classifyFetchError` now names the exhausted window in the resource error string so the cron log says WHY (`WHOOP rate limit hit (429, day window) @ …`) — counts/status/window only, no token material, per the existing logging discipline. **Unit-tested** via `npm run test:ratelimit` (`scripts/test-ratelimit.mjs`, no creds, mocks `fetch` + records `setTimeout`): header parsing incl. garbled/ambiguous → `unknown`; throttle no-op at comfortable Remaining and exact wait at/below the buffer; day-window near-limit NOT slept on; minute 429 retried with `Retry-After` winning exactly; day 429 → 1 fetch, 0 sleeps, typed error; exhausted budget → typed error; 5xx/network/plain-4xx paths unchanged. All pre-existing suites (`test:refresh`/`test:webhook`/`test:session`/`test:backoff`/`test:transforms`/`test:callback`) re-run and pass. **Live-verified (2026-07-05, this machine has `.env.local`):** `npm run test:whoop` passes end-to-end through the new code, and a one-off header capture on a real call confirmed the exact documented `X-RateLimit-Limit` format byte-for-byte (parsed as `minute`, Remaining 99, Reset 60). **Vercel plan/timeout confirmed via the Vercel API (not guessed): Hobby plan, Fluid Compute on, no `maxDuration` override → the current 300s default applies.** _Still unobserved live (flagged in the module header): a real 429 and the day-window-first header variant (first value `10000`) — the fail-fast path rests on the docs' "first value = closest limit" rule. Residual worst case: a persistent **5xx** storm can still sleep up to ~90s per resource (3 retries × 30s cap) ≈ 6 min across 4 sequential resources, which could exceed the 300s default — acceptable for a daily cron (the next run catches up), noted in PROJECT-STATE.md._

**Skills / knowledge to lean on**

- **Knowledge:** REST pagination, webhook handling + signature verification, TypeScript typing of API responses, data-shaping for time-series, caching patterns.

---

## Phase 3 — UI style & design system

**Goal:** A cohesive, good-looking dashboard shell before/while charts go in.

- [x] **3.1 Design tokens** — color palette (consider a WHOOP-like dark theme), typography scale, spacing, radii. Define as CSS variables / theme object. **Done (2026-07-06):** Neo Frutiger Aero tokens in `src/index.css`, documented in design.md §1 (contrast-hardened in 3.4).
- [x] **3.2 Layout shell** — header, sidebar/nav, responsive dashboard grid for the chart cards. **Done (2026-07-07):** sticky glass header + centered main column + bento grid from the confirmed Figma layout (design.md §2); no sidebar by design until Phase 5. See PROJECT-STATE.md.
- [x] **3.3 Component library** — reusable Card, ChartContainer, Loading/Empty/Error states, buttons, form controls. **Done (2026-07-08):** `src/components/` (Card, Button, ChartContainer, states, form primitives), documented in design.md §3. See PROJECT-STATE.md.
- [x] **3.4 Responsive + accessibility** — mobile breakpoints, color-contrast, keyboard nav, chart `aria`/text alternatives. **Done (2026-07-08):** verified 375/768/1024/1280px (header-wrap fix for a real 375px overflow), computed-ratio WCAG AA audit with four token darkenings + `--color-warning-text` (flagged in design.md §1; LOCKED chart palette untouched), 44×44px tap targets via hit-area extension, keyboard/focus audit (native elements, DOM-order focus, ≥4.6:1 focus outline), `prefers-reduced-motion` support, placeholder-tile aria audit, and the Phase 4 chart accessibility contract written into design.md §5.2. Known exception: the legacy OAuth banner's dismiss ✕ tap target (banner out of scope per §3).
- [ ] **3.5 Dark/light mode** (optional).

**Skills / knowledge to lean on**

- **Skill — `theme-factory`:** generate a cohesive color/font theme for the dashboard and apply it consistently.
- **Skill — `figma-to-code-generator`:** if you mock the dashboard (in Figma or as a sketch), turn it into React/TS components with design tokens and CSS animations.
- **Skill — `brand-guidelines`:** only if you want an Anthropic-styled look; otherwise build a WHOOP-flavored theme.
- **Tooling — Figma MCP:** I can generate or read Figma designs to drive the layout if you want to design first.
- **Knowledge:** design tokens, responsive CSS grid/flex, accessibility for data viz.

---

## Phase 4 — Data visualizations (D3.js)

**Goal:** Your six charts, built as reusable D3-in-React components. Each is a sub-project.

General D3+React pattern: let **React own the DOM / SVG container and state**, let **D3 own scales, axes, shapes, and transitions**. Build one solid reusable scaffold (responsive SVG, axes, tooltip, legend) and reuse it.

- [ ] **4.0 Charting foundation** — responsive `<svg>` wrapper hook, shared scales/axes helpers, tooltip + legend components, animation/transition utility.

- [ ] **4.1 Stacked bar chart** — suggested mapping: **sleep stages per night** (Awake / Light / Deep / REM stacked to total sleep), or strain contributors per day.
- [ ] **4.2 Combo chart #1 (line + area)** — suggested: **Recovery % (line) over Day Strain (area)** to see readiness vs. load.
- [ ] **4.3 Combo chart #2 (line + area)** — suggested: **HRV (line) over a rolling baseline band (area)**, or RHR line over sleep-debt area.
- [ ] **4.4 Dot matrix #1** — suggested: **recovery calendar** (one dot per day, color = recovery zone red/yellow/green).
- [ ] **4.5 Dot matrix #2** — suggested: **sleep performance** calendar/matrix (dot size or color = % of sleep need met).
- [ ] **4.6 Dot matrix #3** — suggested: **strain** matrix, or a questionnaire-vs-recovery correlation matrix once Phase 6 exists.
- [ ] **4.7 Interactivity** — tooltips, hover, date-range filter, legend toggles shared across charts.
- [ ] **4.8 Loading/empty/error states** wired to the data layer.

> **Confirmed 2026-07-09** — mappings above accepted as-is (4.6 uses the strain-matrix variant, not the questionnaire-correlation variant, since Phase 5 doesn't exist yet). See design.md §4 for the locked table.

**Skills / knowledge to lean on**

- **Knowledge:** D3 scales (`scaleLinear`, `scaleBand`, `scaleTime`), `d3.stack` for stacked bars, `d3.area`/`d3.line` for combos, `d3.axis`, transitions; the React+D3 integration pattern (refs vs. React-managed SVG); responsive SVG with `viewBox` + ResizeObserver.
- **Tip:** Dot-matrix/calendar layouts are where D3 shines over Chart.js — worth the extra control you chose.

---

## Phase 5 — Daily questionnaire

**Goal:** Capture subjective daily inputs and store them alongside WHOOP data for correlation.

- [ ] **5.1 Define questions** — e.g. mood, soreness, stress, alcohol, nutrition, motivation (Likert 1–5 or tags). Decide the schema.
- [ ] **5.2 Form UI** — accessible daily form, one entry per day, edit-today support, validation.
- [ ] **5.3 Storage** — persist responses (same DB as Phase 2.4), keyed by date + user.
- [ ] **5.4 Reminders** (optional) — daily prompt/notification to fill it in. _(I can set up a scheduled task to remind you each morning if you want.)_
- [ ] **5.5 Join with WHOOP data** — surface questionnaire fields in charts (e.g. dot-matrix correlating self-reported stress vs. recovery).

**Skills / knowledge to lean on**

- **Knowledge:** form state + validation in React (controlled inputs or a form library), date-keyed records, joining subjective + objective time series.
- **Tooling — scheduled tasks:** I can create a recurring daily reminder.

---

## Phase 6 — Quality, security & deployment (added)

**Goal:** Make it robust and shippable. This is the part most personal projects skip and later regret.

- [ ] **6.1 Secrets management** — WHOOP Client Secret, Supabase keys, and the token-encryption key all live in **Vercel env vars**, never in the bundle. Set separate values for Preview vs. Production. Rotate the WHOOP secret if it ever leaks.
- [ ] **6.2 Error handling & logging** — graceful API failures, token-expiry recovery, Supabase-pause "waking up" state, user-visible error states. **Scrub logs** — never log tokens or health fields into Vercel/Supabase logs.
- [ ] **6.3 Testing** — unit tests for data transforms, component tests for charts, an integration test of the OAuth flow (mock WHOOP).
- [ ] **6.4 CI/CD** — Vercel auto-deploys on push (preview per branch, prod on `main`). Add GitHub Actions for lint + test on PR if you want a gate before merge.
- [ ] **6.5 Deployment** — production on Vercel (frontend + `/api` functions together); add the Vercel prod URL as a redirect URI in the WHOOP dashboard. Confirm Supabase prod project + region.
- [ ] **6.6 Privacy** — health data: keep the repo private, app-level token encryption already in Phase 1.4, store the minimum you need, region nearest you. _(Optional, max privacy: Supabase is self-hostable, but the managed-cloud security controls aren't available out-of-the-box when self-hosting — you'd harden it yourself.)_

**Skills / knowledge to lean on**

- **Knowledge:** GitHub Actions, environment promotion (dev→prod), basic web security (secret handling, CORS, HTTPS), health-data privacy hygiene.

---

## Phase 7 — WHOOP 5.0 local deep-metrics investigation (R&D track)

**Goal:** Determine whether — and how — we can source the _deep_ WHOOP 5.0 metrics (**recovery, strain, sleep**) **locally off the band over Bluetooth**, the way 4.0-only projects already do, so the dashboard could eventually run without the WHOOP cloud. This is a **parallel research track**, not a dependency of Phases 0–6.

> **Status & honesty (June 2026):** This is **exploratory** and may not pan out on any fixed timeline. As of now, **no public project has fully reverse-engineered the 5.0's deep-metric protocol.** Verify current project status before relying on any claim here — the space moves fast and my knowledge of it is not authoritative.

**What's possible on a 5.0 _today_ vs. blocked:**

- ✅ **Live heart rate** streams over the _standard_ Bluetooth Heart Rate Service (commonly UUID `0x180D` — _verify_), which needs **no pairing/bond**. This is the one piece available right now and the natural first proof-of-concept.
- ⛔ **Recovery, strain, sleep, history offload** ride WHOOP's _proprietary, encrypted_ protocol, which on the 5.0 is **not yet decoded** publicly.
- ⚠️ **Bond constraint:** the strap holds an encrypted Bluetooth bond with **one device at a time** (normally the official WHOOP app). Reading the deep data requires taking that bond, which can disrupt the official app's pairing.

**Investigation steps:**

- [ ] **7.1 Track the field** — follow the projects working on this and watch for 5.0 progress: `noop-app/noop` (4.0 + _experimental_ 5.0/MG), `bWanShiTong/openwhoop` (4.0, Rust), `bWanShiTong/reverse-engineering-whoop` + its writeup, `johnmiddleton12/wearable`, `madhursatija/whoof`, `christianmeurer/whoop-reader`, `jogolden/whoomp`. _(All 4.0-centric today; the 5.0 is the open frontier.)_
- [ ] **7.2 Capture your own BLE traffic** — the core RE method: enable **Bluetooth HCI snoop logging** on Android (Developer Options) — or use macOS **PacketLogger** — while the official WHOOP app syncs your 5.0, then analyze the frames in Wireshark. This is how the 4.0 was mapped.
- [ ] **7.3 Live-HR proof-of-concept (do this first)** — build a tiny local collector that reads the standard HR stream off the 5.0 and writes it to Supabase. Proves the _whole_ band→DB→dashboard path end-to-end **before** any deep-metric decoding exists, and is guaranteed to work today. (I can scaffold this in Node or Python whenever you want the quick win.)
- [ ] **7.4 Pairing / bond handshake** — investigate the encrypted bond (NOOP describes a `CLIENT_HELLO` link-establishment handshake on the 5.0). Understand single-device bonding and how to pair without permanently breaking the official app.
- [ ] **7.5 Decode the deep-metric packets** — once captured, map the 5.0 frame format and packet types for recovery/strain/sleep. Use the documented 4.0 layout (openwhoop's "type-47" biometric decode) as a _starting hypothesis only_ — expect the 5.0 to differ.
- [ ] **7.6 Local analytics** — recompute recovery/strain/sleep on your own machine from raw signals using documented methods (HRV RMSSD / Task Force 1996, Edwards or Banister TRIMP for strain, on-device sleep staging), mirroring what `openwhoop` and `noop` do. These are **approximations**, not WHOOP's proprietary scores, and are **not medical-grade**.
- [ ] **7.7 Wire it into the dashboard** — when/if decoded, stand up the **local collector → Supabase** path and reuse a **mapping/view layer**: the collector writes its own native tables, SQL views re-present them under the names the charts already query (Phase 2.4 shapes), so the dashboard swaps source with **no chart changes**.
- [ ] **7.8 Guardrails** — own device, own data only; interoperability/research framing (e.g. 17 U.S.C. §1201(f) reverse-engineering for interoperability); **not a medical device**; don't violate any agreement that binds you. Keep this track in a clearly-labeled, isolated module so it never touches the cloud pipeline's secrets.

**Skills / knowledge to lean on**

- **Knowledge:** BLE/GATT (services, characteristics, notifications), HCI snoop-log capture + analysis (Wireshark), packet framing/CRC, encrypted bonding/pairing, time-series signal processing, the published HRV/strain/sleep algorithms above.
- **Tooling:** I can scaffold the live-HR collector (7.3) and help analyze captured BLE logs.

---

## Suggested build order (critical path)

1. **Phase 0** (repo + scaffold) →
2. **Phase 1** (auth) — nothing works without a token →
3. **Phase 2** (data layer) — get real data flowing →
4. **Phase 3 + 4** in parallel (style shell while building the charting foundation) →
5. **Phase 5** (questionnaire) →
6. **Phase 6** (harden + deploy).

**Phase 7** (5.0 local deep-metrics R&D) runs **off to the side** — _not_ on the critical path. Pick it up opportunistically, starting with the live-HR proof-of-concept (7.3).

Get **one** chart end-to-end (auth → fetch → transform → render) before building the other five — it de-risks the whole pipeline.

---

## What I can do for you next

- Scaffold the repo + Vite app + `/api` functions and wire up Vercel + Supabase, then commit the baseline.
- Build the OAuth functions with encrypted token storage (Phase 1) and a typed WHOOP API client (Phase 2).
- Generate the design system with `theme-factory`, or mock the dashboard in Figma first.
- Build the reusable D3 charting foundation, then each chart.
- Stand up the questionnaire and a daily reminder.

Tell me which phase to start on, and confirm the chart→metric mappings in Phase 4.

---

## Sources

- [Overview — WHOOP for Developers](https://developer.whoop.com/docs/developing/overview/)
- [OAuth 2.0 — WHOOP for Developers](https://developer.whoop.com/docs/developing/oauth/)
- [Getting Started — WHOOP for Developers](https://developer.whoop.com/docs/developing/getting-started/)
- [WHOOP API Docs](https://developer.whoop.com/api/)
- [v1 to v2 Migration Guide](https://developer.whoop.com/docs/developing/v1-v2-migration/)
- [Recovery — user data](https://developer.whoop.com/docs/developing/user-data/recovery/)
- [Webhooks — WHOOP for Developers](https://developer.whoop.com/docs/developing/webhooks/)
- [Authenticating with WHOOP (Passport)](https://developer.whoop.com/docs/tutorials/access-token-passport/)

**Phase 7 (5.0 local R&D) references — unofficial community reverse-engineering projects:**

- [NOOP — local-first WHOOP companion (4.0 & experimental 5.0)](https://github.com/noop-app/noop)
- [openwhoop — WHOOP 4.0 local client (Rust)](https://github.com/bWanShiTong/openwhoop)
- [Reverse Engineering Whoop 4.0 — writeup](https://github.com/bWanShiTong/reverse-engineering-whoop-post)
- [bWanShiTong/reverse-engineering-whoop](https://github.com/bWanShiTong/reverse-engineering-whoop)
- [johnmiddleton12/wearable](https://github.com/johnmiddleton12/wearable)
