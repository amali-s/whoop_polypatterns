# whoop-polypatterns

A personal **WHOOP data-visualization dashboard**: pull your WHOOP data via the
WHOOP API (OAuth 2.0), store it in Postgres, and render it with custom D3.js
charts (a stacked bar, two combo charts, and three dot-matrix charts), alongside
a self-reported questionnaire.

> **Status: Phase 0 — project scaffold.** Tooling, structure, and security
> guardrails are in place. No WHOOP/Supabase wiring yet.

---

## Locked stack

| Concern           | Choice                                                          |
| ----------------- | --------------------------------------------------------------- |
| Frontend          | **React + TypeScript** built with **Vite**                      |
| Visualizations    | **D3.js**                                                       |
| Hosting + backend | **Vercel** (static frontend + `/api` serverless functions)      |
| OAuth / API proxy | Vercel serverless functions in `/api` (keep secrets off client) |
| Database          | **Supabase** (Postgres: tokens, WHOOP data, questionnaire)      |
| Cost              | Vercel **free tier** + Supabase **free tier**                   |

Single repo (monorepo): the Vite app lives at the **root**, serverless functions
live in **`/api`**, shared server-only code lives in **`/lib`**.

---

## How the pieces fit together

```
Browser (React + D3, served by Vercel static)
   │  fetch('/api/...')
   ▼
Vercel serverless functions  (/api/*.ts)         ← holds all secrets
   │  - WHOOP OAuth: redirect, token exchange, refresh
   │  - encrypt tokens (lib/crypto.ts, AES-256-GCM) before storing
   │  - read/write WHOOP data + questionnaire
   ▼
Supabase / Postgres   (tokens [encrypted], whoop data, questionnaire)
   ▲
   └─ WHOOP API  ← functions call out using decrypted tokens
```

**Security model (non-negotiable):**

- The **WHOOP Client Secret**, **Supabase service-role key**, and the
  **token-encryption key** are server-only. They live **only** in Vercel
  environment variables — never in frontend code, never committed.
- WHOOP tokens are encrypted at the application level (**AES-256-GCM**, see
  [`lib/crypto.ts`](lib/crypto.ts)) **before** being stored in Supabase.
- `.env` is never committed. Only [`.env.example`](.env.example) (placeholders)
  is tracked. See it for the full list of required variables and which are
  server-only.

---

## Project layout

```
.
├── api/                # Vercel serverless functions (Node). Each file = an endpoint.
│   ├── health.ts       #   GET /api/health → { ok: true }
│   ├── auth.ts         #   GET /api/auth → 302 redirect to WHOOP OAuth authorize
│   └── callback.ts     #   GET /api/callback → verify state, exchange code, store tokens
├── lib/                # Server-only shared code (NOT bundled into the frontend).
│   ├── crypto.ts       #   AES-256-GCM token encrypt/decrypt helpers.
│   └── supabase.ts     #   Service-role Supabase client (server-only).
├── src/                # React + TypeScript frontend (Vite).
├── public/             # Static assets served as-is.
├── .env.example        # Documented env vars (placeholders only).
├── eslint.config.js    # Flat ESLint config (browser src + node api/lib + Prettier).
├── .prettierrc.json    # Prettier formatting rules.
├── .editorconfig       # Editor defaults.
├── Skills.md           # Living index of skills/knowledge per phase.
├── design.md           # Living design spec (tokens, layout, chart→metric map).
└── ROADMAP.md          # Source of truth: phased build plan (WHOOP API v2).
```

The phased plan lives in [`ROADMAP.md`](ROADMAP.md) — start there. This is
**Phase 0**.

---

## Authentication (WHOOP OAuth 2.0)

The authorization-code flow spans two serverless functions:

**1. [`api/auth.ts`](api/auth.ts) — start the flow.**
`GET /api/auth` → 302 redirect to WHOOP's authorize endpoint
(`https://api.prod.whoop.com/oauth/oauth2/auth`). It mints a random `state` for
CSRF protection, sends it to WHOOP, and also stores it in an **HttpOnly,
SameSite=Lax** cookie (`whoop_oauth_state`). Requested scopes:
`read:recovery read:cycles read:sleep read:workout read:profile offline` (the
`offline` scope is what returns a refresh token).

**2. [`api/callback.ts`](api/callback.ts) — complete the flow.** WHOOP redirects
the browser back to `WHOOP_REDIRECT_URI` (`/api/callback`) with `?code&state`.
The handler:

1. **Verifies CSRF first** — compares the returned `state` against the
   `whoop_oauth_state` cookie; a missing/mismatched value is rejected with `400`
   before anything else happens. The state cookie is then cleared (single use).
2. **Handles a denied/error redirect** — if WHOOP sends `?error=...` (e.g. the
   user declined), it redirects to `/?whoop_error=...` instead of crashing.
3. **Exchanges the code for tokens** — a server-side `POST` to
   `https://api.prod.whoop.com/oauth/oauth2/token`, `x-www-form-urlencoded`,
   with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
   and `client_secret` **in the body** (verified against the WHOOP docs, June
   2026 — they specify "send client credentials in body"). A non-200 is handled
   with a `502` and server-side logging (never echoing WHOOP's error to the
   client).
4. **Stores tokens server-side** — `access_token` and `refresh_token` are
   written to **HttpOnly, SameSite=Lax** cookies, **AES-256-GCM-encrypted at
   rest** via [`lib/crypto.ts`](lib/crypto.ts). They never reach client-side
   JavaScript. _Tradeoff:_ cookies are simple and stateless but ride on the
   browser and can't be refreshed without it — **Phase 1.4** moves the source of
   truth to the encrypted Supabase `whoop_tokens` table.
5. **Redirects** the connected user to the app (`/`).

> **Cookie `Secure` flag is gated to production** (`NODE_ENV === 'production'`)
> in **both** `/api/auth` and `/api/callback`, so the cookies are sent over
> plain `http://localhost` during dev. The two functions must keep this gate in
> lockstep — if one sets `Secure` and the other doesn't, the state cookie won't
> round-trip locally. In production every cookie is `Secure`.

Env vars these routes read (see [`.env.example`](.env.example)):

| Var                    | Used by         | Used for                                                                  |
| ---------------------- | --------------- | ------------------------------------------------------------------------- |
| `WHOOP_CLIENT_ID`      | auth + callback | `client_id` on the authorize URL and token exchange (public).             |
| `WHOOP_CLIENT_SECRET`  | callback        | `client_secret` in the token exchange. **Server-only — never committed.** |
| `WHOOP_REDIRECT_URI`   | auth + callback | `redirect_uri` — must byte-match the value registered in WHOOP.           |
| `TOKEN_ENCRYPTION_KEY` | callback        | AES-256-GCM key to encrypt tokens before storing them in cookies.         |

---

## Local setup

**Prerequisites:** Node **`^20.19.0 || >=22.12.0`** (Vite 8 requires it). An
[`.nvmrc`](.nvmrc) pins Node 22 — run `nvm use` if you use nvm.

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file and fill in real values
cp .env.example .env
#    (generate the token key: openssl rand -base64 32)

# 3. Run the Vite dev server (frontend)
npm run dev
```

To run the `/api` serverless functions locally the way Vercel runs them, use the
Vercel CLI (`npm i -g vercel`, then `vercel dev`) — verify the current command
against the [Vercel CLI docs](https://vercel.com/docs/cli). `npm run dev` alone
serves only the frontend, not `/api`.

### Scripts

| Script                 | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Start the Vite dev server (frontend).           |
| `npm run build`        | Type-check (`tsc -b`) and build for production. |
| `npm run preview`      | Preview the production build locally.           |
| `npm run lint`         | ESLint over the repo.                           |
| `npm run lint:fix`     | ESLint with `--fix`.                            |
| `npm run format`       | Prettier write over the repo.                   |
| `npm run format:check` | Prettier check (CI-friendly, no writes).        |

---

## Deployment

Vercel zero-config detects Vite and serves `/api` as functions — no
`vercel.json` is needed for this layout. Set the environment variables from
`.env.example` in the Vercel dashboard before deploying. See the project setup
checklist (GitHub → Vercel → Supabase → WHOOP) provided during scaffolding.
