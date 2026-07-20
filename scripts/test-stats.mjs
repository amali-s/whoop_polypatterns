// scripts/test-stats.mjs
//
// Unit test for the Phase 4.12 stat-card delta logic (src/lib/stats.ts).
// The module is pure (no imports, no I/O), so this script exercises the REAL
// function against small hand-built fixture series and asserts EXACT expected
// values — every expectation is hand-computed in the comments below, never a
// lazy "is not null".
//
// Coverage (per the 4.12 brief):
//   * empty series and all-null series          → no-value
//   * today's metric null but baseline present   → no-value (today wins)
//   * exactly minSamples − 1 prior samples       → no-baseline (value, no delta)
//   * exactly minSamples prior samples           → full (exact mean/delta)
//   * a zero delta (value === mean)              → full, delta 0, percentDelta 0
//   * today's own value genuinely NOT in the mean (excludeToday true vs false)
//   * windowDays bounds the baseline (older days outside the window excluded)
//   * a null day inside the window contributes no sample
//   * percentDelta null when the mean is 0
//   * the generic accessor works on a DailyMetricPoint-shaped object
//
// All fixture values are SYNTHETIC — no real personal health data.
//
// USAGE (from repo root):
//   npm run test:stats           # = node scripts/test-stats.mjs
//
// Node 24 strips the TypeScript types on import; stats.ts is import-free so
// it loads without a bundler.

const { baselineDelta } = await import('../src/lib/stats.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}
/** Float-tolerant equality (means / percentages of decimals). */
function approx(a, b) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

// ── Fixture builder (synthetic data only) ────────────────────────────────────
// values → one {day, value} point per CONSECUTIVE calendar day from startDay,
// ascending. Date.UTC handles month rollover, so callers pass plain arrays.
function makeSeries(values, startDay = '2026-06-01') {
  const y = Number(startDay.slice(0, 4));
  const m = Number(startDay.slice(5, 7));
  const d = Number(startDay.slice(8, 10));
  return values.map((v, i) => ({
    day: new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
    value: v,
  }));
}
const val = (p) => p.value;
// Wide window / floor-of-1 for the cases that aren't testing those knobs.
const wide = (over = {}) => ({ windowDays: 30, minSamples: 1, excludeToday: true, ...over });

// ── Case 1: no value → no-value ──────────────────────────────────────────────
console.log('Case 1: today has no value');
check('empty series → no-value', baselineDelta([], val, wide()).kind === 'no-value');
check(
  'all-null series → no-value',
  baselineDelta(makeSeries([null, null, null]), val, wide()).kind === 'no-value',
);
// Baseline is fully present (three non-null prior days) but TODAY is null:
// no-value must win over an available baseline — the headline number is absent.
const todayNull = baselineDelta(makeSeries([10, 20, 30, null]), val, wide({ minSamples: 1 }));
check('today null but baseline present → no-value (today wins)', todayNull.kind === 'no-value');

// ── Case 2: too few prior samples → no-baseline ──────────────────────────────
console.log('\nCase 2: fewer than minSamples prior non-null days');
// [10, 20, null, 5] over 4 days, minSamples 3. today = 5 (non-null). Prior
// non-null in window = {10, 20} (the null day adds nothing) → count 2 = 3 − 1.
const thin = baselineDelta(makeSeries([10, 20, null, 5]), val, wide({ minSamples: 3 }));
check("kind 'no-baseline' at minSamples − 1", thin.kind === 'no-baseline');
check('no-baseline still carries today value 5', thin.value === 5);
check('no-baseline sampleCount 2 (null day not counted)', thin.sampleCount === 2);

// ── Case 3: exactly minSamples prior samples → full ──────────────────────────
console.log('\nCase 3: exactly minSamples prior non-null days');
// [10, 20, 30, 8] over 4 days, minSamples 3. today = 8. Prior = {10,20,30} →
// count 3 = minSamples. mean = 60/3 = 20. delta = 8 − 20 = −12. pct = −60.
const full = baselineDelta(makeSeries([10, 20, 30, 8]), val, wide({ minSamples: 3 }));
check("kind 'full' at exactly minSamples", full.kind === 'full');
check('value 8', full.value === 8);
check('mean 20 (60/3)', approx(full.mean, 20));
check('delta −12 (8 − 20)', approx(full.delta, -12));
check('percentDelta −60 (−12/20)', approx(full.percentDelta, -60));
check('sampleCount 3', full.sampleCount === 3);

// ── Case 4: a zero delta ─────────────────────────────────────────────────────
console.log('\nCase 4: value equals the baseline mean → delta 0');
// [12, 18, 15] over 3 days, minSamples 2. today = 15. Prior = {12,18} → mean 15.
// delta = 15 − 15 = 0. percentDelta = 0/15 = 0.
const zero = baselineDelta(makeSeries([12, 18, 15]), val, wide({ minSamples: 2 }));
check("kind 'full'", zero.kind === 'full');
check('delta exactly 0', zero.delta === 0);
check('percentDelta exactly 0', zero.percentDelta === 0);
check('mean 15', approx(zero.mean, 15));

// ── Case 5: today is genuinely excluded from the mean ────────────────────────
console.log('\nCase 5: excludeToday keeps today out of its own baseline');
// [10, 20, 100] over 3 days, minSamples 2. today = 100.
//   excludeToday TRUE : prior = {10,20} → mean 15,  count 2, delta 85.
//   excludeToday FALSE: window includes today → {10,20,100} → mean 43.33…,
//                       count 3 — proving the flag really removes today.
const excl = baselineDelta(makeSeries([10, 20, 100]), val, wide({ minSamples: 2 }));
check('excludeToday: mean 15, NOT 43.33 (today absent)', approx(excl.mean, 15));
check('excludeToday: sampleCount 2', excl.sampleCount === 2);
check('excludeToday: delta 85 (100 − 15)', approx(excl.delta, 85));
const incl = baselineDelta(
  makeSeries([10, 20, 100]),
  val,
  wide({ minSamples: 2, excludeToday: false }),
);
check(
  'excludeToday false: mean 43.333… and count 3 (today counted)',
  approx(incl.mean, 130 / 3) && incl.sampleCount === 3,
);

// ── Case 6: windowDays bounds the lookback ───────────────────────────────────
console.log('\nCase 6: windowDays limits how far back the baseline reaches');
// [1, 2, 3, 4, 5, 60] over 6 days, windowDays 3, minSamples 2, excludeToday.
// Window = last 3 days = {4, 5, 60}; drop today (60) → prior = {4, 5}.
// The older 1,2,3 are OUTSIDE the 3-day window and must be excluded.
// mean = 4.5, count 2, delta = 60 − 4.5 = 55.5.
const windowed = baselineDelta(makeSeries([1, 2, 3, 4, 5, 60]), val, {
  windowDays: 3,
  minSamples: 2,
  excludeToday: true,
});
check("kind 'full'", windowed.kind === 'full');
check('mean 4.5 (only 4,5 in window; 1,2,3 excluded)', approx(windowed.mean, 4.5));
check('sampleCount 2 (window bounds the baseline)', windowed.sampleCount === 2);
check('delta 55.5 (60 − 4.5)', approx(windowed.delta, 55.5));

// ── Case 7: percentDelta is null when the mean is 0 ──────────────────────────
console.log('\nCase 7: no percentage of a zero mean');
// [0, 0, 7] over 3 days, minSamples 2. today = 7. Prior mean = 0.
// delta = 7 − 0 = 7, but 7/0 is not a percentage → percentDelta null.
const zeroMean = baselineDelta(makeSeries([0, 0, 7]), val, wide({ minSamples: 2 }));
check('delta 7', approx(zeroMean.delta, 7));
check('percentDelta null (mean 0)', zeroMean.percentDelta === null);

// ── Case 8: the generic accessor works on a DailyMetricPoint-shaped object ────
console.log('\nCase 8: generic over any {day} point, real accessor');
// Mirror the App wiring: a point carrying `kilojoule`, pulled by its accessor.
// Prior kJ = {8000, 9000} → mean 8500; today 9200 → delta 700.
const kjPoints = [
  { day: '2026-07-17', kilojoule: 8000 },
  { day: '2026-07-18', kilojoule: 9000 },
  { day: '2026-07-19', kilojoule: 9200 },
];
const kj = baselineDelta(kjPoints, (p) => p.kilojoule, wide({ minSamples: 2 }));
check('kind full, mean 8500', kj.kind === 'full' && approx(kj.mean, 8500));
check('delta 700 (9200 − 8500)', approx(kj.delta, 700));

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
