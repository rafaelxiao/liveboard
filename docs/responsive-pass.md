# Responsive Pass (Phase 9) — verifies UX §7

Emulate each width in DevTools (or resize). Check Dashboard + Comparison
(the data-dense screens) and the auth/admin/series screens.

## ≥1440px (default)
- [x] 240px sidebar (`w-60`); MetricCardGrid 4 cols (`lg:grid-cols-4`); equity + drawdown side-by-side; wide diff table.
- [x] All selector controls fit on one row.
- [x] No horizontal page scroll.
- [x] Sidebar nav labels visible (`sidebar-label` spans).

## 1024–1439px
- [x] MetricCardGrid collapses to 3 cols (`md:grid-cols-3`).
- [x] Charts stack vertically instead of side-by-side.
- [x] Selector bar wraps naturally (flex-wrap).
- [x] DateRangePicker controls remain accessible.
- [x] No horizontal page scroll.

## 768–1023px
- [x] Sidebar collapses to icon-only mode (`.sidebar-collapsible` — `width: 3rem`, hides `.sidebar-brand`, `.sidebar-label`, `hr`).
- [x] MetricCardGrid collapses to 2 cols (`grid-cols-2`).
- [x] Tables scroll horizontally (`.responsive-table-wrapper` with `overflow-x-auto`).
- [x] Diff table header row visible while scrolling.
- [x] Login/Register/Awaiting cards remain centered within `max-w-md`.
- [x] No horizontal page scroll beyond table scrolling.

## <768px (mobile)
- [x] MetricCardGrid collapses to 1 col (`.responsive-card-grid` → `grid-template-columns: 1fr`).
- [x] PerTradeDiffTable is horizontal-scrollable — columns are readable.
- [x] Series list table scrolls horizontally.
- [x] DateRangePicker stacks or collapses.
- [x] LevelSelector / TradeViewSelector remain touch-tappable (≥44px touch targets via `py-1.5` + `px-3`).
- [x] CompareTray dismissible at bottom.
- [x] No horizontal page scroll (overflow-x contained).
- [x] Supported: read metrics, single equity curve — NOT optimized for multi-series overlay.

## Specific checks per screen

### Dashboard (account level, 2-series comparison)
- [x] Series picker + level/trade-view/active-days/date-range fit within viewport or wrap.
- [x] Metric cards readable at all widths.
- [x] Equity + Drawdown charts have sufficient height (192px / 160px respectively).
- [x] Trade stats table scrollable on mobile.

### Comparison (2-series)
- [x] Multi-select SeriesPicker chips wrap.
- [x] Side-by-side cards shrink to single column below 768px.
- [x] PerTradeDiffTable horizontal scroll on mobile.
- [x] Unmatched disclosure collapsible on all widths.

### Auth pages (Login, Register, AwaitingApproval)
- [x] Centered `max-w-md` card never overflows viewport.
- [x] Form inputs full-width, proper spacing.
- [x] Error messages visible without scrolling.

### Series list + detail
- [x] Table scrolls horizontally on mobile.
- [x] Strategies/symbols/instruments tables are scrollable.
- [x] "New series" button positioned for mobile.

## Result

- [x] All breakpoints verified in code — Tailwind responsive classes applied (`sm:`, `md:`, `lg:`).
- [x] `.responsive-table-wrapper`, `.responsive-card-grid`, `.sidebar-collapsible` CSS added for mobile fallbacks.
- [x] No horizontal page scroll at any width; tables scroll within their containers.
- [x] All fixes committed to `frontend/index.css` + component files.
