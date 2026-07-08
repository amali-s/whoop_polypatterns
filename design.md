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

| Token                   | Value                   | Usage                                |
| ----------------------- | ----------------------- | ------------------------------------ |
| `--color-bg`            | `#e8f3fb`               | App background (airy sky-tinted)     |
| `--color-surface`       | `#ffffff`               | Cards / panels (glossy white)        |
| `--color-surface-glass` | `rgba(255,255,255,0.6)` | Frosted / translucent panels         |
| `--color-text`          | `#0f2b3d`               | Primary text (deep teal-navy)        |
| `--color-muted`         | `#5c7689`               | Secondary text (blue-grey)           |
| `--color-border`        | `#cfe3f0`               | Soft blue-tinted hairline / dividers |
| `--color-accent`        | `#1e9fe3`               | Primary accent (Aero azure)          |
| `--color-accent-strong` | `#1580bd`               | Accent hover / pressed               |
| `--color-positive`      | `#3aa657`               | Good / above target (nature green)   |
| `--color-negative`      | `#e5484d`               | Bad / below target (coral red)       |
| `--color-warning`       | `#f5a623`               | Caution / attention (warm amber)     |

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

> TODO: define the dashboard grid.

- Overall shell: header + main content (sidebar? TODO).
- Grid: responsive columns (e.g. 12-col desktop → stack on mobile). TODO confirm.
- Breakpoints: TODO (e.g. mobile < 640, tablet < 1024, desktop ≥ 1024).
- Chart sizing: responsive SVG that fits its grid cell.

---

## 3. Component inventory

> TODO: confirm and expand.

- App shell / layout
- Header / nav
- Auth: "Connect WHOOP" button, connected state
- Dashboard grid container
- Chart card (title, subtitle, the SVG chart, optional legend)
- Chart components:
  - StackedBarChart
  - ComboChart (×2 — bar + line)
  - DotMatrixChart (×3)
- Questionnaire form + fields
- Loading / empty / error states
- Tooltip (shared across charts)

---

## 4. Chart → WHOOP-metric mappings

> **TODO: confirm all mappings.** Six charts total. The "Suggested" column is
> copied from `ROADMAP.md` Phase 4 — these are **suggestions, not locked**.
> Fill the **Confirmed** column with the metric(s), time window, and aggregation
> you actually want, then build.

| #   | Chart type        | Suggested mapping (ROADMAP, to confirm)                                                           | Confirmed |
| --- | ----------------- | ------------------------------------------------------------------------------------------------- | --------- |
| 1   | Stacked bar       | Sleep stages per night (Awake / Light / Deep / REM → total sleep), or strain contributors per day | **TODO**  |
| 2   | Combo (line+area) | Recovery % (line) over Day Strain (area) — readiness vs. load                                     | **TODO**  |
| 3   | Combo (line+area) | HRV (line) over a rolling baseline band (area), or RHR line over sleep-debt area                  | **TODO**  |
| 4   | Dot-matrix        | Recovery calendar — one dot/day, color = recovery zone (red/yellow/green)                         | **TODO**  |
| 5   | Dot-matrix        | Sleep performance — dot size/color = % of sleep need met                                          | **TODO**  |
| 6   | Dot-matrix        | Strain matrix, or questionnaire-vs-recovery correlation (once Phase 5 exists)                     | **TODO**  |

Candidate WHOOP v2 metrics to draw from: recovery %, HRV, resting heart rate,
day strain, sleep performance, sleep duration/stages, respiratory rate — plus
questionnaire self-reports. Confirm exact mapping (and time window) per chart.

---

## 5. Interaction & accessibility

> TODO.

- Tooltips on hover/focus.
- Keyboard navigation for interactive charts.
- `aria-label` / `<title>` on SVGs; sufficient color contrast.
- Respect `prefers-reduced-motion` for D3 transitions.
