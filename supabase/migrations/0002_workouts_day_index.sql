-- ============================================================================
-- 0002_workouts_day_index.sql — index for workout day-range chart queries
-- ============================================================================
-- whoop_cycles/whoop_recovery/whoop_sleep get an index on (user_id, day) for
-- free from their `unique (user_id, day)` constraint. whoop_workouts is unique
-- on (user_id, whoop_id) instead (see 0001_init.sql — a day can have several
-- workouts), so it has no index supporting the same day-range chart queries.
-- This adds one explicitly.
--
--   * Idempotent: safe to re-run (CREATE INDEX IF NOT EXISTS).
-- ============================================================================

create index if not exists whoop_workouts_user_day_idx
  on public.whoop_workouts (user_id, day);
