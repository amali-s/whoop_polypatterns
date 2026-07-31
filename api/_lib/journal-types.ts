// Daily-journal types (Phase 5.1 — the type layer for the questionnaire).
//
// These mirror `supabase/migrations/0004_daily_questionnaire_schema.sql`
// column-for-column (names, nullability, and the closed vocabularies inside
// each CHECK constraint). They are the ONE source of truth shared by Phase
// 5.2's form and Phase 5.3's API route — neither should redeclare an answer
// shape locally. When the migration changes, change this file in the same
// commit.
//
// It lives beside whoop-types.ts / transforms.ts because the frontend already
// imports types from api/_lib (see src/hooks/useDailySeries.ts and the combo
// charts); nothing here is server-only.
//
// NULL DISCIPLINE (the reason most fields are `| null`):
//   Every answer column is nullable and NULL means NOT ANSWERED — never 0,
//   never false, never 'none'. `cramps: null` and `cramps: 'none'` are
//   different facts, and so are `caffeine_servings: null` and `0`. The
//   `period` field carries the strongest form of this rule; see PeriodAnswer.
//
// PURITY: type declarations and frozen literal constants only — no I/O, no
// logic. The single import is TYPE-ONLY (erased at build) and exists purely to
// make a divergence from src/lib/cycle.ts a compile error; see the guards at
// the bottom of this file.

import type { PeriodLog } from '../../src/lib/cycle';

// ── The eight questions ──────────────────────────────────────────────────────
/**
 * The locked question set and its display order, read off `journal-stub-list`
 * in `src/App.tsx` (the Figma-confirmed journal tile). Phase 5.2 renders these
 * in this order rather than inventing its own; the `key` is the DB column.
 */
export const JOURNAL_QUESTIONS = [
  { key: 'hydrated', label: 'Hydrated' },
  { key: 'cramps', label: 'Cramps' },
  { key: 'period', label: 'Period' },
  { key: 'discharge', label: 'Discharge' },
  { key: 'afternoon_snack', label: 'Afternoon snack' },
  { key: 'traveled', label: 'Traveled' },
  { key: 'caffeine_servings', label: 'Caffeine' },
  { key: 'alcohol_drinks', label: 'Alcohol' },
] as const;

/** Column name of one of the eight questions. */
export type JournalQuestionKey = (typeof JOURNAL_QUESTIONS)[number]['key'];

// ── Answer vocabularies ──────────────────────────────────────────────────────
/**
 * An EXPLICIT period answer. The stored column is `PeriodAnswer | null`, where
 * `null` means NOT LOGGED — the journal was never filled in for that day — and
 * is deliberately distinct from an explicit `'no'` (Phase 4.10's hard
 * constraint). Never coerce the null away: `src/lib/cycle.ts` infers cycle
 * starts from explicit `'yes'` days, and a fabricated `'no'` is evidence the
 * user never gave.
 */
export type PeriodAnswer = 'yes' | 'no';

/**
 * Cramp intensity, ORDERED from least to most severe. This array is the single
 * source of that ordering — charts and form controls index into it rather than
 * hardcoding a sequence (the DB CHECK constrains the vocabulary, not its
 * order). `'none'` is an answered "no cramps"; unanswered is `null`.
 */
export const CRAMP_LEVELS = ['none', 'mild', 'moderate', 'severe'] as const;
export type CrampLevel = (typeof CRAMP_LEVELS)[number];

/**
 * Discharge AMOUNT, ordered least to most (not a texture vocabulary — see the
 * 0004 migration header for why). `'none'` is an answered "none"; unanswered
 * is `null`.
 */
export const DISCHARGE_LEVELS = ['none', 'light', 'moderate', 'heavy'] as const;
export type DischargeLevel = (typeof DISCHARGE_LEVELS)[number];

// ── Numeric bounds (mirror the CHECK constraints in 0004) ───────────────────
// Typo guards, not health guidance. Phase 5.2 validates against these so the
// form rejects a bad value before the DB does — keep them in step with the
// migration's CHECKs; a mismatch means a form that submits rows the DB refuses.
export const CAFFEINE_SERVINGS_MIN = 0;
export const CAFFEINE_SERVINGS_MAX = 20;
export const ALCOHOL_DRINKS_MIN = 0;
export const ALCOHOL_DRINKS_MAX = 30;
export const TYPICAL_CYCLE_LENGTH_MIN = 15;
export const TYPICAL_CYCLE_LENGTH_MAX = 90;

// ── daily_questionnaire ──────────────────────────────────────────────────────
/**
 * The eight answers plus the two free-form fields — i.e. everything a day's
 * entry can say. Split out from the row identity below so 5.2's form state and
 * 5.3's upsert payload can both be exactly this, with no id/timestamp fields
 * to invent. Every field nullable: a partially filled journal is normal, and
 * `null` is "not answered", not "answered negatively".
 */
export interface JournalAnswers {
  /** Self-assessed "felt hydrated". */
  hydrated: boolean | null;
  cramps: CrampLevel | null;
  /** Tri-state: `null` = NOT LOGGED, never "no". */
  period: PeriodAnswer | null;
  discharge: DischargeLevel | null;
  afternoon_snack: boolean | null;
  traveled: boolean | null;
  /** Count of caffeinated drinks; `0` is an answered "none". */
  caffeine_servings: number | null;
  /** Count of alcoholic drinks; `0` is an answered "none". */
  alcohol_drinks: number | null;
  /** Free-text note for the day. */
  notes: string | null;
  /**
   * Escape hatch for questions added after 0004, so a new one needs no
   * migration. Untyped by design — anything that earns a stable shape earns a
   * real column instead.
   */
  extra: Record<string, unknown> | null;
}

/**
 * One `public.daily_questionnaire` row as it comes back from Supabase.
 * `unique (user_id, day)` means at most one per day, so writes are upserts on
 * that pair.
 */
export interface DailyQuestionnaireRow extends JournalAnswers {
  id: string;
  /** WHOOP member id, stored as text (0001's convention — not numeric). */
  user_id: string;
  /** Local calendar day, ISO 'YYYY-MM-DD' — the same day key the WHOOP tables use. */
  day: string;
  /** RFC-3339 timestamp. */
  created_at: string;
  /** RFC-3339 timestamp; set by the write path on upsert (no DB trigger). */
  updated_at: string;
}

// ── user_settings ────────────────────────────────────────────────────────────
/**
 * One `public.user_settings` row: once-asked scalars, one row per user.
 * Separate from `whoop_tokens` on purpose (that table is a credential store).
 */
export interface UserSettingsRow {
  user_id: string;
  /**
   * User-reported typical cycle length in days, asked ONCE on the first logged
   * period and NEVER defaulted to 28. `null` = never answered, which the
   * period meter renders honestly (day number only, no denominator).
   *
   * FALLBACK ONLY: once ≥2 logged episodes exist, `estimateCycleLength()` in
   * `src/lib/cycle.ts` takes precedence and `cycleState()` reports
   * `lengthSource: 'estimated'`. Pass this straight into `PeriodMeterTile`'s
   * `typicalCycleLength` prop — `cycleState()` already implements the
   * precedence, so callers must not pre-resolve it themselves.
   */
  typical_cycle_length: number | null;
  /**
   * When the once-only question was shown, answered or not — so a dismissal
   * doesn't turn into a prompt on every future period day. RFC-3339, or `null`
   * if it has never been shown.
   */
  typical_cycle_length_asked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Compile-time contract with src/lib/cycle.ts ──────────────────────────────
/** Fails to compile unless `Actual` is assignable to `Expected`. */
type AssertAssignable<Expected, Actual extends Expected> = Actual;

/**
 * The two guards below are mutual, so together they assert that this file's
 * period type and `PeriodLog['period']` are the SAME type — not merely
 * overlapping. If either side gains or loses a member (say a `'spotting'`
 * answer), one of these stops compiling and `npm run typecheck:api` fails,
 * instead of the mismatch surfacing as a silently mis-detected cycle.
 * Zero runtime cost: type aliases only.
 */
export type PeriodAnswerIsCycleCompatible = AssertAssignable<
  PeriodLog['period'],
  PeriodAnswer | null
>;
export type CyclePeriodIsAnswerCompatible = AssertAssignable<
  PeriodAnswer | null,
  PeriodLog['period']
>;
