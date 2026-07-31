-- ============================================================================
-- 0004_daily_questionnaire_schema.sql — the real questionnaire schema (Phase 5.1)
-- ============================================================================
-- 0001_init.sql created `daily_questionnaire` with an explicit PLACEHOLDER
-- column set (mood / soreness / stress / motivation Likerts + an `alcohol`
-- boolean) and said so in its own comment: "Columns are placeholders (Phase
-- 5.1)". This file replaces those placeholders with the FINAL question set and
-- adds the once-per-user cycle-length store the period meter needs.
--
-- QUESTION SET — LOCKED DESIGN, NOT A PROPOSAL
--   The eight questions come from `journal-stub-list` in `src/App.tsx`
--   (the Figma-confirmed journal tile, design.md §3): Hydrated, Cramps,
--   Period, Discharge, Afternoon snack, Traveled, Caffeine, Alcohol — in that
--   order. The placeholder Likerts are dropped rather than kept alongside:
--   they are not on the confirmed list, and a column nothing will ever write
--   is worse than no column (Phase 5.5 would have to explain the empties).
--
-- DROPPING PLACEHOLDER COLUMNS IS SAFE HERE
--   Nothing has ever written this table: the only references to
--   `daily_questionnaire` in the repo are 0001 itself and documentation
--   (verified 2026-07-29), the form is Phase 5.2 and the write path Phase 5.3.
--   So the drops below cannot lose data. They are NOT a precedent for
--   destructive migrations on the synced WHOOP tables, which hold real rows.
--
-- COLUMN-TYPE REASONING (one line of intent per question — the point of 5.1)
--   The form is a once-a-day, thumb-on-phone checklist, so the default answer
--   shape is a single tap. A question earns something richer than a boolean
--   only when the extra taps buy signal that Phase 5.5's correlation charts
--   would otherwise lose.
--
--     hydrated          boolean   The locked label is a self-assessed STATE
--                                 ("Hydrated"), not a count of glasses. Yes/no
--                                 respects the label; a litres field would be
--                                 a different question than the one designed.
--     cramps            text      Closed vocabulary none/mild/moderate/severe.
--                                 Intensity is the whole signal — "had cramps"
--                                 flattens a twinge and a day off work into
--                                 one value, and cramp severity is exactly
--                                 what a user would want plotted against
--                                 recovery. Four levels, not a 1-5 Likert:
--                                 five self-reported gradations of pain are
--                                 not reliably distinguishable day to day, and
--                                 four chips fit one mobile row.
--     period            text      TRI-STATE. See its own section below.
--     discharge         text      Closed vocabulary none/light/moderate/heavy
--                                 — AMOUNT, deliberately not a texture
--                                 vocabulary (sticky/creamy/egg-white/...).
--                                 See the ambiguity note below.
--     afternoon_snack   boolean   A binary event: it happened or it didn't.
--     traveled          boolean   Same — a day is a travel day or it is not.
--                                 (What KIND of travel, if it ever matters,
--                                 belongs in `extra`, not a new column.)
--     caffeine_servings smallint  DOSE, not presence. "Had caffeine" is true
--                                 on almost every day for most people, which
--                                 makes it useless as a correlate; one espresso
--                                 vs. four is the thing that moves HRV and
--                                 sleep. 0 = none (an answered "no caffeine"),
--                                 so the boolean case is still one tap.
--     alcohol_drinks    smallint  Same dose reasoning, more so — WHOOP
--                                 recovery is famously alcohol-sensitive, and
--                                 one drink vs. five is a different day.
--                                 Replaces 0001's `alcohol boolean`.
--     notes             text      Free text (already in 0001, restated below).
--     extra             jsonb     Escape hatch (already in 0001): anything
--                                 added later lands here first and only earns
--                                 a real column once it proves it deserves one.
--
--   The three closed vocabularies are TEXT, not smallint codes, so that a raw
--   `select * from daily_questionnaire` is readable without a codebook and the
--   TypeScript unions in api/_lib/journal-types.ts mirror the stored values
--   literally. Display order for the ordinals lives in that file
--   (CRAMP_LEVELS / DISCHARGE_LEVELS) — the single source of ordering.
--
--   Every CHECK below constrains the VOCABULARY only. A CHECK is satisfied by
--   NULL (null → unknown → not a violation), so "not answered" stays
--   representable on every column without a single nullable-workaround.
--
-- AMBIGUITY, RESOLVED EXPLICITLY (not covered by the stub list or the two
-- hard constraints — recorded here and in ROADMAP 5.1 rather than picked
-- silently): the stub list says only "Discharge", with no confirmed answer
-- vocabulary. Amount (none/light/moderate/heavy) was chosen over a
-- fertility-awareness TEXTURE vocabulary because it reuses the same four-chip
-- control as `cramps` (one form idiom, not two), needs no user training, and
-- because texture tracking is a feature nobody has asked for. If texture is
-- wanted later it goes into `extra` first — no migration needed.
--
-- OTHER DESIGN NOTES
--   * `unique (user_id, day)` (from 0001) is untouched: one row per day, so
--     "edit today" is an upsert. `id`, `user_id`, `day`, `created_at`,
--     `updated_at` are untouched too.
--   * `period` is a NON-RESERVED keyword in PostgreSQL, so it needs no
--     quoting (unlike `"end"` in 0003, which is reserved).
--   * Row Level Security is ENABLED on the new table with no policies, exactly
--     like every other table in this repo — deny-by-default for the anon key,
--     while `/api`'s service-role client (lib/supabase.ts) bypasses RLS. See
--     0001's DESIGN NOTES.
--   * `updated_at` has no trigger, matching 0001: the write path (5.3) sets it
--     on upsert.
--   * Idempotent: safe to re-run. Column changes use IF EXISTS / IF NOT
--     EXISTS; CHECK constraints are dropped-then-added by name, since
--     PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto (daily_questionnaire.id defaults to it).
-- Enabled by default on Supabase, but be explicit so this file is portable —
-- same as 0001.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- daily_questionnaire — drop the 0001 placeholders
-- ----------------------------------------------------------------------------
alter table public.daily_questionnaire
  drop column if exists mood,
  drop column if exists soreness,
  drop column if exists stress,
  drop column if exists motivation,
  -- Superseded by alcohol_drinks below (dose, not presence).
  drop column if exists alcohol;

-- ----------------------------------------------------------------------------
-- daily_questionnaire — the real question set, in the locked stub-list order
-- ----------------------------------------------------------------------------
alter table public.daily_questionnaire
  add column if not exists hydrated          boolean,
  add column if not exists cramps            text,
  add column if not exists period            text,
  add column if not exists discharge         text,
  add column if not exists afternoon_snack   boolean,
  add column if not exists traveled          boolean,
  add column if not exists caffeine_servings smallint,
  add column if not exists alcohol_drinks    smallint,
  -- Already created by 0001; restated so this file describes the whole table.
  add column if not exists notes             text,
  add column if not exists extra             jsonb;

-- ── The tri-state Period column (HARD CONSTRAINT 1) ─────────────────────────
-- Stored as TEXT 'yes' / 'no', with NULL (or an absent row) meaning NOT
-- LOGGED. Chosen over a nullable boolean for two reasons:
--
--   1. It mirrors `src/lib/cycle.ts`'s `PeriodLog` contract
--      (`period: 'yes' | 'no' | null`) VERBATIM, so the 5.3 read path hands
--      rows to the period meter with no mapping layer to get wrong.
--   2. A boolean invites exactly the bug this constraint forbids:
--      `coalesce(period, false)` reads as harmless tidying but silently
--      converts "the user never opened the journal" into "no period today".
--      There is no comparable one-liner that turns NULL into 'no'.
--
-- Why the distinction is load-bearing: the period meter infers cycle starts
-- from the gaps between explicit 'yes' days (design.md's cycle-start-detection
-- rule, EPISODE_GAP_DAYS = 3). 'no' and NULL are treated IDENTICALLY for
-- grouping, so neither can split one period in two — but a NULL coerced to
-- 'no' would be indistinguishable from evidence, and any future rule that does
-- trust explicit 'no' days would then be reading fabricated answers.
-- NEVER default this column, and never write 'no' to mean "unanswered".
alter table public.daily_questionnaire
  drop constraint if exists daily_questionnaire_period_check;
alter table public.daily_questionnaire
  add constraint daily_questionnaire_period_check
  check (period in ('yes', 'no'));

-- ── Closed vocabularies + plausible-range guards ────────────────────────────
alter table public.daily_questionnaire
  drop constraint if exists daily_questionnaire_cramps_check;
alter table public.daily_questionnaire
  add constraint daily_questionnaire_cramps_check
  check (cramps in ('none', 'mild', 'moderate', 'severe'));

alter table public.daily_questionnaire
  drop constraint if exists daily_questionnaire_discharge_check;
alter table public.daily_questionnaire
  add constraint daily_questionnaire_discharge_check
  check (discharge in ('none', 'light', 'moderate', 'heavy'));

-- Upper bounds are typo guards ("20" for a mistyped 2), not health guidance.
-- They match CAFFEINE_SERVINGS_MAX / ALCOHOL_DRINKS_MAX in
-- api/_lib/journal-types.ts — change both together.
alter table public.daily_questionnaire
  drop constraint if exists daily_questionnaire_caffeine_servings_check;
alter table public.daily_questionnaire
  add constraint daily_questionnaire_caffeine_servings_check
  check (caffeine_servings between 0 and 20);

alter table public.daily_questionnaire
  drop constraint if exists daily_questionnaire_alcohol_drinks_check;
alter table public.daily_questionnaire
  add constraint daily_questionnaire_alcohol_drinks_check
  check (alcohol_drinks between 0 and 30);

comment on table public.daily_questionnaire is
  'Subjective daily journal, one row per (user_id, day). Final question set from the locked journal tile (0004, Phase 5.1). Every answer column is nullable and NULL means NOT ANSWERED.';

comment on column public.daily_questionnaire.hydrated is
  'Self-assessed "felt hydrated" yes/no. NULL = not answered.';
comment on column public.daily_questionnaire.cramps is
  'Cramp intensity: none | mild | moderate | severe. NULL = not answered (distinct from ''none'').';
comment on column public.daily_questionnaire.period is
  'TRI-STATE, Phase 4.10 hard constraint: ''yes'' | ''no'' | NULL, where NULL = NOT LOGGED. Never coerce NULL to ''no'' / false — the cycle-start inference in src/lib/cycle.ts depends on the difference.';
comment on column public.daily_questionnaire.discharge is
  'Discharge amount: none | light | moderate | heavy (amount, not texture — see 0004 header). NULL = not answered.';
comment on column public.daily_questionnaire.afternoon_snack is
  'Whether an afternoon snack happened. NULL = not answered.';
comment on column public.daily_questionnaire.traveled is
  'Whether the day involved travel. NULL = not answered.';
comment on column public.daily_questionnaire.caffeine_servings is
  'Caffeinated drinks, count. 0 = an answered "none". NULL = not answered. Dose, not presence — see 0004 header.';
comment on column public.daily_questionnaire.alcohol_drinks is
  'Alcoholic drinks, count. 0 = an answered "none". NULL = not answered. Replaces 0001''s placeholder alcohol boolean.';
comment on column public.daily_questionnaire.notes is
  'Free-text note for the day. Optional.';
comment on column public.daily_questionnaire.extra is
  'Escape hatch for questions added after 0004 — land them here before spending a migration on a column.';

-- ----------------------------------------------------------------------------
-- user_settings — one row per user for once-asked scalars (HARD CONSTRAINT 2)
-- ----------------------------------------------------------------------------
-- `typical_cycle_length` is asked ONCE, on the user's first logged period, and
-- is never defaulted to 28 (user decision 2026-07-18; design.md's
-- cycle-start-detection rule #5). It is therefore NOT a per-day answer and has
-- no business in daily_questionnaire, where it would be re-asked or duplicated
-- across every row.
--
-- Why a new table rather than reusing `whoop_tokens` (the only existing
-- one-row-per-user table): whoop_tokens is a CREDENTIAL store whose own
-- comment says it holds ciphertext only, written by the OAuth/refresh path.
-- Hanging a user preference off it would mean the questionnaire's write path
-- touches the token row, and a settings bug could damage auth. Keep secrets
-- and preferences in separate tables.
--
-- Deliberately named user_settings (not user_profile / cycle_settings): the
-- next once-only scalar — a reminder time for 5.4, a units preference — lands
-- here as another nullable column instead of another table.
create table if not exists public.user_settings (
  user_id                       text        primary key,
  -- NULL = never answered. The period meter renders text-only ("Day 6", no
  -- denominator, no dot row) rather than assuming a length — an assumed
  -- 28-dot row is never rendered.
  typical_cycle_length          smallint,
  -- When the once-only question was PUT to the user, independent of whether
  -- they answered it. Lets 5.2 honour "asked once" even if the user dismisses
  -- the prompt, instead of re-asking on every subsequent period day.
  typical_cycle_length_asked_at timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- Deliberately wide sanity bounds, not clinical guidance: a typo guard only.
-- Matches TYPICAL_CYCLE_LENGTH_MIN / _MAX in api/_lib/journal-types.ts.
alter table public.user_settings
  drop constraint if exists user_settings_typical_cycle_length_check;
alter table public.user_settings
  add constraint user_settings_typical_cycle_length_check
  check (typical_cycle_length between 15 and 90);

comment on table public.user_settings is
  'One row per user for once-asked scalars (0004, Phase 5.1). NOT a credential store — see whoop_tokens for those.';
comment on column public.user_settings.typical_cycle_length is
  'User-reported typical cycle length in days. Asked ONCE, on the first logged period. NEVER defaulted to 28. FALLBACK ONLY: once >=2 logged episodes exist, estimateCycleLength() in src/lib/cycle.ts (mean start-to-start gap) takes precedence and cycleState() reports lengthSource = ''estimated'' instead of ''user-reported''. NULL = never answered.';
comment on column public.user_settings.typical_cycle_length_asked_at is
  'When the once-only cycle-length question was shown, answered or not — so it is not re-asked. NULL = never shown.';

alter table public.user_settings enable row level security;
