// scripts/test-reminder.mjs
//
// Unit test for the Phase 5.4 journal-reminder decision logic
// (src/lib/reminder.ts). The module is pure (no imports, no I/O, no browser
// globals), so this script exercises the REAL function across the full input
// space and asserts the exact decision for each case — the same pattern as
// test-cycle.mjs / test-stats.mjs.
//
// WHAT THIS DOES NOT COVER, and why: nothing here touches the Notification API,
// `localStorage`, permission prompts, or the click→focus deep link. Those have
// no Node equivalent worth faking — a mock of `new Notification()` would only
// assert that the mock was called, which proves nothing about a real browser.
// They are covered by the in-browser checks recorded in ROADMAP 5.4 instead.
// This is exactly why the rules were extracted into a pure function: the part
// that can be tested honestly is tested exhaustively, and the part that cannot
// is a thin, documented shell (src/hooks/useJournalReminder.ts).
//
// Coverage:
//   * every dayStatus × permission × preference combination, enumerated rather
//     than sampled (a 3 × 4 × 12 = 144-case sweep at the end)
//   * a logged day is silent no matter what else is true  (never nag someone
//     who already logged)
//   * an unknown day (loading / 401 / failed load) is silent      (never guess)
//   * permission 'default' NEVER notifies                (no auto-request)
//   * 'denied' explains itself only to someone who opted in       (no nagging)
//   * the once-per-day gate: same day → no second notification, next day → yes
//   * opted out → no prompt at all, and still no notification
//
// USAGE (from repo root):
//   npm run test:reminder        # = node scripts/test-reminder.mjs
//
// Node 24 strips the TypeScript types on import; reminder.ts is import-free so
// it loads without a bundler.

const { DEFAULT_REMINDER_PREFERENCE, reminderDecision } = await import('../src/lib/reminder.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

const TODAY = '2026-07-31';
const YESTERDAY = '2026-07-30';

/** A preference with the named overrides; everything else is the never-asked
 *  default, so each case states only what it is actually about. */
const pref = (over = {}) => ({ ...DEFAULT_REMINDER_PREFERENCE, ...over });

/** Decide, with `today` and an unlogged day as the defaults (the only inputs
 *  under which anything ever happens). */
const decide = (over = {}) =>
  reminderDecision({
    today: TODAY,
    dayStatus: 'not-logged',
    permission: 'default',
    preference: pref(),
    ...over,
  });

const is = (decision, notify, prompt) => decision.notify === notify && decision.prompt === prompt;

// ── Case 1: the default state — never asked, never opted in ──────────────────
console.log('Case 1: fresh browser, today not logged');
check('default permission → opt-in control, no notification', is(decide(), false, 'opt-in'));
check(
  'DEFAULT_REMINDER_PREFERENCE is all-negative (nothing is an implied yes)',
  DEFAULT_REMINDER_PREFERENCE.optedIn === false &&
    DEFAULT_REMINDER_PREFERENCE.dismissed === false &&
    DEFAULT_REMINDER_PREFERENCE.lastNotifiedDay === null,
);

// ── Case 2: already logged today → absolute silence ──────────────────────────
console.log('\nCase 2: today already logged');
for (const permission of ['unsupported', 'default', 'granted', 'denied']) {
  check(
    `logged + ${permission} + opted in → nothing, whatever else is true`,
    is(
      decide({
        dayStatus: 'logged',
        permission,
        preference: pref({ optedIn: true, lastNotifiedDay: null }),
      }),
      false,
      'none',
    ),
  );
}

// ── Case 3: we don't KNOW whether today is logged → also silence ─────────────
console.log('\nCase 3: unknown day status (loading, 401, failed load)');
check(
  'unknown + granted + opted in → no notification (never guess)',
  is(
    decide({ dayStatus: 'unknown', permission: 'granted', preference: pref({ optedIn: true }) }),
    false,
    'none',
  ),
);
check(
  'unknown + default → not even the opt-in control',
  is(decide({ dayStatus: 'unknown' }), false, 'none'),
);

// ── Case 4: permission 'default' never fires (the no-auto-request rule) ──────
console.log("\nCase 4: permission 'default' — the dark-pattern guard");
check(
  'default + opted in (request pending/closed) → still no notification',
  is(decide({ preference: pref({ optedIn: true }) }), false, 'opt-in'),
);
check(
  'default + opted in + already notified some other day → still no notification',
  is(decide({ preference: pref({ optedIn: true, lastNotifiedDay: YESTERDAY }) }), false, 'opt-in'),
);
check(
  'default + dismissed → say nothing at all',
  is(decide({ preference: pref({ dismissed: true }) }), false, 'none'),
);

// ── Case 5: granted ──────────────────────────────────────────────────────────
console.log('\nCase 5: permission granted');
check(
  'granted + opted in + never notified → NOTIFY, and show the off switch',
  is(decide({ permission: 'granted', preference: pref({ optedIn: true }) }), true, 'on'),
);
check(
  'granted + opted in + already notified TODAY → no second notification',
  is(
    decide({
      permission: 'granted',
      preference: pref({ optedIn: true, lastNotifiedDay: TODAY }),
    }),
    false,
    'on',
  ),
);
check(
  'granted + opted in + last notified YESTERDAY → notify again (new day)',
  is(
    decide({
      permission: 'granted',
      preference: pref({ optedIn: true, lastNotifiedDay: YESTERDAY }),
    }),
    true,
    'on',
  ),
);
check(
  'granted but NOT opted in (granted out of band) → offer, never fire',
  is(decide({ permission: 'granted' }), false, 'opt-in'),
);
check(
  'granted + turned off (opted out + dismissed) → silent, no control',
  is(
    decide({
      permission: 'granted',
      preference: pref({ optedIn: false, dismissed: true, lastNotifiedDay: YESTERDAY }),
    }),
    false,
    'none',
  ),
);

// ── Case 6: denied ───────────────────────────────────────────────────────────
console.log('\nCase 6: permission denied');
check(
  'denied + opted in → the blocked line (they asked; explain once)',
  is(decide({ permission: 'denied', preference: pref({ optedIn: true }) }), false, 'blocked'),
);
check(
  'denied + never opted in → nothing (never introduce a feature by its failure)',
  is(decide({ permission: 'denied' }), false, 'none'),
);
check(
  'denied + opted in + dismissed → the line is gone for good',
  is(
    decide({ permission: 'denied', preference: pref({ optedIn: true, dismissed: true }) }),
    false,
    'none',
  ),
);
check(
  'denied never notifies, whatever the stored day says',
  decide({
    permission: 'denied',
    preference: pref({ optedIn: true, lastNotifiedDay: YESTERDAY }),
  }).notify === false,
);

// ── Case 7: unsupported (iOS Safari outside a PWA, embedded webviews) ────────
console.log('\nCase 7: Notification API unsupported');
check(
  'unsupported + opted in → no control offered (it could not work)',
  is(decide({ permission: 'unsupported', preference: pref({ optedIn: true }) }), false, 'none'),
);
check(
  'unsupported + fresh browser → no control offered',
  is(decide({ permission: 'unsupported' }), false, 'none'),
);

// ── Case 8: exhaustive sweep — the two invariants that must hold EVERYWHERE ──
console.log('\nCase 8: full input sweep (3 dayStatus × 4 permission × 12 preferences)');
const DAY_STATUSES = ['unknown', 'logged', 'not-logged'];
const PERMISSIONS = ['unsupported', 'default', 'granted', 'denied'];
const PREFERENCES = [];
for (const optedIn of [false, true]) {
  for (const dismissed of [false, true]) {
    for (const lastNotifiedDay of [null, TODAY, YESTERDAY]) {
      PREFERENCES.push(pref({ optedIn, dismissed, lastNotifiedDay }));
    }
  }
}

let combinations = 0;
let notifyCount = 0;
let violations = 0;
for (const dayStatus of DAY_STATUSES) {
  for (const permission of PERMISSIONS) {
    for (const preference of PREFERENCES) {
      combinations += 1;
      const decision = reminderDecision({ today: TODAY, dayStatus, permission, preference });
      if (decision.notify) {
        notifyCount += 1;
        // INVARIANT 1: a notification requires ALL FOUR of these. Any other
        // combination that fires is a bug this sweep is here to catch.
        const legitimate =
          dayStatus === 'not-logged' &&
          permission === 'granted' &&
          preference.optedIn === true &&
          preference.lastNotifiedDay !== TODAY;
        if (!legitimate) violations += 1;
      }
      // INVARIANT 2: a day that is logged or unknown produces NO UI either.
      if (dayStatus !== 'not-logged' && decision.prompt !== 'none') violations += 1;
      // INVARIANT 3: the returned prompt is always one of the four states.
      if (!['none', 'opt-in', 'on', 'blocked'].includes(decision.prompt)) violations += 1;
    }
  }
}
check(`swept ${combinations} combinations`, combinations === 3 * 4 * 12);
check('no combination violates the three invariants', violations === 0);
// Exactly the four preferences with optedIn && lastNotifiedDay !== TODAY
// (dismissed is irrelevant once opted in), for the one dayStatus × permission
// pair that may fire: 1 × 1 × 4.
check(`exactly 4 of ${combinations} combinations notify (hand-counted)`, notifyCount === 4);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
