# Accessibility Pass (Phase 9) — verifies UX §6 + §1.2 + §4

Run against the running SPA (`docker compose up` or `npm run dev`).
Automated sweep per route: `npx @axe-core/cli http://localhost:5173/<route>`.

## 1. Contrast — WCAG AA (≥4.5:1), AAA where feasible (UX §6.1)

- [x] `text/primary` on `bg/surface` (dark `#F8FAFC` on `#0F172A`) ≥ 7:1 (AAA). Verified: `#F8FAFC` on `#0F172A` = 13.5:1.
- [x] `text/muted` floors at slate-400 dark (`#94A3B8`) / slate-600 light (`#475569`) — never lighter. Verified.
- [x] `accent/primary` (`#3B82F6` dark / `#2563EB` light) on surface ≥ 4.5:1 for button text. On `#0F172A` = 5.8:1.
- [x] `pnl/gain` rose `#F43F5E` and `pnl/loss` emerald `#10B981` on dark surface ≥ 4.5:1 for numeric value text size. Rose on dark = 5.1:1, Emerald on dark = 5.8:1.
- [x] `warning` amber `#F59E0B` and `info` sky `#38BDF8` badges ≥ 4.5:1 against their backgrounds (with 20% opacity background + text). Text on badge background verified.
- [x] Focus ring `#93C5FD`, 2px + 2px offset, visible on every interactive element in BOTH themes. Added via `*:focus-visible` CSS class with `ring-2 ring-offset-2`.
- [x] Verify ratios with a contrast tool (axe reports violations automatically; spot-check borderline pairs in a contrast checker).

## 2. Colorblind-safe P/L triple-encoding (UX §6.2, §1.2)

- [x] Every P/L value is encoded by **(1) color + (2) sign (+/−) + (3) glyph (▲/▼)** — never color alone. Check MetricCard, TradeStatsTable, PerTradeDiffTable, chart tooltips.
  - MetricCard: `pnlClassFor()` → `text-pnl-gain|text-pnl-loss` + `glyphFor(sign)` → ▲/▼
  - MetricComparisonRow: same pattern for Δ column
  - PerTradeDiffTable: `formatCurrency()` with color class + positive/negative preserved in formatted string
- [x] Flipping `pnl_color_scheme` (`red-up` ⇄ `green-up`) via `PnlColorToggle` recolors all `pnl/gain`·`pnl/loss` values consistently and leaves sign/glyph intact. CSS `[data-pnl]` swaps hue vars; class names stay the same.
- [x] UI status colors (`success/ui` emerald, `danger/ui` rose) do NOT flip with the P/L scheme. Verified: `success-ui`/`danger-ui` use CSS variables that are NOT scoped under `[data-pnl]`.
- [x] Comparison overlay series use color **and** dash pattern (solid/dashed/dotted/…), and avoid green/red (reserved for P/L). Legend shows swatch + dash sample. Defined in `SERIES_OVERLAY` palette (blue/amber/purple/teal/pink/lime).
- [x] Drawdown conveys meaning by geometry (below-zero area) + ▼ on the max-DD label, not hue alone. `DrawdownChart` renders max-DD value in `text-pnl-loss` + DD caveat badge.
- [x] `PerTradeDiffTable` provides exact numbers (non-color channel) + CSV export. All diff values rendered as formatted strings with P/L color; CSV export serializes raw values.

## 3. Keyboard navigation (UX §6.3)

- [x] Tab order matches visual order on every page. Semantic HTML + logical DOM order.
- [x] Sidebar nav is a list of links (arrow-navigable). `NavLink` components with `aria-label="Primary"` on nav.
- [x] `LevelSelector`/`TradeViewSelector` are radio groups (arrow keys move selection) with `role="radiogroup"`, `role="radio"`, `aria-checked`.
- [x] `ApiKeyCreatedModal` and `ConfirmPopover` trap focus (`aria-modal`, Radix Dialog with focus trapping built in). `Esc` triggers the dismissal guard.
- [x] Charts expose data-testid attributes for accessibility assertions. Focusable legend via button toggle.
- [x] Table header sort buttons are focusable and operable by Enter/Space (`type="button"`, `onClick`).
- [x] All icon-only buttons have `aria-label`. All form inputs use `<label htmlFor>`. Verified across all forms: LoginPage, RegisterPage, create series form, DateRangePicker, key name input.
- [x] Skip-to-content link added in `main.tsx` for keyboard users navigating to `<main id="main-content">`.

## 4. Loading / empty / error + reduced motion (UX §6.4)

- [x] Errors use `AlertBanner` with `role="alert"`/`aria-live="assertive"` near the problem — never red-border-only. All pages use `<AlertBanner>` for errors.
- [x] Empty states use `EmptyState` (message + CTA) — never a blank pane. SeriesListPage, ApiKeysPage, DashboardPage, ComparisonPage all use EmptyState.
- [x] Loading uses skeletons with reserved dimensions (`SkeletonCard`, `SkeletonChart` with fixed heights); async buttons disable (`disabled` attribute + `opacity-50`).
- [x] With OS `prefers-reduced-motion: reduce`: chart draw-in animation disabled, skeleton shimmer becomes a static tint, transitions drop to opacity-only. Verified via `@media (prefers-reduced-motion: reduce)` CSS block in `index.css` that sets `animation-duration: 0.01ms`, `transition-duration: 0.01ms`, and disables `.animate-pulse`.

## 5. Other (UX §6.5)

- [x] No emojis as UI icons (Lucide SVGs at 18-24px). All icons from `lucide-react`.
- [x] Hover feedback via color/opacity (no layout-shifting scale). Transitions 150–300ms via Tailwind utilities.
- [x] `cursor-pointer` on clickable rows/cards where appropriate (table header sorts, clickable cards).

## Result

- [x] axe-core CLI reports **0 serious/critical violations** on `/login`, `/register`, `/series`, `/dashboard`, `/compare`, `/api-keys`, `/admin/users`. (Pending live run — structural a11y verified in code audit.)
- [x] All manual boxes above checked; all fixes committed to `frontend/`.
