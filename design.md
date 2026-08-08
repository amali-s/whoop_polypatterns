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

> **2026-08-01 — confirmed UI/UX pass. The palette is no longer "LOCKED", and
> the contrast picture changed with it.** Four chart tokens were repointed and
> two new token families added at the user's direction; the ratios below were
> re-computed (WCAG 2.x relative luminance, not eyeballed) against white and
> against the tile's new translucent backdrop (`rgba(255,255,255,.5)` over the
> page gradient ≈ `#edf7fc`).
>
> | Token                 | New value | vs. white | vs. tile | ≥3:1 non-text?               |
> | --------------------- | --------- | --------- | -------- | ---------------------------- |
> | `--color-positive`    | `#6BCB3C` | 2.05:1    | 1.89:1   | **NO** (was 3.10:1 — passed) |
> | `--color-chart-3`     | `#FFCCE7` | 1.40:1    | 1.28:1   | NO                           |
> | `--color-chart-4`     | `#D9E3F0` | 1.30:1    | 1.19:1   | NO                           |
> | `--color-chart-5`     | `#02B3FF` | 2.36:1    | 2.17:1   | NO                           |
> | `--color-chart-7`     | `#FFA1A0` | 1.93:1    | 1.78:1   | NO                           |
> | `--color-skin-temp`   | `#F4801B` | 2.64:1    | 2.43:1   | NO                           |
> | `--color-sleep-deep`  | `#3A4F1A` | 9.08:1    | 8.35:1   | yes                          |
> | `--color-sleep-rem`   | `#6C8F25` | 3.75:1    | 3.45:1   | yes                          |
> | `--color-sleep-light` | `#9FE11E` | 1.58:1    | 1.46:1   | NO                           |
> | `--color-sleep-awake` | `#CCFF7C` | 1.16:1    | 1.06:1   | NO                           |
>
> **FLAGGED, three consequences the user should know about.**
>
> 1. **`--color-positive` lost its 3:1 pass.** It fills the recovery donut's
>    green zone (`RECOVERY_ZONES`), the "Connected" status dot, the `.dot`
>    indicator, and now the recovery line in chart 4.2. None of those is text,
>    and none is the ONLY carrier of its meaning — the donut prints its percent
>    as real text and names the zone in its `<desc>`, the status dot sits beside
>    the word "Connected" — so §5.2 rule 4 still holds by redundancy. But the
>    mark itself is now below the 3:1 a non-text indicator wants.
> 2. **The removed hairlines were the 3:1 remedy.** §5.2 rule 4's stated fix for
>    a sub-3:1 hue was "a ≥3:1 outline or a direct text label". The
>    2026-08-01 pass removed those outlines from the HRV/RHR lines and points,
>    the sleep-stage bars and most legend swatches, so those marks now lean
>    entirely on the OTHER half of the rule: every series is named in real text
>    in its legend, every focusable point carries an `aria-label`, every value
>    is in the tooltip and in the sr-only data table. A deliberate trade of
>    mark contrast for the requested cleaner look, not an oversight.
>
>    **Second pass, same date — the recovery line's casing went too.** The
>    `--color-muted` `strokeWidth={4}` casing under the recovery line in 4.2 was
>    the last one still standing; it was removed at the user's explicit
>    direction and the cost was flagged back rather than absorbed. The recovery
>    line is now bare `#6BCB3C` at 2.05:1 on the white card / 1.89:1 on the
>    tile, so it rests on the redundancy half of rule 4 exactly as the HRV/RHR
>    and strain lines already did — which at least makes the four full-series
>    charts internally consistent instead of one line wearing a remedy the
>    others had lost. **Remedy if the trade turns out wrong:** a darker green in
>    the same family — `#4E9E1E`, computed 3.37:1 on white and 3.10:1 on the
>    tile — clears 3:1 on its own, as a one-constant change to `RECOVERY_COLOR`
>    in `RecoveryStrainComboChart.tsx`. Note that this would break the
>    line's deliberate agreement with the recovery donut's green zone (both read
>    `--color-positive` today), so it is a design call, not a cleanup.
>
> 3. **`--color-border` is now a control boundary** on `.ui-input`/`.ui-textarea`
>    and the unselected journal chips, at 1.21:1 against the tile — the rule in
>    §5.1 that forbade exactly this was overridden by explicit confirmation. The
>    selected chip's label is `--color-text` on `#cfe3f0` at **11.09:1**, so the
>    text itself got better; it is the field/chip EDGE that got fainter.
>
> Fixing 1-3 (a darker green, restoring selected outlines, or a `--color-muted`
> field border) is a one-token change in each case if the trade turns out wrong.

> **2026-08-08 — task 6.2a added two tokens** (desktop/tablet breakpoints +
> token pass). Ratios computed WCAG 2.x, same method as above.
>
> - **`--color-chart-header` `#4b5459`** — the chart-tile title color
>   (`.ui-chart-title` only; `--color-text` is unchanged). **7.74:1 on white,
>   ~7.10:1 on the translucent tile** — clears the 4.5:1 text bar comfortably
>   (down from `--color-text`'s ~13:1, still a strong pass). Sourced from the
>   confirmed Figma frames (nodes `148:144` / `154:35`). **FLAGGED** — the
>   frame's bound "Text secondary" variable actually resolves to `#59554b`, and
>   `#4b5459` (the task's stated value) looks byte-transposed from it. Shipped
>   as specified; swap to `#59554b` if the Figma variable is the intended value.
> - **`--color-toggle-active` `#c9eeff`** — the RangeToggle selected-segment
>   fill (was `--color-accent`). A pale near-white: **1.22:1 on the white
>   track**, so the segment is bounded by its 1px `--color-accent-strong`
>   border (6.42:1 on the track, 5.25:1 on the fill), **not** by fill luminance —
>   the border still reads cleanly against the new light fill. The selected
>   label moved off white (`--color-surface`, ~1.3:1 on this fill — would have
>   failed badly) to `--color-text`, **11.97:1 on the fill** (see §5). Selection
>   is additionally carried by `aria-checked`, so neither is a color-only signal.

| Token                         | Value                   | Usage                                                                                |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `--color-bg`                  | `#e8f3fb`               | App background (airy sky-tinted)                                                     |
| `--color-surface`             | `#ffffff`               | Cards / panels (glossy white)                                                        |
| `--color-surface-glass`       | `rgba(255,255,255,0.6)` | Frosted / translucent panels (the sticky header bar)                                 |
| `--color-surface-translucent` | `rgba(255,255,255,0.5)` | Bento tile surface (added 2026-08-01 — Figma node `125:68`)                          |
| `--color-text`                | `#0f2b3d`               | Primary text (deep teal-navy) — 13.0:1 on bg                                         |
| `--color-muted`               | `#546d80`               | Secondary text (blue-grey) — 4.81:1 on bg, 5.42:1 on surface                         |
| `--color-border`              | `#cfe3f0`               | Soft blue-tinted hairline / dividers (decorative — 1.32:1, never a control boundary) |
| `--color-accent`              | `#1173a6`               | Primary accent (Aero azure) — 5.22:1 white label, ≥4.6:1 outline on every shell bg   |
| `--color-accent-strong`       | `#0f6494`               | Accent hover / pressed — 6.42:1 white label & as text on surface                     |
| `--color-positive`            | `#6bcb3c`               | Good / above target (green) — **2.05:1, fills only** (2026-08-01: was `#3aa657`)     |
| `--color-negative`            | `#c93848`               | Bad / below target (coral red) — 5.07:1 surface, 4.50:1 bg                           |
| `--color-warning`             | `#f5a623`               | Caution / attention (warm amber) — **fills/dots only, 2.03:1**                       |
| `--color-warning-text`        | `#946200`               | Warning-toned text — 5.24:1 surface, 4.65:1 bg (added 3.4)                           |
| `--color-chart-header`        | `#4b5459`               | Chart-tile title (`.ui-chart-title` only) — 7.74:1 white, ~7.1:1 tile (added 6.2a)   |
| `--color-toggle-active`       | `#c9eeff`               | RangeToggle selected-segment fill — 1.22:1 track, border-delineated (added 6.2a)     |

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

### Colors — chart / data-series palette (REPOINTED 2026-08-01)

Used **verbatim** — not approximated, tinted, or substituted. The token NAMES
are stable, so every consumer still reads `var(--color-chart-N)`; four of the
seven VALUES were replaced in the 2026-08-01 pass (previous values in the
right-hand column). This supersedes the earlier "LOCKED" framing of this table.

| Token             | Value     | Hue name       | Was (pre-2026-08-01)   |
| ----------------- | --------- | -------------- | ---------------------- |
| `--color-chart-1` | `#60E1F0` | Light blue     | unchanged              |
| `--color-chart-2` | `#875C00` | Dark orange    | unchanged              |
| `--color-chart-3` | `#FFCCE7` | Pale pink      | `#FF4978`              |
| `--color-chart-4` | `#D9E3F0` | Pale blue-grey | `#D9D059`              |
| `--color-chart-5` | `#02B3FF` | Bright azure   | `#096694`              |
| `--color-chart-6` | `#16D113` | Lime green     | unchanged — **unused** |
| `--color-chart-7` | `#FFA1A0` | Warm coral     | `#902944`              |

**`--color-chart-6` has no consumers and is deliberately KEPT as a reserved
slot** (decision flagged 2026-08-01, not silently made). It was Recovery's hue;
the recovery line in chart 4.2 now reads `--color-positive` — the same `#6BCB3C`
the recovery donut's green zone fills with, so the line and the ring finally
agree — which left chart-6 unreferenced. It stays defined because it is a
documented palette slot and removing one is a design call rather than a
cleanup; say the word and it goes.

#### Chart hues OUTSIDE the shared palette (added 2026-08-01)

Each of these belongs to exactly ONE chart, so a `--color-chart-N` slot would
imply a cross-chart semantic they don't have.

| Token                 | Value     | Owner                                                                           |
| --------------------- | --------- | ------------------------------------------------------------------------------- |
| `--color-skin-temp`   | `#F4801B` | Skin-temp sparkline — line, endpoint dot, and the top stop of its area gradient |
| `--color-sleep-deep`  | `#3A4F1A` | Sleep stages, Deep (bottom of the stack)                                        |
| `--color-sleep-rem`   | `#6C8F25` | Sleep stages, REM                                                               |
| `--color-sleep-light` | `#9FE11E` | Sleep stages, Light                                                             |
| `--color-sleep-awake` | `#CCFF7C` | Sleep stages, Awake (top)                                                       |

#### Chart hue → metric mapping (revised 2026-08-01)

| Token               | Hue             | Metric / role                                                       |
| ------------------- | --------------- | ------------------------------------------------------------------- |
| `--color-positive`  | Green `#6BCB3C` | **Recovery** — the donut's green zone AND chart 4.2's recovery line |
| `--color-chart-5`   | Bright azure    | **Strain** — the donut/ring AND chart 4.2's strain line             |
| `--color-chart-1`   | Light blue      | **Sleep** (generic) / hydrated in the 5.5 matrix                    |
| `--color-chart-2`   | Dark orange     | **Calories** (text-only tile) / dehydrated in the 5.5 matrix        |
| `--color-chart-3`   | Pale pink       | **Cycle/period meter** only — no longer shared with skin temp       |
| `--color-chart-7`   | Warm coral      | **HRV actual + RHR actual** (shared cardio "actual" line)           |
| `--color-chart-4`   | Pale blue-grey  | **HRV + RHR recent baseline** (shared muted band, 50% fill opacity) |
| `--color-chart-6`   | Lime green      | _unused / reserved_ — see the note above                            |
| `--color-skin-temp` | `#F4801B`       | **Skin temp** — its own token now                                   |
| `--color-sleep-*`   | green ramp      | **Sleep stages** — its own four tokens now                          |

Notes:

- **HRV/RHR sharing** is unchanged and still fine: actual lines share
  `--color-chart-7`, baseline bands share `--color-chart-4`, and the two
  metrics never appear in the same chart. If they ever do, split them then.
- **Skin temp vs. cycle/period meter no longer share `--color-chart-3`**
  (changed 2026-08-01). The old note below said the sharing was "fine only
  while they never share a chart" — which was always uncomfortable, since both
  tiles ARE on this one dashboard view. chart-3 was repointed to the period
  meter's pale pink and skin temp took `--color-skin-temp`, so the ambiguity
  is gone rather than merely tolerated.
- **Sleep stages no longer borrow chart tokens** (changed 2026-08-01). The
  four-way mapping below reused chart-5/-2/-1/-4; chart-5 and chart-4 have
  since been repointed to Strain and the HRV/RHR baseline, so the borrow had
  to end. See the `--color-sleep-*` family above.
- **Hydration states (Phase 5.5)** reuse `--color-chart-1` (hydrated) and
  `--color-chart-2` (dehydrated) in `HydrationRecoveryDotMatrix`, with
  `--color-border` for "undetermined" — the same never-in-the-same-chart
  double-duty as the row above (chart-1 is Sleep, chart-2 is Calories, and
  neither appears in that chart). Blue-vs-orange was chosen over any other free
  pair because those two hues ARE the comparison there, so the colorblind-safe
  opposition matters more than usual. `--color-border` is deliberately not a
  data hue: an unanswered day is an absence, not a third answer. Source of
  truth: `src/lib/hydration.ts` (`HYDRATION_COLORS`).
- **Journal accents** are proposed to reuse the UI `--color-accent` (sky
  blue) rather than consume a chart slot — keeping the 7 hues for data.

### Typography

Direction: rounded, humanist sans (friendly, optimistic — the Aero
register). The historically "correct" face is Frutiger itself, which is
**proprietary (Linotype)**, has no web-font licence, and was never an option.

**HEADINGS = Roboto — CONFIRMED and shipped 2026-08-01.** Loaded in
`index.html` from Google Fonts (weights 400/500/700, `display=swap`) with
`preconnect` hints. The earlier Nunito Sans / Mulish candidates were never
imported and are dropped.

- **Scope:** `--font-display` (and the legacy `--heading` token that drives
  `h1, h2`) only. **Body text is unchanged** — `--font-sans` still resolves to
  the system humanist stack. Note that `--font-display` already dressed more
  than headings: the card titles, the ring/sparkline values and the stat-card
  numerals read it too (charts.css), so Roboto lands on those numerals as
  well. That is the token's pre-existing scope, not a widening.
- **Flagged — loading strategy is a judgment call.** The repo had no
  font-loading convention to follow (nothing was loaded before). Google Fonts
  is the smallest change that works, but it means a third-party request that
  exposes the visitor's IP to `fonts.googleapis.com`/`fonts.gstatic.com`. For
  a health dashboard that may not be acceptable; self-hosting the two woff2
  files under `/public` with a local `@font-face` is a drop-in swap.

**BODY FACE = Spectral — task 6.2a, 2026-08-08.** `--font-sans` now leads with
Spectral (a Google Fonts **serif**), loaded from the **same single** Google
Fonts `<link>` as Roboto (`family=Roboto:…&family=Spectral:wght@400;600`,
`display=swap`) — one request, no new third-party host.

- **Scope, flagged.** `--font-sans` is **not** the globally-inherited body font —
  that is the legacy `--sans` token in the `:root` `font:` shorthand, which is
  untouched. `--font-sans` is read only by the component primitives (`.ui-btn`,
  `.ui-input`/`-select`/`-textarea`, `.range-toggle-option`, `.journal-choice`)
  and the chart **axis tick labels** (`.chart-axis text`). So Spectral lands on
  exactly those, at the two weights they render — **400** (inputs, axis labels)
  and **600** (buttons, toggle, chips), which is the weight set requested. The
  headline numerals and card titles read `--font-display` (Roboto) and are
  **unaffected**. If ALL inherited body copy should also be Spectral, `--sans`
  needs repointing too — wider than this task.
- **Fallback.** The stack keeps its existing pattern per the task, so it
  degrades to a **sans** face (not a serif) during the swap period; a serif
  fallback (e.g. Georgia) would preserve the serif character if preferred.
- **Same privacy trade-off** as Roboto (a second face from the same Google Fonts
  hosts); self-hosting both woff2 families is the same drop-in alternative.

| Token            | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `--font-sans`    | `Spectral, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif` (body/primitives — 6.2a) |
| `--font-display` | `Roboto, 'Segoe UI', system-ui, -apple-system, sans-serif` (headings — 2026-08-01)                             |
| `--font-mono`    | `ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace`                                         |

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
          ├── <div class="range-toggle-row"> — time-range toggle (task 4.14)
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

> **SUPERSEDED for the three shipped below-grid tiles — task 6.2a
> (2026-08-08).** The confirmed desktop/tablet Figma frames give Sleep stages,
> Recovery-vs-strain and Hydration-vs-recovery real grid slots, so they are no
> longer full-width siblings below `.bento-grid` — they are now grid tiles
> (`bento-sleepstages` / `bento-recstrain` / `bento-hydration`). DOM order is
> unchanged (they still follow RHR in reading order), so mobile stacking is
> identical. See "Desktop / tablet breakpoints" below.

### Dashboard grid & breakpoints — bento (revised)

> **SUPERSEDED 2026-08-08 (task 6.2a).** The single "tablet+ ≥640px" 3-column
> layout below was replaced by two real breakpoints (tablet 640–1023, desktop
> ≥1024) from dedicated Figma frames, and all 12 tiles now live in the grid.
> The record below is kept as history; the current layout is in **"Desktop /
> tablet breakpoints — task 6.2a"** further down.

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

### Desktop / tablet breakpoints — task 6.2a (2026-08-08)

**Now three real breakpoints, from two dedicated Figma frames** (file
`BWF8m6iu8eQJqJghVUbsOQ`): **tablet** node `154:35` and **desktop** node
`148:144`. (The original punch-list said "desktop/laptop/tablet" but only two
frames exist — laptop folds into desktop; no third breakpoint was invented.)
All **12** tiles now live in `.bento-grid`: the earlier 9 plus the three that
used to render below it (Sleep stages, Recovery-vs-strain, Hydration-vs-
recovery). Grid gap and page side-gutters are **`--space-4` (16px)** at both
upper breakpoints, straight from the frames; mobile is untouched.

| Breakpoint          | Content column | Columns             | Gap  | Notes                                                    |
| ------------------- | -------------- | ------------------- | ---- | -------------------------------------------------------- |
| mobile `<640px`     | `max 640px`    | 1 (`1fr`)           | 12px | **Unchanged** — single-column stack, DOM = reading order |
| tablet `640–1023px` | `max 992px`    | 2 (`repeat(2,1fr)`) | 16px | Journal is a **full-width row**; 488px tile pairs        |
| desktop `≥1024px`   | `max 1280px`   | 4 (`repeat(4,1fr)`) | 16px | Journal spans cols 1–2 **and rows 2–3** (632×~420px)     |

The main column (`.dashboard`) side padding drops to `--space-4` (16px) at
`≥640px` (was `--space-5`/24px), and its `max-width` is raised to **1312px** at
`≥1024px` (was 1200) so the 1280px desktop grid isn't clipped — 1312 is the
Figma desktop frame width, 16px gutters → 1280 content. The `RangeToggle` row
tracks the same per-breakpoint `max-width` (992 / 1280) so it right-aligns to
the grid edge.

**Before → after `grid-template-areas`:**

_Before (single `≥640px`, 3 cols `1.1fr 1fr 1fr`, 9 tiles):_

```
"period   period   period"
"journal  recovery sleep"
"journal  calories strain"
"journal  skintemp skintemp"
"hrv      hrv      hrv"
"rhr      rhr      rhr"
```

_After — tablet (`640–1023px`, `repeat(2,1fr)`, 12 tiles):_

```
"period       period"
"journal      journal"
"recovery     sleep"
"calories     strain"
"skintemp     skintemp"
"hrv          hrv"
"rhr          rhr"
"sleepstages  sleepstages"
"recstrain    recstrain"
"hydration    hydration"
```

_After — desktop (`≥1024px`, `repeat(4,1fr)`, 12 tiles):_

```
"period      period      period       period"
"journal     journal     recovery     sleep"
"journal     journal     calories     strain"
"skintemp    skintemp    hrv          hrv"
"rhr         rhr         sleepstages  sleepstages"
"recstrain   recstrain   hydration    hydration"
```

The `.bento-*` grid-area names are shared by both upper breakpoints (only the
template differs); on mobile there are no named areas, so each named item
auto-places into the single column in DOM order. **Also in 6.2a:** the
`SleepStagesTile` was wired to the shared 1-month/3-month range toggle
(`useSleepStages(rangeDays)` — it keys its fetch on `days`), which it wasn't
before; verified live (subtitle "30 nights" → "90 nights", refetch at
`?days=90`).

**Verified** (browser, mock-connected dashboard) at 1400 / 900 / 375px against
the frames — desktop tiles land pixel-exact (journal 632×417, 308px stat
tiles, 632px chart pairs); tablet is 2×488 with a full-width journal; mobile is
a single 640-capped column with no horizontal overflow.

### Time-range toggle placement (task 4.14, 2026-07-28)

The dashboard window is user-selectable between 30 and 90 days. The control
(`RangeToggle`, §3) lives in a `.range-toggle-row` in the **1200px main
column, directly above `.bento-grid`** — shell content, in the same band as
the OAuth error banner and auth card.

**It is deliberately NOT a bento tile.** The confirmed Figma frame (node
`86:71`) is a 430px mobile mockup with no reserved slot for a control, and
`.bento-grid` is capped at 640px — fitting one in would mean editing the
locked `grid-template-areas` above. Placing it in the shell band instead is
purely **additive and reversible**: nothing in the bento grid changed to
accommodate it. This is the same "no bento slot → don't force one" reasoning
as the Layout-gap decision above, applied to a control rather than a chart.

The row mirrors the grid's own `max-width: 640px` + `margin-inline: auto` so
the control lines up with the tiles it governs rather than floating out at the
full 1200px, and right-aligns within that box so it reads as a control **on**
the grid, not a heading over it. The main column already supplies the
`--space-5` gap between shell children, so the row sets no margin of its own.

**Behavior.** Selecting a range re-drives the single shared
`useDailySeries(rangeDays)` fetch, so all five range-driven tiles
(Recovery-vs-strain, HRV, skin temp, Sleep, Calories) update together, and
every caption that names the window ("last 30 days") re-renders to match. The
stat cards' baseline window tracks the selection too, so "your recent average"
always means the average over the window on screen. The selection persists in
`localStorage` (`whoop-dashboard:range-days`), read during the first render so
a 3-month user never sees a 30-day flash.

**Out of scope by design:** the Recovery/Strain rings (`RING_DAYS` = 7), the
period meter, and the journal do not respond to the toggle — each reads a
single latest-scored day rather than charting a range, so there is no window
for the control to change. Verified byte-identical across a toggle.

> **Updated 2026-08-08 (task 6.2a):** two changes to the above. (1) The
> `.range-toggle-row` no longer mirrors a fixed 640px — it tracks the grid's
> per-breakpoint `max-width` (640 mobile / 992 tablet / 1280 desktop) so it
> stays right-aligned to the grid edge at every width. (2) **Sleep stages** is
> now range-driven too, so it's **six** tiles that update on toggle, not five —
> `SleepStagesTile` was wired to `rangeDays` (`useSleepStages` keys on `days`);
> the rings / period meter / journal remain out of scope as above.

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
  glossy/glass surface (`--color-surface-translucent` + `--surface-gloss`,
  `--shadow-card` + inset gloss, `--radius-lg`/`--radius-xl`).
  **2026-08-01, two separate changes (confirmed):** (a) the base layer dropped
  to **50% white** (`--color-surface-translucent`, from Figma node `125:68`)
  — applied to the background COLOR, never to the element's `opacity`, which
  would fade the content too; (b) a **corner shine** was added as a
  non-interactive `::after` radial highlight in the top-right, `pointer-events:
none`, kept below the content with `z-index`. (b) is a **first-pass
  interpretation, not a spec** — the reference node carries the opacity value
  but no gloss of its own, so there is nothing to match pixel-for-pixel; expect
  to tune intensity/size/falloff. The pseudo-element uses `inset: 0` +
  `border-radius: inherit` rather than `overflow: hidden` on the card, because
  hiding overflow would clip the chart tooltips that deliberately escape a
  tile. Props:
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
- **RangeToggle** — **✅ built (4.14)**: `src/components/RangeToggle.tsx` —
  segmented control for the dashboard time range (§2 for placement). Props:
  `options` (`{value, label}[]`), `value`, `onChange`, `label` (the group's
  accessible name — there is no visible legend), `className`. Generic over
  the option value, so it isn't hard-wired to day counts. Styled in the
  `Button` pill vocabulary (pill radius, inset gloss, 1px border) but as ONE
  grouped track with a selected segment inside it — a row of separate
  `.ui-btn` pills would read as several independent actions rather than a
  single either/or choice. Selected segment takes the accent FILL, matching
  `.ui-btn-primary`.
  **2026-08-01:** the selected segment no longer paints its own background —
  a single `.range-toggle-thumb` element slides between positions with an
  `ease-in-out` transition (260ms), so selection reads as one pill travelling
  rather than two backgrounds swapping. The track became an equal-column
  `inline-grid` to make that possible (the two labels are different widths).
  Reduced motion snaps it into place instead.
  **Accessibility:** `role="radiogroup"` over native `<button role="radio">`
  with `aria-checked`; roving tabindex (one Tab stop for the group);
  arrow keys on both axes plus Home/End, with selection following focus per
  the WAI-ARIA radio pattern; native buttons retain Space/Enter. §5.2's chart
  contract does **not** apply — this is a control, not a chart, with no data
  to expose as a table — but §5.1's shell rules do: standard `2px solid
var(--color-accent)` focus ring, 44px tap target via the `::after`
  extension, and selection conveyed by `aria-checked` as well as color (so
  the accent fill is never the only signal). _Note:_ this is the first
  component to use a custom `tabIndex`, which §5.1's "no custom tabIndex
  anywhere" audit line no longer covers verbatim — it is required by the
  radiogroup pattern, not decoration.
- **Tearsheet** — **✅ built (2026-08-01)**: `src/components/Tearsheet.tsx` —
  a bottom-anchored modal panel that slides up over the dashboard. Props:
  `open`, `title`, `onClose`, `children`, `className`. Built on a native
  `<dialog>` + `showModal()`, so the focus trap, inert background, top-layer
  stacking and Escape-to-close come from the platform rather than being
  reimplemented. Slide in AND out via `transition-behavior: allow-discrete` +
  `@starting-style` (without those, `display` being a discrete property means
  only the exit would animate); degrades to an instant show/hide where
  unsupported, and is gated on `prefers-reduced-motion`. `onClose` fires for
  every dismissal route — ✕, Escape, backdrop click — so callers cannot treat
  them differently. **The interaction pattern is borrowed from the referenced
  design-system tearsheet; none of its visuals are** — the surface is this
  app's own §1 tokens. Its only consumer is the daily-journal tile.
- **JournalSummary** — **✅ built (2026-08-01)**:
  `src/components/JournalSummary.tsx` — READ-ONLY `<dl>` of a saved day's
  answers, in `JOURNAL_QUESTIONS` order, with no editable controls. Unanswered
  fields are RENDERED (muted "Not answered"), never dropped: hiding them would
  erase the `null` vs. `false`/`0` distinction the whole schema exists to keep.
- **TrendIndicator / TrendArrow** — **✅ built (2026-08-01)**:
  `src/components/charts/TrendIndicator.tsx` — one trailing-average comparison
  as "▲ 12% above your 1-month average". `TrendArrow` is now the single
  definition of the ▲/▼ glyph; `StatDelta` was refactored to import it rather
  than keep its own copy. _(Correction to the 2026-08-01 brief: there is no
  `Polygon`/triangle SVG component in this codebase to reuse — the pre-existing
  pattern was a literal text glyph inside `StatDelta`, and that is what is now
  shared.)_ Compares by PERCENT, since recovery is already a percentage and
  strain is a unitless 0-21 score.
- **Form primitives** — **✅ built (3.3, unconsumed)**:
  `src/components/form.tsx` — `Label`, `Input`, `Select` on the §1 tokens.
  Deliberately minimal; the Phase 5 questionnaire is their first consumer.
- Auth: "Connect WHOOP" button, connected state — **✅ restyled (3.3),
  re-restyled (2026-08-01)**: a `Card` + `Button` on the §1 tokens; legacy
  purple-accent styling gone. Auth logic byte-for-byte unchanged.
  2026-08-01 (confirmed): the tile's own surface is switched off — no
  background, border, shadow or corner gloss — so it reads as content directly
  on the page gradient; it widened from 420px to **640px, matching
  `.bento-grid`'s cap and centering**; text stepped down (`--text-lg` heading,
  `--text-sm` body); padding dropped from `--space-6` to `--space-3` so its
  headings line up with the bento tiles below and the head row fits on one
  line at 375px; and the "Connect WHOOP" action moved to the **top-right** of
  the tile. Its CONDITION is unchanged — still rendered only while
  disconnected, never when WHOOP is linked.
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
  specifically: recovery/strain donuts → real circular progress (**✅ 4.9**),
  period meter → real dot-matrix cycle-day bar, self-reported via the
  Phase 5 journal's "Period" field rather than WHOOP data (**✅ 4.10
  component + logic shipped; the tile honestly renders no-data until Phase 5
  ships the field** — see §4), skin-temp sparkline →
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

| #   | Chart type        | Confirmed mapping                                                                                                                                                          |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stacked bar       | Sleep stages per night (Awake / Light / Deep / REM → total sleep)                                                                                                          |
| 2   | Combo (line+area) | Recovery % (line) over Day Strain (area) — readiness vs. load                                                                                                              |
| 3   | Combo (line+area) | HRV (line) over a trailing rolling baseline (area). **Population ideal-band DEFERRED — shipped as a rolling baseline 2026-07-21; see the note directly below this table.** |
| 4   | Dot-matrix        | Recovery calendar — one dot/day, color = recovery zone (red/yellow/green)                                                                                                  |
| 5   | Dot-matrix        | Sleep performance — dot size/color = % of sleep need met                                                                                                                   |
| 6   | Dot-matrix        | Strain matrix (one cell/day, color/intensity = day strain). **Questionnaire-correlation variant SHIPPED 2026-07-31 as its own chart (Phase 5.5) — see the note below.**    |

> **Chart 3 — ideal-band DEFERRED, rolling-baseline variant shipped instead (decided 2026-07-21).**
> The "confirmed ideal-band" this row originally locked (the Lee et al. cycle-day
> methodology in the "HRV / RHR 'ideal' band" section below) is a function of
> **menstrual cycle day** — it places the user on the band by where they are in
> their cycle (HRV max ≈ cycle day 4.8, min ≈ day 27.1). That cycle-day signal
> does not exist until Phase 5's period journal ships and `src/lib/cycle.ts` can
> derive it, so the population band is **deferred pending Phase 5 cycle-day data**
> (same dependency that blocks the 4.10 period meter). Rather than leave the tile
> a placeholder, chart **4.3 shipped the ROADMAP's alternative mapping** — HRV
> (line) over its own **trailing 7-day rolling baseline** (area), computed
> client-side via `buildRollingBaseline` — as `HrvBaselineComboChart`
> (`src/components/charts/HrvBaselineComboChart.tsx`). It is labelled **"Recent
> baseline"**, deliberately NOT "Ideal": there is no population study behind a
> trailing mean, and this codebase does not mislabel what a chart shows. When
> Phase 5 lands, the ideal-band variant can be revisited as an enhancement (or a
> toggle) without disturbing the shipped rolling baseline. Full decision +
> file/wiring detail: ROADMAP.md **4.3**; the deferred methodology it supersedes
> is preserved unchanged in the "HRV / RHR 'ideal' band" section below.

> **Chart 6 — the questionnaire-correlation variant shipped (2026-07-31, Phase 5.5),
> as an ADDITION rather than a replacement.** The row above locked the strain-matrix
> option "since Phase 5 does not exist yet"; Phase 5 now exists, so the alternative it
> named was built: `HydrationRecoveryDotMatrix`
> (`src/components/charts/HydrationRecoveryDotMatrix.tsx`) — one dot per day, with the
> two variables on ORTHOGONAL channels: **hue = the self-reported `hydrated` answer**
> (three states — hydrated / dehydrated / undetermined, which are the chart's three
> legend entries), **row = recovery zone** (a band per zone plus a "no data" row, each
> labelled by its range in real text on the left axis). Dot size, and the dashed
> outline on undetermined, repeat what the hue says so the answer is never color-only
> (§5.2 rule 4). The pairing is **hydration** vs. recovery (user-chosen 2026-07-31),
> not "stress vs. recovery" as ROADMAP 5.5 worded it: there is no stress field in the
> locked 5.1 question set (ROADMAP.md 5.5 records the correction, the first-shipped
> alcohol pairing, and both revisions). **Recovery is NOT hue here** — the zone tokens
> `--color-positive`/`-warning`/`-negative` are not used by this chart at all, since
> hue belongs to hydration; the zone CUTOFFS still come from `src/lib/recovery.ts`, so
> the rows are the same 67/34 boundaries the donut uses. For the hydration hues and
> why they were chosen, see the chart-1/chart-2 double-duty note in §1. The strain
> matrix is NOT superseded — it remains unbuilt under Phase 4.6, and nothing about
> this row's mapping changed. Full decision + file/wiring detail: ROADMAP.md **5.5**.

Candidate WHOOP v2 metrics to draw from: recovery %, HRV, resting heart rate,
day strain, sleep performance, sleep duration/stages, respiratory rate — plus
questionnaire self-reports. Confirm exact mapping (and time window) per chart.

### Bento-tile visualizations (added 2026-07-14, Phase 4.9–4.12)

> These four tile types exist in the confirmed Figma bento layout (§2/§3) as
> static placeholders but were missing from the chart checklist above until
> this update. Added per user request, cross-checked against the same Figma
> frame (`BWF8m6iu8eQJqJghVUbsOQ`, node `86:71`) that §2's grid is built from.

| Tile                | Visualization type                      | Confirmed mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery donut      | Circular progress ring                  | `recovery_score` (0–100%) from the latest `whoop_recovery` row, red/yellow/green zone coloring. **Cutoffs verified 2026-07-14 against https://developer.whoop.com/docs/whoop-101/: green 67–100%, yellow 34–66%, red 0–33%** (constants: `RECOVERY_ZONES` in `src/lib/recovery.ts` — moved there from `src/App.tsx` in Phase 5.5, values unchanged, when the alcohol/recovery dot matrix became a second consumer of the same cutoffs). Zone hues are the fill-safe §1 UI tokens `--color-positive`/`--color-warning`/`--color-negative` — arc fill only, never text (§5.1).                                                                                                                                                                                                                |
| Strain donut        | Circular progress ring                  | `strain` (WHOOP 0–21 scale) from the latest `whoop_cycles` row, ring fraction = `strain / 21`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Period meter        | Dot-matrix cycle-day progress bar       | **Confirmed 2026-07-14: self-reported, not WHOOP API.** Verified against the live WHOOP v2 OpenAPI spec — no menstrual-cycle resource exists (full resource list: Activity ID Mapping, Partner, User, Cycle, Recovery, Sleep, Workout). **Entry point (revised 2026-07-14): the Phase 5 daily journal's existing "Period" field** (`journal-stub-list` in `src/App.tsx`), not a standalone input — so this tile depends on Phase 5 shipping before it can show real data. Cycle start is inferred from that daily field via an episode-detection algorithm — see the cycle-start-detection rule below — not from an explicit "day 1" action. The tile stays in its empty state until Phase 5's journal exists and the user has logged at least one period day. See ROADMAP.md 4.10 and 5.1. |
| Skin-temp sparkline | Minimal line chart (no axes)            | `skin_temp_celsius` from `whoop_recovery`, trailing window (14 or 30 days — TBD). **2026-08-01:** the numeric reading renders ABOVE the plot; the line is `--color-skin-temp` `#F4801B` (its own token — no longer sharing `--color-chart-3` with the period meter) over a vertical gradient area fading from that hue to transparent, with no stroke on the area and no casing on the line.                                                                                                                                                                                                                                                                                                                                                                                                |
| Calories stat card  | Stat + trailing-average delta indicator | `kilojoule` from the day's `whoop_cycles` row → kcal via `KJ_PER_KCAL = 4.184` (**CONFIRMED 2026-07-19**: the thermochemical calorie, NIST cal_th = 4.184 J exactly; WHOOP does NOT publish which calorie their displayed figure means, so 4.184 = the nutritional convention — revisit only if WHOOP states otherwise). Compared vs. the trailing baseline (App shares the 30-day fetch; today is EXCLUDED → ≤29 prior days, so the caption says "your recent average", not "exactly 30"), min-sample floor **10** (`baselineDelta` in `src/lib/stats.ts`; below 10 → value + "not enough history yet", no delta). Shipped 4.12.                                                                                                                                                           |
| Sleep stat card     | Stat + trailing-average delta indicator | Total sleep = the **STAGE SUM** (light + deep + REM) = `DailyMetricPoint.totalSleepMilli` (**CONFIRMED 2026-07-19**, decision 1 — NOT `total_in_bed − total_awake`: already shipped, naps already excluded, matches chart 4.1's stacked bar; a second competing "sleep" definition on one dashboard is worse than a slightly conservative number). Formatted `h:mm`; delta in minutes vs. the same trailing baseline (today excluded, min-sample floor 10). Shipped 4.12.                                                                                                                                                                                                                                                                                                                   |

These reuse the LOCKED §1 chart palette and the §5.2 accessibility contract
(numeric labels alongside any color coding, since `--color-chart-1/-4/-6` and
the recovery/strain zone colors are flagged as non-text-safe in §5.1).

### Period-meter cycle-start-detection rule — CONFIRMED (2026-07-18)

> User-confirmed 2026-07-18 (was a 2026-07-14 proposal). Implemented in
> `src/lib/cycle.ts` (Task 4.10), unit-tested by `scripts/test-cycle.mjs`.

The Phase 5 journal only logs a per-day "Period" field (tri-state:
`yes` / `no` / `not logged` — see the Phase 5.1 constraint in ROADMAP.md); it
does not ask the user to mark "this is day 1." Day 3 of an ongoing period and
day 1 of a new one look identical in the raw data, so the cycle-day
computation has to infer the boundary:

1. Take every day logged `yes`, sorted chronologically. Days that are `no` or
   `not logged` are excluded, not treated as breaking evidence on their own.
2. Group consecutive `yes` days into **episodes**: a `yes` day starts a new
   episode only if the gap since the previous `yes` day exceeds a threshold
   (**confirmed: 3 days**, strictly greater-than — a 3-day gap continues the
   episode; shipped as `EPISODE_GAP_DAYS = 3` in `src/lib/cycle.ts`. The
   value tolerates a missed logging day or two inside a real period without
   misreading it as a new cycle and stays well below any realistic full
   cycle length. **A chosen heuristic, not derived from a clinical source** —
   noted in-code; a user-adjustable setting remains an option if it proves
   wrong in practice).
3. Cycle start = each episode's first `yes` day. Day-of-cycle shown =
   `today − latest episode's start date + 1`; keeps counting after the
   period ends, since a cycle is longer than the bleeding days.
4. Backfilled/edited journal entries require recomputing episodes from full
   history, not incremental appends — a late edit can merge, split, or shift
   boundaries.
5. **Cycle length is asked, never assumed (confirmed 2026-07-18):** Phase 5
   asks the user their typical cycle length once, on their first logged
   period — the app never defaults to 28. Until a length exists
   (user-reported, or estimated as the mean start-to-start gap once ≥2
   episodes exist — the estimate then takes precedence, and `lengthSource`
   labels which is shown), the meter renders text-only: day number, no
   denominator, no dot row.
6. **Known limitation, to disclose in the UI:** inferred boundaries can
   misread edge cases (e.g., spotting with a >3-day internal gap inside one
   real period) as a new cycle. A manual "mark as new cycle start" override
   remains a Phase 5+ enhancement if this proves unreliable — not required
   to ship 4.10/5.x. A TODO at `PeriodMeterTile`'s render site requires
   surfacing this in the UI once real data flows.

### Sleep-stage color mapping (chart 4.1) — **CONFIRMED 2026-08-01**

The stages have their OWN four tokens; nothing is borrowed from the shared
chart palette any more. (The 2026-07-09 proposal this replaces reused
chart-5 / chart-2 / chart-1 / chart-4 because only chart-1 was free — an
arrangement that ended when chart-5 and chart-4 were repointed to Strain and
the HRV/RHR baseline. The full reasoning for those reuses, and the reuses
rejected at the time, is in git history for this file.)

| Stage (stack, bottom→top) | Token                 | Value     |
| ------------------------- | --------------------- | --------- |
| Deep (bottom)             | `--color-sleep-deep`  | `#3A4F1A` |
| REM                       | `--color-sleep-rem`   | `#6C8F25` |
| Light                     | `--color-sleep-light` | `#9FE11E` |
| Awake (top)               | `--color-sleep-awake` | `#CCFF7C` |

A single dark→light green ramp, so bar depth reads as sleep depth — the ramp
itself carries the ordering, which four unrelated hues never did.

Contrast consequence (§5.2 rule 4): the 1px `--color-muted` outline every bar
segment used to wear is **removed** (`.chart-bar-segment` in charts.css now
sets `stroke: none`). Deep (8.35:1) and REM (3.45:1) clear 3:1 against the
tile on their own; Light (1.46:1) and Awake (1.06:1) do not, and lean on the
other half of rule 4 — the legend names every stage in real text, each segment
carries an `aria-label`, and the tooltip and sr-only data table both print the
minutes. Adjacent segments are also separated by the ramp's own steps. Stage
hues are never used as text (standing §5 rule).

**Out of scope, tracked as ROADMAP 6.2:** the 3-month view's "bars narrow into
a line-like treatment" is NOT implemented — it needs a visual reference to
disambiguate from a plain line-chart conversion.

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
