// scripts/test-transforms.mjs
//
// Unit test for the Phase 2.6 chart-data transforms (api/_lib/transforms.ts).
// The module is pure (no imports, no I/O), so this script exercises the REAL
// functions against small hand-built fixture rows and asserts EXACT expected
// numbers — every expectation is hand-computed in the comments below, never a
// lazy "is not null".
//
// Coverage (per the Phase 2.6 brief):
//   * a normal fully-scored day               → real values
//   * a day with score_state !== 'SCORED'     → null, NOT 0
//   * kilojoule: SCORED surfaces it, PENDING → null (not a stale leak),
//     no cycle row at all → null
//   * a day missing from every collection      → appears with all-null fields
//   * a nap row                                → excluded from the stage breakdown
//                                                (and from the daily sleep fields)
//   * multiple workouts on one day             → aggregated, none dropped
//   * an unscored workout                      → count it, but null the strain sum
//   * millis → minutes rounding (round half-up)
//   * a rolling-baseline window that starts    → null until minSamples is met,
//     below minSamples                            then the trailing mean
//
// All fixture numbers are SYNTHETIC — no real personal health data.
//
// USAGE (from repo root):
//   npm run test:transforms      # = node scripts/test-transforms.mjs
//
// Node 24 strips the TypeScript types on import; transforms.ts is import-free so
// it loads without a bundler.

const { buildDailySeries, buildSleepStageBreakdown, buildRollingBaseline } =
  await import('../api/_lib/transforms.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}
/** Float-tolerant equality (means / sums of decimals). */
function approx(a, b) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

// ── Fixture builders (synthetic data only) ───────────────────────────────────
const MIN = 60_000; // ms per minute
const cycle = (day, score_state, strain, kilojoule = null) => ({
  day,
  score_state,
  strain,
  kilojoule,
  average_heart_rate: null,
  max_heart_rate: null,
  start: null,
  end: null,
  timezone_offset: null,
});
const recovery = (
  day,
  score_state,
  recovery_score,
  hrv_rmssd_milli,
  resting_heart_rate,
  skin_temp_celsius = null,
) => ({
  day,
  score_state,
  recovery_score,
  resting_heart_rate,
  hrv_rmssd_milli,
  spo2_percentage: null,
  skin_temp_celsius,
  user_calibrating: null,
});
const sleep = (day, score_state, { perf, awake, light, deep, rem, nap = false } = {}) => ({
  day,
  score_state,
  start: null,
  end: null,
  timezone_offset: null,
  nap,
  sleep_performance_percentage: perf ?? null,
  sleep_efficiency_percentage: null,
  sleep_consistency_percentage: null,
  respiratory_rate: null,
  total_light_sleep_time_milli: light ?? null,
  total_slow_wave_sleep_time_milli: deep ?? null,
  total_rem_sleep_time_milli: rem ?? null,
  total_awake_time_milli: awake ?? null,
  total_in_bed_time_milli: null,
  disturbance_count: null,
  need_from_sleep_debt_milli: null,
});
const workout = (day, score_state, strain) => ({
  day,
  score_state,
  start: null,
  end: null,
  timezone_offset: null,
  sport_name: null,
  sport_id: null,
  strain,
  average_heart_rate: null,
  max_heart_rate: null,
  kilojoule: null,
  distance_meter: null,
});

// ── Shared fixtures over the window 2026-06-01 .. 2026-06-05 ──────────────────
// 06-01 normal scored day; 06-02 cycle PENDING (strain must be null);
// 06-03 MISSING from every collection; 06-04 two workouts + a nap; 06-05 scored
// day whose only workout is unscored.
const cycles = [
  // 06-01 SCORED: strain 12.5 AND kilojoule 9000 both surface.
  cycle('2026-06-01', 'SCORED', 12.5, 9000),
  // 06-02 PENDING: sync writes null strain when not SCORED; the 8888 kJ here is
  // a deliberate STALE value the scored() gate must null (never leak, never 0).
  cycle('2026-06-02', 'PENDING_SCORE', null, 8888),
  cycle('2026-06-04', 'SCORED', 8.0),
  cycle('2026-06-05', 'SCORED', 15.0),
];
const recoveries = [
  recovery('2026-06-01', 'SCORED', 66, 45.2, 55, 33.9), // SCORED with a skin-temp reading
  // PENDING row carrying a STALE skin temp — the scored() gate must null it.
  recovery('2026-06-02', 'PENDING_SCORE', null, null, null, 34.5),
  recovery('2026-06-04', 'SCORED', 40, 30.0, 60), // SCORED, no reading (pre-4.0 hardware)
  recovery('2026-06-05', 'SCORED', 80, 60.0, 50),
];
// 06-01 awake = 1_230_000 ms = 20.5 min → rounds to 21 (round half-up).
const sleeps = [
  sleep('2026-06-01', 'SCORED', {
    perf: 90,
    awake: 1_230_000,
    light: 180 * MIN,
    deep: 90 * MIN,
    rem: 60 * MIN,
  }),
  sleep('2026-06-02', 'PENDING_SCORE', {}), // unscored night: all stage millis null
  sleep('2026-06-04', 'SCORED', {
    perf: 75,
    awake: 15 * MIN,
    light: 200 * MIN,
    deep: 80 * MIN,
    rem: 40 * MIN,
  }),
  sleep('2026-06-04', 'SCORED', { perf: 50, light: 30 * MIN, nap: true }), // nap → excluded
];
const workouts = [
  workout('2026-06-01', 'SCORED', 4.0),
  workout('2026-06-04', 'SCORED', 5.0),
  workout('2026-06-04', 'SCORED', 3.5), // 06-04 sum = 8.5, count = 2
  workout('2026-06-05', 'PENDING_SCORE', null), // unscored → count 1, sum null
];

// ── Case 1: buildDailySeries ─────────────────────────────────────────────────
console.log('\nCase 1: buildDailySeries — one point per day incl. gaps, null not 0');
const daily = buildDailySeries(cycles, recoveries, sleeps, workouts, {
  start: '2026-06-01',
  end: '2026-06-05',
});
check('five points, one per calendar day inclusive', daily.length === 5);
check(
  'days are contiguous & in order',
  JSON.stringify(daily.map((p) => p.day)) ===
    JSON.stringify(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']),
);

// Hand-computed expected point for each day.
//   06-01 totalSleepMilli = (180+90+60)*60000 = 19_800_000
//   06-04 totalSleepMilli = (200+80+40)*60000 = 19_200_000
const byDay = Object.fromEntries(daily.map((p) => [p.day, p]));

// 06-01 — the normal fully-scored day.
const d1 = byDay['2026-06-01'];
check('06-01 strain 12.5', d1.strain === 12.5);
check('06-01 kilojoule 9000 (SCORED cycle surfaces its energy)', d1.kilojoule === 9000);
check('06-01 recoveryScore 66', d1.recoveryScore === 66);
check('06-01 hrvRmssdMilli 45.2', approx(d1.hrvRmssdMilli, 45.2));
check('06-01 restingHeartRate 55', d1.restingHeartRate === 55);
check(
  '06-01 skinTempCelsius 33.9 (SCORED row carries the reading)',
  approx(d1.skinTempCelsius, 33.9),
);
check('06-01 sleepPerformancePercentage 90', d1.sleepPerformancePercentage === 90);
check('06-01 totalSleepMilli 19_800_000 (derived from stages)', d1.totalSleepMilli === 19_800_000);
check('06-01 workoutStrainSum 4.0', approx(d1.workoutStrainSum, 4.0));
check('06-01 workoutCount 1', d1.workoutCount === 1);

// 06-02 — cycle AND recovery PENDING_SCORE; every score-derived field MUST be
// null (not 0), even where the row carries a stale value.
const d2 = byDay['2026-06-02'];
check('06-02 strain null (PENDING, not 0)', d2.strain === null);
check('06-02 kilojoule null (stale 8888 on a PENDING cycle must not leak)', d2.kilojoule === null);
check('06-02 recoveryScore null', d2.recoveryScore === null);
check(
  '06-02 skinTempCelsius null (stale 34.5 on a PENDING row must not leak)',
  d2.skinTempCelsius === null,
);
check(
  '06-02 sleepPerformancePercentage null (unscored night)',
  d2.sleepPerformancePercentage === null,
);
check('06-02 totalSleepMilli null (unscored night)', d2.totalSleepMilli === null);
check(
  '06-02 workout fields null (no workouts)',
  d2.workoutStrainSum === null && d2.workoutCount === null,
);

// 06-03 — MISSING from every collection; the day must still appear, all null.
const d3 = byDay['2026-06-03'];
check(
  '06-03 present with ALL fields null (a gap, not skipped)',
  d3 !== undefined &&
    d3.strain === null &&
    d3.kilojoule === null &&
    d3.recoveryScore === null &&
    d3.hrvRmssdMilli === null &&
    d3.restingHeartRate === null &&
    d3.skinTempCelsius === null &&
    d3.sleepPerformancePercentage === null &&
    d3.totalSleepMilli === null &&
    d3.workoutStrainSum === null &&
    d3.workoutCount === null,
);

// 06-04 — two workouts aggregate; nap excluded from the sleep fields.
const d4 = byDay['2026-06-04'];
check('06-04 strain 8.0', d4.strain === 8.0);
check('06-04 recoveryScore 40', d4.recoveryScore === 40);
check(
  '06-04 skinTempCelsius null (SCORED row without a reading — pre-4.0 strap)',
  d4.skinTempCelsius === null,
);
check(
  '06-04 sleepPerformancePercentage 75 (main sleep, not the nap)',
  d4.sleepPerformancePercentage === 75,
);
check('06-04 totalSleepMilli 19_200_000 (nap excluded)', d4.totalSleepMilli === 19_200_000);
check('06-04 workoutStrainSum 8.5 (5.0 + 3.5, none dropped)', approx(d4.workoutStrainSum, 8.5));
check('06-04 workoutCount 2', d4.workoutCount === 2);

// 06-05 — scored day but its only workout is unscored.
const d5 = byDay['2026-06-05'];
check('06-05 strain 15.0', d5.strain === 15.0);
check('06-05 hrvRmssdMilli 60.0', approx(d5.hrvRmssdMilli, 60.0));
check(
  '06-05 sleepPerformancePercentage null (no sleep row)',
  d5.sleepPerformancePercentage === null,
);
check('06-05 workoutStrainSum null (only workout unscored)', d5.workoutStrainSum === null);
check('06-05 workoutCount 1 (unscored workout still counted)', d5.workoutCount === 1);

// ── Case 2: buildSleepStageBreakdown ─────────────────────────────────────────
console.log('\nCase 2: buildSleepStageBreakdown — naps skipped, millis→minutes rounded');
const stages = buildSleepStageBreakdown(sleeps);
// 4 input rows, 1 is a nap → 3 points, in input order.
check('3 points (nap of the 4 rows excluded)', stages.length === 3);
check(
  'days in input order, no nap',
  JSON.stringify(stages.map((s) => s.day)) ===
    JSON.stringify(['2026-06-01', '2026-06-02', '2026-06-04']),
);

// 06-01: awake 1_230_000ms = 20.5 → 21 (round half-up); light 180, deep 90, rem 60.
//        total = 21 + 180 + 90 + 60 = 351.
const s1 = stages[0];
check('06-01 awakeMinutes 21 (20.5 rounds half-up)', s1.awakeMinutes === 21);
check('06-01 lightMinutes 180', s1.lightMinutes === 180);
check('06-01 deepMinutes 90 (from slow-wave)', s1.deepMinutes === 90);
check('06-01 remMinutes 60', s1.remMinutes === 60);
check('06-01 totalMinutes 351 (= sum of the rounded stages)', s1.totalMinutes === 351);

// 06-02: unscored night → every stage null, total null.
const s2 = stages[1];
check(
  '06-02 all stage minutes null (unscored, not 0)',
  s2.awakeMinutes === null &&
    s2.lightMinutes === null &&
    s2.deepMinutes === null &&
    s2.remMinutes === null &&
    s2.totalMinutes === null,
);

// 06-04: awake 15, light 200, deep 80, rem 40 → total 335.
const s4 = stages[2];
check('06-04 awakeMinutes 15', s4.awakeMinutes === 15);
check('06-04 lightMinutes 200', s4.lightMinutes === 200);
check('06-04 deepMinutes 80', s4.deepMinutes === 80);
check('06-04 remMinutes 40', s4.remMinutes === 40);
check('06-04 totalMinutes 335', s4.totalMinutes === 335);

// ── Case 3: buildRollingBaseline — clean series, threshold at the 3rd point ───
console.log('\nCase 3: buildRollingBaseline — null until minSamples met, then trailing mean');
// A dedicated contiguous 5-day series with a value every day (strain accessor):
//   10, 12, 14, 16, 18 over 2026-06-10 .. 2026-06-14. windowDays=3, minSamples=3.
//   06-10 window {10}            count 1 → null
//   06-11 window {10,12}         count 2 → null
//   06-12 window {10,12,14}      count 3 → mean 12
//   06-13 window {12,14,16}      count 3 → mean 14
//   06-14 window {14,16,18}      count 3 → mean 16
const clean = [10, 12, 14, 16, 18].map((v, i) => ({
  day: `2026-06-${10 + i}`,
  strain: v,
  recoveryScore: null,
  hrvRmssdMilli: null,
  restingHeartRate: null,
  skinTempCelsius: null,
  sleepPerformancePercentage: null,
  totalSleepMilli: null,
  workoutStrainSum: null,
  workoutCount: null,
}));
const base = buildRollingBaseline(clean, (p) => p.strain, 3, { minSamples: 3 });
check('06-10 mean null (1 sample < 3)', base[0].mean === null && base[0].sampleCount === 1);
check('06-11 mean null (2 samples < 3)', base[1].mean === null && base[1].sampleCount === 2);
check('06-12 mean 12 (3 samples: 10,12,14)', approx(base[2].mean, 12) && base[2].sampleCount === 3);
check('06-13 mean 14 (12,14,16)', approx(base[3].mean, 14) && base[3].sampleCount === 3);
check('06-14 mean 16 (14,16,18)', approx(base[4].mean, 16) && base[4].sampleCount === 3);

// Default minSamples (=3) must behave identically to the explicit option above.
const baseDefault = buildRollingBaseline(clean, (p) => p.strain, 3);
check(
  'default minSamples=3 matches explicit',
  JSON.stringify(baseDefault) === JSON.stringify(base),
);

// ── Case 4: buildRollingBaseline — nulls excluded from mean & sampleCount ─────
console.log('\nCase 4: buildRollingBaseline — null days contribute no sample');
// values 10, null, 14, 16, null over 5 contiguous days. windowDays=3, minSamples=2.
//   d1 {10}          count 1 → null
//   d2 {10}          count 1 → null      (the null day itself adds nothing)
//   d3 {10,14}       count 2 → mean 12
//   d4 {14,16}       count 2 → mean 15
//   d5 {14,16}       count 2 → mean 15   (d5's own null adds nothing)
const gapped = [10, null, 14, 16, null].map((v, i) => ({
  day: `2026-06-${20 + i}`,
  strain: null,
  recoveryScore: null,
  hrvRmssdMilli: v, // baseline over HRV this time, to prove the accessor is generic
  restingHeartRate: null,
  skinTempCelsius: null,
  sleepPerformancePercentage: null,
  totalSleepMilli: null,
  workoutStrainSum: null,
  workoutCount: null,
}));
const gapBase = buildRollingBaseline(gapped, (p) => p.hrvRmssdMilli, 3, { minSamples: 2 });
check('d1 null (1 sample < 2)', gapBase[0].mean === null && gapBase[0].sampleCount === 1);
check(
  'd2 null (null day, still 1 sample)',
  gapBase[1].mean === null && gapBase[1].sampleCount === 1,
);
check('d3 mean 12 (10,14 — count 2)', approx(gapBase[2].mean, 12) && gapBase[2].sampleCount === 2);
check('d4 mean 15 (14,16 — count 2)', approx(gapBase[3].mean, 15) && gapBase[3].sampleCount === 2);
check(
  'd5 mean 15 (14,16; own null excluded)',
  approx(gapBase[4].mean, 15) && gapBase[4].sampleCount === 2,
);

// ── Case 5: buildRollingBaseline over REAL buildDailySeries output ────────────
console.log('\nCase 5: buildRollingBaseline composes with buildDailySeries output');
// hrv over the daily series: 45.2, null, null, 30.0, 60.0. windowDays=3, minSamples=1.
//   06-05 window {null,30.0,60.0} → count 2 → mean 45.0
const composed = buildRollingBaseline(daily, (p) => p.hrvRmssdMilli, 3, { minSamples: 1 });
check('06-01 mean 45.2 (single sample, minSamples=1)', approx(composed[0].mean, 45.2));
check(
  '06-03 mean 45.2 (only 06-01 in window)',
  approx(composed[2].mean, 45.2) && composed[2].sampleCount === 1,
);
check(
  '06-05 mean 45 ((30+60)/2, nulls excluded)',
  approx(composed[4].mean, 45) && composed[4].sampleCount === 2,
);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
