# WHOOP Dashboard — Build Roadmap

A phased plan for building a web UI that connects to your WHOOP app, pulls your data, and visualizes it with custom charts plus a daily questionnaire.

**Stack:** React + TypeScript + Vite (frontend) · D3.js (visualizations) · **Vercel** (hosting + serverless functions for WHOOP OAuth) · **Supabase** (Postgres for tokens + data + questionnaire) — both on **free tier**

> **Accuracy note:** The WHOOP API details below were verified against the WHOOP developer docs in June 2026 and reflect **API v2** (v1 is being deprecated — see the v1→v2 migration guide). APIs change; verify every endpoint, scope, and URL against the live docs at https://developer.whoop.com before relying on it. Anything I'm not fully certain of is flagged inline.

---

## Key architectural decision (read first)

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

> **Free-tier reality:** No BAA on free tier — fine here, since you store only your own WHOOP data and HIPAA doesn't bind individuals. The privacy lever is in _your_ code: encrypt tokens at the app level before storing (Phase 1.4) and never log secrets/health fields. Note Supabase **pauses inactive free projects** (~1 week of no activity — verify current terms), so handle the "waking up" state (Phase 2).

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

- [ ] **1.1 Register redirect URI** in the WHOOP Developer Dashboard — `http://localhost:3000/callback` (or your Vite dev port) for dev, and your Vercel prod URL later. Redirect URIs must match exactly.
- [ ] **1.2 Build the authorize redirect** — a Vercel function (`/api/auth`) constructs the authorize URL with `client_id`, `redirect_uri`, `response_type=code`, `scope`, and a `state` param (CSRF protection).
- [ ] **1.3 Handle the callback** — `/api/callback` exchanges the `code` for `access_token` + `refresh_token` (Client Secret from Vercel env vars, server-side only).
- [ ] **1.4 Token storage with app-level encryption** — before writing tokens to the Supabase `whoop_tokens` table, **encrypt them in the function** (e.g. AES-256-GCM using a key held only in Vercel env vars). This way even the DB operator sees ciphertext, not your raw WHOOP tokens. Never put tokens in `localStorage` or in the frontend. _(Verify the exact crypto API you use against current Node docs.)_
- [ ] **1.5 Token refresh** — implement refresh-token rotation before expiry; handle the refreshed token correctly. _(Verify token lifetime and whether refresh tokens rotate against current docs — I'm not certain of the exact TTL.)_
- [ ] **1.6 Auth state in the UI** — "Connect WHOOP" button → redirect → connected state.

**Skills / knowledge to lean on**

- **Knowledge:** OAuth 2.0 Authorization Code flow, `state`/CSRF, refresh-token rotation, secure secret storage, CORS between SPA and proxy.
- **Reference:** WHOOP OAuth guide and the "Authenticating with Passport" tutorial (Passport.js strategy) if you use Node — verify it's current.

---

## Phase 2 — Data layer (fetch, model, store)

**Goal:** Reliable, typed access to WHOOP data feeding the charts.

WHOOP v2 resources you'll likely use: **Cycles** (physiological cycles / strain), **Recovery** (recovery %, HRV, RHR), **Sleep** (stages, performance), **Workouts**, **Profile**, **Body Measurement**.

- [ ] **2.1 API client** — Vercel-function wrapper for each endpoint with auth header injection (decrypt the token from Supabase first), pagination handling (these endpoints are paginated), and error/retry logic.
- [ ] **2.2 TypeScript types** — model each response shape. _(Generate from the live API responses, not from memory — field names should be confirmed against real payloads.)_
- [ ] **2.3 Caching / sync strategy** — store fetched WHOOP data in Supabase so charts read from your DB, not WHOOP on every load. **Webhooks** are available (configurable v1/v2 in the dashboard) to get pushed updates; or a scheduled sync (Vercel Cron on free tier — verify current limits).
- [ ] **2.4 Supabase schema** — tables for cycles, recovery, sleep, workouts keyed by date; this gives chart history and lets you join questionnaire data (Phase 5).
- [ ] **2.5 Handle free-tier pause** — Supabase pauses inactive free projects (~1 week, verify). Add a graceful "waking up" / retry state in the UI, and optionally a lightweight scheduled ping (Vercel Cron) to keep it warm.
- [ ] **2.6 Data transforms** — shape raw responses into chart-ready series (per-day buckets, stage breakdowns, rolling baselines).
- [ ] **2.7 Rate-limit handling** — respect WHOOP rate limits with backoff. _(Confirm current limits in docs.)_

**Skills / knowledge to lean on**

- **Knowledge:** REST pagination, webhook handling + signature verification, TypeScript typing of API responses, data-shaping for time-series, caching patterns.

---

## Phase 3 — UI style & design system

**Goal:** A cohesive, good-looking dashboard shell before/while charts go in.

- [ ] **3.1 Design tokens** — color palette (consider a WHOOP-like dark theme), typography scale, spacing, radii. Define as CSS variables / theme object.
- [ ] **3.2 Layout shell** — header, sidebar/nav, responsive dashboard grid for the chart cards.
- [ ] **3.3 Component library** — reusable Card, ChartContainer, Loading/Empty/Error states, buttons, form controls.
- [ ] **3.4 Responsive + accessibility** — mobile breakpoints, color-contrast, keyboard nav, chart `aria`/text alternatives.
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

> The chart→metric mappings above are **my suggestions**, not a requirement — tell me which WHOOP metric you actually want in each and I'll lock them in.

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

## Suggested build order (critical path)

1. **Phase 0** (repo + scaffold) →
2. **Phase 1** (auth) — nothing works without a token →
3. **Phase 2** (data layer) — get real data flowing →
4. **Phase 3 + 4** in parallel (style shell while building the charting foundation) →
5. **Phase 5** (questionnaire) →
6. **Phase 6** (harden + deploy).

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
