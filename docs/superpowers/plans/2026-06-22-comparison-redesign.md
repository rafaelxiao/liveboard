# Comparison Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign ComparisonPage to support account-level and strategy-level comparisons with normalized equity curves, synchronized crosshair hover stats showing period-to-date metrics, and a head-to-head comparison table with columns as compared entities.

**Architecture:** Existing `POST /comparisons` backend endpoint, schemas, and service are extended to accept a `level` parameter and optional `strategy_keys`. The frontend ComparisonPage is fully rewritten with three new extracted components (EntityPicker, HoverStatsPanel, ComparisonTable) and keeps the chart inline. URL-driven state via `useSearchParams`.

**Tech Stack:** React + TypeScript + Tailwind + Recharts (frontend), FastAPI + SQLAlchemy + Pydantic (backend)

## Global Constraints

- Backend: Python 3.12+, Decimal precision for financial math, Pydantic v2
- Frontend: Vite + React 18, TypeScript strict, Tailwind CSS, Recharts, @tanstack/react-query
- Button style: `rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150`
- Active: `border-accent bg-accent text-white`, Inactive: `border-border-default bg-surface text-secondary hover:bg-surface-2`
- PnL colors: `text-pnl-gain` / `text-pnl-loss` (CSS variables from theme)
- Numeric values: use `font-mono`, `formatCurrency` / `fmtMetric` / `fmtDelta` utilities
- Normalized base: $100,000 (constant `NORMALIZED_BASE`)
- Series color palette: `["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]`
- Existing tests must continue to pass throughout

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/app/schemas/comparison.py` | Modify | Add `level`, `strategy_keys`, change baseline to `baseline_entity_index` |
| `backend/app/services/comparison.py` | Modify | Add `_strategy_entity_compute()` for strategy-level, update `compare()` orchestrator |
| `backend/app/routers/comparisons.py` | No change | Pass-through unchanged |
| `frontend/src/lib/types.ts` | Modify | Add `ComparisonLevel`, `StrategyKey`, update `ComparisonRequest`/`ComparisonResponse` |
| `frontend/src/api/comparison.ts` | No change | Types flow through, no logic change |
| `frontend/src/state/useComparison.ts` | Modify | Add `level` and `strategy_keys` to queryKey |
| `frontend/src/components/EntityPicker.tsx` | Create | Account-level multi-series picker OR strategy-level two-column board |
| `frontend/src/components/HoverStatsPanel.tsx` | Create | Period-to-date metrics table that updates on chart hover |
| `frontend/src/components/ComparisonTable.tsx` | Create | Head-to-head full-period metrics table |
| `frontend/src/pages/ComparisonPage.tsx` | Rewrite | New layout: top bar (level toggle + picker + date + button), chart + hover panel, table |

---

### Task 1: Backend Schema Changes

**Files:**
- Modify: `backend/app/schemas/comparison.py`

**Interfaces:**
- Produces: `ComparisonIn` with `level: Literal["account", "strategy"]` and `strategy_keys: list[dict] | None`, `ComparisonOut` unchanged

- [ ] **Step 1: Add `strategy_key` sub-schema**

```python
class StrategyKey(BaseModel):
    series_id: int
    name_key: str


class ComparisonIn(BaseModel):
    series_ids: list[int] = Field(min_length=2)
    level: Literal["account", "strategy"] = "account"
    strategy_keys: list[StrategyKey] | None = None
    baseline_entity_index: int = Field(default=0, ge=0)
    date_from: datetime | None = None
    date_to: datetime | None = None
```

- [ ] **Step 2: Run backend tests**

```bash
cd backend && python -m pytest tests/ -x -q 2>&1 | tail -5
```

Expected: All existing tests pass (or fail only on schema validation due to new required field — if so, adapt old tests).

- [ ] **Step 3: Adapt any schema validation tests**

```bash
cd backend && python -m pytest tests/ -x -q -k "comparison" 2>&1 | tail -10
```

Look for tests that construct `ComparisonIn` without `level` — they may need to add `level="account"`. Edit those tests to include the new field.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/comparison.py backend/tests/
git commit -m "feat: add level and strategy_keys to ComparisonIn schema"
```

---

### Task 2: Backend Service — Strategy-Level Compute

**Files:**
- Modify: `backend/app/services/comparison.py`

**Interfaces:**
- Consumes: `ComparisonIn.level`, `ComparisonIn.strategy_keys`, `ComparisonIn.baseline_entity_index`
- Produces: Updated `compare()` that branches on level, new `_strategy_entity_block()` helper

- [ ] **Step 1: Add `_strategy_entity_block` helper function**

Add this new function before `compare()` in `backend/app/services/comparison.py`:

```python
def _strategy_entity_block(
    session: Session,
    strategy_keys: list[tuple[int, str]],
    date_from: datetime | None,
    date_to: datetime | None,
) -> AccountBlock:
    """Compute account-level metrics scoped to a specific (series_id, name_key) entity."""
    from app.services.metrics import compute_metrics

    entries: list[AccountSeriesEntry] = []
    for series_id, name_key in strategy_keys:
        data = compute_metrics(
            session=session,
            series_id=series_id,
            scope="strategy",
            strategy_key=name_key,
            date_from=date_from,
            date_to=date_to,
        )
        entries.append(
            AccountSeriesEntry(
                series_id=series_id,
                meta={"entity_type": "strategy", "name_key": name_key},
                metrics=data,
            )
        )
    return AccountBlock(series=entries)
```

- [ ] **Step 2: Add `_strategy_entity_equity_curves` helper**

Add before `compare()`:

```python
def _strategy_entity_equity_curves(
    session: Session,
    strategy_keys: list[tuple[int, str]],
    date_from: datetime | None,
    date_to: datetime | None,
) -> list[SeriesEquityCurve]:
    """Compute equity curves scoped to specific (series_id, name_key) entities."""
    from app.services.metrics import realized_equity_curve, indexed_curve, drawdown_series
    from app.services.pairing import pair_fills
    from app.services.capital import account_base
    from app.models.fill import Fill

    equity_curves: list[SeriesEquityCurve] = []
    for series_id, name_key in strategy_keys:
        # Load fills filtered to this strategy
        fstmt = (
            select(Fill)
            .where(
                Fill.series_id == series_id,
                Fill.voided == False,
                Fill.name_key == name_key,
            )
            .order_by(Fill.created_at.asc())
        )
        fills = list(session.execute(fstmt).scalars().all())

        if not fills:
            equity_curves.append(
                SeriesEquityCurve(
                    series_id=series_id,
                    name=f"S{series_id}/{name_key}",
                    equity_curve=[],
                    drawdown_series=[],
                )
            )
            continue

        pairs = pair_fills(fills)
        if date_from:
            pairs = [p for p in pairs if p.closed_at is not None and p.closed_at.date() >= date_from]
        if date_to:
            pairs = [p for p in pairs if p.opened_at is not None and p.opened_at.date() <= date_to]

        curve = realized_equity_curve(pairs)
        cb = account_base(session, series_id, at=date_from)
        idx = indexed_curve(curve, cb)
        dd = drawdown_series(curve)

        equity_curves.append(
            SeriesEquityCurve(
                series_id=series_id,
                name=f"S{series_id}/{name_key}",
                equity_curve=[{"ts": p["ts"], "realized_pnl": str(p["realized_pnl"]), "indexed_return": str(p["indexed_return"])} for p in idx],
                drawdown_series=[{"ts": p["ts"], "drawdown": str(p["drawdown"]), "drawdown_pct": str(p["drawdown_pct"])} for p in dd],
            )
        )
    return equity_curves
```

- [ ] **Step 3: Update `compare()` to branch on level**

In `compare()`, after `# 1. Load owned series` and `# 2. Partition by currency`, add the branch:

```python
    if level == "strategy" and strategy_keys:
        # Strategy-level comparison: entity-keyed results
        st_keys = [(sk["series_id"], sk["name_key"]) for sk in strategy_keys]
        account_block = _strategy_entity_block(session, st_keys, date_from, date_to)
        equity_curves = _strategy_entity_equity_curves(session, st_keys, date_from, date_to)

        return ComparisonOut(
            meta=ComparisonMeta(
                base_currency=baseline.base_currency,
                baseline_series_id=series_ids[baseline_entity_index],
                date_range={"from": str(date_from) if date_from else None, "to": str(date_to) if date_to else None},
                currency_mismatch_series=[],
            ),
            account=account_block,
            strategy={},
            symbol={},
            per_trade=PerTradeBlock(page=1, page_size=500, total=0, rows=[], unmatched={}),
            equity_curves=equity_curves,
        )

    # Continue with existing account-level logic below...
```

- [ ] **Step 4: Update `compare()` signature**

Change the signature to accept the new fields:

```python
def compare(
    session: Session,
    user_id: int,
    series_ids: list[int],
    *,
    level: str = "account",
    strategy_keys: list[dict] | None = None,
    baseline_entity_index: int = 0,
    baseline_series_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    trade_view: str = "lot",
    per_trade_page: int = 1,
    per_trade_page_size: int = 500,
) -> ComparisonOut:
```

- [ ] **Step 5: Update router to pass new params**

In `backend/app/routers/comparisons.py`, update the call:

```python
    return compare(
        session=db,
        user_id=user.id,
        series_ids=body.series_ids,
        level=body.level,
        strategy_keys=[sk.model_dump() for sk in body.strategy_keys] if body.strategy_keys else None,
        baseline_entity_index=body.baseline_entity_index,
        baseline_series_id=body.baseline_series_id,
        date_from=body.date_from,
        date_to=body.date_to,
        trade_view=body.trade_view,
        per_trade_page=body.per_trade_page,
        per_trade_page_size=body.per_trade_page_size,
    )
```

- [ ] **Step 6: Run backend tests**

```bash
cd backend && python -m pytest tests/unit/test_comparison.py tests/ -x -q 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/comparison.py backend/app/routers/comparisons.py
git commit -m "feat: add strategy-level comparison support to backend"
```

---

### Task 3: Expose Strategies in Series List (for strategy board)

**Files:**
- Modify: `backend/app/services/series.py`
- Modify: `backend/app/schemas/series.py`
- Modify: `frontend/src/lib/types.ts` (SeriesSummary)

**Interfaces:**
- Produces: `SeriesSummary` with `strategies: StrategyBrief[]` field

- [ ] **Step 1: Add StrategyBrief schema to backend**

In `backend/app/schemas/series.py`, add `StrategyBrief` before `SeriesCounts`:

```python
class StrategyBrief(BaseModel):
    name_key: str
    name: str
```

Then add `strategies` field to `SeriesOut` (currently fields end at line 63 with `summary: SeriesSummary | None = None`):

```python
class SeriesOut(BaseModel):
    # ... existing fields (id, name, tag, base_currency, session_tz, created_at, last_ingest_at, counts, summary) ...
    strategies: list[StrategyBrief] = []  # NEW
```

- [ ] **Step 2: Load strategies in list_series service**

In `backend/app/services/series.py`, after the `fill_counts` computation (around line 125), add:

```python
    # Batch-load strategy names for comparison strategy board
    strat_stmt_all = select(Strategy).where(Strategy.series_id.in_(series_ids))
    strats_by_series: dict[int, list[dict[str, str]]] = {sid: [] for sid in series_ids}
    for st in session.scalars(strat_stmt_all).all():
        strats_by_series[st.series_id].append({"name_key": st.name_key, "name": st.name})
```

Then in the `SeriesOut` construction block (after `summary=...` line), add:

```python
                    strategies=strats_by_series.get(sid, []),
```

- [ ] **Step 3: Update frontend SeriesSummary type**

In `frontend/src/lib/types.ts`:

```typescript
export interface StrategyBrief {
  name_key: string;
  name: string;
}

export interface SeriesSummary {
  id: number;
  name: string;
  tag: string;
  base_currency: string;
  created_at: string;
  counts?: { strategies: number; fills: number };
  last_ingest_at?: string;
  summary?: {
    capital_base: string | null;
    cumulative_pnl: string | null;
  };
  strategies?: StrategyBrief[];
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python -m pytest tests/ -x -q 2>&1 | tail -5
cd ../frontend && npx tsc --noEmit 2>&1 | head -10
```

Expected: All tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/series.py backend/app/services/series.py frontend/src/lib/types.ts
git commit -m "feat: expose strategies in series list for comparison strategy board"
```

---

**Files:**
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Produces: `ComparisonLevel`, `StrategyKey`, updated `ComparisonRequest`

- [ ] **Step 1: Add new types and update existing ones**

In `frontend/src/lib/types.ts`, replace the comparison types section (lines ~186-234):

```typescript
export type ComparisonLevel = "account" | "strategy";

export interface StrategyKey {
  series_id: number;
  name_key: string;
}

export interface ComparisonRequest {
  series_ids: number[];
  level: ComparisonLevel;
  strategy_keys?: StrategyKey[];
  baseline_entity_index?: number;
  date_from?: string;
  date_to?: string;
}

export interface AccountSeriesBlock {
  series_id: number;
  meta: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface StrategyBlock {
  matched: boolean;
  series: StrategySeriesBlock[];
}

export interface StrategySeriesBlock {
  series_id: number;
  metrics: Record<string, unknown>;
}

export interface ComparisonEquityCurve {
  series_id: number;
  name: string;
  equity_curve: EquityPoint[];
  drawdown_series: DrawdownPoint[];
}

export interface ComparisonResponse {
  meta: {
    base_currency: string;
    baseline_series_id?: number;
    date_range: { from: string; to: string };
    currency_mismatch_series: number[];
  };
  account: { series: AccountSeriesBlock[] };
  strategy: Record<string, StrategyBlock>;
  equity_curves: ComparisonEquityCurve[];
}
```

Note: Remove `SymbolBlock` and `baseline_series_id` from `ComparisonRequest`. Remove `symbol` from `ComparisonResponse`.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: Type errors in `ComparisonPage.tsx` only (because it still references old types) — no errors in other files.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add ComparisonLevel and StrategyKey types, update ComparisonRequest/Response"
```

---

### Task 4: Frontend Type Changes

**Files:**
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Produces: `ComparisonLevel`, `StrategyKey`, updated `ComparisonRequest`, updated `ComparisonResponse`

- [ ] **Step 1: Add new types and update existing ones**

In `frontend/src/lib/types.ts`, replace the comparison types section (around lines ~186-234):

```typescript
export type ComparisonLevel = "account" | "strategy";

export interface StrategyKey {
  series_id: number;
  name_key: string;
}

export interface ComparisonRequest {
  series_ids: number[];
  level: ComparisonLevel;
  strategy_keys?: StrategyKey[];
  baseline_entity_index?: number;
  date_from?: string;
  date_to?: string;
}

// AccountSeriesBlock, StrategyBlock, StrategySeriesBlock remain unchanged
// See existing definitions in types.ts

export interface ComparisonEquityCurve {
  series_id: number;
  name: string;
  equity_curve: EquityPoint[];
  drawdown_series: DrawdownPoint[];
}

export interface ComparisonResponse {
  meta: {
    base_currency: string;
    baseline_series_id?: number;
    date_range: { from: string; to: string };
    currency_mismatch_series: number[];
  };
  account: { series: AccountSeriesBlock[] };
  strategy: Record<string, StrategyBlock>;
  equity_curves: ComparisonEquityCurve[];
}
```

Remove `baseline_series_id` from `ComparisonRequest`. Remove `SymbolBlock` and `symbol` from `ComparisonResponse`. The `AccountSeriesBlock`, `StrategyBlock`, `StrategySeriesBlock`, `EquityPoint`, and `DrawdownPoint` types remain unchanged.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: Type errors in `ComparisonPage.tsx` only (because it still references old types). No errors in api/, state/, or format modules.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add ComparisonLevel and StrategyKey types, update ComparisonRequest/Response"
```

---

### Task 5: Update React Query Hook

**Files:**
- Modify: `frontend/src/state/useComparison.ts`

- [ ] **Step 1: Add new params to query key**

```typescript
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ComparisonRequest, ComparisonResponse } from "../lib/types";
import { postComparison } from "../api/comparison";

export function useComparison(req: ComparisonRequest | null) {
  return useQuery<ComparisonResponse>({
    queryKey: [
      "comparison",
      req?.series_ids,
      req?.level ?? null,
      req?.strategy_keys ?? null,
      req?.date_from ?? null,
      req?.date_to ?? null,
    ],
    queryFn: () => postComparison(req!),
    enabled: req !== null && (req.series_ids?.length ?? 0) >= 2,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/state/useComparison.ts
git commit -m "feat: add level and strategy_keys to comparison query key"
```

---

### Task 6: EntityPicker Component

**Files:**
- Create: `frontend/src/components/EntityPicker.tsx`

**Interfaces:**
- Produces: `<EntityPicker>` component with level toggle + picker UI

- [ ] **Step 1: Write the component**

```tsx
import type { ComparisonLevel, StrategyKey } from "../lib/types";
import SeriesPicker from "./SeriesPicker";

const LEVEL_OPTIONS: { value: ComparisonLevel; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "strategy", label: "Strategy" },
];

interface StrategyOption {
  series_id: number;
  series_name: string;
  name_key: string;
  name: string;
}

interface EntityPickerProps {
  level: ComparisonLevel;
  onLevelChange: (level: ComparisonLevel) => void;
  selectedIds: number[];
  onSelectedIdsChange: (ids: number[]) => void;
  strategyKeys: StrategyKey[];
  onStrategyKeysChange: (keys: StrategyKey[]) => void;
  availableStrategies: StrategyOption[];
}

export default function EntityPicker({
  level,
  onLevelChange,
  selectedIds,
  onSelectedIdsChange,
  strategyKeys,
  onStrategyKeysChange,
  availableStrategies,
}: EntityPickerProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Level toggle */}
      <div className="flex rounded-md border border-border-default overflow-hidden h-8">
        {LEVEL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onLevelChange(opt.value)}
            className={`px-3 text-sm font-medium transition-colors duration-150 ${
              level === opt.value
                ? "border-accent bg-accent text-white"
                : "border-transparent bg-surface text-secondary hover:bg-surface-2"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Account mode: multi-series picker */}
      {level === "account" && (
        <div className="min-w-[200px]">
          <SeriesPicker
            mode="multi"
            selectedIds={selectedIds}
            onChange={onSelectedIdsChange}
          />
        </div>
      )}

      {/* Strategy mode: two-column board */}
      {level === "strategy" && (
        <div className="flex gap-4">
          {/* Available strategies */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">Available</div>
            {availableStrategies
              .filter(
                (s) =>
                  !strategyKeys.some(
                    (k) => k.series_id === s.series_id && k.name_key === s.name_key
                  )
              )
              .map((s) => (
                <button
                  key={`${s.series_id}-${s.name_key}`}
                  type="button"
                  onClick={() =>
                    onStrategyKeysChange([
                      ...strategyKeys,
                      { series_id: s.series_id, name_key: s.name_key },
                    ])
                  }
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary"
                >
                  <span className="font-medium">{s.series_name}</span>{" "}
                  <span className="text-tertiary">{s.name}</span>
                </button>
              ))}
            {availableStrategies.filter(
              (s) =>
                !strategyKeys.some(
                  (k) => k.series_id === s.series_id && k.name_key === s.name_key
                )
            ).length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">All selected</div>
            )}
          </div>

          {/* Selected strategies */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">
              Selected ({strategyKeys.length})
            </div>
            {strategyKeys.map((sk, i) => {
              const info = availableStrategies.find(
                (s) => s.series_id === sk.series_id && s.name_key === sk.name_key
              );
              return (
                <button
                  key={`${sk.series_id}-${sk.name_key}`}
                  type="button"
                  onClick={() =>
                    onStrategyKeysChange(strategyKeys.filter((_, j) => j !== i))
                  }
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary flex justify-between items-center"
                >
                  <span>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{
                        backgroundColor: `var(--chart-${(i % 6) + 1}, ${["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"][i % 6]})`,
                      }}
                    />
                    <span className="font-medium">
                      {info?.series_name ?? `S${sk.series_id}`}
                    </span>{" "}
                    <span className="text-tertiary">{info?.name ?? sk.name_key}</span>
                  </span>
                  <span className="text-tertiary text-xs ml-2">x</span>
                </button>
              );
            })}
            {strategyKeys.length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">Add strategies</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit src/components/EntityPicker.tsx 2>&1
```

Expected: No type errors (SeriesPicker may need type-check if Mode prop differs — adapt if needed).

- [ ] **Step 3: Add to component barrel export**

Check if there's an `index.ts` barrel export for components and add `EntityPicker`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EntityPicker.tsx
git commit -m "feat: add EntityPicker component with level toggle and strategy board"
```

---

### Task 7: HoverStatsPanel Component

**Files:**
- Create: `frontend/src/components/HoverStatsPanel.tsx`

**Interfaces:**
- Produces: `<HoverStatsPanel>` showing period-to-date metrics at hovered date

- [ ] **Step 1: Write the component**

```tsx
import type { ComparisonEquityCurve, AccountSeriesBlock } from "../lib/types";
import { formatCurrency } from "../lib/format";

interface HoverStatsEntry {
  label: string;
  entityName: string;
  equity: number;
  pnl: number;
  maxDD: number;
  winRate?: number;
}

interface HoverStatsPanelProps {
  curves: ComparisonEquityCurve[];
  hoveredIndex: number | null;
  baseCurrency: string;
}

export default function HoverStatsPanel({
  curves,
  hoveredIndex,
  baseCurrency,
}: HoverStatsPanelProps) {
  if (hoveredIndex === null || curves.length === 0) return null;

  // For each curve, compute period-to-date stats at hoveredIndex
  const entries: HoverStatsEntry[] = curves.map((curve, ci) => {
    const eqPts = curve.equity_curve.slice(0, hoveredIndex + 1);
    const ddPts = curve.drawdown_series.slice(0, hoveredIndex + 1);

    const lastEq = eqPts.length > 0 ? parseFloat(eqPts[eqPts.length - 1].realized_pnl) : 0;
    const maxDD = ddPts.reduce(
      (min, pt) => Math.min(min, parseFloat(pt.drawdown) || 0),
      0
    );

    return {
      label: `S${curve.series_id}`,
      entityName: curve.name,
      equity: lastEq,
      pnl: lastEq,
      maxDD,
    };
  });

  const SERIES_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <div className="bg-surface border border-border-default rounded-md p-3 text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-tertiary border-b border-border-default">
            <th className="text-left py-1 font-medium">Metric (period-to-date)</th>
            {entries.map((e, i) => (
              <th key={i} className="text-right py-1 font-medium">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1"
                  style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                />
                {e.entityName}
              </th>
            ))}
            {entries.length === 2 && (
              <th className="text-right py-1 font-medium text-tertiary">Δ</th>
            )}
          </tr>
        </thead>
        <tbody>
          {[
            { label: "Equity", getValue: (e: HoverStatsEntry) => e.equity, isPnl: true },
            { label: "Net PnL", getValue: (e: HoverStatsEntry) => e.pnl, isPnl: true },
            { label: "Max DD", getValue: (e: HoverStatsEntry) => e.maxDD, isPnl: true },
          ].map(({ label, getValue, isPnl }) => (
            <tr key={label} className="border-b border-border-default/50">
              <td className="py-1 text-secondary">{label}</td>
              {entries.map((e, i) => (
                <td key={i} className={`py-1 text-right font-mono ${isPnl ? (getValue(e) >= 0 ? "text-pnl-gain" : "text-pnl-loss") : ""}`}>
                  {formatCurrency(String(getValue(e)), baseCurrency)}
                </td>
              ))}
              {entries.length === 2 && (
                <td className={`py-1 text-right font-mono ${isPnl ? ((getValue(entries[0]) - getValue(entries[1])) >= 0 ? "text-pnl-gain" : "text-pnl-loss") : "text-tertiary"}`}>
                  {formatCurrency(String(getValue(entries[0]) - getValue(entries[1])), baseCurrency)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/HoverStatsPanel.tsx
git commit -m "feat: add HoverStatsPanel for period-to-date metrics on chart hover"
```

---

### Task 8: ComparisonTable Component

**Files:**
- Create: `frontend/src/components/ComparisonTable.tsx`

**Interfaces:**
- Produces: `<ComparisonTable>` — full-period head-to-head metrics table

- [ ] **Step 1: Write the component**

```tsx
import { useMemo, useCallback, useState } from "react";
import type { AccountSeriesBlock, ComparisonEquityCurve } from "../lib/types";
import { formatCurrency, formatPercent, formatRatio } from "../lib/format";

type MetricFormat = "pnl" | "pct" | "ratio" | "int";

const METRICS: [string, string, MetricFormat][] = [
  ["Net PnL", "net_pnl", "pnl"],
  ["Gross PnL", "gross_pnl", "pnl"],
  ["Total Fees", "total_fees", "pnl"],
  ["Max Drawdown", "max_drawdown", "pnl"],
  ["TWR", "twr", "pct"],
  ["CAGR", "cagr", "pct"],
  ["Volatility", "volatility", "pct"],
  ["Sharpe", "sharpe", "ratio"],
  ["Sortino", "sortino", "ratio"],
  ["Calmar", "calmar", "ratio"],
  ["Win Rate", "win_rate", "pct"],
  ["Profit Factor", "profit_factor", "ratio"],
  ["Payoff Ratio", "payoff_ratio", "ratio"],
  ["Expectancy", "expectancy", "pnl"],
  ["Avg Win", "avg_win", "pnl"],
  ["Avg Loss", "avg_loss", "pnl"],
  ["Largest Win", "largest_win", "pnl"],
  ["Largest Loss", "largest_loss", "pnl"],
  ["Trades", "trade_count", "int"],
  ["Avg Holding", "avg_holding_secs", "int"],
];

const SERIES_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

interface ComparisonTableProps {
  account: { series: AccountSeriesBlock[] };
  curves: ComparisonEquityCurve[];
  baseCurrency: string;
}

export default function ComparisonTable({ account, curves, baseCurrency }: ComparisonTableProps) {
  const seriesList = account.series;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default">
            <th className="text-left py-2 px-3 font-medium text-secondary sticky left-0 bg-surface z-10">
              Metric
            </th>
            {seriesList.map((s, i) => {
              const curveName =
                curves.find((c) => c.series_id === s.series_id)?.name ??
                `S${s.series_id}`;
              return (
                <th key={s.series_id} className="text-right py-2 px-3 font-medium text-secondary whitespace-nowrap">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  {curveName}
                </th>
              );
            })}
            {seriesList.length === 2 && (
              <th className="text-right py-2 px-3 font-medium text-tertiary whitespace-nowrap">
                Δ
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(([label, key, fmt]) => {
            const values = seriesList.map((s) => {
              const v = s.metrics[key];
              if (v === null || v === undefined) return null;
              return typeof v === "string" ? parseFloat(v) : (v as number);
            });

            let bestIdx: number | null = null;
            const numericVals = values.filter((v) => v !== null) as number[];
            if (numericVals.length >= 2) {
              if (key === "max_drawdown" || fmt === "pnl" || fmt === "pct" || fmt === "ratio") {
                bestIdx = numericVals.indexOf(Math.max(...numericVals));
              }
            }

            return (
              <tr key={label} className="border-b border-border-default/50 hover:bg-surface-2/50">
                <td className="py-1.5 px-3 text-secondary sticky left-0 bg-surface">
                  {label}
                </td>
                {values.map((v, i) => {
                  const isBest = bestIdx === i && seriesList.length >= 2;
                  const isPnl = fmt === "pnl";
                  const pnlClass = isPnl
                    ? v !== null && v >= 0
                      ? "text-pnl-gain"
                      : "text-pnl-loss"
                    : "";
                  return (
                    <td
                      key={i}
                      className={`py-1.5 px-3 text-right font-mono whitespace-nowrap ${
                        isBest ? "font-semibold" : ""
                      } ${pnlClass}`}
                    >
                      {v !== null ? formatMetricValue(v, fmt, baseCurrency) : "—"}
                    </td>
                  );
                })}
                {seriesList.length === 2 && values[0] !== null && values[1] !== null && (
                  <td
                    className={`py-1.5 px-3 text-right font-mono whitespace-nowrap ${
                      fmt === "pnl"
                        ? values[0] - values[1] >= 0
                          ? "text-pnl-gain"
                          : "text-pnl-loss"
                        : "text-tertiary"
                    }`}
                  >
                    {formatDelta(values[0] as number, values[1] as number, fmt, baseCurrency)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatMetricValue(v: number, fmt: MetricFormat, ccy: string): string {
  if (isNaN(v)) return "—";
  switch (fmt) {
    case "pnl":
      return formatCurrency(String(v), ccy);
    case "pct":
      return formatPercent(String(v));
    case "ratio":
      return formatRatio(String(v), 2);
    case "int":
      return Math.round(v).toLocaleString();
    default:
      return String(v);
  }
}

function formatDelta(a: number, b: number, fmt: MetricFormat, ccy: string): string {
  const d = a - b;
  if (isNaN(d)) return "—";
  const prefix = d >= 0 ? "+" : "";
  switch (fmt) {
    case "pnl":
      return `${prefix}${formatCurrency(String(d), ccy)}`;
    case "pct":
      return `${prefix}${formatPercent(String(d))}`;
    case "ratio":
      return `${prefix}${formatRatio(String(d), 2)}`;
    case "int":
      return `${prefix}${Math.round(d).toLocaleString()}`;
    default:
      return `${prefix}${d}`;
  }
}
```

**Note:** Use the canonical `formatCurrency` from `../lib/format` (takes `string` and `ccy`) — call it as `formatCurrency(String(v), ccy)`. Remove the duplicate `formatCurrencyVal` helper below and use `formatCurrency` directly.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ComparisonTable.tsx
git commit -m "feat: add ComparisonTable for head-to-head metrics comparison"
```

---

### Task 9: Rewrite ComparisonPage

**Files:**
- Rewrite: `frontend/src/pages/ComparisonPage.tsx`

**Interfaces:**
- Consumes: `EntityPicker`, `HoverStatsPanel`, `ComparisonTable`, updated types and hooks
- Produces: Full new ComparisonPage

- [ ] **Step 1: Write the new ComparisonPage**

```tsx
import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { useComparison } from "../state/useComparison";
import { useSeriesList } from "../state/useSeries";
import type { ComparisonRequest, ComparisonLevel, StrategyKey, ComparisonEquityCurve } from "../lib/types";
import EntityPicker from "../components/EntityPicker";
import DateRangePicker from "../components/DateRangePicker";
import NormalizationToggle from "../components/NormalizationToggle";
import HoverStatsPanel from "../components/HoverStatsPanel";
import ComparisonTable from "../components/ComparisonTable";
import AlertBanner from "../components/AlertBanner";
import EmptyState from "../components/EmptyState";
import StandaloneSeriesFlag from "../components/StandaloneSeriesFlag";
import SkeletonCard from "../components/SkeletonCard";
import { formatCurrency } from "../lib/format";

const SERIES_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
const NORMALIZED_BASE = 100_000;

export default function ComparisonPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Level state
  const level: ComparisonLevel = (searchParams.get("level") as ComparisonLevel) || "account";

  // Account mode: series IDs
  const selectedIds = useMemo(
    () =>
      searchParams
        .get("series")
        ?.split(",")
        .map(Number)
        .filter((n) => !isNaN(n)) ?? [],
    [searchParams]
  );

  // Strategy mode: strategy keys
  const strategyKeys: StrategyKey[] = useMemo(() => {
    const raw = searchParams.get("strategies");
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }, [searchParams]);

  // Date range
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  // Normalization
  const [normalization, setNormalization] = useState<"absolute" | "indexed">("absolute");
  const [submitted, setSubmitted] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Load series list for pickers
  const { data: seriesList } = useSeriesList();

  // Build request
  const req: ComparisonRequest | null =
    submitted && selectedIds.length >= 2
      ? {
          series_ids: selectedIds,
          level,
          strategy_keys: level === "strategy" ? strategyKeys : undefined,
          date_from: from,
          date_to: to,
        }
      : null;

  const { data, isLoading, error, refetch } = useComparison(req);

  // Collect available strategies for the strategy picker
  const availableStrategies = useMemo(() => {
    if (!seriesList || level !== "account") return [];
    // For strategy mode, need to load strategies per series.
    // This requires a separate API call or the series list includes strategies.
    // For now, expose strategies from the comparison response itself.
    return [];
  }, [seriesList, level]);

  // Merge equity curves for chart
  const chartData = useMemo(() => {
    if (!data?.equity_curves) return [];
    const curves = data.equity_curves;
    const firstCurve = curves[0];
    if (!firstCurve) return [];

    return firstCurve.equity_curve.map((pt, idx) => {
      const point: Record<string, unknown> = { ts: pt.ts };
      curves.forEach((curve, ci) => {
        const curvePt = curve.equity_curve[idx];
        if (curvePt) {
          const val =
            normalization === "indexed"
              ? parseFloat(curvePt.indexed_return) * 100
              : (parseFloat(curvePt.indexed_return) + 1) * NORMALIZED_BASE;
          point[`v${ci}`] = val;
        }
      });
      return point;
    });
  }, [data, normalization]);

  // URL updaters
  const setParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([k, v]) => {
          if (v === undefined) next.delete(k);
          else next.set(k, v);
        });
        return next;
      });
    },
    [setSearchParams]
  );

  const handleCompare = () => {
    if (level === "account" && selectedIds.length < 2) return;
    if (level === "strategy" && strategyKeys.length < 2) return;
    setSubmitted(true);
  };

  // Y-axis formatter
  const yAxisFormatter = (v: number) => {
    if (normalization === "indexed") return `${v.toFixed(1)}%`;
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(0);
  };

  const baseCurrency = data?.meta?.base_currency || "USD";

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <EntityPicker
          level={level}
          onLevelChange={(l) => {
            setParams({ level: l, series: undefined, strategies: undefined });
            setSubmitted(false);
          }}
          selectedIds={selectedIds}
          onSelectedIdsChange={(ids) => setParams({ series: ids.join(",") })}
          strategyKeys={strategyKeys}
          onStrategyKeysChange={(keys) =>
            setParams({ strategies: JSON.stringify(keys) })
          }
          availableStrategies={availableStrategies}
        />

        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setParams({ from: f ?? undefined, to: t ?? undefined });
          }}
        />

        <button
          type="button"
          onClick={handleCompare}
          disabled={
            (level === "account" && selectedIds.length < 2) ||
            (level === "strategy" && strategyKeys.length < 2)
          }
          className="rounded-md border border-accent bg-accent text-white px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed h-8"
        >
          Compare
        </button>
      </div>

      {/* Content */}
      {!submitted && (
        <EmptyState message="Select entities and click Compare to see results." />
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <div className="h-[300px] bg-surface rounded-md animate-pulse" />
        </div>
      )}

      {error && !isLoading && (
        <AlertBanner
          message={`Comparison failed: ${(error as Error).message}`}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <>
          {/* Currency mismatch flags */}
          {data.meta.currency_mismatch_series.map((sid) => (
            <StandaloneSeriesFlag key={sid} seriesId={sid} />
          ))}

          {/* Chart */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-secondary">Equity Curves</h3>
              <NormalizationToggle
                mode={normalization}
                onChange={setNormalization}
              />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                onMouseMove={(e) => {
                  if (e?.activeTooltipIndex !== undefined) {
                    setHoveredIndex(e.activeTooltipIndex);
                  }
                }}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={yAxisFormatter} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => {
                    if (normalization === "indexed") return [`${value.toFixed(2)}%`];
                    return [formatCurrency(String(value), baseCurrency)];
                  }}
                />
                <ReferenceLine y={normalization === "indexed" ? 0 : NORMALIZED_BASE} stroke="var(--border-default)" />
                <Legend
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  iconType="line"
                />
                {data.equity_curves.map((curve, i) => (
                  <Line
                    key={curve.series_id}
                    type="monotone"
                    dataKey={`v${i}`}
                    name={curve.name}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Hover Stats Panel */}
          <HoverStatsPanel
            curves={data.equity_curves}
            hoveredIndex={hoveredIndex}
            baseCurrency={baseCurrency}
          />

          {/* Head-to-Head Table */}
          <div>
            <h3 className="text-sm font-medium text-secondary mb-2">
              Head-to-Head Comparison
            </h3>
            <ComparisonTable
              account={data.account}
              curves={data.equity_curves}
              baseCurrency={baseCurrency}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run frontend build to check types**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: No type errors.

- [ ] **Step 3: Run frontend tests**

```bash
cd frontend && npx vitest run 2>&1 | tail -10
```

Expected: Existing tests that don't reference old ComparisonPage behavior pass. Tests that reference old behavior need adapting (see Task 10).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ComparisonPage.tsx
git commit -m "feat: rewrite ComparisonPage with level toggle, hover stats, and head-to-head table"
```

---

### Task 10: Fix and Adapt Tests

**Files:**
- Modify: `frontend/src/__tests__/ComparisonPage.test.tsx` (or wherever comparison tests live)

- [ ] **Step 1: Find comparison page tests**

```bash
cd frontend && grep -rl "ComparisonPage" src/__tests__/ 2>/dev/null || grep -rl "ComparisonPage" src/ --include="*.test.*" 2>/dev/null
```

- [ ] **Step 2: Read existing tests and adapt**

Update test expectations to match the new component structure:
- Replace references to deleted components (PerTradeDiffTable, MetricComparisonRow) with new ones (ComparisonTable, HoverStatsPanel)
- Add test for level toggle switching
- Add test for head-to-head table rendering
- Ensure all existing passing tests still pass

- [ ] **Step 3: Run all tests**

```bash
cd frontend && npx vitest run 2>&1 | tail -10
cd ../backend && python -m pytest tests/ -x -q 2>&1 | tail -5
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/__tests__/
git commit -m "test: adapt comparison page tests for redesign"
```

---

### Task 11: Verify Strategy Board Data Flow

**Files:**
- Modify: `frontend/src/pages/ComparisonPage.tsx` (the `availableStrategies` computation)

- [ ] **Step 1: Update availableStrategies computation**

The strategy board now pulls from the series list's `strategies` field (added in Task 3). Update the ComparisonPage to use it:

```typescript
const availableStrategies = useMemo(() => {
  if (!seriesList || level !== "strategy") return [];
  return seriesList.flatMap((s) =>
    (s.strategies ?? []).map((st) => ({
      series_id: s.id,
      series_name: s.name,
      name_key: st.name_key,
      name: st.name,
    }))
  );
}, [seriesList, level]);
```

- [ ] **Step 2: Verify type check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -10
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ComparisonPage.tsx
git commit -m "feat: wire strategy board with real data from series list"
```

---

## Self-Review Checklist

- [ ] Spec coverage: Account/Strategy level toggle ✓ (Tasks 1,2,6,9), Multi-entity select ✓ (Task 6), Normalized equity ✓ (Task 9), Chart hover stats ✓ (Task 7,9), Head-to-head table ✓ (Task 8,9), Strategy data loading ✓ (Task 3,11)
- [ ] No placeholders: All steps have code, all commands have expected output
- [ ] Type consistency: `ComparisonLevel`, `StrategyKey`, `ComparisonRequest` types flow from Task 4 through Tasks 5-9, 11
- [ ] Backend schema: `ComparisonIn` in Task 1 matches router in Task 2 step 5 and service signature in Task 2 step 4
- [ ] Frontend types: `ComparisonRequest` in Task 4 matches `EntityPicker` props in Task 6 and page request in Task 9
- [ ] Component props: `HoverStatsPanel` (Task 7) and `ComparisonTable` (Task 8) consume `ComparisonEquityCurve[]` and `AccountSeriesBlock[]` from types
- [ ] All existing tests must pass: Task 10 ensures this
- [ ] Format functions: Components use `formatCurrency(String(v), ccy)`, `formatPercent(String(v))`, `formatRatio(String(v), 2)` from `../lib/format`
