import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  DEFAULT_REMINDER_PREFERENCE,
  reminderDecision,
  type JournalDayStatus,
  type ReminderPermission,
  type ReminderPreference,
  type ReminderPrompt,
} from '../lib/reminder';

// Phase 5.4 — the browser half of the journal reminder. Every RULE lives in
// src/lib/reminder.ts (pure, unit-tested); this hook only supplies that function
// with real inputs and carries out what it says: read the permission, read/write
// the stored preference, raise the Notification, and hand the tile a focus
// target for a clicked notification to land on.
//
// IN-TAB ONLY, deliberately (ROADMAP 5.4): a Notification raised from page
// script needs the page alive, so this reminds you while the dashboard is open
// and never when it is closed. Closed-browser push would need a service worker,
// VAPID keys and a subscription table — a different feature, filed as a
// follow-up rather than half-built here.

/** localStorage key for the reminder preference — same namespace as the range
 *  toggle's `whoop-dashboard:range-days` (4.14). One JSON object rather than
 *  three keys, so a partial write can't leave the three fields disagreeing. */
const REMINDER_STORAGE_KEY = 'whoop-dashboard:journal-reminder';

const NOTIFICATION_TITLE = 'Log today’s WHOOP journal';
const NOTIFICATION_BODY = 'Today isn’t logged yet. Open the dashboard to fill it in.';

/**
 * Persisted preference. ANY malformed value — absent key, non-JSON, JSON of the
 * wrong shape, or a throwing localStorage (Safari private mode, storage
 * disabled) — falls back to the never-asked default. Same discipline as
 * `readStoredRangeDays`: a UI preference is never worth a broken tile, and here
 * the fallback is also the SAFE direction (no opt-in, so nothing fires).
 */
function readReminderPreference(): ReminderPreference {
  try {
    const raw = window.localStorage.getItem(REMINDER_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_REMINDER_PREFERENCE;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_REMINDER_PREFERENCE;
    }
    const value = parsed as Partial<Record<keyof ReminderPreference, unknown>>;
    return {
      // Field by field, each checked for its own type — an unexpected value
      // reads as the default rather than being coerced into an opt-in.
      optedIn: value.optedIn === true,
      dismissed: value.dismissed === true,
      lastNotifiedDay: typeof value.lastNotifiedDay === 'string' ? value.lastNotifiedDay : null,
    };
  } catch {
    return DEFAULT_REMINDER_PREFERENCE;
  }
}

/** Persist the preference. Swallows storage failures — the choice still applies
 *  for this session, it just won't survive a reload (the range-toggle rule). */
function storeReminderPreference(preference: ReminderPreference): void {
  try {
    window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Storage unavailable or full. Not worth surfacing.
  }
}

/** Current browser permission, or 'unsupported' where the API doesn't exist
 *  (iOS Safari outside an installed PWA, some embedded webviews). */
function readPermission(): ReminderPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Raise the notification. Wrapped in try/catch because the constructor is NOT
 * universally available even where `Notification` exists — Chrome on Android
 * throws a TypeError and requires ServiceWorkerRegistration.showNotification(),
 * which is the out-of-scope push path. A throw here degrades to "no nudge this
 * load", never to a broken tile.
 */
function showReminderNotification(day: string, onActivate: () => void): void {
  try {
    const notification = new Notification(NOTIFICATION_TITLE, {
      body: NOTIFICATION_BODY,
      // Same tag for the same day, so two open tabs collapse into one nudge
      // rather than stacking two identical ones.
      tag: `whoop-journal-${day}`,
    });
    notification.onclick = () => {
      // Bring the dashboard forward, then hand off to the tile's focus target.
      window.focus();
      notification.close();
      onActivate();
    };
  } catch {
    // See above — nothing to report to the user, who asked for a nudge and
    // simply won't get one in this browser.
  }
}

export interface JournalReminderState {
  /** What the tile should render (see ReminderPrompt). */
  prompt: ReminderPrompt;
  /**
   * Focus target for a clicked notification — put it on the reminder region.
   * Deep-linking means "bring this tab forward and put the user AT the journal",
   * and a focus move is the only version of that a keyboard or screen-reader
   * user also gets.
   */
  regionRef: RefObject<HTMLDivElement | null>;
  /** Opt in. The ONLY caller of Notification.requestPermission() — it runs
   *  inside this click handler and nowhere else. */
  enable: () => void;
  /** "Not now" — stop offering. */
  dismiss: () => void;
  /** Turn reminders back off (an opt-in with no way out is its own dark
   *  pattern). Also clears the opt-in, so the blocked note goes with it. */
  disable: () => void;
}

/**
 * @param dayStatus whether today's journal entry exists — 'unknown' while the
 *   tile is still loading, on a 401, or after a failed load. Never guessed.
 * @param today local ISO 'YYYY-MM-DD', the day the tile is showing.
 */
export function useJournalReminder(
  dayStatus: JournalDayStatus,
  today: string,
): JournalReminderState {
  const [permission, setPermission] = useState<ReminderPermission>(readPermission);
  const [preference, setPreference] = useState<ReminderPreference>(readReminderPreference);
  const regionRef = useRef<HTMLDivElement | null>(null);
  // In-session half of the once-per-day gate. The durable half is
  // `lastNotifiedDay` in localStorage (below): a ref survives re-renders, a
  // stored day survives reloads, and neither is React state because nothing
  // the user can SEE depends on it — keeping it out of state is also what keeps
  // this effect free of a setState.
  const firedForDay = useRef<string | null>(null);

  const decision = reminderDecision({ today, dayStatus, permission, preference });

  useEffect(() => {
    if (!decision.notify || firedForDay.current === today) {
      return;
    }
    firedForDay.current = today;
    // Record BEFORE firing: if the constructor throws (see
    // showReminderNotification) we still count the attempt, so a browser that
    // can't raise notifications can't turn every reload into a retry.
    storeReminderPreference({ ...preference, lastNotifiedDay: today });
    showReminderNotification(today, () => {
      const region = regionRef.current;
      if (region === null) {
        return;
      }
      region.scrollIntoView({ block: 'center' });
      region.focus();
    });
  }, [decision.notify, today, preference]);

  /** Single write path: storage and state always change together. */
  function update(next: ReminderPreference): void {
    storeReminderPreference(next);
    setPreference(next);
  }

  function enable(): void {
    if (permission === 'unsupported') {
      return;
    }
    // Opt in FIRST and keep it set even if the browser says no — that is what
    // earns the 'blocked' note (we only explain the block to someone who asked).
    update({ ...preference, optedIn: true, dismissed: false });
    void Notification.requestPermission().then(
      (result) => {
        setPermission(result);
      },
      () => {
        // Older callback-only implementations reject/never resolve; re-read
        // rather than assume, and never invent a 'granted'.
        setPermission(readPermission());
      },
    );
  }

  function dismiss(): void {
    update({ ...preference, dismissed: true });
  }

  function disable(): void {
    update({ ...preference, optedIn: false, dismissed: true });
  }

  return { prompt: decision.prompt, regionRef, enable, dismiss, disable };
}
