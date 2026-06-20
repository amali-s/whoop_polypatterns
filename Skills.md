# Skills & Knowledge Index

> **Living document.** A running index of the skills, tools, and knowledge to
> lean on per phase. Seeded from the **"Skills / knowledge to lean on"** notes in
> [`ROADMAP.md`](ROADMAP.md) — keep the two in sync, and add "what I learned"
> notes here as the project progresses.
>
> Always verify CLI commands, API endpoints, scopes, and URLs against current
> docs — versions move. WHOOP details below reflect **API v2** (verified in the
> roadmap June 2026); re-verify against https://developer.whoop.com.

## How to use this

- Each phase lists the **knowledge / skills / tooling** to lean on, plus links.
- When you hit something non-obvious, jot it under **Notes / gotchas** so future
  phases don't relearn it.

---

## Phase 0 — Foundations & project setup _(current)_

- **Knowledge:** Git/GitHub basics (branches, PRs), Vite project setup, monorepo
  layout, `.gitignore` hygiene, environment-variable management.
- **Vite (React + TS template)** — scaffolding, dev server, build. https://vite.dev
  · Requires Node `^20.19.0 || >=22.12.0`.
- **TypeScript** — project-references tsconfig (`tsconfig.app` / `tsconfig.node`).
- **ESLint (flat config) + typescript-eslint** — https://eslint.org · https://typescript-eslint.io
- **Prettier** + `eslint-config-prettier`.
- **Vercel project structure** — `/api` = serverless functions, zero-config Vite.
  https://vercel.com/docs/functions
- **Node `crypto`** — AES-256-GCM token encryption (`lib/crypto.ts`).
  https://nodejs.org/api/crypto.html
- **Tooling:** Claude can run scaffolding + Git commands in the workspace; a
  GitHub/web browser path exists for creating the repo interactively.

**Notes / gotchas:**

- Secrets live only in Vercel env vars; `.env` is gitignored, `.env.example` tracked.

## Phase 1 — WHOOP API connection (auth)

- **Knowledge:** OAuth 2.0 Authorization Code flow, `state`/CSRF, refresh-token
  rotation, secure secret storage, CORS between SPA and proxy.
- **Reference:** WHOOP OAuth guide + "Authenticating with WHOOP (Passport)"
  tutorial (verify it's current).
- **WHOOP v2 endpoints** (verify against live docs):
  - Authorize: `https://api.prod.whoop.com/oauth/oauth2/auth`
  - Token: `https://api.prod.whoop.com/oauth/oauth2/token`
  - API base: `https://api.prod.whoop.com`
  - Scopes: `offline`, `read:profile`, `read:recovery`, `read:sleep`,
    `read:workout`, `read:cycles`, (verify) `read:body_measurement`.
    `offline` is what returns a **refresh token**.
- **`lib/crypto.ts`** — AES-256-GCM encrypt tokens before they touch the DB (Phase 1.4).

**Notes / gotchas:**

- Redirect URI must match the WHOOP dashboard registration **exactly**.
- Token TTL / whether refresh tokens rotate: **unconfirmed** — verify in docs (Phase 1.5).
- Never put tokens in `localStorage` or the frontend.

## Phase 2 — Data layer (fetch, model, store)

- **Knowledge:** REST pagination, webhook handling + signature verification,
  TypeScript typing of API responses, data-shaping for time-series, caching.
- **Supabase / Postgres** — schema, RLS, `@supabase/supabase-js` (service-role
  server client vs anon browser client). https://supabase.com/docs
- **WHOOP v2 resources:** Cycles (strain), Recovery (recovery %, HRV, RHR), Sleep
  (stages, performance), Workouts, Profile, Body Measurement.
- **Sync:** WHOOP **webhooks** (dashboard) or scheduled sync via **Vercel Cron**
  (verify free-tier limits). https://vercel.com/docs/cron-jobs
- **Types:** generate from live payloads, not from memory.

**Notes / gotchas:**

- Service-role key bypasses RLS — server-only, never in the browser.
- Supabase **pauses inactive free projects** (~1 week — verify); handle a
  "waking up" state, optionally a Cron keep-warm ping.
- Respect WHOOP rate limits with backoff (confirm current limits).

## Phase 3 — UI style & design system

- **Skill — `theme-factory`:** generate a cohesive color/font theme and apply it.
- **Skill — `figma-to-code-generator`:** turn a Figma/sketch mock into React/TS
  components with design tokens + CSS animations.
- **Skill — `brand-guidelines`:** only if you want an Anthropic-styled look;
  otherwise build a WHOOP-flavored theme.
- **Tooling — Figma MCP:** generate or read Figma designs to drive the layout.
- **Knowledge:** design tokens, responsive CSS grid/flex, accessibility for data viz.
- See [`design.md`](design.md) for tokens, layout, and chart→metric mappings.

## Phase 4 — Data visualizations (D3.js)

- **Knowledge:** D3 scales (`scaleLinear`, `scaleBand`, `scaleTime`), `d3.stack`
  (stacked bar), `d3.area`/`d3.line` (combos), `d3.axis`, transitions; the
  React+D3 integration pattern (refs vs React-managed SVG); responsive SVG with
  `viewBox` + ResizeObserver. https://d3js.org · https://observablehq.com/@d3/gallery
- **Pattern:** React owns the DOM/SVG container + state; D3 owns scales, axes,
  shapes, transitions. Build one reusable scaffold (responsive SVG, axes,
  tooltip, legend) and reuse across all six charts.
- **Charts:** 1× stacked bar, 2× combo (line + area), 3× dot-matrix. See
  [`design.md`](design.md) for the metric mappings (to confirm).

**Notes / gotchas:**

- Dot-matrix/calendar layouts are where D3 earns its keep over Chart.js.

## Phase 5 — Daily questionnaire

- **Knowledge:** form state + validation in React (controlled inputs or a form
  library), date-keyed records, joining subjective + objective time series.
- **Tooling — scheduled tasks:** Claude can create a recurring daily reminder.

## Phase 6 — Quality, security & deployment

- **Knowledge:** GitHub Actions, environment promotion (dev→prod), basic web
  security (secret handling, CORS, HTTPS), health-data privacy hygiene.
- Secrets in Vercel env vars (separate Preview vs Production); rotate the WHOOP
  secret if leaked. Scrub logs — never log tokens or health fields.
- Tests: data transforms (unit), charts (component), OAuth flow (integration, mock WHOOP).
