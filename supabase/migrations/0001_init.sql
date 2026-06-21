-- ============================================================================
-- 0001_init.sql — initial schema for the WHOOP dashboard
-- ============================================================================
-- Phase 0 scaffolding. Creates the token store, placeholder tables for synced
-- WHOOP data (Phase 2.4 shapes), and the daily questionnaire (Phase 5.3).
--
-- DESIGN NOTES
--   * Single-user app today, but every row carries a `user_id` so the schema
--     does not need reshaping if multi-user is ever added. `user_id` is the
--     WHOOP member id (stored as text — do not assume it is numeric).
--   * Synced WHOOP tables keep a `raw jsonb` column holding the full API
--     payload. The WHOOP API v2 field names are NOT yet confirmed against live
--     responses (see ROADMAP Phase 2.2 — "generate from real payloads, not
--     from memory"), so we intentionally avoid inventing typed columns now.
--     Phase 2 will add typed/generated columns once real payloads are seen.
--   * Row Level Security is ENABLED on every table. No policies are created,
--     which means: with RLS on and no policy, the anon/authenticated roles get
--     ZERO access by default (deny-by-default). The /api functions use the
--     SERVICE ROLE key (see lib/supabase.ts), which BYPASSES RLS — so the
--     server keeps full access while the browser is locked out. If frontend
--     code is ever pointed at Supabase with the anon key, add explicit RLS
--     policies at that point.
--   * Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS, etc.).
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto; enabled by default on Supabase, but be
-- explicit so this file is portable.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- whoop_tokens — encrypted OAuth token storage (Phase 1.4)
-- ----------------------------------------------------------------------------
-- Stores CIPHERTEXT only, never raw WHOOP tokens. The access/refresh tokens are
-- encrypted with lib/crypto.ts (AES-256-GCM) before insert; each column holds
-- the self-describing "base64(iv):base64(tag):base64(ciphertext)" string.
create table if not exists public.whoop_tokens (
  user_id                  text        primary key,
  access_token_encrypted   text        not null,
  refresh_token_encrypted  text        not null,
  -- Absolute expiry of the access token, so refresh logic (Phase 1.5) can act
  -- before it lapses. The token TTL itself is not yet confirmed (ROADMAP 1.5).
  expires_at               timestamptz,
  scope                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.whoop_tokens is
  'Encrypted WHOOP OAuth tokens (ciphertext only). Written by /api, server-side.';
comment on column public.whoop_tokens.access_token_encrypted is
  'AES-256-GCM ciphertext from lib/crypto.ts (iv:tag:ciphertext). Never plaintext.';
comment on column public.whoop_tokens.refresh_token_encrypted is
  'AES-256-GCM ciphertext from lib/crypto.ts (iv:tag:ciphertext). Never plaintext.';

alter table public.whoop_tokens enable row level security;

-- ----------------------------------------------------------------------------
-- Synced WHOOP data (Phase 2.4) — placeholder tables, one row per record/day.
-- ----------------------------------------------------------------------------
-- Each table is keyed by (user_id, day) for one logical record per day, keeps
-- the WHOOP record id for upserts/webhooks, and stores the full payload in
-- `raw`. Typed columns are deferred to Phase 2 (see DESIGN NOTES above).

-- Physiological cycles / day strain.
create table if not exists public.whoop_cycles (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  whoop_id    text,                       -- WHOOP's own record id (for upsert)
  day         date        not null,       -- date key for chart history
  raw         jsonb       not null,       -- full v2 payload (field names TBD)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
comment on table public.whoop_cycles is
  'WHOOP cycles/strain, one row per day. Placeholder: payload in raw jsonb (Phase 2.4).';

-- Recovery (recovery %, HRV, RHR).
create table if not exists public.whoop_recovery (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  whoop_id    text,
  day         date        not null,
  raw         jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
comment on table public.whoop_recovery is
  'WHOOP recovery, one row per day. Placeholder: payload in raw jsonb (Phase 2.4).';

-- Sleep (stages, performance).
create table if not exists public.whoop_sleep (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  whoop_id    text,
  day         date        not null,
  raw         jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
comment on table public.whoop_sleep is
  'WHOOP sleep, one row per day. Placeholder: payload in raw jsonb (Phase 2.4).';

-- Workouts. A day can have several, so the natural key is the WHOOP record id
-- rather than (user_id, day); `day` is kept for date-range chart queries.
create table if not exists public.whoop_workouts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  whoop_id    text        not null,
  day         date        not null,
  raw         jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, whoop_id)
);
comment on table public.whoop_workouts is
  'WHOOP workouts, one row per workout. Placeholder: payload in raw jsonb (Phase 2.4).';

alter table public.whoop_cycles   enable row level security;
alter table public.whoop_recovery enable row level security;
alter table public.whoop_sleep    enable row level security;
alter table public.whoop_workouts enable row level security;

-- ----------------------------------------------------------------------------
-- daily_questionnaire (Phase 5.3) — subjective daily inputs, one row per day.
-- ----------------------------------------------------------------------------
-- Keyed by (user_id, day) to enforce one entry per day (edit-today = upsert).
-- The exact question set is finalized in Phase 5.1; the Likert columns below
-- are a reasonable placeholder, and `extra` jsonb holds anything added later
-- without a migration. Joined to WHOOP data on (user_id, day) in Phase 5.5.
create table if not exists public.daily_questionnaire (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  day         date        not null,
  mood        smallint,                   -- Likert 1-5 (placeholder)
  soreness    smallint,                   -- Likert 1-5 (placeholder)
  stress      smallint,                   -- Likert 1-5 (placeholder)
  motivation  smallint,                   -- Likert 1-5 (placeholder)
  alcohol     boolean,                    -- placeholder
  notes       text,
  extra       jsonb,                      -- room for new questions (Phase 5.1)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
comment on table public.daily_questionnaire is
  'Subjective daily questionnaire, one row per day. Columns are placeholders (Phase 5.1).';

alter table public.daily_questionnaire enable row level security;
