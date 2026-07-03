-- ============================================================================
-- 0003_typed_columns.sql — typed columns for the synced WHOOP tables (Phase 2.4)
-- ============================================================================
-- 0001_init.sql deliberately deferred typed columns until real payloads were
-- seen; api/_lib/whoop-types.ts has since been verified field-by-field against
-- a live 2026-06-30 capture (Phase 2.2), so these columns are read off that
-- type layer, not from memory.
--
-- DESIGN NOTES
--   * `raw jsonb` stays untouched as the source of truth / audit trail. Typed
--     columns are a READ optimization for the Phase 4 charts — never the only
--     home of a value.
--   * Every column is NULLABLE. Each record is a discriminated union on
--     score_state ('SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'); score-derived
--     columns are written NULL unless score_state = 'SCORED' (see
--     api/_lib/sync.ts row builders). Rows cached before this migration also
--     stay NULL until the next sync re-upserts them — backfill = re-run
--     `npm run sync:whoop` over the window you care about.
--   * "end" is quoted — END is a reserved word in SQL.
--   * Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- whoop_cycles — day strain (charts 4.2 combo, 4.6 strain matrix)
-- ----------------------------------------------------------------------------
alter table public.whoop_cycles
  add column if not exists score_state        text,
  add column if not exists strain             double precision,
  add column if not exists kilojoule          double precision,
  add column if not exists average_heart_rate smallint,
  add column if not exists max_heart_rate     smallint,
  add column if not exists start              timestamptz,
  add column if not exists "end"              timestamptz,  -- null while the cycle is in progress
  add column if not exists timezone_offset    text;         -- UTC-offset string, e.g. "-05:00"

comment on table public.whoop_cycles is
  'WHOOP cycles/strain, one row per day. Typed columns from raw (0003, Phase 2.4); raw jsonb remains the source of truth.';

-- ----------------------------------------------------------------------------
-- whoop_recovery — recovery %, HRV, RHR (charts 4.2, 4.3, 4.4 recovery calendar)
-- ----------------------------------------------------------------------------
alter table public.whoop_recovery
  add column if not exists score_state          text,
  add column if not exists recovery_score       smallint,          -- integer % 0..100
  add column if not exists resting_heart_rate   smallint,
  add column if not exists hrv_rmssd_milli      double precision,
  add column if not exists spo2_percentage      double precision,  -- WHOOP 4.0+ sensors
  add column if not exists skin_temp_celsius    double precision,  -- WHOOP 4.0+ sensors
  add column if not exists user_calibrating     boolean;

comment on table public.whoop_recovery is
  'WHOOP recovery, one row per day. Typed columns from raw (0003, Phase 2.4); raw jsonb remains the source of truth.';

-- ----------------------------------------------------------------------------
-- whoop_sleep — stages + performance (charts 4.1 stacked stages, 4.3, 4.5)
-- ----------------------------------------------------------------------------
alter table public.whoop_sleep
  add column if not exists score_state                      text,
  add column if not exists start                            timestamptz,
  add column if not exists "end"                            timestamptz,
  add column if not exists timezone_offset                  text,
  add column if not exists nap                              boolean,
  add column if not exists sleep_performance_percentage     smallint,          -- integer % 0..100
  add column if not exists sleep_efficiency_percentage      double precision,
  add column if not exists sleep_consistency_percentage     smallint,          -- integer % 0..100
  add column if not exists respiratory_rate                 double precision,
  add column if not exists total_light_sleep_time_milli     bigint,
  add column if not exists total_slow_wave_sleep_time_milli bigint,
  add column if not exists total_rem_sleep_time_milli       bigint,
  add column if not exists total_awake_time_milli           bigint,
  add column if not exists total_in_bed_time_milli          bigint,
  add column if not exists disturbance_count                integer,
  -- Not in the original 2.4 column list: chart 4.3's alternative mapping is
  -- "RHR line over sleep-debt area", and sleep debt lives only in
  -- score.sleep_needed — so surface it now rather than re-migrating later.
  add column if not exists need_from_sleep_debt_milli       bigint;

comment on table public.whoop_sleep is
  'WHOOP sleep, one row per day (main sleep; naps skipped by sync). Typed columns from raw (0003, Phase 2.4); raw jsonb remains the source of truth.';

-- ----------------------------------------------------------------------------
-- whoop_workouts — per-workout strain/load (chart 4.1 alt, range queries)
-- ----------------------------------------------------------------------------
alter table public.whoop_workouts
  add column if not exists score_state        text,
  add column if not exists start              timestamptz,
  add column if not exists "end"              timestamptz,
  add column if not exists timezone_offset    text,
  add column if not exists sport_name         text,
  add column if not exists sport_id           integer,
  add column if not exists strain             double precision,
  add column if not exists average_heart_rate smallint,
  add column if not exists max_heart_rate     smallint,
  add column if not exists kilojoule          double precision,
  add column if not exists distance_meter     double precision;  -- null for no-GPS activities even when SCORED

comment on table public.whoop_workouts is
  'WHOOP workouts, one row per workout. Typed columns from raw (0003, Phase 2.4); raw jsonb remains the source of truth.';
