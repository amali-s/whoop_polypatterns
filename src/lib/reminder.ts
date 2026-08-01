// Phase 5.4 — should we remind the user to fill in today's journal?
//
// Pure decision logic: ZERO imports, zero I/O, no `window`, no `Notification` —
// unit-tested by scripts/test-reminder.mjs the same way src/lib/cycle.ts is by
// test-cycle.mjs and src/lib/stats.ts is by test-stats.mjs. Keep it import-free
// so Node's type-stripping loads it without a bundler. Everything that actually
// touches the browser (permission state, localStorage, firing the notification)
// lives in src/hooks/useJournalReminder.ts, which is a thin shell around the one
// function below — that split is what makes the rules testable at all, since the
// Notification API cannot be exercised in a Node script.
//
// ── THE RULES, AND WHY ──────────────────────────────────────────────────────
//  * NEVER remind someone who already logged today. `dayStatus` must be an
//    affirmative 'not-logged' — 'unknown' (still loading, a 401, a failed load)
//    produces nothing, because "we couldn't tell" is not "you haven't logged".
//  * NEVER auto-request permission. A page-load `Notification.requestPermission()`
//    is the dark pattern this task exists to avoid: the browser prompt is a
//    one-shot resource, and spending it unasked usually earns a permanent
//    'denied'. When permission is 'default' the answer is an opt-in CONTROL, and
//    the request happens only inside that control's click handler.
//  * NEVER nag when the browser said no. 'denied' shows a one-line explanation
//    ONLY to someone who asked for reminders (otherwise they'd be told about a
//    feature they never wanted), and that line can be turned off for good.
//  * At most ONE notification per calendar day, enforced by comparing
//    `lastNotifiedDay` to `today` — not by a render-count or a timer, so a
//    reload, a re-render, or a second tab can't produce a second nudge.
//
// The stored opt-in is deliberately a SECOND gate on top of the browser's
// permission, not a mirror of it: permission alone would mean anyone whose
// browser already granted this origin notifications (or who used our control
// once and later turned it off) gets nudged with no way to stop short of the
// browser's own site settings. Turning reminders off is an app-level choice and
// belongs in app-level state.

/** Browser permission, plus the case where the API doesn't exist at all
 *  (iOS Safari outside an installed PWA, some embedded webviews). Mirrors the
 *  DOM's `NotificationPermission` union widened by 'unsupported' — declared
 *  locally rather than imported, per this module's import-free contract. */
export type ReminderPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** What we know about today's journal entry. 'unknown' covers still-loading,
 *  no session (401) and a failed load — all three mean "don't act". */
export type JournalDayStatus = 'unknown' | 'logged' | 'not-logged';

/** Which inline control the journal tile should render.
 *  - 'opt-in'  — permission is grantable and the user hasn't opted in or waved
 *                us off; the control requests permission on click, never before.
 *  - 'on'      — reminders are live; the control is the OFF switch (an opt-in
 *                with no way back is its own dark pattern) and doubles as the
 *                focus target a clicked notification deep-links to.
 *  - 'blocked' — the user asked for reminders and the browser refuses; one
 *                honest line, dismissible for good.
 *  - 'none'    — say nothing. */
export type ReminderPrompt = 'none' | 'opt-in' | 'on' | 'blocked';

/** The client-only preference, persisted in localStorage (never the DB: this is
 *  a per-browser UI choice, not user data — a phone and a laptop can legitimately
 *  disagree about whether this browser may raise notifications). */
export interface ReminderPreference {
  /** The user explicitly asked for reminders. Set only from a click. */
  optedIn: boolean;
  /** The user waved the opt-in (or the blocked note) away. Suppresses the
   *  control for good — the point of a dismissal is that it stops asking. */
  dismissed: boolean;
  /** ISO 'YYYY-MM-DD' of the last day a notification was FIRED (or attempted),
   *  null if never. The once-per-day gate; see the note above. */
  lastNotifiedDay: string | null;
}

/** Preference for a browser that has never answered. Every field is the
 *  "we were never told" value — nothing here is an implied yes. */
export const DEFAULT_REMINDER_PREFERENCE: ReminderPreference = {
  optedIn: false,
  dismissed: false,
  lastNotifiedDay: null,
};

export interface ReminderInput {
  /** Today as a local ISO 'YYYY-MM-DD' — the same day the tile loaded. */
  today: string;
  dayStatus: JournalDayStatus;
  permission: ReminderPermission;
  preference: ReminderPreference;
}

export interface ReminderDecision {
  /** Fire a browser Notification now. Only ever true for an affirmatively
   *  unlogged day, with permission granted, opted in, and not yet fired today. */
  notify: boolean;
  prompt: ReminderPrompt;
}

/** Nothing to fire, nothing to say — the answer for every "we don't know" and
 *  every "already logged" case, which is most of them. */
const SILENT: ReminderDecision = { notify: false, prompt: 'none' };

/**
 * The whole of 5.4's policy, as one pure function of four inputs. Callers do
 * exactly what it says; they must not add conditions of their own, or the rules
 * above stop being testable in one place.
 */
export function reminderDecision({
  today,
  dayStatus,
  permission,
  preference,
}: ReminderInput): ReminderDecision {
  // Rule 1: only an affirmative "today isn't logged" earns anything at all.
  // 'logged' is the whole reason the feature is tolerable; 'unknown' is a
  // deliberate refusal to guess (a 401 tile has no journal to fill in).
  if (dayStatus !== 'not-logged') {
    return SILENT;
  }
  // No API to opt into — offering a control that cannot work would be a lie.
  if (permission === 'unsupported') {
    return SILENT;
  }
  if (permission === 'denied') {
    // Only explain to someone who asked; never introduce the feature by
    // reporting that it's blocked.
    return {
      notify: false,
      prompt: preference.optedIn && !preference.dismissed ? 'blocked' : 'none',
    };
  }
  // 'default' (never asked) and 'granted'-but-not-opted-in are the same UI
  // question — "do you want this?" — and the same answer: an inert control.
  // The permission request lives in its click handler, never here.
  if (!preference.optedIn) {
    return { notify: false, prompt: preference.dismissed ? 'none' : 'opt-in' };
  }
  if (permission !== 'granted') {
    // Opted in, but the browser hasn't granted (yet): the request is pending or
    // was closed without an answer. Keep offering the control; don't pretend
    // reminders are on.
    return { notify: false, prompt: 'opt-in' };
  }
  // Granted + opted in + today unlogged: nudge once, then show the off switch.
  return { notify: preference.lastNotifiedDay !== today, prompt: 'on' };
}
