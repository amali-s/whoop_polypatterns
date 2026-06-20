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
│   └── health.ts       #   GET /api/health → { ok: true }
├── lib/                # Server-only shared code (NOT bundled into the frontend).
│   └── crypto.ts       #   AES-256-GCM token encrypt/decrypt helpers.
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
