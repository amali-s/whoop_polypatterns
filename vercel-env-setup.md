# Vercel + Supabase environment setup

How to configure the environment for the WHOOP dashboard and verify it on the
live deploy. Companion to [.env.example](.env.example) (local dev) — this file
covers the **Vercel** (production/preview) and **Supabase** side.

> **Note:** This file was added in the Phase 0 close-out. Earlier instructions
> that said `openssl rand -hex 32` for the token key were **wrong** — the code
> in [lib/crypto.ts](lib/crypto.ts) decodes the key with
> `Buffer.from(raw, 'base64')` and requires exactly 32 decoded bytes, so the
> key must be **base64**. Use `openssl rand -base64 32` (see below).

---

## The 7 environment variables

Set every one of these in **Vercel → Project → Settings → Environment Variables**
(for Production, and Preview if you use preview deploys). Never put server-only
values in the frontend bundle.

| #   | Variable                    | Scope           | Notes                                                    |
| --- | --------------------------- | --------------- | -------------------------------------------------------- |
| 1   | `WHOOP_CLIENT_ID`           | public          | From the WHOOP Developer Dashboard.                      |
| 2   | `WHOOP_CLIENT_SECRET`       | **server-only** | OAuth secret. Never ship to the browser.                 |
| 3   | `WHOOP_REDIRECT_URI`        | server-ish      | Must match the URI registered with WHOOP exactly.        |
| 4   | `SUPABASE_URL`              | public          | `https://<ref>.supabase.co`                              |
| 5   | `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Full admin, bypasses RLS. `/api` only.                   |
| 6   | `SUPABASE_ANON_KEY`         | public          | Respects RLS; safe for browser (with `VITE_` prefix).    |
| 7   | `TOKEN_ENCRYPTION_KEY`      | **server-only** | AES-256-GCM key. Must be **base64**, decode to 32 bytes. |

WHOOP values (1–3) come from the WHOOP Developer Dashboard; Supabase values
(4–6) from **Supabase → Project Settings → API**.

### Generating `TOKEN_ENCRYPTION_KEY`

```sh
openssl rand -base64 32
```

This prints a 44-character base64 string that decodes to exactly 32 bytes —
what [lib/crypto.ts](lib/crypto.ts) requires. Do **not** use `-hex` (that yields
64 hex chars = 32 bytes raw, but base64-decoding it gives the wrong length and
the code throws).

---

## Applying the Supabase migration

The schema lives in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql).
Apply it **once** to your Supabase project. Two options:

### Option A — Supabase SQL editor (simplest)

1. Open **Supabase → SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql`.
3. Click **Run**. It is idempotent, so re-running is safe.

### Option B — Supabase CLI (if installed)

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

### Verify the tables and RLS exist

Run this in the SQL editor — every table should appear with `rowsecurity = true`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Expected rows (all `rowsecurity = true`): `daily_questionnaire`,
`whoop_cycles`, `whoop_recovery`, `whoop_sleep`, `whoop_tokens`,
`whoop_workouts`. You can also confirm visually in **Table Editor** (each table
shows an "RLS enabled" badge). There are intentionally **no RLS policies** yet —
with RLS on and no policy, the browser (anon key) gets no access, while the
`/api` service-role client retains full access.

---

## Verifying env vars on the live deploy (`/api/health-env`)

A **temporary** endpoint, [api/health-env.ts](api/health-env.ts), reports
whether each of the 7 vars is readable at runtime. It returns **booleans only,
never the values**.

1. Deploy to Vercel after setting all 7 vars.
2. Open `https://<your-app>.vercel.app/api/health-env`.
3. Confirm the response has `allPresent: true`, every field in `present` is
   `true`, and `tokenKeyDecodesTo32Bytes: true` (this last one catches the
   hex-vs-base64 mistake). Overall `ok` is `true` when all of that holds.
4. Also smoke-test `https://<your-app>.vercel.app/api/health` → `{ "ok": true }`.

> ⚠️ **Delete after validation.** Once you've confirmed everything is `true`,
> remove `api/health-env.ts` and redeploy. It exposes which vars are configured
> and should not live in the deployed app.
