// scripts/test-cycle.mjs
//
// Unit test for the Phase 4.10 period-meter cycle logic (src/lib/cycle.ts).
// The module is pure (no imports, no I/O), so this script exercises the REAL
// functions against small hand-built fixture logs and asserts EXACT expected
// values — every expectation is hand-computed in the comments below, never a
// lazy "is not null".
//
// Coverage (per the 4.10 brief):
//   * zero 'yes' days                        → no-data
//   * first-ever entry                       → one episode, day 1
//   * consecutive 'yes' days (unsorted in)   → ONE episode, start = first day
//   * one-day logging gap mid-period         → still ONE episode
//   * exactly-3-day gap                      → still one episode (rule is > 3, not ≥ 3)
//   * 4-day gap                              → TWO episodes
//   * 'no' days interleaved among 'yes'      → do not break the episode
//   * null (not-logged) days                 → identical grouping to 'no' days
//   * <2 episodes                            → estimateCycleLength null → 'day-only',
//                                              and no 28 appears anywhere
//   * ≥2 episodes                            → exact hand-computed mean gap, 'estimated'
//                                              preferred over the user-reported value
//   * retroactive edits                      → full-history recompute merges/splits episodes
//   * dayOfCycle > cycleLength (overdue)     → not clamped, not negative
//   * a range spanning a DST boundary        → exact day count (UTC-normalized helper)
//
// All fixture dates are SYNTHETIC — no real personal health data.
//
// USAGE (from repo root):
//   npm run test:cycle           # = node scripts/test-cycle.mjs
//
// Node 24 strips the TypeScript types on import; cycle.ts is import-free so
// it loads without a bundler.

const { EPISODE_GAP_DAYS, detectEpisodes, estimateCycleLength, cycleState } =
  await import('../src/lib/cycle.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

// ── Fixture builder (synthetic data only) ────────────────────────────────────
const log = (date, period = 'yes') => ({ date, period });

// ── Case 1: zero 'yes' days → no-data ────────────────────────────────────────
console.log('Case 1: zero explicit yes days');
check('empty history → no episodes', detectEpisodes([]).length === 0);
const noYes = [log('2026-01-10', 'no'), log('2026-01-11', null), log('2026-01-12', 'no')];
check('no/null-only history → no episodes', detectEpisodes(noYes).length === 0);
check(
  "cycleState → kind 'no-data'",
  cycleState(noYes, '2026-01-15').kind === 'no-data' &&
    cycleState([], '2026-01-15').kind === 'no-data',
);

// ── Case 2: first-ever entry ─────────────────────────────────────────────────
console.log('\nCase 2: first-ever entry');
const first = [log('2026-01-10')];
const firstEps = detectEpisodes(first);
check('one episode', firstEps.length === 1);
check('start = the entry itself', firstEps[0].startDate === '2026-01-10');
// dayOfCycle on the start date itself: 10 − 10 + 1 = 1 (inclusive count).
const firstState = cycleState(first, '2026-01-10');
check('day 1 on the start date', firstState.kind === 'day-only' && firstState.dayOfCycle === 1);
// Four days later: 14 − 10 + 1 = 5 — the count continues past the entry.
const firstLater = cycleState(first, '2026-01-14');
check('day 5 on 01-14', firstLater.kind === 'day-only' && firstLater.dayOfCycle === 5);

// ── Case 3: consecutive yes days (fed unsorted) → one episode ────────────────
console.log('\nCase 3: 5 consecutive yes days, unsorted input');
const run = [
  log('2026-01-12'),
  log('2026-01-10'),
  log('2026-01-14'),
  log('2026-01-11'),
  log('2026-01-13'),
];
const runEps = detectEpisodes(run);
check('ONE episode', runEps.length === 1);
check('start = first day (2026-01-10)', runEps[0].startDate === '2026-01-10');
check(
  'all 5 days, chronological',
  runEps[0].days.join(',') === '2026-01-10,2026-01-11,2026-01-12,2026-01-13,2026-01-14',
);

// ── Case 4: one-day logging gap mid-period → still one episode ───────────────
console.log('\nCase 4: one-day logging gap mid-period');
// 01-12 simply missing from the history: gap 01-11 → 01-13 = 2 ≤ 3.
const gapped = [log('2026-01-10'), log('2026-01-11'), log('2026-01-13'), log('2026-01-14')];
const gappedEps = detectEpisodes(gapped);
check('still ONE episode', gappedEps.length === 1);
check('4 yes days in it', gappedEps[0].days.length === 4);

// ── Case 5: exactly-3-day gap → still one episode (rule is > 3, not ≥ 3) ─────
console.log('\nCase 5: boundary — a gap of exactly EPISODE_GAP_DAYS');
check('threshold constant is 3', EPISODE_GAP_DAYS === 3);
// 01-10 → 01-13 is a 3-day gap: 3 > 3 is false, so NO new episode.
const boundary = detectEpisodes([log('2026-01-10'), log('2026-01-13')]);
check('3-day gap does NOT split (one episode)', boundary.length === 1);
check('episode spans both days', boundary[0].days.join(',') === '2026-01-10,2026-01-13');

// ── Case 6: 4-day gap → two episodes ─────────────────────────────────────────
console.log('\nCase 6: a 4-day gap');
// 01-10 → 01-14 is a 4-day gap: 4 > 3, so a NEW episode starts.
const split = detectEpisodes([log('2026-01-10'), log('2026-01-14')]);
check('TWO episodes', split.length === 2);
check(
  'starts 01-10 and 01-14',
  split[0].startDate === '2026-01-10' && split[1].startDate === '2026-01-14',
);

// ── Case 7: interleaved 'no' days don't break the episode ────────────────────
console.log("\nCase 7: 'no' days interleaved among yes days");
const interleaved = [
  log('2026-01-10'),
  log('2026-01-11', 'no'),
  log('2026-01-12'),
  log('2026-01-13', 'no'),
  log('2026-01-14'),
];
const interleavedEps = detectEpisodes(interleaved);
check('still ONE episode', interleavedEps.length === 1);
check('3 yes days (the no days are not members)', interleavedEps[0].days.length === 3);

// ── Case 8: null (not logged) grouped identically to 'no' ────────────────────
console.log('\nCase 8: null-heavy history ≡ no-heavy history');
const nullHeavy = [
  log('2026-01-10'),
  log('2026-01-11', null),
  log('2026-01-12'),
  log('2026-01-13', null),
  log('2026-01-14'),
];
check(
  'identical episodes either way',
  JSON.stringify(detectEpisodes(nullHeavy)) === JSON.stringify(detectEpisodes(interleaved)),
);

// ── Case 9: <2 episodes → null estimate → 'day-only', and NO default 28 ──────
console.log('\nCase 9: fewer than 2 episodes');
const oneEpisode = detectEpisodes([log('2026-01-10'), log('2026-01-11')]);
check('estimateCycleLength → null', estimateCycleLength(oneEpisode) === null);
check('estimateCycleLength([]) → null', estimateCycleLength([]) === null);
const dayOnly = cycleState([log('2026-01-10'), log('2026-01-11')], '2026-01-20');
// 20 − 10 + 1 = 11.
check("kind 'day-only', day 11", dayOnly.kind === 'day-only' && dayOnly.dayOfCycle === 11);
check('no 28 anywhere in the result', !JSON.stringify(dayOnly).includes('28'));

// ── Case 10: ≥2 episodes → exact mean gap, 'estimated' beats user-reported ───
console.log('\nCase 10: estimated cycle length from 3 episodes');
// Episode starts: 01-01, 01-29, 02-27 (each yes-run separated by >3-day gaps).
//   gap 1: Jan 1 → Jan 29           = 28 days
//   gap 2: Jan 29 → Feb 27          = 2 (to Jan 31) + 27 = 29 days (2026 not a leap year)
//   mean  = (28 + 29) / 2 = 28.5    → Math.round → 29
const threeEpisodes = [
  log('2026-01-01'),
  log('2026-01-02'),
  log('2026-01-29'),
  log('2026-01-30'),
  log('2026-02-27'),
];
const threeEps = detectEpisodes(threeEpisodes);
check('3 episodes detected', threeEps.length === 3);
check('estimate = 29 (round(28.5))', estimateCycleLength(threeEps) === 29);
// today 02-28: dayOfCycle = 28 − 27 + 1 = 2.
const full = cycleState(threeEpisodes, '2026-02-28', 30);
check(
  "kind 'full', day 2 of 29, source 'estimated' (beats the reported 30)",
  full.kind === 'full' &&
    full.dayOfCycle === 2 &&
    full.cycleLength === 29 &&
    full.lengthSource === 'estimated',
);
// One episode + a user-reported length → that value, labeled honestly.
// today 01-15: dayOfCycle = 15 − 10 + 1 = 6.
const reported = cycleState([log('2026-01-10')], '2026-01-15', 30);
check(
  "one episode + reported 30 → 'full', day 6 of 30, source 'user-reported'",
  reported.kind === 'full' &&
    reported.dayOfCycle === 6 &&
    reported.cycleLength === 30 &&
    reported.lengthSource === 'user-reported',
);

// ── Case 11: retroactive edits recompute from full history ───────────────────
console.log('\nCase 11: retroactive edits merge and split episodes');
// MERGE: 01-10 and 01-16 are a 6-day gap → two episodes…
const beforeMerge = detectEpisodes([log('2026-01-10'), log('2026-01-16')]);
check('before backfill: two episodes', beforeMerge.length === 2);
// …then the user backfills 01-13: gaps become 3 and 3 (both ≤ 3) → ONE episode.
const afterMerge = detectEpisodes([log('2026-01-10'), log('2026-01-16'), log('2026-01-13')]);
check('after backfilling 01-13: ONE episode', afterMerge.length === 1);
check(
  'merged episode starts 01-10, 3 days',
  afterMerge[0].startDate === '2026-01-10' && afterMerge[0].days.length === 3,
);
// SPLIT: 01-10, 01-12, 01-14 (gaps 2, 2) → one episode…
const beforeSplit = detectEpisodes([log('2026-01-10'), log('2026-01-12'), log('2026-01-14')]);
check('before edit: one episode', beforeSplit.length === 1);
// …then the user corrects 01-12 to 'no': remaining gap 01-10 → 01-14 = 4 > 3 → TWO.
const afterSplit = detectEpisodes([log('2026-01-10'), log('2026-01-12', 'no'), log('2026-01-14')]);
check('after editing 01-12 to no: TWO episodes', afterSplit.length === 2);
check(
  'new starts 01-10 and 01-14',
  afterSplit[0].startDate === '2026-01-10' && afterSplit[1].startDate === '2026-01-14',
);

// ── Case 12: overdue — dayOfCycle > cycleLength, no clamp, no negative ───────
console.log('\nCase 12: dayOfCycle past the estimated length');
// Episodes 01-01 and 01-29 → estimate = 28. today 03-05:
//   Jan 29 → Jan 31 = 2, + 28 (all of Feb 2026) = 30, + 5 = 35 → day 35 + 1 = 36.
const overdue = cycleState([log('2026-01-01'), log('2026-01-29')], '2026-03-05');
check(
  'day 36 of estimated 28 — unclamped',
  overdue.kind === 'full' && overdue.dayOfCycle === 36 && overdue.cycleLength === 28,
);
check(
  'positive, exceeds length honestly',
  overdue.dayOfCycle > overdue.cycleLength && overdue.dayOfCycle > 0,
);

// ── Case 13: DST boundary — day count stays exact ────────────────────────────
console.log('\nCase 13: range spanning a DST transition');
// US spring-forward is 2026-03-08. Start 03-01, today 03-15 → 15 − 1 + 1 = 15.
// Local-midnight Date math in a DST zone yields a 23-hour day in that range,
// so naive (a − b) / 86400000 gives 13.958… → an off-by-one after truncation.
// cycle.ts normalizes through Date.UTC, so the count is exact in any TZ.
const dst = cycleState([log('2026-03-01')], '2026-03-15');
check('day 15 across spring-forward', dst.kind === 'day-only' && dst.dayOfCycle === 15);
// Fall-back too: 2026-11-01. Start 10-25, today 11-08 → 8 + (31 − 25) + 1 = 15.
const dstFall = cycleState([log('2026-10-25')], '2026-11-08');
check('day 15 across fall-back', dstFall.kind === 'day-only' && dstFall.dayOfCycle === 15);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
