# Project state

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
    null on both.
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
