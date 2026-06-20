# Design Spec

> **Living document — starter skeleton.** Fill in the placeholders as design
> decisions get made. Sections marked **TODO** need your input before building.

---

## 1. Design tokens

### Colors

> TODO: confirm palette. Placeholders below — replace with real values.

| Token              | Value (placeholder) | Usage                      |
| ------------------ | ------------------- | -------------------------- |
| `--color-bg`       | `#0b0b0f`           | App background             |
| `--color-surface`  | `#16161d`           | Cards / panels             |
| `--color-text`     | `#e8e8ea`           | Primary text               |
| `--color-muted`    | `#9a9aa6`           | Secondary text             |
| `--color-accent`   | `#3bd6c6`           | Primary accent / WHOOP-ish |
| `--color-strain`   | TODO                | Strain metric series       |
| `--color-recovery` | TODO                | Recovery metric series     |
| `--color-sleep`    | TODO                | Sleep metric series        |
| `--color-positive` | `#4ade80`           | Good / above target        |
| `--color-negative` | `#f87171`           | Bad / below target         |

### Typography

> TODO: confirm typefaces and scale.

| Token         | Value (placeholder)            |
| ------------- | ------------------------------ |
| `--font-sans` | system-ui, sans-serif          |
| `--font-mono` | ui-monospace, monospace        |
| Scale         | 12 / 14 / 16 / 20 / 24 / 32 px |
| Weights       | 400 / 500 / 700                |

### Spacing & radius

> TODO: confirm scale.

| Token         | Value                        |
| ------------- | ---------------------------- |
| Spacing scale | 4 / 8 / 12 / 16 / 24 / 32 px |
| Radius        | 8 / 12 px                    |

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
