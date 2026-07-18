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

## The 8 environment variables

Set every one of these in **Vercel → Project → Settings → Environment Variables**
(for Production, and Preview if you use preview deploys). Never put server-only
values in the frontend bundle.

| #   | Variable                    | Scope           | Notes                                                                     |
| --- | --------------------------- | --------------- | ------------------------------------------------------------------------- |
| 1   | `WHOOP_CLIENT_ID`           | public          | From the WHOOP Developer Dashboard.                                       |
| 2   | `WHOOP_CLIENT_SECRET`       | **server-only** | OAuth secret. Never ship to the browser.                                  |
| 3   | `WHOOP_REDIRECT_URI`        | server-ish      | Must match the URI registered with WHOOP exactly.                         |
| 4   | `SUPABASE_URL`              | public          | `https://<ref>.supabase.co`                                               |
| 5   | `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Full admin, bypasses RLS. `/api` only.                                    |
| 6   | `SUPABASE_ANON_KEY`         | public          | Respects RLS; safe for browser (with `VITE_` prefix).                     |
| 7   | `TOKEN_ENCRYPTION_KEY`      | **server-only** | AES-256-GCM key. Must be **base64**, decode to 32 bytes.                  |
| 8   | `CRON_SECRET`               | **server-only** | **Production only.** Without it the daily sync silently 401s — see below. |

WHOOP values (1–3) come from the WHOOP Developer Dashboard; Supabase values
(4–6) from **Supabase → Project Settings → API**. Values 7–8 you generate
yourself — no service issues them.

### Generating `TOKEN_ENCRYPTION_KEY`

```sh
openssl rand -base64 32
```

This prints a 44-character base64 string that decodes to exactly 32 bytes —
what [lib/crypto.ts](lib/crypto.ts) requires. Do **not** use `-hex` (that yields
64 hex chars = 32 bytes raw, but base64-decoding it gives the wrong length and
the code throws).

### Generating `CRON_SECRET`

```sh
openssl rand -base64 32
```

Same command, but a **different value** — do not reuse the encryption key.
Unlike (7) this is an opaque shared password, not a key: it is compared byte-for-byte
with `timingSafeEqual`, never decoded, so the format is irrelevant. Base64 is
just convenient.

**Scope it to Production only.** Vercel Cron runs only against production, and
it injects `Authorization: Bearer $CRON_SECRET` automatically once the variable
exists — there is nothing to configure on the cron side.

**Why this one is easy to miss.** [api/sync.ts](api/sync.ts) `isAuthorized()`
**fails closed**: with no secret configured it logs `CRON_SECRET is not set —
refusing to run sync` and returns 401 _before_ doing any work. Nothing throws,
nothing appears in your app logs, and the dashboard keeps rendering fine — it
just renders empty, because Supabase is never filled. This cost four days of
debugging on 2026-07-18; the charts were correct the entire time.

**Verify it after setting it.** Env changes only apply to _new_ deployments, so
redeploy first, then either wait for 08:00 UTC or trigger a run by hand:

```sh
curl -H "Authorization: Bearer <your-secret>" \
  "https://<your-domain>/api/sync?days=30"
```

`{"ok":true,...}` with per-resource counts means the pipeline is alive.
`Unauthorized` means the value or the redeploy did not take. Store the secret in
a password manager — Vercel will not show it again after saving. Rotating it is
harmless (no data impact), unlike `TOKEN_ENCRYPTION_KEY`.

> **Make this a habit:** confirm in the Vercel cron logs that `/api/sync` is
> actually running. It is also what keeps the free-tier Supabase project from
> auto-pausing (7-day inactivity window), which is why ROADMAP 2.5 deliberately
> skipped a second keep-warm cron — that reasoning only holds while sync runs.

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

## Verifying env vars on the live deploy

> **Historical note:** a temporary `api/health-env.ts` endpoint used to report
> which of the (then) 7 vars were readable at runtime, returning booleans only.
> It was **deleted after validation as intended** — it no longer exists in the
> repo, and it never knew about `CRON_SECRET` (variable 8). If you re-create
> something like it, delete it again afterward: it advertises which secrets are
> configured.

Verify the current 8 in this order. Each step exercises a different variable,
so the first failure tells you which one is wrong.

1. **Deploy** after setting all 8. Env changes apply only to _new_ deployments.
2. **`GET /api/health`** → `{ "ok": true }`. Confirms the deploy is live at all
   (deliberately DB-free, so it proves nothing about Supabase).
3. **Load the dashboard and connect WHOOP.** Exercises `WHOOP_CLIENT_ID`,
   `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `TOKEN_ENCRYPTION_KEY` — the callback
   encrypts tokens with (7) and writes them via (5). A green "Connected"
   card means all six work.
4. **Trigger a sync by hand** (the `curl` above). Exercises `CRON_SECRET`.
   **This is the step the old checklist had no equivalent for**, and its
   absence is exactly how an unset `CRON_SECRET` survived to production.
5. **Reload the dashboard.** Charts should now render real values. Empty tiles
   here with steps 1–4 green means the sync ran but returned nothing — check
   the counts in the step-4 response body.

**Reading the chart states as a diagnostic** — the tiles discriminate failure
modes for free, so check them before digging into logs:

| Tile shows           | Meaning                                                      |
| -------------------- | ------------------------------------------------------------ |
| "Connect your WHOOP" | 401 — no valid session cookie                                |
| "Couldn't load…"     | non-OK response — 503 waking DB, or a missing/wrong (4)/(5)  |
| "no data yet" / "—"  | request **succeeded**; the data is genuinely absent/unscored |

That third row is the one to internalize: it means the frontend, the API, and
Supabase are all healthy and the problem is upstream in the sync — a missing
`CRON_SECRET`, a cron that never fired, or a member with no scored days yet.
