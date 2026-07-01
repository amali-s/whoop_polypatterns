// WHOOP API v2 response types (Phase 2.2 — the type layer for api/_lib/whoop.ts).
//
// These interfaces are the DEFAULT record types for the generic fetch helpers in
// whoop.ts (e.g. getCycles<T = WhoopCycle>). They describe ONE record of each
// collection / one single-object response — NOT the pagination envelope, which
// lives in whoop.ts as WhoopCollection<T> / WhoopPage<T> and is reused as-is.
//
// VERIFIED AGAINST LIVE PAYLOAD (captured 2026-06-30):
//   Source: a real call to each of the six v2 endpoints for a connected member,
//   via scripts/capture-whoop-samples.mjs → whoop-samples/ (gitignored; raw
//   personal health data, never committed). Every field name, casing, nesting,
//   and primitive type below was read off that captured JSON, not from WHOOP's
//   docs or from memory. Where a single sample isn't enough to be sure (a field
//   that was null, or a state we never observed), it is flagged with
//   `TODO(verify)` rather than guessed silently.
//
//   Caveats from a single-sample capture (see also the per-field TODOs):
//     - Only score_state === 'SCORED' was observed live. The non-SCORED arm of
//       each discriminated union (score === null) follows WHOOP's documented
//       state contract but was NOT seen in this capture.
//     - Date-time fields are RFC-3339 strings (e.g. "2026-06-30T03:25:30.180Z");
//       typed as `string` and named `…At` / start / end by WHOOP's convention.
//     - timezone_offset is a UTC-offset string like "-05:00" (not minutes).

// ── Score state (gates whether `score` is populated) ─────────────────────────
/**
 * The scoring lifecycle of a cycle/recovery/sleep/workout record. When a record
 * is 'SCORED', its `score` object is populated; otherwise WHOOP returns
 * `score: null` (the record exists but hasn't been/can't be scored).
 *
 * Only 'SCORED' was observed in the 2026-06-30 capture. 'PENDING_SCORE' and
 * 'UNSCORABLE' are WHOOP's documented states for in-progress / unscorable
 * records and are included so the unions below stay total.
 * TODO(verify): capture a PENDING_SCORE / UNSCORABLE record to confirm the
 * literal strings and that `score` is `null` (vs omitted) in those states.
 */
export type WhoopScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';

// ── Profile (GET /v2/user/profile/basic) ─────────────────────────────────────
export interface WhoopProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

// ── Body measurement (GET /v2/user/measurement/body) ─────────────────────────
export interface WhoopBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  /** Integer bpm. */
  max_heart_rate: number;
}

// ── Cycle (GET /v2/cycle) ────────────────────────────────────────────────────
export interface WhoopCycleScore {
  strain: number;
  kilojoule: number;
  /** Integer bpm. */
  average_heart_rate: number;
  /** Integer bpm. */
  max_heart_rate: number;
}

/** Fields present on every cycle regardless of score_state. */
interface WhoopCycleBase {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  /**
   * `null` for the current, still-in-progress cycle (the one captured here had
   * no end yet); an RFC-3339 string once the cycle closes.
   * TODO(verify): only seen null in one sample — confirm with a second payload
   * (i.e. capture a completed cycle to confirm the string form).
   */
  end: string | null;
  /** UTC offset string, e.g. "-05:00". */
  timezone_offset: string;
}

export type WhoopCycle =
  | (WhoopCycleBase & { score_state: 'SCORED'; score: WhoopCycleScore })
  // TODO(verify): non-SCORED arm not observed in the 2026-06-30 capture.
  | (WhoopCycleBase & { score_state: 'PENDING_SCORE' | 'UNSCORABLE'; score: null });

// ── Recovery (GET /v2/recovery) ──────────────────────────────────────────────
export interface WhoopRecoveryScore {
  user_calibrating: boolean;
  /** Integer percentage 0..100. */
  recovery_score: number;
  /** Integer bpm. */
  resting_heart_rate: number;
  hrv_rmssd_milli: number;
  /** Present from WHOOP 4.0+ sensors; observed populated in the capture. */
  spo2_percentage: number;
  /** Present from WHOOP 4.0+ sensors; observed populated in the capture. */
  skin_temp_celsius: number;
}

/** Recovery has no id of its own; it is keyed by the cycle/sleep it scores. */
interface WhoopRecoveryBase {
  cycle_id: number;
  /** Sleep UUID this recovery is derived from. */
  sleep_id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
}

export type WhoopRecovery =
  | (WhoopRecoveryBase & { score_state: 'SCORED'; score: WhoopRecoveryScore })
  // TODO(verify): non-SCORED arm not observed in the 2026-06-30 capture.
  | (WhoopRecoveryBase & { score_state: 'PENDING_SCORE' | 'UNSCORABLE'; score: null });

// ── Sleep (GET /v2/activity/sleep) ───────────────────────────────────────────
export interface WhoopSleepStageSummary {
  total_in_bed_time_milli: number;
  total_awake_time_milli: number;
  total_no_data_time_milli: number;
  total_light_sleep_time_milli: number;
  total_slow_wave_sleep_time_milli: number;
  total_rem_sleep_time_milli: number;
  sleep_cycle_count: number;
  disturbance_count: number;
}

export interface WhoopSleepNeeded {
  baseline_milli: number;
  need_from_sleep_debt_milli: number;
  need_from_recent_strain_milli: number;
  need_from_recent_nap_milli: number;
}

export interface WhoopSleepScore {
  stage_summary: WhoopSleepStageSummary;
  sleep_needed: WhoopSleepNeeded;
  respiratory_rate: number;
  /** Integer percentage 0..100. */
  sleep_performance_percentage: number;
  /** Integer percentage 0..100. */
  sleep_consistency_percentage: number;
  sleep_efficiency_percentage: number;
}

interface WhoopSleepBase {
  /** Sleep UUID. */
  id: string;
  cycle_id: number;
  /**
   * Legacy v1 numeric id of this sleep (null for records with no v1 ancestor).
   * TODO(verify): only seen null in one sample — confirm with a second payload
   * (in particular that the populated form is a number, per the v1 id scheme).
   */
  v1_id: number | null;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  /** UTC offset string, e.g. "-05:00". */
  timezone_offset: string;
  nap: boolean;
}

export type WhoopSleep =
  | (WhoopSleepBase & { score_state: 'SCORED'; score: WhoopSleepScore })
  // TODO(verify): non-SCORED arm not observed in the 2026-06-30 capture.
  | (WhoopSleepBase & { score_state: 'PENDING_SCORE' | 'UNSCORABLE'; score: null });

// ── Workout (GET /v2/activity/workout) ───────────────────────────────────────
export interface WhoopWorkoutZoneDurations {
  zone_zero_milli: number;
  zone_one_milli: number;
  zone_two_milli: number;
  zone_three_milli: number;
  zone_four_milli: number;
  zone_five_milli: number;
}

export interface WhoopWorkoutScore {
  strain: number;
  /** Integer bpm. */
  average_heart_rate: number;
  /** Integer bpm. */
  max_heart_rate: number;
  kilojoule: number;
  /** Fraction 0..1 of the workout that was recorded (1 in the capture). */
  percent_recorded: number;
  /**
   * null for activities without distance data (the captured pilates workout had
   * no GPS/distance).
   * TODO(verify): only seen null in one sample — confirm with a second payload
   * (e.g. a run) that the populated form is a number.
   */
  distance_meter: number | null;
  /**
   * null for indoor/no-GPS activities (see distance_meter).
   * TODO(verify): only seen null in one sample — confirm with a second payload.
   */
  altitude_gain_meter: number | null;
  /**
   * null for indoor/no-GPS activities (see distance_meter).
   * TODO(verify): only seen null in one sample — confirm with a second payload.
   */
  altitude_change_meter: number | null;
  zone_durations: WhoopWorkoutZoneDurations;
}

interface WhoopWorkoutBase {
  /** Workout UUID. */
  id: string;
  /**
   * Legacy v1 numeric id of this workout (null for records with no v1 ancestor).
   * TODO(verify): only seen null in one sample — confirm with a second payload
   * (in particular that the populated form is a number, per the v1 id scheme).
   */
  v1_id: number | null;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  /** UTC offset string, e.g. "-05:00". */
  timezone_offset: string;
  /** Human-readable sport name, e.g. "pilates". */
  sport_name: string;
  /** Numeric WHOOP sport id (e.g. 43 = pilates in the capture). */
  sport_id: number;
}

export type WhoopWorkout =
  | (WhoopWorkoutBase & { score_state: 'SCORED'; score: WhoopWorkoutScore })
  // TODO(verify): non-SCORED arm not observed in the 2026-06-30 capture.
  | (WhoopWorkoutBase & { score_state: 'PENDING_SCORE' | 'UNSCORABLE'; score: null });
