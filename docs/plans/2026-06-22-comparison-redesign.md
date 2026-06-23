# Comparison Page Redesign

**Date**: 2026-06-22
**Status**: Designing

## Overview

Redesign the ComparisonPage to support account-level and strategy-level comparisons with normalized equity curves, synchronized crosshair hover stats, and a head-to-head metrics table.

## Design Decisions

### Level Selection
- Two modes: **Account** (compare whole series) and **Strategy** (compare individual strategies)
- User picks level via a radio toggle in the top bar
- Strategy-level uses a two-column board UI: available strategies grouped by series on the left, selected entities on the right

### Normalization
- **Default**: Normalized to a common base balance ($100,000) so equity curves are comparable regardless of actual account size
- Keep the Absolute/Indexed toggle, but default to normalized
- Normalized value = `(indexed_return + 1) * NORMALIZED_BASE`

### Entity Selection
- **Account level**: Multi-series picker (existing `<SeriesPicker mode="multi">`)
- **Strategy level**: Two-column board with click-to-add/remove from (series, strategy_name_key) pairs
- Minimum 2 entities required for comparison
- Entities are colored by predefined palette, consistent across chart and table

### Hover Stats Panel
- **Period-to-date metrics**: Computed from curve start to hovered date
- Updates dynamically as cursor moves along the x-axis
- Shows per-entity values plus delta when exactly 2 entities are compared
- Initial metrics: Equity at date, Net PnL, Max Drawdown, Win Rate

### Head-to-Head Table
- Columns are the compared entities (with colored dots matching chart)
- Rows are full-period metrics (same 21 metrics as current account table)
- Delta column appears for 2-way comparisons
- Best value per row gets subtle highlighting
- Horizontally scrollable on narrow screens

## Layout

```
┌─ Top Bar ──────────────────────────────────────────────────────────┐
│ [Account] [Strategy] | Entity Picker | Date Range | [Compare]      │
└────────────────────────────────────────────────────────────────────┘
┌─ Chart Panel (~50%) ───────────────────────────────────────────────┐
│ Normalization Toggle: [Abs] [Indexed]                              │
│ ┌─ Recharts LineChart ───────────────────────────────────────────┐ │
│ │ Overlaid equity curves per entity, colored by palette          │ │
│ │ Vertical crosshair at hover-date across all lines              │ │
│ │ Legend identifying each line                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌─ Hover Stats Panel ────────────────────────────────────────────┐ │
│ │ Period-to-date metrics at hovered date, per-entity + delta     │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
┌─ Head-to-Head Table (~50%) ───────────────────────────────────────┐
│ Columns: Entity A | Entity B | Entity C | Δ (for 2-way)          │
│ Rows: 21 full-period metrics                                      │
│ Best value per row highlighted                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Backend Changes

### Schema (`backend/app/schemas/comparison.py`)
- Add `level: Literal["account", "strategy"]` to `ComparisonIn`
- Add `strategy_keys: list[StrategyKey] | None` where `StrategyKey = { series_id: int, name_key: str }`
- Change `baseline_series_id` to `baseline_entity_index: int` (0-based index into selected entities)

### Service (`backend/app/services/comparison.py`)
- Account level: Existing path unchanged
- Strategy level: For each `(series_id, name_key)` pair, filter fills to that strategy, compute equity curve and full metrics scoped to that strategy
- Return entity-keyed results (not series-keyed)

### Equity Curve Normalization
- Backend already returns `indexed_return` per point via `indexed_curve()`
- Frontend does the normalization transform: `(indexed_return + 1) * 100_000`
- No backend changes needed for normalization itself

## Frontend Changes

### Types (`frontend/src/lib/types.ts`)
- Add `ComparisonLevel = "account" | "strategy"`
- Add `StrategyKey { series_id: number; name_key: string }` and `SelectedEntity`
- Update `ComparisonRequest`: add `level`, `strategy_keys`
- Update `ComparisonResponse`: entity-keyed structures

### Components (new)
- `EntityPicker.tsx` — Multi-series picker (account mode) or two-column board (strategy mode)
- `HoverStatsPanel.tsx` — Dynamic period-to-date metrics at hovered date
- `ComparisonTable.tsx` — Head-to-head full-period comparison table
- `NormalizationToggle.tsx` — Absolute/Indexed toggle (reuse or extend existing)

### Page (`frontend/src/pages/ComparisonPage.tsx`)
- Full rewrite to new layout
- URL-driven state via `useSearchParams`
- Two-panel layout: chart on top, table below

## Metrics List for Head-to-Head Table

Same 21 metrics as current:
1. Net PnL
2. Gross PnL
3. Total Fees
4. Max Drawdown
5. TWR
6. CAGR
7. Volatility
8. Sharpe
9. Sortino
10. Calmar
11. Win Rate
12. Profit Factor
13. Payoff Ratio
14. Expectancy
15. Avg Win
16. Avg Loss
17. Largest Win
18. Largest Loss
19. Trades
20. Avg Holding

## Data Flow

```
User selects level + entities → ComparisonRequest sent to POST /comparisons
  → Backend computes metrics per entity (account or strategy scoped)
  → Returns entity-keyed account block + equity curves per entity
Frontend renders:
  → Chart: Normalized equity curves from indexed_returns
  → Hover panel: Period-to-date stats computed client-side from curve data
  → Table: Full-period metrics from account block
```
