# Design Spec

> **Living document — starter skeleton.** Fill in the placeholders as design
> decisions get made. Sections marked **TODO** need your input before building.

---

## 1. Design tokens

> **Aesthetic direction — Neo Frutiger Aero (confirmed for Phase 3.1).**
> Light, airy base (not a dark theme); glossy/glassy surfaces; soft
> sky-blue / cyan-tinted neutrals; high-gloss highlights and gentle
> gradients; generous rounding — the 2000s–2010s "tech optimism" look
> (Vista/early-macOS Aero glass, not flat minimalism, not neon
> cyberpunk). This replaces the earlier dark-theme placeholder, which
> was never confirmed. Tokens are defined as plain-CSS custom
> properties in `src/index.css` (`:root`); the repo uses no
> Tailwind/CSS-in-JS. **All values below are authored (not
> placeholders)** except where explicitly flagged as a proposal.

### Colors — base UI palette

> **Task 3.4 (2026-07-08) — WCAG AA contrast deltas, flagged explicitly.**
> A computed-ratio audit (WCAG 2.x relative luminance, not eyeballed) found
> five failures in the original 3.1 values; four tokens were darkened and one
> companion token added. Original values and their failing ratios:
> `--color-muted` `#5c7689` (4.23:1 on `--color-bg`, needs 4.5), `--color-accent`
> `#1e9fe3` (2.95:1 as white-label button fill / focus outline, needs 4.5 / 3),
> `--color-accent-strong` `#1580bd` (4.33:1 white label + secondary label),
> `--color-negative` `#e5484d` (3.91:1 as error text on surface).
> `--color-warning` `#f5a623` (2.03:1) is **unchanged** but demoted to
> fills/dots only — warning-toned _text_ uses the new `--color-warning-text`.
> The LOCKED chart palette is untouched. All deltas are darkenings within the
> same hue, reversible if a different remedy is preferred.

| Token                   | Value                   | Usage                                                                                |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `--color-bg`            | `#e8f3fb`               | App background (airy sky-tinted)                                                     |
| `--color-surface`       | `#ffffff`               | Cards / panels (glossy white)                                                        |
| `--color-surface-glass` | `rgba(255,255,255,0.6)` | Frosted / translucent panels                                                         |
| `--color-text`          | `#0f2b3d`               | Primary text (deep teal-navy) — 13.0:1 on bg                                         |
| `--color-muted`         | `#546d80`               | Secondary text (blue-grey) — 4.81:1 on bg, 5.42:1 on surface                         |
| `--color-border`        | `#cfe3f0`               | Soft blue-tinted hairline / dividers (decorative — 1.32:1, never a control boundary) |
| `--color-accent`        | `#1173a6`               | Primary accent (Aero azure) — 5.22:1 white label, ≥4.6:1 outline on every shell bg   |
| `--color-accent-strong` | `#0f6494`               | Accent hover / pressed — 6.42:1 white label & as text on surface                     |
| `--color-positive`      | `#3aa657`               | Good / above target (nature green) — 3.10:1, fills/large only                        |
| `--color-negative`      | `#c93848`               | Bad / below target (coral red) — 5.07:1 surface, 4.50:1 bg                           |
| `--color-warning`       | `#f5a623`               | Caution / attention (warm amber) — **fills/dots only, 2.03:1**                       |
| `--color-warning-text`  | `#946200`               | Warning-toned text — 5.24:1 surface, 4.65:1 bg (added 3.4)                           |

### Colors — glossy / glass treatment

The Aero sheen is authored as a **gradient token** (`--surface-gloss`),
not a single flat highlight — the sheen is intrinsically directional
(bright at the top, fading down), which a flat color can't reproduce.
Sharing one gradient token is what keeps the glass look **consistent**
across every card (the inconsistency risk called out in the brief comes
from components each hand-rolling a gradient; a shared token removes it).
Reversible: fall back to the flat `--color-highlight` if the sheen is
ever dropped. _(Flagged for confirmation — gradient vs. flat.)_

| Token                  | Value                                                                                                      | Usage                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `--gradient-bg`        | `linear-gradient(180deg,#f2fafe 0%,#dbeef9 100%)`                                                          | Subtle sky-gradient page background   |
| `--surface-gloss`      | `linear-gradient(180deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.28) 42%, rgba(255,255,255,.04) 100%)` | Glass sheen overlaid on card surfaces |
| `--color-highlight`    | `rgba(255,255,255,0.75)`                                                                                   | Flat specular edge / inset highlight  |
| `--shadow-card`        | `0 8px 24px -8px rgba(9,102,148,.28), 0 2px 6px -2px rgba(9,102,148,.16)`                                  | Soft blue-tinted card drop shadow     |
| `--shadow-inset-gloss` | `inset 0 1px 0 rgba(255,255,255,0.85)`                                                                     | Top inner gloss line on surfaces      |

### Colors — chart / data-series palette (LOCKED)

These seven hexes come from a confirmed palette and are used **verbatim**
— not approximated, tinted, or substituted.

| Token             | Value     | Hue name       |
| ----------------- | --------- | -------------- |
| `--color-chart-1` | `#60E1F0` | Light blue     |
| `--color-chart-2` | `#875C00` | Dark orange    |
| `--color-chart-3` | `#FF4978` | Bright magenta |
| `--color-chart-4` | `#D9D059` | Pale mustard   |
| `--color-chart-5` | `#096694` | Dark blue      |
| `--color-chart-6` | `#16D113` | Lime green     |
| `--color-chart-7` | `#902944` | Dark magenta   |

#### Chart color mapping — **PROPOSAL, pending confirmation**

The palette is locked; the semantic mapping is **not**. Proposed
assignment of the seven hues to the metric surface in §4 (Recovery,
Strain, Sleep, Calories, Skin temp, HRV actual+ideal, RHR actual+ideal,
cycle/period meter, journal accents). There are more roles than hues, so
some hues do deliberate double-duty (per the brief's suggestion that
"actual" lines can share, and "ideal" bands can share a muted token):

| Token             | Hue            | Proposed metric / role                                                                 |
| ----------------- | -------------- | -------------------------------------------------------------------------------------- |
| `--color-chart-6` | Lime green     | **Recovery** (green = high recovery, WHOOP convention)                                 |
| `--color-chart-5` | Dark blue      | **Strain** (blue = strain, WHOOP convention)                                           |
| `--color-chart-1` | Light blue     | **Sleep** (calm cyan)                                                                  |
| `--color-chart-2` | Dark orange    | **Calories** (warm energy/burn)                                                        |
| `--color-chart-3` | Bright magenta | **Skin temp** (warm) — _also_ the **cycle/period meter** (never co-occur in one chart) |
| `--color-chart-7` | Dark magenta   | **HRV actual + RHR actual** (shared cardio "actual" line)                              |
| `--color-chart-4` | Pale mustard   | **HRV ideal + RHR ideal** (shared muted baseline band)                                 |

Notes on the soft spots (please confirm/redirect):

- **HRV/RHR sharing.** Actual lines share `--color-chart-7`; ideal/baseline
  bands share the muted `--color-chart-4`. If HRV and RHR ever appear in
  the **same** chart, their actual lines would collide — split them then.
- **Skin temp vs. cycle/period meter** both use `--color-chart-3`; fine only
  while they never share a chart.
- **Journal accents** are proposed to reuse the UI `--color-accent` (sky
  blue) rather than consume a chart slot — keeping the 7 hues for data.

### Typography

Direction: rounded, humanist sans (friendly, optimistic — the Aero
register). The historically "correct" face is Frutiger itself, which is
**proprietary (Linotype)** and not bundled.

**Font candidates — PROPOSAL, licensing/availability to be confirmed
before importing any:**

- **Nunito Sans** (primary candidate) — rounded, humanist, **SIL OFL**,
  self-hostable; closest free match to the Aero feel.
- **Mulish** (alternative) — a more neutral humanist sans, also OFL, if
  Nunito reads too soft.

Until a face is licensed/imported, the stack falls back to system
humanist faces — `'Segoe UI'` first gives Windows users the authentic
Vista-era Aero look for free, `system-ui` elsewhere.

| Token            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `--font-sans`    | `'Nunito Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif` |
| `--font-display` | `'Nunito', 'Nunito Sans', 'Segoe UI', system-ui, sans-serif` (headings)                    |
| `--font-mono`    | `ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace`                     |

| Scale token   | Size | Typical use                  |
| ------------- | ---- | ---------------------------- |
| `--text-xs`   | 12px | Captions / axis labels       |
| `--text-sm`   | 14px | Secondary / meta text        |
| `--text-base` | 16px | Body                         |
| `--text-lg`   | 20px | Card titles                  |
| `--text-xl`   | 24px | Section headings             |
| `--text-2xl`  | 32px | Page / hero headings         |
| `--text-3xl`  | 40px | Hero metric numerals (added) |

Weights: `--weight-regular` 400 · `--weight-medium` 500 ·
`--weight-semibold` 600 (added — rounded faces read well at 600 for UI
emphasis) · `--weight-bold` 700. The placeholder 12/14/16/20/24/32
numeric scale was kept and extended with a 40px hero step for big
dashboard numbers.

### Spacing & radius

Frutiger Aero leans generous, so the placeholder radii were **increased**
(cards should read as glossy bubbles, not flat panels): default card
radius is now 16px, large/hero cards 24px, with a pill radius for
buttons/chips. Spacing keeps the placeholder 4→32 steps and extends
upward (48/64) for airy dashboard breathing room.

| Token       | Value | Note                         |
| ----------- | ----- | ---------------------------- |
| `--space-1` | 4px   |                              |
| `--space-2` | 8px   |                              |
| `--space-3` | 12px  |                              |
| `--space-4` | 16px  |                              |
| `--space-5` | 24px  |                              |
| `--space-6` | 32px  |                              |
| `--space-7` | 48px  | added — section gaps         |
| `--space-8` | 64px  | added — shell / hero spacing |

| Radius token    | Value | Use                            |
| --------------- | ----- | ------------------------------ |
| `--radius-sm`   | 8px   | Inputs, small controls         |
| `--radius-md`   | 12px  | Tighter cards / chips          |
| `--radius-lg`   | 16px  | **Default card radius**        |
| `--radius-xl`   | 24px  | Large / hero cards             |
| `--radius-pill` | 999px | Buttons, status chips, toggles |

---

## 2. Layout / grid

> **Authored in Phase 3.2 (layout shell); chart grid revised in a 3.2
> follow-up to match a confirmed Figma bento layout** (file
> `BWF8m6iu8eQJqJghVUbsOQ`, node `86:71`). Values below are implemented in
> `src/index.css` (`#root`) and `src/App.css` (shell section), built on the
> §1 tokens.

### Shell structure

```
body (--color-bg)
└── #root — full-bleed --gradient-bg, flex column, min-height 100svh
    ├── <header class="app-header">   sticky glass bar
    │     brand (h1) · status chip · Connect/Disconnect pill
    └── <main class="dashboard">      centered column, max-width 1200px
          ├── OAuth error banner (when present)
          ├── auth/connection card (the pre-3.2 card, now shell content)
          └── <section class="dashboard-grid"> — six chart-card slots
```

- **No sidebar in Phase 3 — deliberately deferred.** The dashboard is the
  only destination until the Phase 5 questionnaire exists; a one-item nav is
  dead chrome. **Reversible:** the shell is plain `header + main` with no
  router; adding a sidebar later is one flex/grid wrapper around `<main>`
  plus the nav component — nothing has to migrate.
- **Header is sticky** (`position: sticky; top: 0`), not static: the
  connection status and Connect/Disconnect action stay reachable while
  scrolling the grid (a long single column on mobile), and the translucent
  glass-over-content effect (`--color-surface-glass` + `backdrop-filter`
  blur) is the Aero register. Cost is one compact row of viewport height.
- Main column: `max-width: 1200px`, centered, `--space-5` padding
  (`--space-7` bottom), `--space-5` vertical gap between banner / card /
  grid. 1200px is a **layout constant, not a §1 token** (§1 is locked).

### Layout gap — Phase 4 charts without a bento slot (confirmed 2026-07-09)

The confirmed Figma bento grid (9 tiles below) only has slots for 2 of the 6
Phase 4 chart types (HRV, RHR combo charts). The stacked-bar (sleep stages)
chart and all 3 dot-matrix charts (recovery calendar, sleep performance,
strain matrix) predate this decision and have no tile in the Figma mockup.
**Decision:** leave the existing 9-tile `.bento-grid` untouched; append new
full-width rows **below** it for these 4 charts, each in its own
`ChartContainer` at the dashboard's 1200px column width (not squeezed into
the 640px-capped bento cluster). Order: stacked bar (sleep stages) → recovery
calendar → sleep performance → strain matrix.

### Dashboard grid & breakpoints — bento (revised)

**Superseded the earlier uniform 6-card `1fr` grid.** The confirmed Figma
frame (node `86:71`) is an asymmetric bento layout, not equal tiles, and
introduces tile types beyond the original 6 Phase-4 chart placeholders:
Period meter, Daily journal (stub — see below), Recovery donut, Sleep stat,
Calories stat, Strain donut, Skin-temp sparkline, HRV combo chart, RHR combo
chart (9 tiles total).

CSS grid (`.bento-grid`), gap `--space-3` (tighter than the old `--space-5` —
the Figma tiles are dense, not spacious):

| Breakpoint       | Columns | Layout                                                                                                                                                                                               |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile `<640px`  | 1       | All 9 tiles stacked in Figma's reading order (DOM order = visual order, no named areas needed)                                                                                                       |
| tablet+ `≥640px` | 3       | Named-area bento: period (full width) → journal (tall left column) beside a 2×2 of recovery/sleep/calories/strain → skin-temp (full width of the right 2 cols) → HRV (full width) → RHR (full width) |

Exact `grid-template-areas` (see `App.css`):

```
"period   period   period"
"journal  recovery sleep"
"journal  calories strain"
"journal  skintemp skintemp"
"hrv      hrv      hrv"
"rhr      rhr      rhr"
```

Columns are `1.1fr 1fr 1fr` — approximates the Figma ratio (journal column
134px vs. 124px for the others), not scraped pixel-for-pixel.

**Adaptation flagged for confirmation:** the Figma frame is a mobile mockup
(430px canvas) with intentionally dense/compact tiles. Rather than stretch
the bento grid to the dashboard's existing 1200px column (which would blow
up the donuts/stat numbers to an odd oversized scale), `.bento-grid` is
capped at `max-width: 640px` and centered on all breakpoints — a reversible
engineering call, not a value taken directly from Figma (which never
specifies a desktop/tablet variant).

- Chart sizing: HRV/RHR combo-chart and skin-temp sparkline placeholders
  currently reserve fixed heights (128px / 64px) — placeholder values, not a
  Phase 4 chart-sizing decision; real D3 charts will size responsively.

---

## 3. Component inventory

> Layout items built in Phase 3.2; component library built in task 3.3
> (`src/components/`). Chart rendering + data wiring remain Phase 4;
> questionnaire remains Phase 5.

- App shell / layout — **✅ built (3.2)**: `#root` gradient shell, sticky
  glass header, centered main column (§2).
- Header / nav — **✅ built (3.2)**: brand + status chip +
  Connect/Disconnect pill, driven by the same connection state as the auth
  card. **No sidebar/nav** — deferred until Phase 5 adds a second page (§2).
- **Card** — **✅ built (3.3)**: `src/components/Card.tsx`, the base
  glossy/glass surface (`--color-surface` + `--surface-gloss`,
  `--shadow-card` + inset gloss, `--radius-lg`/`--radius-xl`). Props:
  `as` (`div`/`section`/`article`), `padding` (`md` = `--space-3` tile
  density, `lg` = `--space-6` hero), `radius` (`lg` default / `xl`), plus
  passthrough HTML attrs. Every bento tile and the auth card render on it.
- **ChartContainer** — **✅ built (3.3)**: `src/components/ChartContainer.tsx`
  — Card + accessible title slot (`useId`-linked `aria-labelledby`),
  optional `subtitle` and `legend` slots, `bodyHeight` (owns the fixed
  placeholder heights 23/64/128px that were hardcoded per tile; Phase 4's
  responsive charts omit the prop), and `status: 'ready' | 'loading' |
'empty' | 'error'` — non-ready statuses swap the body for the matching
  state component. Phase 4 drops a D3 chart in as children and drives
  `status` from fetch state; no API change expected.
- **Loading / Empty / Error states** — **✅ built (3.3)**:
  `src/components/states.tsx` — `LoadingState` (`role="status"` +
  `aria-live="polite"` + spinner), `EmptyState` (meaningful default text),
  `ErrorState` (`role="alert"`). Used by ChartContainer and standalone (the
  auth card uses Loading/Error directly). Wiring them to real fetch state is
  Phase 4 (4.8).
- **Button** — **✅ built (3.3)**: `src/components/Button.tsx` —
  primary/secondary variants on `--color-accent`/`--color-accent-strong` +
  `--radius-pill`, sizes `md` (card CTA) / `sm` (header pill). Renders a
  real `<a>` when `href` is given (the OAuth actions are 302 navigations).
- **Form primitives** — **✅ built (3.3, unconsumed)**:
  `src/components/form.tsx` — `Label`, `Input`, `Select` on the §1 tokens.
  Deliberately minimal; the Phase 5 questionnaire is their first consumer.
- Auth: "Connect WHOOP" button, connected state — **✅ restyled (3.3)**: now
  a `Card` (`padding="lg"`, `radius="xl"`) + `Button` on the §1 tokens;
  legacy purple-accent styling gone. Auth logic byte-for-byte unchanged.
  _Still legacy:_ the OAuth error **banner** keeps its pre-§1 tokens — it
  wasn't in the 3.3 component list; migrate when it next changes.
- Dashboard grid container — **✅ revised (3.2 follow-up)**: `.bento-grid`,
  bento layout/areas per §2, unchanged by 3.3 (verified identical
  `grid-template-areas`/columns before and after the refactor).
- Bento tiles (period bar, journal stub list, stat donut, stat value,
  sparkline placeholder, combo-chart placeholder + legend) — **✅ rebuilt on
  Card + ChartContainer (3.3)**, same grid areas, placeholder visuals passed
  as ready-state children (deliberately NOT `status="empty"`, so the
  tile-specific Figma placeholder visuals survive; Phase 4 flips status from
  real fetch state). Real chart rendering + data wiring is **Phase 4**,
  specifically: recovery/strain donuts → real circular progress (**TODO
  4.9**), period meter → real dot-matrix cycle-day bar, self-reported via the
  Phase 5 journal's "Period" field rather than WHOOP data — so this tile
  depends on Phase 5 shipping (**TODO 4.10**, see §4), skin-temp sparkline →
  real line chart (**TODO 4.11**), calories/sleep stat tiles → stat cards
  with a monthly-average delta indicator (**TODO 4.12**). These four were
  absent from the original Phase 4 checklist (only the six D3 chart types
  below were listed) and were added 2026-07-14.
- Daily journal tile — **explicit stub, now on ChartContainer (3.3)**: same
  visible "Stub — Phase 5" label (subtitle slot) and static rows; no real
  journal UI until Phase 5.
- Chart components: **Phase 4, in progress**
  - StackedBarChart — **✅ built (4.1)**: `src/components/charts/StackedBarChart.tsx`,
    generic (typed keys over any nullable-numeric fields, reusable for e.g.
    strain contributors); renders sleep stages below the bento grid, fed by
    `/api/sleep-stages` via `src/hooks/useSleepStages.ts`. Stage color
    mapping: §4 proposal, pending confirmation.
  - ComboChart (×2 — bar + line) — **TODO (4.2/4.3)**
  - DotMatrixChart (×3) — **TODO (4.4–4.6)**
- Questionnaire form + fields — **TODO (Phase 5)** (will consume the 3.3
  form primitives)
- Tooltip (shared across charts) — **TODO (Phase 4)**

---

## 4. Chart → WHOOP-metric mappings

> **Confirmed 2026-07-09** (user accepted the ROADMAP suggestions as-is,
> kicking off Phase 4). Chart 6 uses the strain-matrix option, not the
> questionnaire-correlation option, since Phase 5 does not exist yet.

| #   | Chart type        | Confirmed mapping                                                                                                            |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stacked bar       | Sleep stages per night (Awake / Light / Deep / REM → total sleep)                                                            |
| 2   | Combo (line+area) | Recovery % (line) over Day Strain (area) — readiness vs. load                                                                |
| 3   | Combo (line+area) | HRV (line) over the confirmed ideal-band (area) — see methodology below                                                      |
| 4   | Dot-matrix        | Recovery calendar — one dot/day, color = recovery zone (red/yellow/green)                                                    |
| 5   | Dot-matrix        | Sleep performance — dot size/color = % of sleep need met                                                                     |
| 6   | Dot-matrix        | Strain matrix (one cell/day, color/intensity = day strain). Questionnaire-correlation variant revisited once Phase 5 exists. |

Candidate WHOOP v2 metrics to draw from: recovery %, HRV, resting heart rate,
day strain, sleep performance, sleep duration/stages, respiratory rate — plus
questionnaire self-reports. Confirm exact mapping (and time window) per chart.

### Bento-tile visualizations (added 2026-07-14, Phase 4.9–4.12)

> These four tile types exist in the confirmed Figma bento layout (§2/§3) as
> static placeholders but were missing from the chart checklist above until
> this update. Added per user request, cross-checked against the same Figma
> frame (`BWF8m6iu8eQJqJghVUbsOQ`, node `86:71`) that §2's grid is built from.

| Tile                | Visualization type                     | Confirmed mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery donut      | Circular progress ring                 | `recovery_score` (0–100%) from the latest `whoop_recovery` row, red/yellow/green zone coloring. **Cutoffs verified 2026-07-14 against https://developer.whoop.com/docs/whoop-101/: green 67–100%, yellow 34–66%, red 0–33%** (constants: `RECOVERY_ZONES` in `src/App.tsx`). Zone hues are the fill-safe §1 UI tokens `--color-positive`/`--color-warning`/`--color-negative` — arc fill only, never text (§5.1).                                                                                                                                                                                                                                                                                                                                                                           |
| Strain donut        | Circular progress ring                 | `strain` (WHOOP 0–21 scale) from the latest `whoop_cycles` row, ring fraction = `strain / 21`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Period meter        | Dot-matrix cycle-day progress bar      | **Confirmed 2026-07-14: self-reported, not WHOOP API.** Verified against the live WHOOP v2 OpenAPI spec — no menstrual-cycle resource exists (full resource list: Activity ID Mapping, Partner, User, Cycle, Recovery, Sleep, Workout). **Entry point (revised 2026-07-14): the Phase 5 daily journal's existing "Period" field** (`journal-stub-list` in `src/App.tsx`), not a standalone input — so this tile depends on Phase 5 shipping before it can show real data. Cycle start is inferred from that daily field via an episode-detection algorithm — see the cycle-start-detection rule below — not from an explicit "day 1" action. The tile stays in its empty state until Phase 5's journal exists and the user has logged at least one period day. See ROADMAP.md 4.10 and 5.1. |
| Skin-temp sparkline | Minimal line chart (no axes)           | `skin_temp_celsius` from `whoop_recovery`, trailing window (14 or 30 days — TBD).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Calories stat card  | Stat + monthly-average delta indicator | `kilojoule` from the day's `whoop_cycles` row, converted to kcal, vs. trailing-30-day mean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sleep stat card     | Stat + monthly-average delta indicator | Total sleep time from `whoop_sleep` (`total_in_bed_time_milli` − `total_awake_time_milli`, or sum of stage fields — definition TBD), vs. trailing-30-day mean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

These reuse the LOCKED §1 chart palette and the §5.2 accessibility contract
(numeric labels alongside any color coding, since `--color-chart-1/-4/-6` and
the recovery/strain zone colors are flagged as non-text-safe in §5.1).

### Period-meter cycle-start-detection rule — PROPOSAL (2026-07-14), pending confirmation

The Phase 5 journal only logs a per-day "Period" field (proposed tri-state:
`yes` / `no` / `not logged` — see the Phase 5.1 constraint in ROADMAP.md); it
does not ask the user to mark "this is day 1." Day 3 of an ongoing period and
day 1 of a new one look identical in the raw data, so the cycle-day
computation has to infer the boundary:

1. Take every day logged `yes`, sorted chronologically. Days that are `no` or
   `not logged` are excluded, not treated as breaking evidence on their own.
2. Group consecutive `yes` days into **episodes**: a `yes` day starts a new
   episode only if the gap since the previous `yes` day exceeds a threshold
   (**proposed default: 3 days** — tolerates a missed logging day or two
   inside a real period without misreading it as a new cycle; stays well
   below any realistic full cycle length). **Not derived from a clinical
   source — a heuristic, flagged for confirmation or for making it a
   user-adjustable setting.**
3. Cycle start = each episode's first `yes` day. Day-of-cycle shown =
   `today − latest episode's start date + 1`; keeps counting after the
   period ends, since a cycle is longer than the bleeding days.
4. Backfilled/edited journal entries require recomputing episodes from full
   history, not incremental appends — a late edit can merge, split, or shift
   boundaries.
5. **Known limitation, to disclose in the UI:** inferred boundaries can
   misread edge cases (e.g., spotting with a >3-day internal gap) as a new
   cycle. A manual "mark as new cycle" override is a possible Phase 5+
   enhancement if this proves unreliable — not required to ship 4.10/5.x.

### Sleep-stage color mapping (chart 4.1) — **PROPOSAL (2026-07-09), pending confirmation**

§1 locks the seven chart hexes and pre-assigns `--color-chart-1` to "Sleep"
generically; it does NOT lock a 4-way mapping for individual sleep stages.
This subsection locks one in (pending your confirmation). **Arithmetic
correction to the task brief:** with six of the seven hues already
load-bearing on the same dashboard view (chart-2 calories, chart-3 skin
temp/period, chart-4 HRV/RHR ideal band, chart-5 strain, chart-6 recovery,
chart-7 HRV/RHR actual), four distinct stage hues require reusing **three**
reserved tokens, not one — only chart-1 is free.

| Stage (stack, bottom→top) | Token             | Hue          | Reuse conflict & why it's the least bad                                                                                      |
| ------------------------- | ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Deep (bottom)             | `--color-chart-5` | Dark blue    | Strain donut/matrix. Deepest sleep = darkest blue is the natural read; strain never co-occurs in a sleep chart.              |
| REM                       | `--color-chart-2` | Dark orange  | Calories — currently a **text-only stat tile** with no colored mark at all, so this is the quietest reuse on the whole view. |
| Light                     | `--color-chart-1` | Light blue   | None — the one free token, and already the designated "Sleep" hue. Lightest blue = lightest sleep.                           |
| Awake (top)               | `--color-chart-4` | Pale mustard | HRV/RHR ideal band — a muted low-salience background area, geometrically distant from this chart's rows.                     |

Rejected reuses: `--color-chart-6` (lime = Recovery's signature semantic
color, and the recovery-calendar dot matrix 4.4 will sit directly below this
chart — worst possible confusion); `--color-chart-3` (bright magenta draws
both the skin-temp sparkline and the period meter on the same view, high
salience); `--color-chart-7` (drawn as the actual line in TWO charts, HRV and
RHR).

Contrast consequence (§5.2 rule 4): chart-1 and chart-4 fail the 3:1
non-text threshold on the white card, so **every bar segment wears a 1px
`--color-muted` outline** (`.chart-bar-segment` in charts.css) regardless of
fill — same precedent as the legend swatches. Stage hues are never used as
text (standing §5 rule); values are labeled in the tooltip/data table in
`--color-text`.

Stack order is deep → REM → light → awake (bottom→top), so bar depth reads
as sleep depth with wake time on top.

### HRV / RHR "ideal" band — confirmed methodology (feeds Phase 2.6)

**Confirmed direction:** "Ideal" is a **normative reference band** — what
published research says a typical cycle-driven fluctuation looks like — not
a personalized predictive/trend line. The user compares their actual
HRV/RHR against it to see whether their own fluctuation looks
typical/normal or looks abnormal.

**Source (verified directly, not from memory):** Lee et al., "A novel method
for quantifying fluctuations in wearable-derived daily cardiovascular
parameters across the menstrual cycle," _npj Digital Health_, 2024.
doi:10.1038/s41746-024-01394-0. N = 11,590 naturally-cycling participants,
45,811 cycles, WHOOP-derived data.

**What the paper actually gives us (only two anchor points per metric, not
a full published day-by-day curve — the full curve is in the paper's Figure
2, which is an image I could not extract numeric data from):**

| Metric      | Extreme point         | Offset from that person's own cycle mean |
| ----------- | --------------------- | ---------------------------------------- |
| RHR         | Nadir ≈ cycle day 4.8 | −1.83 BPM                                |
| RHR         | Peak ≈ cycle day 26.4 | +1.64 BPM                                |
| HRV (RMSSD) | Max ≈ cycle day 4.8   | +3.57 ms                                 |
| HRV (RMSSD) | Min ≈ cycle day 27.1  | −3.22 ms                                 |

The paper's named "amplitude" figures (RHR +2.73 BPM avg, HRV −4.65 ms avg —
these are the numbers WHOOP's own blog post cites) are actually a _two-window
comparison_: mean(cycle days 2–8) vs. mean(the final 7 days of that
person's own cycle length) — deliberately not a fixed day number, since
cycle length varies person to person (cohort mean was 27.42 ± 2.16 days).

**Confirmed centering (2026-07-08):** the band centers on **this user's own
overall historical average** RHR/HRV (computed from their synced
`whoop_recovery` data) — not the population's absolute BPM/ms level, since
the paper only publishes _relative offsets from cycle mean_, and not a
personalized trend/forecast either. The center is a single baseline
constant; the _shape_ of the fluctuation around it is the population
pattern from the study.

**Curve shape — approximated, flagged explicitly in-app:** because only the
two anchor points (not the full published curve) are available, the ideal
band is built by **interpolating a smooth curve between the two known
anchor points** per metric (nadir/peak day + offset). This is a reasonable
approximation of the study's shape, but it is **not** the literal published
curve — the UI must label it as "modeled from published population
averages," not as raw study data, and should say "outside the typical
range" rather than implying a medical abnormality (individual spread in the
study was large — RHR-amplitude SD ≈ ±1.95 BPM around a 2.73 BPM mean, HRV
even wider — so being outside the modeled band does not, on its own, mean
something is wrong).

**Still open / not yet built:** the actual transform code (Phase 2.6), and
whether a more precise version of the full curve can be sourced later (e.g.
supplementary data tables, if the paper publishes exact per-day GAMM
coefficients) rather than the two-anchor-point interpolation used here.

---

## 5. Interaction & accessibility

> **Authored in Task 3.4 (2026-07-08).** Two parts: what the current shell
> already guarantees (audited + fixed), and the **contract every Phase 4
> chart component must follow** — documentation Phase 4 builds against.

### 5.1 Current shell — audited state (Task 3.4)

- **Breakpoints:** verified at 375 / 768 / 1024 / 1280px — no horizontal
  overflow, sticky header never clips content (`.app-header` and
  `.header-session` wrap at narrow widths; before 3.4 the disconnected
  state's chip + Connect pill forced horizontal scroll at 375px).
- **Contrast:** every text/background pairing computed against WCAG AA —
  see the ratio table + flagged token deltas in §1. Standing rules:
  `--color-warning` and the LOCKED chart hues `--color-chart-1/-4/-6`
  (and `--color-positive` at small sizes) must **never color text**;
  `--color-border` is decorative and must never be the only boundary of a
  control (form controls use `--color-muted` borders, 5.42:1).
- **Tap targets:** all buttons/links get a ≥44×44px hit area via the
  `.ui-btn::after` extension (visual pill unchanged); form controls have
  `min-height: 44px`. _Known exception:_ the legacy OAuth banner's dismiss
  ✕ (~28×24px) — the banner is out of scope until next touched (§3).
- **Keyboard:** all interactive elements are native `<a>`/`<button>`, no
  custom `tabIndex` anywhere, focus order = DOM order = visual order; no
  traps. Focus indicator: `2px solid var(--color-accent)` outline with
  offset — #1173a6 is ≥4.6:1 against every shell background (needs 3:1).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` in
  `components.css` stops the `ui-spin` animation (spinner degrades to a
  static ring; every `LoadingState` also carries a text label) and snaps
  the button color transition.
- **Placeholder semantics:** each `ChartContainer` names its `<article>`
  via `useId`-linked `aria-labelledby`; placeholder visuals are
  `role="img"` with honest "no data yet" labels; every numeric placeholder
  ("—:—hrs", "— cal") is real text, not an image. The journal stub's
  sample rows are `aria-hidden` **deliberately** — they are fake data, and
  the adjacent (exposed) note tells screen-reader users there's no data
  source yet.

### 5.2 Phase 4 chart accessibility contract (build against this)

Every chart component (StackedBarChart, ComboChart, DotMatrixChart, and
the 4.0 scaffold) MUST ship with all of the following:

1. **Accessible name + summary on the SVG.** The `<svg>` gets
   `role="img"` plus either `aria-labelledby` pointing at an SVG
   `<title>` (name) and `<desc>` (one-sentence summary of what the chart
   currently shows, e.g. "Recovery percent by day, June 1–30, ranging
   42–98%"), or an equivalent `aria-label`. The summary must describe the
   _data_, not the chart type. When the tile is in a loading/empty/error
   state, ChartContainer's state components already carry the semantics —
   don't double-announce.
2. **Text/table fallback of the underlying data.** A visually-hidden (but
   screen-reader-exposed) `<table>` (or `<dl>` for single-series) of the
   series the chart renders, adjacent to the SVG, marked up so the SVG
   graphic itself can stay `aria-hidden` from the row-by-row reading flow
   if that avoids duplication. The fallback renders from the SAME
   transformed series the D3 code draws from (Phase 2.6 outputs) — never
   a re-fetch or re-derivation. Gaps stay gaps: a null day reads "no
   data", never 0 (the Phase 2 null discipline extends to what screen
   readers hear).
3. **Keyboard parity for hoverable points.** Any datum with a hover
   tooltip must be focusable (`tabindex="0"` on the point/mark, roving
   tabindex within a chart so one Tab stop enters the chart and
   arrow keys move between points) and show the SAME tooltip on focus as
   on hover (`focus`/`blur` mirror `mouseenter`/`mouseleave`). Escape
   dismisses. Tooltip content must itself be real text meeting AA
   contrast, and must not be the only place a value exists (the fallback
   table carries everything).
4. **Color is never the only encoding.** Series must be distinguishable
   by position/shape/pattern or direct labeling in addition to hue — the
   LOCKED palette (§1) contains hues that fail 3:1 against the white card
   (chart-1 light blue 1.55:1, chart-4 pale mustard 1.60:1, chart-6 lime
   1.07–2.07:1). Non-text marks in those hues get a ≥3:1 outline (the
   3.4 precedent: legend swatches wear a 1px `--color-muted` border) or a
   direct text label. Chart hues are NEVER used as text color — only
   chart-2, chart-5, chart-7 pass 4.5:1, and relying on that invites
   palette drift; label in `--color-text`/`--color-muted` instead.
5. **Reduced motion governs D3 transitions.** Gate every
   `selection.transition()` / animated entrance on
   `window.matchMedia('(prefers-reduced-motion: reduce)')` — when reduced,
   render the final state immediately (`.duration(0)` or skip the
   transition entirely). Live-update animations (e.g. a point pulsing)
   must have a static equivalent. This mirrors the CSS rule already in
   `components.css`.
6. **Legends** follow the 3.4 pattern: swatch `aria-hidden` + real-text
   label, swatches bordered per rule 4. Interactive legend toggles (4.7)
   are real `<button>`s with `aria-pressed`.

- Tooltips on hover/focus — pattern locked by rule 3.
- Keyboard navigation for interactive charts — pattern locked by rule 3.
- `aria-label` / `<title>` on SVGs — rule 1.
- `prefers-reduced-motion` for D3 transitions — rule 5.
