# Project state

## Roadmap status (Task 6.2b — the three P0 UI/motion punch-list items) — ✅ COMPLETE (all three fixed + browser-verified at 375 / 800 / 1280px; NOT yet live-verified on prod) (2026-08-15)

**Scope.** Only the three **P0** items from ROADMAP.md's 6.2b punch list (senior
audit 2026-08-11). P1/P2/P3 items are deliberately untouched — separate runs.
No commit made — changes left in the working tree for review.

**What shipped, per file**

- **`src/components/charts/Sparkline.tsx` (P0 #1 — gap treatment).** The
  `.defined()` null-breaking is UNCHANGED — the data line/area still break at
  every null day and never interpolate across (repo null discipline, ROADMAP
  4.11). Two non-data signifiers were layered on top of the intact break:
  (1) a `connectorPath` — a faint dotted `--color-muted` bridge through all
  defined readings, drawn UNDER the solid line so it shows ONLY in the null
  spans (it never asserts a value there); (2) `isolatedPoints` — a reading with
  no defined neighbour either side draws no solid segment (d3 `line()` emits a
  bare invisible moveto — this WAS the "orphaned stub"), so it now gets the
  `.sparkline-latest-dot` treatment. The `<desc>` and `ChartDataTable` values
  are untouched (still the real Celsius numbers), and the draw-on entrance is
  still double-gated on `prefers-reduced-motion`. New CSS: `.sparkline-gap-connector`
  in `charts.css`, added to that file's reduced-motion transition-kill block.
- **`ProgressRing.tsx` + `StrainRingTile` (App.tsx) + `--color-chart-5` (P0 #2 —
  strain fill).** Per Amaya's correction the pale TRACK is intentional — `trackColor`
  untouched. Two FILL fixes: (a) `--color-chart-5` `#02b3ff` → **`#0088cc`**
  (2.36:1 → **3.95:1 white / 3.62:1 tile**, clears the 3:1 non-text minimum). This
  is the shared Strain token, so it changes BOTH the ring AND `RecoveryStrainComboChart`'s
  (4.2) strain line — accepted and intended (same "Strain = azure" semantic,
  both were the same sub-3:1 hue, both improve; the 4.2 line now passes on its own
  instead of resting on rule-4 redundancy). No ring-only `progressColor` override
  needed. (b) A new **generic** `minFraction` prop (default 0) on `ProgressRing`
  floors the RENDERED arc at `Math.max(fraction, minFraction)`; `StrainRingTile`
  derives the floor as `0.9 / STRAIN_SCALE_MAX`. The `valueLabel` and `<desc>` are
  the caller's own true text and are never floored — the visual floor never leaks
  into the accessible channel. `noData` and the Recovery ring are untouched
  (no `minFraction` passed → default 0 → no change).
- **`components.css` `.range-toggle-thumb` (P0 #3 — selected-state contrast).**
  Strengthened WITHOUT touching the fill token, so the **11.97:1 dark-on-pale
  label, the 1.22:1 documented fill, and the `aria-checked` redundancy are all
  preserved exactly**: border thickened 1px → 2px `--color-accent-strong`
  (6.42:1 on the track), plus a soft blue-tinted depth shadow
  (`0 2px 6px -2px rgba(9,102,148,.35)`, the `--shadow-card` family — not a new
  color token) so the segment reads as a raised chip. Two independent cues now,
  not one thin line. The sliding-pill animation + reduced-motion handling are
  untouched.
- **`design.md` §1** — new dated 6.2b note documenting the `#0088CC` ratios and
  the shared-token consequence, plus the chart-palette / hue-mapping table rows
  updated (`Bright azure` → `Deep azure`). RangeToggle change documented there too.
- **`src/components/charts/RecoveryStrainComboChart.tsx`** — comment-only: the
  stale `#02B3FF` / "2.36:1" references in the header updated to the new value.

**Contrast ratios (WCAG 2.x relative luminance; white and the `≈ #edf7fc` tile)**

| Token / element        | Before          | After                    |
| ---------------------- | --------------- | ------------------------ |
| `--color-chart-5` fill | 2.36 / 2.17 (✗) | **3.95 / 3.62 (✓ ≥3:1)** |
| RangeToggle label      | 11.97:1         | 11.97:1 (unchanged)      |
| RangeToggle fill       | 1.22:1          | 1.22:1 (unchanged)       |
| RangeToggle border     | 6.42:1 @ 1px    | 6.42:1 @ **2px**         |

**Verified (browser, 2026-08-15, temporary `vite.config.ts` mock — the 4.1/5.3
dev-middleware trick; reverted afterwards, `git diff vite.config.ts` empty)**

- Gates: `npm run lint`, `npx tsc -b` (exit 0), `npm run typecheck:api`,
  `npm run format:check` all pass.
- Verified via computed DOM values (per the "preview downscales screenshots"
  note — geometry over eyeballing), at **375 / 800 / 1280px**, zero horizontal
  overflow at every width:
  - **Sparkline:** solid line has 4 subpaths (3 real fragments + 1 bare moveto
    for the isolated reading — proving the stub WAS invisible); exactly 1 dotted
    connector (`rgb(84,109,128)` = `--color-muted`, dash `2 3`, opacity .55, 1px);
    exactly 1 isolated dot; latest dot present; `<desc>` still reads "17 of 30
    days have a reading" with the real range.
  - **Strain ring:** rendered arc fraction = **0.0429** (the floor, `0.9/21`),
    NOT the true `0.0238` — while `valueLabel` = "0.5" and `<desc>` = "0.5 of 21
    …" keep the true value. Stroke `rgb(0,136,204)` = `#0088cc`. Recovery ring
    unchanged (0.72, green `rgb(107,203,60)`).
  - **RangeToggle:** thumb `border-top-width` 2px, color `rgb(15,100,148)`
    (`--color-accent-strong`), box-shadow carries both the inset gloss and the
    new lift, background `rgb(201,238,255)` = `#c9eeff` (unchanged).
  - **Reduced motion (§5.2 rule 5):** confirmed by forcing the media query — all
    JS-gated entrances render their final state immediately.

**Still open / flagged**

- **NOT live-verified on prod.** The mock proves the geometry/contract; confirm
  on the real deployment against a synced account — especially the sparkline on
  actual sparse skin-temp data, and a genuinely low-strain day showing the floor.
- **Judgment call on P0 #3, flagged for Amaya.** I kept the RangeToggle FILL
  unchanged to preserve the exact 11.97:1 label contrast the brief named, and
  strengthened via border + shadow. If that doesn't feel like enough "pop," a
  more saturated (but still pale) fill is the next lever — it would lower the
  label ratio below 11.97:1 (though it stays far above the 4.5:1 minimum). Not
  done unasked.
- **P1/P2/P3 of 6.2b remain open** — separate follow-up runs, not started.
- The two blockers from the prior entry (no Claude-in-Chrome extension; no
  computer-use grant) were NOT relevant here — the in-app Browser pane drove the
  temporary-mock verification.

**What needs human action**

- **Review the working-tree changes** (nothing committed), then **commit + push**
  (`main` auto-deploys Vercel prod) and do the live check above.

## Roadmap status (Live-verification pass — all of Phase 4 and Phase 5 checked against real production data) — ✅ 11 of 13 CONFIRMED, 1 known defect reproduced live, 1 diagnosed as not-a-bug (2026-08-15)

**Why this entry exists.** Nearly every Phase 4/5 task above carried the same standing residual: "mock-verified in the browser, NOT live-verified against real data." Amaya has been using the Vercel prod deployment from her phone and laptop, so this was a real-world check-through of each tile against her actual synced WHOOP account and journal history — not a new build. No code changed except the two items flagged below; this is a documentation pass recording what's now confirmed, done by walking Amaya through a checklist per feature and recording her direct observations (this session had no live browser/computer-use access — see the two blockers noted below).

**Confirmed working on real data (2026-08-15, user-confirmed):**

- **4.1** Sleep-stages stacked bar — real per-night bars, gaps render as gaps not zero bars.
- **4.2** Recovery/Strain combo chart — both series plot, missing data breaks the line rather than dropping to zero.
- **4.3 / 4.15** HRV and RHR rolling-baseline combo charts — real line + correctly-labelled "Recent baseline" band.
- **4.9** Recovery & Strain rings — re-confirmed (originally live-verified 2026-07-18). Note: this pass didn't specifically land on a yellow-zone (34–66%) recovery day, so that specific band is still only code-verified, not screenshotted.
- **4.10 / 5.7** Period meter — logging two periods ≥4 days apart produced exactly the designed progression: an open-ended pill row after the first entry, then the full estimated-length dot matrix after the second. This closes the last Phase 4/5 residual that had been open since 4.10 shipped in July.
- **4.12 / 4.13** Calories & Sleep stat cards — sensible values and deltas against real data; the sleep card's "As of [date]" fallback confirmed.
- **4.14** Range toggle — 1↔3 month switch visibly refetches and changes the numbers; persists across a reload.
- **5.2 / 5.3** Journal form + storage — a submitted entry survives a reload. First confirmed write to the real `daily_questionnaire` table from a logged-in browser.
- **5.5** Hydration-vs-recovery correlation chart — logged hydrated/not-hydrated days produce correctly colored dots and a sensible summary sentence.

**4.11 skin-temp sparkline — real defect, reproduced live, not yet fixed.** Renders real data and gap days do break the line rather than bridging it, but the render also shows 2–3 disconnected fragments plus an orphan dot instead of one continuous trend with a legible gap treatment. This is the exact defect the 2026-08-11 UI/motion audit already filed as **6.2b P0 item #1** — this pass confirms it's a real production bug, not a screenshot artifact or an illusion from sparse hardware data. No fix applied here; it's already queued in ROADMAP.md's 6.2b punch list. Still unconfirmed: whether the latest visible reading matches the WHOOP app's own figure for that day, and whether the sr-only data table quotes the exact same values as the SVG.

**5.4 reminders — diagnosed, working as designed, not a bug.** Amaya reported never getting a reminder. Root cause, found by walking through `src/lib/reminder.ts`'s decision table with her: she's seen the "Remind me when I haven't logged today" opt-in banner in the journal tile but never clicked it. `reminderDecision()` requires an explicit opt-in click as a second gate on top of browser permission (deliberate, per the 5.4 rules — permission alone isn't consent) — so nothing fires until that button is pressed and the resulting browser permission prompt is granted. Not a defect; just an unfinished setup step on her end. Still open: click through the opt-in on Chrome/Mac (her primary device) and confirm a real OS-level notification actually fires, since the constructor path itself has never been exercised outside a faked `Notification` in dev preview.

**Two blockers hit while trying to verify this directly, worth recording:**

1. The Claude-in-Chrome browser extension was not connected this session, so the lighter tab-automation tools couldn't reach the live dashboard.
2. Computer-use on Amaya's Mac requires the Claude desktop app to hold macOS Accessibility + Screen Recording permissions, which weren't granted yet — `computer_resolve_access` refused until that's done in System Settings.

Neither was resolved this session; verification instead went through a manual checklist with Amaya reporting what she saw. If either gets fixed later, live UI checks (e.g., the still-open WHOOP-app cross-checks on 4.11/4.12, or actually watching the 5.4 OS notification fire) could be done directly instead of by proxy.

**What needs human action**

- **4.11:** no action needed to close this entry — the defect is already tracked as 6.2b P0 #1; fixing it is a separate build task.
- **5.4:** click "Remind me when I haven't logged today" in the journal tile on the Mac, grant the browser's permission prompt, then leave a tab open on an unlogged day to confirm the OS notification fires.
- **Commit:** this entry plus the ROADMAP.md annotations are uncommitted in the working tree (`ROADMAP.md` also still carries the uncommitted 2026-08-11 6.2b punch-list addition from before this pass) — commit when ready.

## Roadmap status (Task 5.7 — cycle-day meter wired to real journal data) — ✅ COMPLETE (every branch mock-verified in the browser; NOT live-verified against real journal rows) (2026-08-03)

**The seam this closes**

The period-meter tile had shown its `no-data` placeholder since 4.10 — caption
"no data yet — the Phase 5 journal isn't built" — long after the journal
shipped in 5.3. Two independent halves of one gap: `App.tsx` rendered
`<PeriodMeterTile />` with no props (so `logs` defaulted to `[]` and
`cycleState` returned `no-data` unconditionally), and `GET /api/journal` only
served `?day=`, one row, while `cycleState` needs HISTORY — it recomputes
episodes from the full log every time, by design, so retroactive edits can
merge and split boundaries.

**What's done**

- **`api/journal.ts` — a range read**: `GET ?from=&to=` →
  `200 { days: [{ day, period }] }`, ascending. Routed on WHICH params are
  present; mixing `day` with `from`/`to`, or sending half a range, is a 400.
  Selects **only `day, period`** (not `ANSWER_SELECT`) — a dot matrix has no
  business receiving the user's notes, cramps and discharge. Span capped at
  **400 days** server-side; inverted ranges rejected. NULL `period` serializes
  as `null`, never `'no'`; unlogged days are absent, never synthesized. Cookie
  `userId`, 503 `{ waking: true }` + `Retry-After: 5`, generic error bodies —
  all the file's existing patterns verbatim. **No migration:** `unique
(user_id, day)` from 0001 already indexes `(user_id, day)`.
- **`src/hooks/usePeriodLogs.ts` (new)** — `useSleepStages`'s template line for
  line: same four-state union, same `cancelled` flag on every `setState`, same
  never-throw discipline. 100-day window ending today; returns `PeriodLog[]`
  plus the window's lower bound.
- **`src/lib/cycle.ts` — the clipped-episode guard** (`dropClippedEpisode`, and
  an optional last parameter on `detectEpisodes` / `cycleState`; both existing
  signatures still work). Still pure — zero imports, zero I/O.
- **`src/lib/day.ts` (new)** — `localTodayISO` moved out of `App.tsx` (plus
  `shiftDayISO`) so the hook shares one definition instead of copying it.
- **`PeriodMeterTile`** — consumes the hook, drives `ChartContainer`'s status
  from it, and carries corrected copy.
- **Untouched, on purpose:** the POST path, `journal-types.ts`, the 5.4
  reminder layer, `JournalSummary`. No schema change, no env var, no dependency.

**The one judgment call worth reading: where the guard's boundary sits**

A hard 100-day window can BISECT a period, and the first `'yes'` day inside it
then looks like a cycle start without being one. With ~3 episodes there are
only 2 gaps to average, so one fabricated start moves the estimate by days
(measured in the preview: **32 unguarded vs. 29 guarded** on the same fixture).
The oldest episode is dropped when its start can't be **proven** genuine, and
the threshold is DERIVED from `detectEpisodes`' own rule rather than chosen:
the nearest day the window could hide is `windowStart − 1`, which would join
the episode iff `start − windowStart < EPISODE_GAP_DAYS`. So offset 0–2 is
dropped and offset **exactly `EPISODE_GAP_DAYS` is kept** — a hidden `'yes'` 4
days before a start already splits into its own episode. Same "> not ≥"
boundary the grouping rule has. **`EPISODE_GAP_DAYS` itself is untouched.**
Cost: at most one episode, and if the dropped one was the ONLY episode the
meter falls back to `no-data` — deliberate, because an unprovable start yields
a `dayOfCycle` that is wrong, not merely imprecise.

**Verified (mock preview, 2026-08-03)**

- Gates: `npm run build`, `npm run typecheck:api`, `npm run lint`,
  `npm run test:cycle`, `npm run test:journal`, `npm run format:check` all pass;
  `test:transforms` and `test:reminder` re-run clean.
- `test-cycle.mjs` +4 cases (clipped episode dropped and the skew undone,
  unclipped kept, the exact `EPISODE_GAP_DAYS` boundary both ways, only-episode
  clipped → `no-data`, omitted argument → pre-5.7 behaviour).
  `test-journal.mjs` +2 cases through the REAL handler with mocked PostgREST
  (the `select=day,period` query, both bounds, the session `user_id`, NULL
  staying null, and every 400 guard with no Supabase call made).
- In-browser via a temporary `vite.config.ts` middleware mock (the 4.1/5.3/5.4
  trick — **reverted afterwards, `git diff vite.config.ts` empty**): the hook
  requests exactly `from=2026-04-26&to=2026-08-03` (100 inclusive days); 3
  episodes → "Day 5 of 29", `lengthSource: 'estimated'`, 29 dots, matching
  `<desc>`; 1 episode → "Day 7" over an open-ended 7-pill row with no track
  and no assumed 28 (see the follow-up below); 0 → the
  corrected no-data copy; 401 → "Connect your WHOOP account to see your cycle
  day."; 500 → the error state; clipped fixture → 29, not the unguarded 32. No
  console errors.

**Follow-up the same day: the `day-only` state got its pills back**

5.7 made that state reachable for the first time, and a bare "Day 7" text line
read as a broken tile rather than an honest one. `DotMatrix` gained an
**`openEnded`** mode: draw the filled dots, draw **no track**. Day 3 is 3 pills
then blank space — a count, not a proportion, with nothing marking where a
cycle would end, so the "never assume 28" decision is untouched (no denominator
drawn, none stated, and the caption reads "no cycle length yet — log a second
period"). `total` there is only a **reserved width** (`CYCLE_ROW_SLOTS` = 28,
the no-data track's rhythm) so a 3-pill row draws pills the size a 29-pill row
does; the viewBox scales to the tile, so sizing to the filled count alone would
balloon three dots across it. The row **grows** past the reservation rather than
capping — day 31 draws 31 pills — because with no denominator there is nothing
to cap against. Verified at days 1, 7 and 31 (no page overflow at 31), with the
`full` and `no-data` states unchanged.

**Second follow-up: the dots encode the journal's answer, not just position**

A dot's fill used to mean "has the cycle reached this day". It now means what
the journal SAID about that day: `'yes'` → `--color-chart-3` (#ffcce7),
`'no'` → `--color-chart-4` (#d9e3f0). `cycleState` gained `startDate` so dot
_i_ maps to `startDate + i` days; `DotMatrix` gained an index-aligned
`dotStyles`; the palette and the summary sentence live in the new pure
`src/lib/period-dots.ts` (the `hydration.ts` precedent).

**Four states, because the column is a tri-state and the row holds unreached
days too.** Not-logged takes `--color-border` + a DASHED outline (the hydration
matrix's "Undetermined" treatment) and pointedly NOT the `'no'` colour — NULL
means NOT ANSWERED, and colouring it as answered would put a claim on screen
the user never made. Future days take `--color-border` with no outline.

**Why every reached dot wears a hairline.** `--color-chart-4` (#d9e3f0) is
10/255 in one channel from `--color-border` (#cfe3f0), so as flat fills "no
period" and "not yet reached" are the same pixel; and #ffcce7 (1.2:1) /
#d9e3f0 (1.15:1) are both far under 3:1 on the white card. The `--color-muted`
hairline solves both at once, exactly as it does in the hydration matrix — the
outline, not the fill, is the separator.

**Trade worth knowing:** the row no longer reads as cycle PROGRESS. Only period
days are pink, so on day 20 of 29 the elapsed run survives only as the hairline
rather than a block of colour. Hollow or smaller future dots would restore it —
not done unasked.

**Still open / flagged**

- **NOT live-verified.** Nothing has ever written a row to the real
  `daily_questionnaire` from a logged-in browser (5.3's standing residual), so
  the meter has never met a real logged period. Confirm on prod by logging
  "Period: yes" on a couple of days — one episode gives "Day _n_" over an
  open-ended pill row,
  and the dot matrix only appears once a second episode ≥4 days later exists.
- **`typicalCycleLength` is still unresolved and its TODO intact** — the
  `user_settings` endpoint (ROADMAP 5.1 constraint 2) remains out of scope, so
  `lengthSource: 'user-reported'` is unreachable in the UI.
- **design.md §4 limitation #6 is still unsurfaced** — the TODO at the render
  site stands: episode starts are inferred, so a >3-day spotting gap inside one
  real period reads as a new cycle, and the manual "mark as new cycle start"
  override remains a follow-up.

**What needs human action**

- **Nothing to apply** — no migration, no new table, no new index, no env var.
- **Commit + push** (pushing `main` auto-deploys Vercel production), then do
  the live check above.

## Roadmap status (Task 5.4 — journal reminders) — ✅ COMPLETE (in-tab only; every branch mock-verified in the browser, real notifications NOT verified) (2026-07-31)

**What's done**

- **`src/lib/reminder.ts` (new)** — the entire reminder policy as ONE pure
  function, `reminderDecision({ today, dayStatus, permission, preference })`
  → `{ notify, prompt }`. Import-free and browser-free (the `cycle.ts` /
  `stats.ts` contract). That split exists for one reason: the Notification API
  can't be exercised in Node, so the RULES were pulled out of it and the shell
  around them kept thin enough to read.
- **`src/hooks/useJournalReminder.ts` (new)** — the browser half: reads
  `Notification.permission`, reads/writes the localStorage preference, raises
  the notification, and owns the focus ref a clicked notification lands on.
  It adds no rules of its own.
- **`src/components/JournalReminder.tsx` (new)** — the control: opt-in, off
  switch, blocked note, or nothing. Also decides nothing.
- **`scripts/test-reminder.mjs` (new, `npm run test:reminder`)** — 26 checks,
  including an exhaustive 144-case sweep (3 dayStatus × 4 permission × 12
  preferences) over three invariants.
- **`src/App.tsx`'s `JournalTile` wired** — reuses the mount-time
  `GET /api/journal?day=…` it already makes; **no new endpoint, no second
  request**. One new piece of state, `logged: boolean | null`.
- **Untouched, on purpose:** `api/_lib/journal-types.ts`, `api/journal.ts`,
  `src/components/JournalForm.tsx`. 5.4 is a layer above the 5.2 seam and
  beside the 5.3 caller, not a change to how the journal is asked or stored.
  No migration, no env var, no dependency.

**The four rules (and the failure each prevents)**

1. **Never remind someone who already logged.** `dayStatus` must be an
   affirmative `'not-logged'`; `'unknown'` (loading / 401 / failed load)
   produces no notification and no banner — "we couldn't tell" is not "you
   haven't logged", the same null discipline 5.1–5.3 run on.
2. **Never auto-request permission on load.** `requestPermission()` is called
   in exactly one place: the opt-in button's click handler. The browser prompt
   is a one-shot resource and spending it unasked usually earns a permanent
   `denied`.
3. **Never nag when the browser said no.** `denied` shows one explanatory line
   ONLY to someone who opted in, dismissible for good; a `denied` browser that
   never asked sees nothing.
4. **At most one notification per calendar day** — a stored `lastNotifiedDay`
   compared to today, not a timer or a render count, so a reload, a re-render
   or a second tab can't double-nudge.

**Two decisions worth knowing about**

- **The stored opt-in is a SECOND gate on top of the browser permission, not a
  mirror of it.** Read literally the brief would fire on `permission ===
'granted'` alone, which makes the persisted opt-in decorative (the browser
  already persists permission). Shipped as both, because an origin can hold
  that permission for an unrelated reason and because revoking it is buried in
  site settings — without an app-level switch, the only way to stop the nudges
  is a trip through browser settings. Cost, stated: an already-granted browser
  still presses the opt-in once. Reversing it is the `!preference.optedIn`
  branch plus one test case.
- **There is an OFF switch (`prompt: 'on'`), which the brief didn't ask for**
  — an opt-in with no way back is its own dark pattern, and it doubles as the
  deep-link focus target. Turning it off hides the control for good; **with no
  settings screen, re-enabling means clearing site data.** That's the honest
  cost of "dismissed means stop asking".

**`logged` is not derived from `answers`, deliberately**

A save whose values match what's on screen leaves `answers` untouched by
design (5.3's `journalAnswersEqual` deviation), and an all-null entry is a real
logged day that looks exactly like a blank one. `logged` is set from the load
(`entry != null`) and set true after a successful upsert — so saving today
makes the reminder vanish immediately, browser-verified.

**Verified (mock preview, 2026-07-31)**

- Gates: `npm run lint`, `npx tsc -b`, `npm run typecheck:api`,
  `npm run format:check`, `npm run test:reminder` all pass;
  `test:journal`, `test:cycle`, `test:transforms`, `test:stats` re-run clean.
- In-browser via a temporary `vite.config.ts` mock (the 4.1/5.3 trick — an
  `/api/journal` middleware plus an index.html shim faking `Notification`,
  since the preview browser's real permission is fixed at `denied`;
  **reverted afterwards — `git diff vite.config.ts` is empty**): opt-in banner
  on `default` with nothing fired; pressing it stores `optedIn: true` and, once
  granted, the region switches in place to the "on" copy with **exactly one**
  notification constructed (title "Log today's WHOOP journal", tag
  `whoop-journal-2026-07-31`) and `lastNotifiedDay` recorded; a reload with
  that day stored fires **zero**; a logged day fires zero, shows nothing and
  leaves `lastNotifiedDay` untouched; `denied` + opted in → the blocked line,
  `denied` alone and `unsupported` → nothing; the notification's click handler
  scrolled (0 → 1815) and moved focus onto the region; "Turn reminders off"
  empties it (`display: none`, height 0, no leftover flex gap); saving the form
  makes it vanish while 5.3's "Saved." still appears; no console errors; no
  horizontal overflow at 375px, where both buttons wrap and keep 44px targets.

**Still open / flagged**

- **NOT live-verified, and only partly verifiable here.** The real permission
  prompt, a real OS notification, its click in the real notification centre,
  and the midnight rollover have never run — every branch above was reached
  through a faked `Notification`, because the preview browser's permission is
  permanently `denied`. Confirm on prod: opt in, leave the tab open on an
  unlogged day, click the notification.
- **Expected behaviours, not bugs:** a tab left open across midnight won't
  re-check until a reload (`today` is computed when the tile mounts); Chrome on
  **Android** throws on the `Notification` constructor and needs the
  service-worker path (ROADMAP 5.6) — the throw is caught, so the tile is
  unaffected and the day is marked attempted rather than retried every reload.
- **Closed-browser push is ROADMAP 5.6, not built** — service worker + VAPID
  keys + a subscriptions table + a server-side scheduler. Half-building it
  would look identical to a working reminder right up to the moment it never
  fires.
- Everything still open from 5.3 stands: no row has been written to the live
  `daily_questionnaire` yet, the once-only cycle-length prompt is unbuilt, the
  period meter still renders `no-data` (**this one closed in 5.7**), and 5.2's
  desktop bento-layout question is still your call.

**What needs human action**

- **Nothing to apply** — no migration, no env var, no dependency.
- **Commit + push** (pushing `main` auto-deploys Vercel production), then do
  the live check above.

## Roadmap status (Task 5.3 — journal storage) — ✅ COMPLETE (mock-verified in the browser; NOT yet live-verified against prod) (2026-07-31)

**What's done**

- **`api/journal.ts` (new)** — the read/write path for the daily
  questionnaire, `GET /api/journal?day=YYYY-MM-DD` and
  `POST /api/journal { day, answers }`, modelled on `api/sleep-stages.ts`
  (same `parseCookies`/`json` helpers, same auth check, same
  `DatabaseUnavailableError` / `isDbUnavailableStatus` → `503 { waking: true }`
  - `Retry-After` classification, same "log the detail, return a generic body"
    rule). **No migration was written and none is needed** — 0004 has been live
    since 2026-07-30, so this is the first code to write the table that already
    exists.
- **Identity is server-side only.** The member comes from `decodeSession()` on
  the `whoop_session` cookie; the `user_id` written to (and filtered on) is
  that value, never a field from the body or query string. The service-role
  client bypasses RLS, so this filter is the ONLY thing separating two
  members' rows — asserted directly in the tests, with a POST body that tries
  to write `user_id: 'member-999-attacker'` and gets the session's id stored
  instead.
- **UPSERT, not append** — `.upsert(row, { onConflict: 'user_id,day' })`
  against 0004's `unique (user_id, day)`, because Phase 5 is an "edit today"
  workflow. `updated_at` is stamped by the write path (0001's convention: the
  table has no trigger); `created_at` is left out of the payload so a re-save
  doesn't rewrite it.
- **`entry: null` is a 200, not a 404.** "Nothing logged today yet" is the
  normal state of this endpoint on any morning; a 404 would make the tile
  render an error for the most common case. The read uses `.limit(1)` and
  takes `[0]` rather than `.single()`/`.maybeSingle()`, so "no row" stays an
  ordinary empty result with no PostgREST error semantics to reinterpret.
- **Null discipline enforced on BOTH sides of the wire.** Validation is
  hand-written per field rather than a coerce, and returns an `INVALID`
  sentinel deliberately distinct from `null` — so "the client sent garbage"
  (400) can never collapse into "the user didn't answer" (a NULL column). An
  absent or null field is written as an explicit NULL, no field is ever
  defaulted, and a wrongly-TYPED field is a 400 rather than something coerced
  into a shape the DB would accept (`hydrated: 'yes'` → 400, not `true`). The
  response is built key by key so a NULL column comes back as a present key
  with a `null` value instead of disappearing.
- **The API does not trust the form.** Bounds and vocabularies are re-checked
  server-side against the same `journal-types.ts` constants the form uses
  (`CAFFEINE_SERVINGS_MIN/MAX`, `ALCOHOL_DRINKS_MIN/MAX`, `CRAMP_LEVELS`,
  `DISCHARGE_LEVELS`, the `PeriodAnswer` union) — the endpoint is reachable
  without the form. Failures return a generic `400 { error: 'Invalid
request.' }` that doesn't enumerate the rules; `day` must be a real calendar
  date (the regex alone would accept `2026-13-45`), and the body has a 64 KB
  ceiling since `notes`/`extra` are free-form. Unknown keys in `answers` are
  ignored rather than forwarded, because the row is assembled field by field.
- **`scripts/test-journal.mjs` (new, `npm run test:journal`)** — the real
  handler against a mocked PostgREST (`global.fetch`), the test-session.mjs
  pattern: no creds, no network, no re-implementation. 60 checks across auth
  (401 both verbs, DB never touched), `entry: null`, a stored row with an
  explicitly-NULL column and an answered `0`/`false`, out-of-bounds and
  wrong-typed payloads (400 **and no upsert attempted**), the upsert request
  itself (asserted against the real `on_conflict=user_id,day` +
  `Prefer: resolution=merge-duplicates` supabase-js emits, and the written
  `user_id`), malformed `day` on both verbs, 540/503/500 classification, the
  Vercel pre-parsed-`req.body` shape, and 405.
- **`src/App.tsx`'s `JournalTile` wired** — mount-time `GET` with a
  cancellation flag (the `useSleepStages`/`session-check` convention;
  same-origin fetch, so the cookie rides along with no `credentials` option,
  matching every other call), `ChartContainer status="loading"` in flight and
  `"empty"` on 401 (the 4.9 rule), `"error"` on anything else. `handleSave` is
  async, awaits the real upsert, and drives the `submitting`/`submitError`
  props `JournalForm` already accepted but 5.2 left unset; it rethrows on
  failure so the form withholds its "Saved." status. **`JournalForm.tsx` was
  not touched** — the 5.2 seam held exactly as designed.
- **The "Not stored yet — entries last until you reload" subtitle is gone**,
  along with the `.journal-session-note` rule in `App.css` that styled it (its
  own comment said to delete it when 5.3 landed).

**One deviation worth knowing about, found in the browser**

- The obvious `setAnswers(entry)` after every successful write is WRONG here,
  and the bug is invisible in tests: handing `JournalForm` a new
  `initialAnswers` reference makes it re-seed, and re-seeding calls
  `setSaved(false)` — so the tile's own state update was erasing the only
  confirmation a successful save produces. Observed live (button returned to
  "Save journal" with an empty status region). Fixed in the CALLER, not the
  form: the tile adopts the server's echo only when it actually differs from
  what was submitted (`journalAnswersEqual`, field by field with `extra`
  serialized). When the server stored exactly what we sent — the normal case —
  the form already displays what's stored, so leaving it alone is both correct
  and what keeps "Saved." on screen.

**Verified (mock preview, 2026-07-31)**

- Gates: `npm run lint`, `npx tsc -b`, `npm run typecheck:api`,
  `npm run format:check`, `npm run test:journal` all pass;
  `npm run test:transforms` and `npm run test:cycle` re-run clean (no Phase 4
  regression).
- In-browser via the temporary `vite.config.ts` middleware mock (the 4.1
  trick; **reverted afterwards — `git diff vite.config.ts` is empty**):
  a loaded row seeds the form with null discipline intact (`hydrated: false` →
  "No", `discharge: null` → "Not answered", `caffeine_servings: 0` → "0",
  `alcohol_drinks: null` → blank); an edit + save POSTs
  `{"day":"2026-07-31","answers":{…,"traveled":true,"alcohol_drinks":2,"discharge":null,…}}`
  — unanswered fields as explicit nulls, `0` still `0`; a reload reads the
  saved values back; mid-flight the button is disabled and reads "Saving…",
  after it the status region says "Saved."; a forced 500 renders the
  `role="alert"` message, no "Saved.", and leaves the user's edits in place;
  `entry: null` opens a blank form (counts blank, not `0`); a 401 renders
  "Connect your WHOOP account to log your day." with no form. No console
  errors.

**Still open / flagged**

- **NOT live-verified.** No real logged-in browser has hit
  `/api/journal` on production, so no row has ever been written to the live
  `daily_questionnaire` — the same residual every Phase 4/5 entry carries.
  The mock proves the wiring and the contract; it does not prove the 0004
  CHECK constraints accept what this endpoint sends. Confirm after deploy by
  saving a journal entry and reloading.
- **The once-only "typical cycle length" prompt is still unbuilt** (ROADMAP
  5.1 constraint 2) — deliberately out of 5.3's scope, as the ROADMAP note
  says. It writes `user_settings` and must first READ
  `typical_cycle_length_asked_at`, which needs an endpoint that doesn't exist
  yet. TODOs remain in `JournalTile` and at `JournalForm`'s `period` control.
- **The period meter still renders `no-data`.** 5.3 stores the tri-state
  `period` field but nothing reads the history back yet — wiring
  `PeriodMeterTile`'s `logs` (and passing the cycle length UNRESOLVED) is the
  next step, and is what finally closes 4.10's residual.
  **RESOLVED by 5.7 (2026-08-03)** — the range read + `usePeriodLogs` do exactly
  that; the cycle length is indeed passed unresolved.
- **5.2's desktop bento layout question is still open** — the journal tile is
  a 219×1651px column at ≥640px. Untouched here; still your call (cap +
  scroll, own full-width row, or out of the grid).

**What needs human action**

- **Nothing to apply** — 0004 is already live (2026-07-30), and 5.3 adds no
  env var and no dependency.
- **Commit + push** (same as every prior phase): pushing `main` auto-deploys
  Vercel production, which is what makes `/api/journal` real. Then do the live
  check above.

## Roadmap status (Task 4.10 — period meter, dot-matrix cycle-day bar) — ✅ COMPONENT + LOGIC COMPLETE (no-data state browser-verified; NOT live-verifiable — no data source exists) (2026-07-18)

**What's done**

- **Three user decisions CONFIRMED (2026-07-18)**, superseding the 2026-07-14
  "PROPOSAL, pending confirmation" language in ROADMAP.md/design.md §4:
  (1) episode-gap threshold = **3 days**, strictly `> 3` (a 3-day gap
  continues the episode), shipped as `EPISODE_GAP_DAYS = 3` and flagged
  in-code as a chosen heuristic, not clinically derived; (2) typical cycle
  length is **asked once, on the first logged period** (the ask is Phase 5's)
  — never an assumed 28; absent a length the meter is text-only, no
  denominator, no dot row; (3) component + logic + tests ship now, the tile
  stays honestly empty until Phase 5 ships the journal's Period field.
- **`src/lib/cycle.ts`** (new, pure, import-free): tri-state `PeriodLog`
  (`null` = not logged ≠ `'no'`), `detectEpisodes` (explicit-`yes` days only;
  `'no'`/null ignored identically so a missed logging day never splits a
  period; always recomputes from FULL history so retroactive edits
  merge/split/shift correctly), `estimateCycleLength` (mean start-to-start
  gap; **null under 2 episodes**, callers must not substitute a default),
  `cycleState` (`no-data` / `day-only` / `full` union; `dayOfCycle` counts
  inclusively from the latest start, past the end of bleeding, unclamped past
  the length; `lengthSource: 'estimated' | 'user-reported'`, estimate
  preferred). Date math = UTC-normalized day numbers — local-midnight ms
  division is DST-off-by-one (asserted in tests).
- **`src/components/charts/DotMatrix.tsx`** (new, barrel-exported): plain SVG
  circles positioned by index (no d3 `scaleBand` — a band scale over indices
  is one expression; ProgressRing precedent). §5.2: `role="img"` +
  `<title>`/`<desc>` via `aria-labelledby` (desc carries the one scalar
  verbatim = rule-2 fallback), day number is real visible text, entrance fade
  double-gated on reduced motion (JS `chartTransitionDuration` + charts.css).
  Fill = `--color-chart-3` (confirmed shared skin-temp/period token), track =
  `--color-border`. Overflow renders a full row, never extra dots — the
  label/desc carry "Day 31 of an estimated 28-day cycle".
- **`src/App.tsx`**: `PeriodMeterTile` replaces the static 28-span
  placeholder; dead `.period-bar`/`.period-seg*` CSS removed from App.css
  (4.9 precedent). Renders all three `cycleState` kinds, so the **Phase 5
  seam is its `logs` / `typicalCycleLength` props**. ChartContainer stays
  `ready` (4.9 rule: `empty` = 401/no session; dataless-but-successful is the
  component's own no-data state). A marked TODO at the render site requires
  surfacing the inference limitation (design.md §4 #6) in the UI once real
  data flows.
- **`scripts/test-cycle.mjs`** + `npm run test:cycle` (test-transforms
  pattern: real module, synthetic fixtures, hand-computed expectations):
  **38 checks, ALL PASS (2026-07-18)** — incl. the exact >3-vs-≥3 boundary,
  null ≡ 'no' grouping, retroactive merge AND split, round(28.5)=29 with
  'estimated' beating a reported 30, day 36-of-28 unclamped, and exact counts
  across both DST transitions.
- Gates: `npm run lint`, `tsc -b`, `typecheck:api`, `format:check`,
  `test:cycle` all pass (2026-07-18).

**What's verified**

- Unit level: everything in `cycle.ts`, exhaustively (above).
- Browser level (dev preview, 2026-07-18): the **no-data state only** —
  28-dot all-track decorative row, muted "—", caption "no data yet — the
  Phase 5 journal isn't built", `aria-labelledby` resolving to title + honest
  desc, zero console errors. (Plain `vite dev`, no `/api` — irrelevant here,
  the tile fetches nothing.)

**Still open / flagged**

- **NOT live-verified, and cannot be:** no data source exists (the journal is
  Phase 5.1), so `day-only` and `full` have never rendered outside unit
  tests. Verify against real journal data when Phase 5 ships; only then does
  this task's residual close. The checkmark means "logic tested + tile
  honest," not "meter works."
- Phase 5.1 inherits two hard constraints (recorded there): the tri-state
  Period field, and the ask-once typical-cycle-length question wired to
  `PeriodMeterTile`'s prop.
- Limitation #6 (design.md §4): episode starts are inferred from daily
  checkboxes — a >3-day spotting gap inside one real period reads as a new
  cycle. Must be surfaced in the UI when the meter goes live (in-code TODO);
  the manual "mark as new cycle start" override stays a Phase 5+ enhancement.

## Roadmap status (Task 4.9 — recovery & strain progress rings) — ✅ COMPLETE (mock-verified + LIVE-VERIFIED) (2026-07-14, live check 2026-07-18)

**What's done**

- **`src/components/charts/ProgressRing.tsx`** (new, barrel-exported):
  reusable single-value ring — SVG `<circle>` + `stroke-dasharray`/
  `stroke-dashoffset` (no `d3-shape`; `offset = C × (1 − fraction)`,
  fraction clamped defensively). §5.2: `role="img"` + `<title>`/`<desc>` via
  `aria-labelledby` (desc = value + zone + scored day; for a single scalar
  that IS the rule-2 text fallback), centered value is real SVG text in
  `--color-text`, dashoffset entrance gated on reduced motion in JS
  (`chartTransitionDuration`) and CSS. `noData` = bare track + muted "—" +
  "no data yet" caption, honest desc.
- **`src/App.tsx`**: `RecoveryRingTile` / `StrainRingTile` replace the
  static donut placeholders; ONE shared `useDailySeries(7)` in `App` feeds
  both (avoids a duplicate fetch of identical rows). Each tile takes its own
  latest non-null day (recovery may lag strain by a day when today is
  PENDING_SCORE — the null discipline handles it). 401 → `empty` with a
  connect message; ready-but-unscored → ring `noData`, not `empty`.
- **Recovery zones VERIFIED** against
  https://developer.whoop.com/docs/whoop-101/ (2026-07-14): green 67–100%,
  yellow 34–66%, red 0–33% (constants `RECOVERY_ZONES`, cited in-code);
  same page confirms strain's 0–21 Borg scale. Zone hues = fill-safe UI
  tokens; strain = `--color-chart-5` (§4 mapping). Dead `.stat-donut*`
  CSS/markup removed.
- Lint / `tsc -b` / `typecheck:api` / prettier pass. Visually verified via
  the temporary vite dev-middleware mock of `/api/daily-series` (green 72%,
  red 28%, strain 6.3, strain-noData; `aria-labelledby` resolution checked
  in-browser), mock fully reverted afterward.

**LIVE-VERIFIED on Vercel prod (2026-07-18, user-confirmed)**

- Both rings render real values from real `/api/daily-series` data against a
  synced account — closing 4.9's only blocking residual (the "live-unverified"
  item carried since 2026-07-14). The 4.1 initial-state residual is now closed
  by the same check.
- **Root cause of the empty-state scare (worth keeping — it was never a chart
  bug):** the rings sat in `noData` on prod because Supabase held ZERO rows for
  the member. `api/sync.ts` `isAuthorized()` fails closed when `CRON_SECRET` is
  unset — it logs and returns 401 before any work — and `CRON_SECRET` had never
  been set on the Vercel project. Every nightly cron since deploy was rejected,
  so the cache was never filled. `/api/daily-series` still returned a clean 200
  with all-null points (null discipline working as designed), which is exactly
  why the tiles showed `noData` rather than `empty`/`error` — the state machine
  was correct throughout and pointed straight at the real fault. Fixed by
  generating a secret (`openssl rand -base64 32`), adding it to Vercel
  **Production**, redeploying, and seeding the cache with
  `npm run sync:whoop -- --days 30`.
- **Diagnostic worth reusing:** ring state discriminates the failure mode for
  free — `empty` ⇒ 401/no session; `error` ⇒ non-OK response (incl. 503 waking
  or a missing service-role key); `noData` ⇒ the request SUCCEEDED and the data
  is genuinely absent or unscored. Read the tile before reading the logs.

**Still open / flagged**

- Yellow zone (34–66) still exercised only through the shared `recoveryZone()`
  code path — the mock covered green/red and the live check landed outside the
  yellow band. Not screenshotted separately; low risk (one shared function).
- **Doc gap that caused this — CLOSED (2026-07-18):** `CRON_SECRET` was absent
  from `vercel-env-setup.md` and `.env.example`, appearing in ROADMAP 2.5 /
  this file only as a hypothetical failure mode, never as a setup action. Now
  fixed: `vercel-env-setup.md` is retitled "The 8 environment variables" with
  `CRON_SECRET` as row 8 plus a generation/scoping/verification section, and
  `.env.example` gains a documented `CRON_SECRET` entry flagging the
  fails-closed-and-silently behavior. The 2.5 cron check was promoted from
  "worth a periodic glance (not blocking)" to a REQUIRED standing verification
  (see that section).
- **Also unverified as a consequence:** because the cron never ran, the 2.5
  reasoning for skipping a keep-warm cron ("the daily sync is real DB activity,
  so the free-tier project can't pause") rested on a false premise for the
  whole period. The premise is true again now that sync runs; no code change
  needed, but the pause risk was live and unmonitored until 2026-07-18.
- `api/callback.ts` still does NOT trigger a sync on connect, so a freshly
  connected account shows an empty dashboard until the next 08:00 UTC cron.
  Not a 4.9 defect, but it is the same empty-state symptom from a different
  cause — worth closing before anyone else connects an account.

## Roadmap status (Task 4.1 — stacked bar chart, sleep stages) — ✅ COMPLETE (sandbox-verified + partially live-verified) (2026-07-09, live check 2026-07-13)

**What's done**

- **`api/sleep-stages.ts`** (new endpoint, structured on session.ts):
  `GET /api/sleep-stages?days=<n>` (default 30, clamped 1–90). Auth = the
  `whoop_session` cookie via `decodeSession`; missing/invalid →
  `401 { error: 'Not authenticated.' }`. Queries `whoop_sleep` for exactly the
  `SleepMetricRow` columns (so DB rows pass into `buildSleepStageBreakdown`
  with no mapping layer — the transforms' first real caller), day-ascending
  over the last n days (UTC window). Returns `200 { points }`;
  `DatabaseUnavailableError` → `503 { waking: true }` + `Retry-After` (same
  classification as session.ts); anything else logs server-side and returns a
  generic `500 { error: 'Failed to load sleep stages.' }` — no Supabase
  internals leak.
- **`src/components/charts/StackedBarChart.tsx`** — GENERIC stacked bar (typed
  `keys` constrained to T's nullable-numeric fields; reusable later for e.g.
  strain contributors). d3-shape `stack()` for layout; `scaleBand` (day) +
  `scaleLinear` (minutes) + shared `Axis`/`ChartSvg`/`Legend`/`Tooltip`/
  `ChartDataTable`. §5.2 contract: data-describing `<title>`/`<desc>` (real
  date range, totals range, gap count); sr-only table rendered from the SAME
  `data` prop (one row/night, one column/stage + total, nulls read "no
  data"); every segment `.chart-mark` with `tabIndex={0}`, identical tooltip
  on mouseenter/focus, Escape dismisses; entrance fade gated on
  `chartTransitionDuration` (0 under reduced motion); legend from the `keys`
  prop. **Null discipline:** a night with `totalMinutes === null` keeps its
  x-axis band slot but draws NO rects — a visible gap, never a zero-height
  stack. Every segment wears a 1px `--color-muted` stroke
  (`.chart-bar-segment`, charts.css) since chart-1/-4 fail 3:1 on white.
- **`src/hooks/useSleepStages.ts`** — mount-time fetch with a cancellation
  flag (session-check.ts discipline); states `loading | unauthenticated |
error | ready`. Type-only import of `SleepStageBreakdownPoint` from
  `api/_lib/transforms` (erased at build — nothing from /api enters the
  bundle; the module is browser-safe by contract anyway).
- **`src/App.tsx`** — `SleepStagesTile`: full-width ChartContainer BELOW the
  closing `</section>` of `.bento-grid` at the dashboard's 1200px column
  width (per the §2 "Layout gap" decision). `status` driven from fetch state:
  401 → 'empty' with a "connect WHOOP" note (a disconnected dashboard isn't
  an error), zero points → 'empty' with a "run a sync" note, non-OK/network →
  'error', else 'ready' rendering StackedBarChart.
- **Color mapping (design.md §4, PROPOSAL pending confirmation):** Deep =
  chart-5 dark blue (bottom), REM = chart-2 dark orange, Light = chart-1
  light blue, Awake = chart-4 pale mustard (top). NOTE the brief's arithmetic
  was corrected: six of seven hues are already load-bearing on this view, so
  THREE reserved tokens are reused (2/4/5), not one — reuses chosen for
  lowest collision (calories tile is text-only today; the ideal band is a
  muted background; strain never co-occurs in a sleep chart). Rejected:
  chart-6 (Recovery's semantic green, and the 4.4 recovery calendar will sit
  directly below), chart-3 (skin temp + period on the same view), chart-7
  (actual line in two charts).
- Verified in the sandbox: `npm run typecheck:api`, `npx tsc -b --force`,
  `npx eslint .`, `npm run test:transforms`, `npx vite build`,
  `npx prettier --check .` all clean.

**What's still open / needs human action**

- **Live-verified on 2026-07-13 (user-confirmed, not re-checked by this
  session):** (a) the tile leaves 'loading' for 'ready' with real bars against
  live Supabase/WHOOP, and (c) `GET /api/sleep-stages` returns points matching
  `npm run sync:whoop`'d rows — first live proof of the 2.6 DTO ↔ DB-row
  compatibility.
- **Still NOT verified live:** (b) an unscored/missing night shows a visible
  gap (not a zero-height bar), and (d) the 401 → "connect WHOOP" empty state
  in a logged-out browser. Confirm these before calling 4.1 fully closed.
- **Confirm the §4 sleep-stage color mapping** (or redirect it) — flagged as
  a proposal; App.tsx `SLEEP_STAGE_KEYS` is the single place to change.
- Tooltip positioning assumes the SVG renders at its measured width (true
  for the current full-width layout; revisit if a chart ever renders scaled).
- Commit + push are yours (`main` auto-deploys Vercel prod).

## Roadmap status (Task 4.0 — charting foundation) — ✅ COMPLETE (2026-07-09)

**Chart→metric mappings confirmed (2026-07-09):** user accepted the ROADMAP
Phase 4 suggested mappings as-is; chart 6 (dot-matrix #3) uses the
strain-matrix variant, not the questionnaire-correlation variant, since
Phase 5 doesn't exist yet. Locked table is in `design.md` §4.

**What's done** — `src/components/charts/`, D3 (+ `@types/d3`) added to
`package.json` dependencies:

- `useChartDimensions.ts` — responsive SVG sizing via `ResizeObserver` on a
  wrapper `<div>`; charts render `viewBox="0 0 width height"` so they scale
  fluidly instead of blurring between measurements. Returns a bounded
  plot-area (width/height minus margins, floored at 0).
- `scales.ts` — re-exports `d3-scale`'s `scaleLinear`/`scaleBand`/`scaleTime`/
  `scaleOrdinal`, plus `safeExtent()` (null-safe `d3.extent` wrapper with a
  fallback domain so an empty dataset renders a valid empty axis instead of
  throwing) and `dayDomain()` for day-string series.
- `Axis.tsx` — shared bottom/left axis. Deliberately **not** an imperative
  `d3.axis()` call into a ref — D3 only supplies the scale + computed tick
  values, React renders the `<g>/<line>/<text>` elements declaratively, per
  the roadmap's "React owns DOM/state, D3 owns scales/shapes" split. Every
  tick label is real DOM text.
- `motion.ts` — `prefersReducedMotion()` / `chartTransitionDuration()`,
  mirrors the existing CSS `@media (prefers-reduced-motion: reduce)` rule;
  every chart's D3 transitions must be gated through this (design.md §5.2
  rule 5).
- `Tooltip.tsx` + `useTooltip.ts` — shared floating tooltip box and a
  hover/focus state hook with one `show()` entry point so mouse and keyboard
  focus open the identical tooltip (rule 3), plus Escape-to-dismiss.
- `Legend.tsx` — same swatch (`aria-hidden`, `--color-muted` bordered) +
  real-text-label pattern already locked in `App.css` (task 3.4); adds an
  optional `onToggle` that renders a real `<button aria-pressed>` for 4.7's
  interactive legends instead of a plain span.
- `ChartSvg.tsx` — accessible `<svg role="img">` wrapper wiring
  `aria-labelledby` to a `<title>`/`<desc>` pair (rule 1); `<desc>` must
  describe the data, not the chart type — enforced by the required `desc` prop.
- `ChartDataTable.tsx` — visually-hidden (`.sr-only-table`), screen-reader-
  exposed data table (rule 2); renders from the same series prop the SVG
  draws from, never a re-fetch. Null cells render "no data", never 0.
- `charts.css` — axis stroke/text styles, `.chart-tooltip` positioning,
  `.legend-item-toggle` (with `aria-pressed='false'` dimming),
  `.chart-mark:focus-visible` (rule 3's focusable point outline), and
  `.sr-only-table`. Tokens-only, same discipline as `components.css`.
- Barrel export: `src/components/charts/index.ts`.

Verified in the sandbox: `npx tsc -b --force` clean, `npx eslint .` clean,
`npx prettier --check` clean (after `--write`), `npx vite build` succeeds
(built against a temp outDir — same stale-file sandbox quirk as prior
phases, unrelated to the code).

**What's still open / flagged for a decision before 4.1–4.6 proceed:**

- **Layout gap:** the confirmed Figma bento grid (Phase 3.2 follow-up) has 9
  tiles — period, journal, recovery donut, sleep stat, calories stat, strain
  donut, skin-temp sparkline, HRV combo, RHR combo. Only 2 of those (HRV,
  RHR) are combo charts matching ROADMAP Phase 4's 6 chart types. There is
  **no existing tile** for the stacked-bar (sleep stages) or any of the 3
  dot-matrix charts (recovery calendar, sleep performance, strain matrix) —
  those need a layout decision (new bento tiles/rows, or replace an existing
  stat/donut tile) before 4.1/4.4/4.5/4.6 can be built. Not blocking 4.2/4.3
  (HRV/RHR already have homes) or the foundation itself.

## Roadmap status (Task 3.4 — responsive + accessibility) — ✅ COMPLETE (verified locally in the dev server) (2026-07-08)

**What's done**

- **Breakpoint audit (375/768/1024/1280px, live in the preview browser, not
  inferred from CSS):** at every width `document.documentElement.scrollWidth`
  === `innerWidth` (375/768/1024/1280 exactly — no horizontal overflow), the
  header computes `position: sticky; top: 0` and sits at `top: 0` after
  scrolling 500–600px, and no card child overflows its card rect. One real
  bug found and fixed: at 375px in the **disconnected** state the header's
  chip + Connect pill (both `white-space: nowrap` by design) ran to 445px →
  horizontal scroll. Fix: `flex-wrap: wrap` on `.app-header` and
  `.header-session` (App.css) — the session row wraps under the brand
  (header 89px tall at 375px, first card top 113px > header bottom 89px, so
  no clip/overlap). Bento grid confirmed 1-col (327px) at 375 and
  `218.6px 198.7px 198.7px` 3-col with the §2 named areas at 768/1024/1280.
- **Color-contrast audit (computed WCAG 2.x relative-luminance ratios via a
  scratchpad script, all §1 pairings incl. the glass token composited over
  bg/gradient):** five failures → four token darkenings + one addition, all
  flagged in design.md §1 with before/after ratios; **LOCKED chart palette
  untouched**:
  - `--color-muted` `#5c7689`→`#546d80` (was 4.23:1 on bg; now 4.81 bg /
    5.42 surface),
  - `--color-accent` `#1e9fe3`→`#1173a6` (white button label was 2.95:1,
    focus outline 2.95:1 vs surface; now 5.22:1 label, ≥4.6:1 outline on
    every shell background),
  - `--color-accent-strong` `#1580bd`→`#0f6494` (hover label + secondary
    label were 4.33:1; now 6.42:1),
  - `--color-negative` `#e5484d`→`#c93848` (error text was 3.91:1 on
    surface; now 5.07 surface / 4.50 bg),
  - `--color-warning` **unchanged** but demoted to fills/dots only (2.03:1
    can never be text); new `--color-warning-text: #946200` (5.24/4.65)
    now colors the journal-stub text.
  - Chart-hue consequence handled without touching the palette: legend
    swatches get a 1px `--color-muted` border (chart-4 pale mustard is
    1.60:1 on white and can't delineate itself); chart hues as _text_ is
    banned in §5 (only 2/5/7 would pass, and that invites drift).
- **Tap targets:** `.ui-btn::after` invisible hit-area extension →
  `max(100%, 44px)` both axes (measured live: sm pill renders 33px tall,
  hit area 44px; md 41px → 44px). Form controls get `min-height: 44px` and
  a `--color-muted` border (the old `--color-border` is 1.32:1 — fine as a
  decorative card hairline, too faint as a control boundary) — unconsumed
  until Phase 5, so no visual change today.
- **Keyboard nav:** grep confirms zero `tabIndex` usage; all interactive
  elements are native `<a>`/`<button>` (banner dismiss included), so focus
  order = DOM order = visual order; no traps possible. Focus indicator is
  the shared `2px solid var(--color-accent)` outline — now ≥4.6:1 on every
  shell background (needs 3:1). Live-verified both tabbables reachable in
  the disconnected state.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` in
  components.css — `ui-spin` animation off (static ring + the LoadingState
  text label still communicate progress), button color transition snapped.
  These were the only two animations/transitions in App.css/components.css.
- **Chart aria (current placeholders):** verified via the accessibility
  tree — every ChartContainer `<article>` takes its name from the
  `useId`-linked title; placeholder visuals are `role="img"` with "no data
  yet" labels; all numeric placeholders are real text; legend swatches
  `aria-hidden` beside real-text labels; journal stub rows stay
  `aria-hidden` deliberately (fake sample data) with the exposed note
  explaining there's no data source.
- **design.md §5 written** (replacing the TODO): §5.1 = audited shell
  state + standing rules; §5.2 = the six-rule Phase 4 chart accessibility
  contract (SVG `<title>`/`<desc>` naming, visually-hidden data-table
  fallback rendered from the same 2.6 series with null=gap discipline,
  hover/focus tooltip parity with roving tabindex, color-never-sole
  encoding + the swatch-border precedent, `matchMedia`-gated D3
  transitions, legend-toggle semantics).
- **Incidental:** vite.config.ts now honors a `PORT` env var and
  `.claude/launch.json` gained `autoPort: true` so a second dev server can
  run beside the default-port one (needed to verify here; harmless
  otherwise — `npm run dev` without PORT is unchanged on 5173).
- Verified on this machine: `npm run build` (tsc + vite), `npm run lint`,
  `npm run format:check` all pass; every breakpoint/contrast/keyboard claim
  above was checked against live computed values in the preview browser
  (screenshots taken at 375px; state exercised: loading → waking →
  disconnected, the expected dev-only path since plain `vite dev` has no
  `/api`).

**Known deliberate deltas / exceptions**

- The four token darkenings above are a visible (same-hue, modest) shift of
  the accent/negative/muted colors — done as the smallest adjustment that
  clears AA, explicitly reversible if you'd rather solve any of them
  differently (e.g. dark text on the bright azure instead of darkening it —
  rejected here because #0f2b3d on #1e9fe3 is 4.46:1, still failing).
- The legacy OAuth banner's dismiss ✕ (~28×24px) misses the 44px tap
  target — left alone per the task's do-not-touch list (banner is flagged
  in design.md §3 as legacy until next touched); noted in §5.1.

**What's still open**

- Connected-state header (chip + Disconnect) was not seen live (no
  `/api/session` under plain `vite dev`) — it's narrower than the
  disconnected state's content, so the 375px wrap fix covers it a fortiori;
  worth one glance on prod. Same caveat as 3.2/3.3.
- `prefers-reduced-motion` was verified as authored CSS (rules present and
  well-formed in the CSSOM) — not exercised with an OS-level toggle in the
  preview browser.
- Phase 4 must build to the §5.2 contract; nothing enforces it yet
  (documentation, not lint).
- Task 3.5 (dark mode) remains optional/unbuilt; the contrast table only
  covers the light theme.

**What needs human action**

- Commit is local — push when ready (`main` auto-deploys Vercel prod).
- Optional: eyeball the darker azure CTA/typography on prod once deployed —
  the deltas are flagged as reversible if the look reads too heavy.

## Roadmap status (Task 3.3 — component library) — ✅ COMPLETE (verified locally in the dev server) (2026-07-08)

**What's done**

- **`src/components/`** (new): `Card.tsx` (base glass surface), `Button.tsx`
  (primary/secondary × md/sm, renders `<a>` for the OAuth 302 navigations),
  `ChartContainer.tsx` (title/subtitle/legend slots + `bodyHeight` +
  `status: ready|loading|empty|error`), `states.tsx` (`LoadingState` with
  `role="status"`+`aria-live="polite"`, `EmptyState`, `ErrorState` with
  `role="alert"`), `form.tsx` (`Label`/`Input`/`Select`, unconsumed until
  Phase 5), `components.css` (all component styles, §1 tokens only), `cx.ts`.
- **App.tsx refactor**: all 9 bento tiles rebuilt on ChartContainer (same
  grid-area classes, placeholder markup passed as ready-state children);
  auth card migrated off the legacy purple tokens onto Card + Button +
  Loading/ErrorState. Auth/session logic byte-for-byte unchanged — only JSX
  wrappers moved. Journal tile keeps its explicit "Stub — Phase 5" label.
- **App.css** slimmed to shell + per-tile visuals + auth-card/banner
  specifics; card surface/buttons/spinner/state styles moved to
  components.css. §1 tokens in `src/index.css` untouched; bento grid
  structure/breakpoints untouched.
- **Known deliberate deltas** (sanctioned as the legacy-auth-card restyle,
  plus two normalizations): (a) auth card is now Aero-styled (azure primary
  pill, xl radius); its loading state gained a spinner and the unreachable
  hint is now a red ErrorState (was muted text) — same `role`s; (b) the
  128/64px placeholder fills are now `box-sizing: border-box`, so their
  rendered boxes are exactly 128/64px instead of the old 130/66px
  (content-box + 1px dashed border) — a 2px normalization on visuals that
  Phase 4 replaces anyway; (c) connected-card status row/meta list restyled
  to token sizes (18px→20px status, 15px→14px meta).
- **OAuth error banner intentionally still on legacy tokens** — not in the
  3.3 component list; flagged in design.md §3 to migrate when next touched.
- Verified on this machine: `npx tsc -b --force`, `npx vite build`,
  `npx eslint .`, `npm run format:check`, `npm run typecheck:api` all pass;
  dev server inspected in the preview browser — `.bento-grid`
  grid-template-areas/columns computed identical to §2 (3-col bento ≥640px,
  single column at 375px), placeholder heights 23/64/128 confirmed, journal
  note still bottom-pinned, legends on chart-7/chart-4 swatches.

**What's still open**

- Placeholder → real-state wiring (`status` prop driven by fetch state) is
  Phase 4 (4.8); form primitives consumed in Phase 5.
- Connected-state card render only typechecked here (plain `vite dev` has no
  `/api/session`) — same caveat as 3.2; worth one glance on prod.
- Commit + push (`main` auto-deploys Vercel prod) — not done by this session.

## Roadmap status (Phase 3.2 — layout shell) — ✅ COMPLETE (verified locally in the dev server) (2026-07-07)

**What's done**

- **App shell** (`src/App.tsx` + `src/App.css` + `src/index.css`): sticky
  glass header (brand h1 · connection-status chip · Connect/Disconnect pill)
  over a centered main column (max-width 1200px) holding the pre-existing
  auth card and a new responsive `.dashboard-grid` with six placeholder
  chart cards (title + kind + "Chart coming soon" body). Plain CSS on the
  Phase 3.1 tokens; no Tailwind/CSS-in-JS; §1 tokens untouched.
- **Auth logic untouched**: `checkSessionWithRetry`, all four
  ConnectionStates, and the OAuth `whoop_error` banner are byte-for-byte the
  same logic — only the JSX around them changed. Markup deltas: the card's
  `h1` became `h2 "Connection"` (the header brand is now the page h1), and
  the connected card's Disconnect link MOVED to the header (one action, not
  two); the disconnected card keeps its primary Connect CTA and the header
  shows a compact one as well — both are the same `/api/auth` navigation
  driven by the same state.
- **Decisions (flagged, reversible)**: (a) **no sidebar/nav** — dashboard is
  the only destination until Phase 5; adding one later is a wrapper around
  `<main>`, nothing migrates (no router exists); (b) **sticky header** —
  status/action stay reachable while scrolling the grid; (c) **breakpoints**
  <640px → 1 col, 640–1023 → 2 cols, ≥1024 → 3 cols (six cards tile evenly
  at every step). All documented in design.md §2 (filled in from TODO); §3
  updated ONLY for the layout rows — chart/questionnaire/state rows still
  TODO.
- **Legacy dark-mode override removed** (`src/index.css`): the scaffold's
  `prefers-color-scheme: dark` block made the auth card dark-on-light inside
  the always-light Aero shell (caught in a dark-mode browser during
  verification). §1's confirmed direction is a light theme; `color-scheme`
  is now `light`. Dark mode returns properly (on §1 tokens) in Phase 3.5 if
  wanted.
- Verified on this machine: `npm run build` (frontend tsc + vite),
  `npm run typecheck:api`, `npm run lint`, `npm run format:check` all pass;
  dev server rendered and checked in the preview browser at 1280/685/375px
  (3/2/1 columns confirmed via computed `grid-template-columns`; sticky
  header confirmed while scrolled; loading → waking → disconnected states
  all seen live — under plain `vite dev` there is no `/api`, so the retry
  loop runs its budget and lands on the honest unreachable hint, which is
  the expected dev-only behavior).

**What's still open**

- Connected-state rendering was only typechecked, not seen live here (plain
  `vite dev` has no `/api/session`); the connected branch's logic is
  unchanged, only wrapped. Worth one glance on prod after deploy.
- The auth card still wears its legacy (pre-§1) purple-accent styling —
  migrating it to the Aero tokens is task 3.3 (component library), on
  purpose.

**What needs human action**

- Commit + push (`main` auto-deploys Vercel prod) — not committed by this
  session.

> **Note (2026-07-03):** this file was referenced as already existing with
> Phase 2.2 / 2.3 entries, but it was not found in the repo, its git history,
> or the working tree in this sandbox — so it was created fresh with the 2.4
> entry below. If your local copy lives elsewhere (untracked / another
> machine), merge this section into it and keep that one.

## Roadmap status (Phase 2.7 — rate-limit handling) — ✅ COMPLETE & LIVE-VERIFIED (2026-07-05)

**Facts verified against the live docs before coding**
(https://developer.whoop.com/docs/developing/rate-limiting, re-checked
2026-07-05 — matched the planning notes exactly):

- Two limits per client: **100 requests/minute** AND **10,000 requests/day**;
  breaching either returns **HTTP 429**.
- Every response carries draft-polli-ratelimit-headers-05 headers:
  `X-RateLimit-Limit` (multi-value, e.g.
  `"100, 100;window=60, 10000;window=86400"` — the FIRST value is the quota of
  whichever window the client is CLOSEST to exhausting; the `;window=60` /
  `;window=86400` params tell minute from day), `X-RateLimit-Remaining`, and
  `X-RateLimit-Reset` (seconds until Remaining resets).

**What's done (verified on this machine, 2026-07-05)**

- **`api/_lib/whoop.ts`** — all internal to `whoopRequest()` and its helpers;
  no public signature (`getProfile`/`getBodyMeasurement`/`getCycles`/
  `getRecovery`/`getSleep`/`getWorkouts`/`fetchCollection`/`fetchCollectionPage`)
  changed:
  - `parseRateLimitHeaders(limit, remaining, reset)` — pure and exported (same
    testability contract as `parseRetryAfter`). Identifies the closest window
    by matching the first bare number in `X-RateLimit-Limit` against the
    `;window=N` entries: exactly one match with window=60 → `'minute'`,
    86400 → `'day'`; missing/garbled/ambiguous → `'unknown'` (which keeps the
    safer retry behavior). Parsed off EVERY response, success and failure.
  - `WhoopRateLimitError extends WhoopApiError` carrying
    `{ window: 'minute' | 'day' | 'unknown', remaining, resetSeconds }` — now
    thrown for every 429 that is not retried further (previously a generic
    `WhoopApiError`). Carries status + endpoint path + WHOOP's body only, no
    token material (unchanged discipline).
  - **Day-window 429 fails FAST**: zero retries, zero sleeps — even when
    `Retry-After` is present. Rationale: the retry budget's 30s-capped waits
    cannot refill a quota that resets in up to 24h; they only burned function
    execution time. Minute/unknown 429s keep the pre-existing
    retry-with-backoff behavior, `Retry-After` still authoritative over the
    computed jittered backoff.
  - **Proactive throttle**: the most recent Remaining/Reset observation lives
    in module-level state (deliberately no locking — the module is server-only
    and sync.ts issues every request SEQUENTIALLY per its concurrency note).
    Before each logical request, if the last observed Remaining ≤
    `RATE_LIMIT_SAFETY_BUFFER` (**3**, a named constant), sleep out the
    remainder of the reported reset (capped at `MAX_BACKOFF_MS`) instead of
    firing into a real 429. Zero added latency when Remaining is comfortable
    (unit-asserted: no `setTimeout` call at all). Day-window observations are
    NOT slept on — same 24h rationale; the request fires and the fail-fast 429
    path reports it. Each observation is consumed once; `resetRateLimitTracking()`
    is exported for test isolation.
  - 5xx / network-failure / plain-4xx / 401 paths are byte-for-byte the same
    behavior as before (regression-covered).
- **`api/_lib/sync.ts`** — `classifyFetchError` gains one branch: a
  `WhoopRateLimitError` becomes a resource-level error string that names the
  window (`WHOOP rate limit hit (429, day window) @ /v2/cycle`), so the daily
  cron log says WHY a run stopped. Counts/status/window only — no tokens, no
  URLs with query strings. No orchestration change: after a day-window hit,
  the remaining resources fail equally fast (zero retries each), so the run
  ends quickly instead of looping; the next day's cron catches up (sync
  windows overlap by design).
- **Tests** (`npm run test:ratelimit`, `scripts/test-ratelimit.mjs` — same
  pattern as test-refresh: the REAL module graph, mocked global `fetch`, no
  creds, no network; plus a recorded-and-instant `setTimeout` patch so every
  backoff/Retry-After/throttle wait is asserted exactly and the script runs
  instantly): header parsing (docs example → minute; day-first → day; absent →
  null; bare/garbled/unknown-window → `'unknown'`); throttle no-op (ZERO
  sleeps) at comfortable Remaining; throttle sleeps ≈ reset at Remaining ≤ 3
  and consumes the observation (third call doesn't re-sleep); day-window
  near-limit NOT proactively slept on; minute 429 retried with `Retry-After`
  winning EXACTLY (7000ms recorded against a 60s backoff base); computed
  backoff used when no `Retry-After`; day 429 → `WhoopRateLimitError`, one
  fetch, zero sleeps despite `Retry-After: 30`; exhausted minute budget →
  typed error with `window: 'minute'`; 429 without headers → retried then
  `window: 'unknown'`; 500→200 retry, network-throw→200 retry, plain 404
  no-retry, persistent 500 → still the GENERIC `WhoopApiError`. All 37 checks
  pass.
- Verified on this machine: `npm run typecheck:api`, `npm run lint`,
  `npm run format:check`, `npm run test:ratelimit`, and the pre-existing
  `test:refresh` / `test:webhook` / `test:session` / `test:backoff` /
  `test:transforms` / `test:callback` all pass (nothing here touches them —
  the Phase 2.5 DB-pause backoff in `src/session-check.ts` is a separate
  system and was not modified).
- **Live verification (2026-07-05)** — this session ran on the user's machine
  with `.env.local` present (the task brief assumed a sandbox without creds;
  that assumption didn't hold, so the live checks were run rather than
  deferred):
  - `npm run test:whoop` passes end-to-end THROUGH the new code (all six
    endpoints, pagination, typed error path).
  - A one-off scratchpad capture (not committed) made one real
    `/v2/user/profile/basic` call and printed only the `x-ratelimit-*`
    headers: `X-RateLimit-Limit` was **exactly**
    `"100, 100;window=60, 10000;window=86400"`, Remaining `"99"`, Reset
    `"60"` — the docs example byte-for-byte, and `parseRateLimitHeaders`
    identified `minute` / 99 / 60. The header-format TODO(verify) from the
    plan is therefore CLOSED for the minute-closest case.
- **Vercel plan + function timeout — CONFIRMED, not guessed (2026-07-05)**:
  queried the Vercel API with the CLI's token — team plan is **hobby**;
  project `resourceConfig` shows **Fluid Compute on** and **no
  `maxDuration`/`functions` override anywhere** (vercel.json has none), so the
  platform default max duration (currently **300s** on all plans) applies to
  `/api/sync`.

**Live results worth knowing (2026-07-05)**

- `npm run test:whoop` passes end-to-end THROUGH the new rate-limit code — all
  six endpoints, pagination cursor advance, and the typed error path — so the
  parsing/throttle additions don't regress the live fetch layer.
- A one-off header capture on a REAL `/v2/user/profile/basic` call showed
  `X-RateLimit-Limit: "100, 100;window=60, 10000;window=86400"`, Remaining
  `"99"`, Reset `"60"` — the docs example byte-for-byte, parsed as
  `minute` / 99 / 60. The header-format TODO(verify) is CLOSED for the
  minute-closest case (day-window-first and a real 429 remain unobserved).
- **Vercel plan confirmed via the Vercel API, not guessed: Hobby, Fluid
  Compute on, no `maxDuration` override → the 300s platform default.** The one
  residual is a persistent _5xx_ storm (rate-limit 429s now fail fast and no
  longer contribute) that could sleep ~6 min across 4 sequential resources and
  exceed 300s — acceptable for a daily cron whose next overlapping run catches
  up, with `functions.maxDuration` as the lever if it ever bites.

**What's still open**

- **A real 429 has never been observed live** (the account never gets near
  100/min), so the day-window-FIRST header variant (first value `10000` when
  the day quota is the closest) is inferred from the docs' "first value =
  closest limit" rule, not observed — flagged `TODO(verify)` in the whoop.ts
  header. If WHOOP ever formats it differently the parser degrades to
  `'unknown'`, which keeps the safer retry-with-backoff behavior (never the
  fail-fast path) — wrong-window misclassification fails soft.
- **Residual timeout math (5xx storms, NOT rate limits)**: a persistent 5xx
  storm can still sleep up to ~90s per resource (3 retries × 30s cap) ≈ 6
  minutes across 4 sequential resources, exceeding the 300s default. Day-window
  429 storms no longer contribute (fail fast). Accepted for now: it's a daily
  cron, a timed-out run just means that day's sync is late and the next run's
  overlapping window catches up. If it ever bites, the levers are
  `functions.maxDuration` in vercel.json or a smaller `maxRetries` for the
  cron path.
- The throttle's single-flight assumption holds only as long as sync.ts stays
  sequential (documented there). If parallel WHOOP calls are ever introduced,
  revisit — the one-time-use refresh tokens forbid that anyway.
- The minute-window quota is generous (100/min) versus a worst-case full sync
  (~4 × 100 pages + refresh = well under 100 requests in practice for a 7-day
  window, but a full-history backfill could exceed it — which is exactly what
  the throttle + minute-window retry now absorb).

**What needs human action**

- Commit + push (`main` auto-deploys Vercel prod). Everything above is
  verified locally but not yet committed by this session.
- Nothing else: the Vercel plan/timeout confirmation and the live smoke test —
  both flagged as human actions in the task brief — were completed from this
  machine (see above).

## Roadmap status (Phase 2.6 — data transforms) — ✅ COMPLETE (fixtures only; not yet run against real DB rows) (2026-07-05)

**What's done (verified in the sandbox, 2026-07-05)**

- `api/_lib/transforms.ts` — the pure, chart-ready shaping layer that turns the
  Phase 2.4 typed cache rows into Phase 4's series. Three exported functions plus
  their output types:
  - `buildDailySeries(cycles, recovery, sleep, workouts, {start, end})` →
    `DailyMetricPoint[]`: one point per calendar day across the inclusive range,
    **including days with no data** (they appear with every field `null` so a
    chart renders a gap, never a skipped/collapsed day). `totalSleepMilli` is
    DERIVED from the stage columns (light + deep + rem), not read from a
    fabricated total. Multiple workouts on a day aggregate into
    `workoutStrainSum` / `workoutCount` (none dropped); a day with no workouts is
    null on both. **Phase 4.12 added `kilojoule`** (the day cycle's raw energy in
    kJ), gated on SCORED exactly like `strain` — the kJ→kcal conversion is a
    display concern (`KJ_PER_KCAL` in `src/App.tsx`) kept OUT of this pure layer,
    which never invents a unit the DB doesn't store. (`skinTempCelsius` was added
    for 4.11 the same way.)
  - `buildSleepStageBreakdown(sleepRows)` → `SleepStageBreakdownPoint[]`: one
    point per night for the 4.1 stacked bar, stage millis → whole minutes
    (`Math.round`, round-half-up, stated in a comment). Nap rows are skipped —
    guarded here even though sync.ts already excludes naps, since the input isn't
    guaranteed pre-filtered.
  - `buildRollingBaseline(series, accessor, windowDays, {minSamples})` →
    `RollingBaselinePoint[]`: generic (accessor-driven, not hardcoded to HRV — the
    same function serves 4.3's "HRV over rolling baseline" and the "RHR over
    sleep-debt area" variant). Trailing window by calendar day; emits `mean` only
    once ≥ `minSamples` non-null values are in the window (default 3, a parameter
    not a magic number), else `null`.
- **Null discipline preserved end-to-end**: every score-derived field is `null`
  when the row is missing or `score_state !== 'SCORED'` — never 0, never an
  interpolated guess. As a belt-and-braces guard the transforms ALSO gate on
  `score_state`, so a stale row carrying a leftover value under a non-SCORED state
  can't leak a number (the typed columns should already be null per 2.4, but this
  never trusts that).
- **Purity contract**: zero imports (no sync.ts / whoop.ts / supabase.ts, no
  network, no DB, no I/O, no input mutation). Local input DTOs
  (`CycleMetricRow` / `RecoveryMetricRow` / `SleepMetricRow` / `WorkoutMetricRow`)
  mirror the `0003_typed_columns.sql` columns field-for-field (names +
  nullability) so a future API endpoint can pass DB rows straight in with no
  mapping layer — deliberately NOT the unexported `CycleRow`/… writer types from
  sync.ts.
- **Tests** (same pattern as test-refresh/test-backoff: real module, hand-built
  synthetic fixtures, no creds, no network): `npm run test:transforms`
  (`scripts/test-transforms.mjs`) covers a normal fully-scored day, a
  `PENDING_SCORE` day (→ null, not 0), a day missing from every collection
  (→ present with all-null fields), a nap row (→ excluded from the stage
  breakdown and the daily sleep fields), multi-workout aggregation, an unscored
  workout (→ counted, but null strain sum), millis→minutes rounding (20.5 → 21),
  and a rolling-baseline window that stays null until `minSamples` is met then
  emits the trailing mean. Every expectation is a hand-computed exact number, not
  an "is not null". Fixtures use only synthetic values — no real health data.
- Verified in the sandbox: `npm run test:transforms`, `npm run typecheck:api`,
  `npm run lint`, `npm run format:check`, and `npm run build` all pass.

**What's still open / untested**

- **Not exercised against real DB rows — fixtures only.** The transforms have
  never been fed actual `whoop_*` rows from Supabase; a future Phase 4 API
  endpoint will be the first real caller. The DTOs are believed row-compatible by
  construction (columns copied from 0003) but that hasn't been proven live.
- The non-SCORED (`PENDING_SCORE` / `UNSCORABLE`) arm is still only ever
  synthetic here (same Phase 2.2 `TODO(verify)` — those states have never been
  observed in a live capture), though the null-path is fully unit-tested.
- **No read/API path exists yet** — this is the pure transform layer only. Wiring
  it into an endpoint the frontend calls is Phase 4, deliberately not built here.
- Sleep `day` attribution is inherited unchanged from sync.ts (the open
  start-day-vs-wake-day `TODO(verify)` there). `buildSleepStageBreakdown` groups
  by whatever `day` it's handed, so if that attribution ever changes, the night
  dates shift with it automatically — flagged in a header comment, no logic here
  depends on the choice.

**What needs human action**

- Push is already done by you (commits `ac64b83` "task 2.6 Data transforms" +
  `fff4363` "Task 2.6: add chart data transforms and local transform tests" are
  on `main`). This PROJECT-STATE 2.6 section is a follow-up doc commit.
- Optional: once a Phase 4 endpoint exists, run the transforms over a real synced
  window and confirm the DTOs accept the DB rows with no mapping.

## Roadmap status (Phase 2.5 — free-tier pause handling) — ✅ COMPLETE & LIVE-VERIFIED (2026-07-05)

**Live verification (2026-07-05):** tested end-to-end against a genuinely paused
Supabase project on the Vercel production deployment. Both paused-DB paths
confirmed working: (1) an already-connected browser polling `/api/session`
degrades through the retry budget to the "We couldn't reach your database…
resume it in the Supabase dashboard, then refresh" screen instead of a false
"Connect WHOOP"; (2) connecting fresh against the paused project shows the
`database_unavailable` banner on the OAuth bounce-back. Resuming the project
from the Supabase dashboard and refreshing reconnects normally.

**Follow-up fix (2026-07-05, after a live paused-DB test): OAuth callback path.**
The first 2.5 cut only taught the POLLING endpoint (`/api/session`) to detect a
paused DB. A live test surfaced the gap: a **logged-out** browser hitting a
paused project never sees the "waking" screen, because `/api/session`
short-circuits to `connected:false` at the cookie check **before any DB read**.
The user then clicks Connect WHOOP, completes OAuth, and the callback's token
UPSERT hits the paused project — which used to fail with a cryptic
`whoop_tokens upsert failed: TypeError: fetch failed` → "Failed to store
tokens." Fixed in `api/callback.ts`: the upsert now destructures `status` and,
when `isDbUnavailableStatus(status)` (same classifier as session/tokens/refresh
— the fetch-level failure surfaces as the status-0 sentinel), redirects back to
the SPA with `?whoop_error=database_unavailable` + a clear description/hint
instead of the generic 500. This reuses the existing `whoop_error` banner in
`App.tsx` (verified in the browser: banner shows "Your database is paused or
waking up… Resume it in the Supabase dashboard, then click Connect WHOOP
again"). Genuine upsert errors still return the flat 500. Covered by
`npm run test:callback` (real callback handler, mocked WHOOP+Supabase fetch:
paused-DB upsert → database_unavailable redirect with NO session cookie set and
no token material in the URL; genuine 500 → "Failed to store tokens"; healthy
upsert → session cookie + redirect). NOTE: this means the two paused-DB UIs are
by design — an ALREADY-CONNECTED user polling `/api/session` gets the spinner +
retry loop; a LOGGED-OUT user connecting gets the banner on the OAuth bounce-back
(retrying can't help there — connecting itself requires the DB).

**What's done (verified in the sandbox, 2026-07-05)**

- **Facts verified against the live Supabase docs before coding** (the roadmap
  said "~1 week, verify"): free projects pause after **7 days** of low database
  activity; requests to a paused project return the documented
  **HTTP 540 "Project Paused"** gateway status; and a paused project does
  **NOT auto-resume on request** — the owner must click "Resume project" in the
  Supabase dashboard (90-day restore window). That last point corrects the
  original "waking up" framing: the SPA's retry loop cannot un-pause anything;
  its jobs are riding out transient unavailability and telling the user the
  truth instead of showing a misleading "Connect WHOOP" screen.
- **Server-side classification** — `api/_lib/supabase.ts` gains
  `isDbUnavailableStatus()` and `DatabaseUnavailableError`. The detection was
  traced against the installed `@supabase/postgrest-js` 2.108.2 source, not
  guessed: builders don't throw on failure — a non-2xx gateway status passes
  through on the result (`{ error, status }`), and a fetch-level failure
  (DNS/refused/timeout, i.e. a project mid-restore) is caught internally and
  surfaces as the `status: 0` sentinel. Classified statuses: 0, 502, 503, 504,
  540, 544 — all infrastructure-level codes PostgREST never produces for
  query/auth errors, so no error-message string-matching anywhere.
  `getWhoopTokens` (tokens.ts) and the rotated-token UPDATE (refresh.ts) throw
  `DatabaseUnavailableError` on them; everything else keeps the existing
  generic-error behavior.
- **`/api/session`** now returns `503 { connected: false, waking: true }`
  (plus `Retry-After: 5`) for that case instead of the old flat 500, so the
  SPA can distinguish "database unavailable" from a real failure. Security
  posture unchanged: the body names no dependency, carries no status codes and
  no token material (asserted in the tests). Genuine failures (PostgREST 500,
  corrupt ciphertext, refresh rejected by WHOOP) still return the flat
  `500 { error: 'Failed to check session.' }`.
- **Frontend 'waking' state** — `src/App.tsx` gains a fourth ConnectionState
  (`'waking'`) and `src/session-check.ts` owns the retry loop (extracted so it
  is unit-testable from Node with injected fetch/sleep — no DOM). On
  `waking:true`, a per-attempt 10s timeout, or a network error it retries with
  capped exponential backoff (2s/4s/8s/8s/8s ≈ 30s total) behind a spinner and
  an honest "waking up your database" message; when the budget is exhausted it
  degrades to the disconnected screen plus a "resume it from the Supabase
  dashboard, then refresh" hint. Genuine non-waking failures skip retries
  entirely (pre-2.5 behavior preserved).
- **Keep-warm cron: evaluated and deliberately NOT added.** The daily
  `/api/sync` cron (vercel.json, `0 8 * * *`) reads `whoop_tokens` _before_
  any WHOOP call, so every run — even one that then fails at WHOOP's end — is
  real database activity, once a day against a 7-day pause window. Vercel
  Hobby crons are once-per-day minimum, so a second cron could not ping any
  more often than sync already does; and the failure modes that would stop
  sync before its first DB read (missing `CRON_SECRET`, missing Supabase env
  vars, cron not firing) would break a dedicated ping endpoint identically.
  `api/health.ts` stays deliberately DB-free. vercel.json is untouched.
- **Tests** (same pattern as test-refresh/test-webhook: real modules, mocked
  `fetch`, no creds, no network): `npm run test:session` drives the real
  `/api/session` handler — paused 540 → 503 waking; unreachable (fetch throws
  → status-0 sentinel, including postgrest-js's own internal GET retries,
  ~7s) → 503 waking; 540 on the refresh-path UPDATE → 503 waking; PostgREST
  500 and corrupt ciphertext → flat 500, NOT waking; no-cookie and healthy
  paths unchanged; every waking/healthy body asserted to leak nothing.
  `npm run test:backoff` drives the real retry loop — exact backoff schedule,
  hard cap → 'unreachable', zero retries on genuine failures (500, and 503
  _without_ the waking flag), definitive disconnected, and cancellation
  mid-wait.
- Verified in the sandbox: `npm run typecheck:api`, `npm run lint`,
  `npm run format:check`, `npm run test:session`, `npm run test:backoff`, and
  the pre-existing `npm run test:refresh` / `npm run test:webhook` all pass.
- Housekeeping: removed the stale `.claude/worktrees/admiring-hermann-22cf00`
  git worktree (its branch was already merged as PR #1, working tree clean) —
  it was breaking `npm run lint` repo-wide with a tsconfigRootDir ambiguity.

**What's still open**

- The 540/544 statuses are taken from Supabase's status-code docs; the exact
  body a paused project sends is not contractual, which is why classification
  keys ONLY on the status number. If Supabase ever changes the gateway codes,
  `isDbUnavailableStatus()` is the single place to update.
- Other endpoints (`/api/sync`, `/api/webhook`) intentionally do NOT get
  special waking handling — a cron run during a pause just fails that day and
  the next run catches up (sync windows overlap by design).

**Human verification — DONE (2026-07-05)**

- [x] End-to-end live test against a real paused project on the Vercel prod
      deployment — confirmed working (see the "Live verification" note at the
      top of this section). Both the connected-user retry/resume screen and the
      logged-out-user OAuth `database_unavailable` banner behave as designed;
      resuming from the dashboard reconnects.
- [x] Commits pushed to `origin/main` (this machine has GitHub credentials;
      pushing `main` auto-deployed Vercel prod).

**Standing verification — REQUIRED, not optional (promoted 2026-07-18)**

- **Confirm the daily `/api/sync` cron actually ran.** Vercel → project →
  **Logs**, filter to `/api/sync` (the cron invocation log is a SEPARATE view
  from your app request logs — a clean app log tells you nothing about it). A
  healthy run prints the counts-only line `sync: members=1 ... cycles=N/N`.
- This was filed as "worth a periodic glance (not blocking)" from 2026-07-05
  until 2026-07-18 and, in practice, was never performed — during which the
  cron 401'd on EVERY run because `CRON_SECRET` had never been set, Supabase
  stayed empty, and the whole Phase 4 chart surface rendered empty states on
  prod. The check is cheap and it is the only signal that the pipeline is
  alive; treat a missing cron log as a P1, not a curiosity. (Full root cause in
  the Task 4.9 section at the top of this file.)
- Two things ride on this run, so a silent failure costs double: the data
  itself, and the DB activity that keeps the free-tier Supabase project inside
  its 7-day pause window. The argument above for skipping a second keep-warm
  cron is only sound **while sync is actually running** — it presumes a working
  cron rather than proving one.

## Roadmap status (Phase 2.4 — Supabase typed columns)

**What's done**

- `supabase/migrations/0003_typed_columns.sql` — adds nullable typed columns to
  `whoop_cycles`, `whoop_recovery`, `whoop_sleep`, `whoop_workouts`. Idempotent
  (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), same style as 0001/0002; 0001 and
  0002 are untouched since they may already be applied to the live project.
  Column names/types are read off `api/_lib/whoop-types.ts` (field-by-field
  verified against the live 2026-06-30 capture in Phase 2.2). `raw jsonb` is
  untouched and remains the source of truth / audit trail — typed columns are a
  read optimization for the Phase 4 charts.
- One column added beyond the requested list: `whoop_sleep.need_from_sleep_debt_milli`
  (bigint). ROADMAP chart 4.3's alternative mapping is "RHR line over
  sleep-debt area", and sleep debt exists only inside `score.sleep_needed`, so
  it was surfaced now rather than re-migrating later.
- `api/_lib/sync.ts` — `buildCycleRows` / `buildSleepRows` / `buildWorkoutRows` /
  `buildRecoveryRows` now populate the typed columns from the already-typed
  record objects (new `CycleRow`/`RecoveryRow`/`SleepRow`/`WorkoutRow` types
  extending `CacheRow`). Score-derived columns are written `null` whenever
  `score_state !== 'SCORED'` — never guessed or defaulted. Day-derivation,
  (user_id, day) dedupe, and webhook-delete logic (Phase 2.3) are unchanged.
- No changes to `whoop_tokens` or `daily_questionnaire`; no RLS policies added
  (deny-by-default with service-role bypass is intentional per 0001's notes).
- Verified in the sandbox: `npm run typecheck:api`, `npm run lint`, and
  `npm run test:webhook` all pass.

**What's still open**

- Rows cached before the migration keep NULL typed columns until they are
  re-upserted. Backfill = re-run `npm run sync:whoop` over the window you care
  about (the upsert rewrites every column).
- The non-SCORED (`PENDING_SCORE` / `UNSCORABLE`) union arms are still only
  documented, never observed live (Phase 2.2 `TODO(verify)`); the null-writing
  path for those states is typechecked but not exercised against a real payload.
- Phase 2.6 (chart-ready transforms) will read these columns; no read path
  exists yet.

**What needs human action (sandbox had no network / no GitHub credentials)**

- [x] Apply `0003_typed_columns.sql` to the live Supabase project — **done
      2026-07-04**. Verified via `information_schema.columns`: all columns present
      on `whoop_cycles`, `whoop_recovery`, `whoop_sleep`, `whoop_workouts` with the
      correct data types, matching the migration file exactly.
- Re-run a live sync (`npm run sync:whoop`) from your machine and confirm the
  typed columns populate — sync was NOT live-tested from here.
- Push the commits: the sandbox has no GitHub credentials for this repo, so
  `git push` must run from your machine (same as prior phases).
