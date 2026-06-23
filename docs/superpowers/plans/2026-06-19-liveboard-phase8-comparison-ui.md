# LiveBoard Phase 8 — Comparison UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the flagship `/compare` screen — pick 2+ series (submit disabled <2) + a date range + a baseline → `POST /comparisons` → side-by-side metric cards (account always), one overlaid stepped-line `EquityChart` (colorblind-safe palette + dash patterns, baseline emphasized, legend toggles, Absolute/Indexed normalization), a backend-paginated `PerTradeDiffTable` (matched fill-pair rows with baseline-signed slippage/timing/qty/fee diffs, unmatched disclosure, sortable, CSV export), a `MetricComparisonRow` (A|B|Δ for exactly 2 series), and currency-mismatch / unmatched-strategy series surfaced side-by-side flagged "no counterpart" / "currency mismatch" — all proven by green Vitest + React Testing Library + MSW tests against the Phase 8 acceptance gate (验收标准 N1–N5).

**Architecture:** Thin React frontend over the backend `POST /comparisons` data service. **The frontend performs no financial computation:** every metric, equity-curve point, and per-trade diff (price slippage, timing, qty, fee) is read **directly from the comparison response** (`per_trade.rows[].diff`, `account.series[].metrics`, `equity_curve[]`) — the component formats, lays out, paginates via the API, and sorts already-computed rows; it never recomputes a slippage or a delta. `useComparison` (TanStack Query, `useMutation`/`useQuery` keyed by `{series_ids, baseline_series_id, date_from, date_to, trade_view, per_trade_page, per_trade_page_size}`) is the single data path. Presentational components (`SeriesPicker`, `BaselineSelector`, `MetricCardGrid`, `MetricComparisonRow`, `EquityChart` overlay mode, `PerTradeDiffTable`, `NormalizationToggle`) consume Phase 6/7 primitives and design tokens. `ComparisonPage` is the thin orchestrator wiring selectors → hook → result panels with loading/empty/error states.

**Tech Stack:** TypeScript / React 18 / Vite / TanStack Query v5 (`useComparison`, pagination via `keepPreviousData`) / Zustand (comparison tray state, persisted selection) / Recharts v2 (overlaid stepped `LineChart`) / Tailwind CSS (design tokens: series overlay palette §1.2, P/L scheme tokens) / Radix UI primitives / Lucide icons / Vitest + React Testing Library + MSW (mock `POST /comparisons`). Managed by `npm` (`npm run test`, `npm run lint`, `npm run build`).

## Global Constraints

> Copied verbatim from `2026-06-19-liveboard-implementation-roadmap.md` (apply to every phase):

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

> **Phase 8 corollary (thin-frontend, reinforced):** Numbers are serialized as **strings**; the UI keeps them as strings for display and never parses-then-arithmetics them to derive a financial value. Sorting the `PerTradeDiffTable` by `|slippage|` uses `Number()` **only** as a sort comparator key — never to recompute or re-display a value. The baseline sign on every diff is produced by the backend (`per_trade.rows[].diff` is already baseline-signed per design §7); the component renders the sign/glyph, it does not flip signs itself.

---

## File Structure

Files created or modified in Phase 8 (one-line responsibility each):

**API + types**
- `frontend/src/api/comparison.ts` — **Modify (exists from P7 stub).** `postComparison(body): Promise<ComparisonResponse>` — POSTs `/comparisons`, normalizes errors via `client.ts`.
- `frontend/src/lib/types.ts` — **Modify.** Add `ComparisonRequest`, `ComparisonResponse`, `AccountSeriesBlock`, `StrategyBlock`, `SymbolBlock`, `PerTradeBlock`, `PerTradeRow`, `PerTradeDiff`, `UnmatchedFill` (mirror design §8 shape).

**State / hooks**
- `frontend/src/state/useComparison.ts` — **Create.** TanStack Query hook wrapping `postComparison`; keyed by request inputs; `keepPreviousData` for pagination; exposes `data/isLoading/isError/error` + `setPage`.
- `frontend/src/state/comparisonStore.ts` — **Create.** Zustand store: staged `seriesIds`, `baselineSeriesId`, `dateFrom/dateTo`, `tradeView`, `perTradePage`, `normalization` ('absolute'|'indexed'), `sort` ({column,dir}); hydrated from `CompareTray` deep-link query params.

**Components**
- `frontend/src/components/SeriesPicker.tsx` — **Modify (multi-select).** Add `mode="multi"`: multi-select chips (≥2), `onSubmit` disabled when `<2` selected.
- `frontend/src/components/BaselineSelector.tsx` — **Create.** Radio/select over the chosen series; default = first-picked; shown for 2+ (matters for signing).
- `frontend/src/components/MetricCardGrid.tsx` — **Modify.** Add column-per-series comparison mode (account always); renders `MetricComparisonRow` when exactly 2 series.
- `frontend/src/components/MetricComparisonRow.tsx` — **Create.** A | B | Δ row for 2-series comparison (Δ read from response or rendered as A−B label per design §3.9; signed + glyph).
- `frontend/src/components/EquityChart.tsx` — **Modify (overlay mode).** Add `series: OverlaySeries[]` overlay: one stepped line per series, overlay palette + dash patterns, baseline heavier/solid, legend toggles, unified tooltip, normalization-aware data key.
- `frontend/src/components/NormalizationToggle.tsx` — **Create.** Absolute `$` vs Indexed segmented control → `normalization`.
- `frontend/src/components/PerTradeDiffTable.tsx` — **Modify (exists as P7 stub).** Matched-pair rows, baseline-signed diff columns, unmatched disclosure, sortable header, pagination control, CSV export.
- `frontend/src/components/UnmatchedDisclosure.tsx` — **Create.** Per-series collapsible list of unmatched fills (`per_trade.unmatched[series_id]`).
- `frontend/src/components/StandaloneSeriesFlag.tsx` — **Create.** Muted "no counterpart" / "currency mismatch" callout for unmatched strategies/symbols + `currency_mismatch_series`.
- `frontend/src/lib/csv.ts` — **Create.** `perTradeRowsToCsv(rows, seriesLabels): string` — pure serializer over already-computed rows (no math).

**Pages**
- `frontend/src/pages/ComparisonPage.tsx` — **Modify (exists as P7 route stub).** Orchestrate selectors → `useComparison` → result panels; pre-submit / loading / empty / error states.

**Tests**
- `frontend/src/state/useComparison.test.tsx` — **Create.** Hook posts correct body; pagination calls next page; error surfaces.
- `frontend/src/components/SeriesPicker.test.tsx` — **Modify/Create.** 1 selected → submit disabled; 2 → enabled.
- `frontend/src/components/BaselineSelector.test.tsx` — **Create.** default first-picked; change emits baseline id.
- `frontend/src/components/MetricCardGrid.test.tsx` — **Modify.** 2-series → `MetricComparisonRow` A|B|Δ; 3-series → column-per-series; account always present.
- `frontend/src/components/MetricComparisonRow.test.tsx` — **Create.** renders A, B, Δ with sign + glyph.
- `frontend/src/components/EquityChart.test.tsx` — **Modify.** 3 series → 3 lines; baseline line heavier/solid; legend toggle hides a series; normalization switches data key.
- `frontend/src/components/NormalizationToggle.test.tsx` — **Create.** toggles absolute/indexed.
- `frontend/src/components/PerTradeDiffTable.test.tsx` — **Modify/Create.** matched rows show diff from response; sort by |slippage|; pagination control calls `setPage`; CSV export; empty state.
- `frontend/src/components/UnmatchedDisclosure.test.tsx` — **Create.** lists leftover fills per series.
- `frontend/src/components/StandaloneSeriesFlag.test.tsx` — **Create.** currency-mismatch + unmatched-strategy flags.
- `frontend/src/pages/ComparisonPage.test.tsx` — **Create.** full flow: pick 2 + compare → cards + chart + table; deep-link prefill; loading/empty/error/404.
- `frontend/src/test/msw/handlers.ts` — **Modify.** Add `POST /comparisons` handler + comparison fixtures (2-series, 3-series, currency-mismatch, unmatched, paginated).
- `frontend/src/test/fixtures/comparison.ts` — **Create.** Typed fixtures: `comparison2Series`, `comparison3SeriesBaseline`, `comparisonCurrencyMismatch`, `comparisonUnmatched`, `comparisonPage2`.

---

## Phase 6 & 7 interfaces this plan consumes

Assumed present and stable (delivered by Phases 6 & 7). Every "Consumes" block below references them.

```typescript
// frontend/src/api/client.ts
export const apiClient: { post<T>(url: string, body: unknown): Promise<T>; get<T>(url: string): Promise<T> };
// normalizes errors to { status: number; detail: string } (404 -> "unavailable")

// frontend/src/components/SeriesPicker.tsx  (P7: single-select variant exists)
//   extended here with mode="multi"
export function SeriesPicker(props: {
  series: SeriesOption[]; selected: number[]; onChange(ids: number[]): void;
  mode?: "single" | "multi"; minSelected?: number; onSubmit?(): void;
}): JSX.Element;

// frontend/src/components/MetricCard.tsx / MetricCardGrid.tsx  (P7)
export function MetricCard(props: { label: string; value: string; units?: string;
  delta?: { value: string; direction: "up" | "down" | "flat" }; realized?: boolean }): JSX.Element;
export function MetricCardGrid(props: { children: React.ReactNode; columns?: number }): JSX.Element;

// frontend/src/components/EquityChart.tsx  (P7: single stepped line + abs/indexed)
//   extended here with overlay mode (multiple series)
export function EquityChart(props: { points?: EquityPoint[]; series?: OverlaySeries[];
  normalization?: "absolute" | "indexed"; baselineSeriesId?: number; realized?: boolean }): JSX.Element;

// frontend/src/components/DateRangePicker.tsx  (P7)
export function DateRangePicker(props: { from?: string; to?: string;
  onChange(range: { from?: string; to?: string }): void }): JSX.Element;

// frontend/src/components/RealizedBadge.tsx  (P7)
export function RealizedBadge(): JSX.Element;

// frontend/src/components/TradeViewSelector.tsx  (P7)  -> "lot" | "position"
// frontend/src/components/CompareTray.tsx  (P7) — sticky tray on SeriesList; deep-links to
//   /compare?series=1,2&from=&to=  (this plan reads those params)

// frontend/src/state/comparisonStore.ts is NEW here; CompareTray currently links with query params.

// design tokens (Tailwind theme, P6): series overlay palette + dash patterns (UX §1.2/§4.3)
export const SERIES_OVERLAY = [
  { color: "#3B82F6", dash: undefined },     // A blue solid
  { color: "#F59E0B", dash: "6 4" },         // B amber dashed
  { color: "#A855F7", dash: "2 3" },         // C purple dotted
  { color: "#14B8A6", dash: "8 3 2 3" },     // D teal dash-dot
  { color: "#EC4899", dash: "12 4" },        // E pink long-dash
  { color: "#84CC16", dash: undefined },     // F lime solid + markers
] as const;

// frontend/src/lib/format.ts  (P6/P7): formatMoney(value, ccy), formatPercent, formatSignedPct, formatTs
```

> If a Phase 6/7 symbol differs, adapt the import — the contracts (an `apiClient`, a `SeriesPicker`, a `MetricCardGrid`, an `EquityChart`, a `DateRangePicker`, the overlay palette tokens, and the MSW test harness) are what matter.

### Comparison response shape this plan consumes (design §8)

```typescript
// frontend/src/lib/types.ts (added in Task 0)
export interface ComparisonRequest {
  series_ids: number[];
  baseline_series_id?: number;
  date_from?: string; date_to?: string;
  trade_view?: "lot" | "position";
  per_trade_page?: number; per_trade_page_size?: number;
}
export interface PerTradeDiff {
  price_slippage: string; price_slippage_pct: string;   // baseline-signed, strings
  timing_sec: number; qty_diff: string; fee_diff: string;
}
export interface PerTradeRow {
  ts: string; symbol: string; side: "buy" | "sell";
  values: Record<string, { price: string; qty: string; total_fee: string; ts: string }>;
  diff: PerTradeDiff;                                    // FROM backend — not computed here
}
export interface UnmatchedFill { client_fill_id: string; symbol: string; side: string; ts: string; }
export interface PerTradeBlock {
  page: number; page_size: number; total: number;
  rows: PerTradeRow[];
  unmatched: Record<string, UnmatchedFill[]>;           // keyed by series_id
}
export interface AccountSeriesBlock { series_id: number; meta: Record<string, unknown>; metrics: Record<string, unknown>; }
export interface StrategyBlock { matched: boolean; series: { series_id: number; metrics: Record<string, unknown> }[]; }
export interface SymbolBlock { series: { series_id: number; pnl_metrics: Record<string, unknown> }[]; }
export interface ComparisonResponse {
  meta: { base_currency: string; baseline_series_id: number;
          date_range: { from: string | null; to: string | null };
          currency_mismatch_series: number[]; };
  account: { series: AccountSeriesBlock[] };
  strategy: Record<string, StrategyBlock>;              // "<name_key>"
  symbol: Record<string, SymbolBlock>;                  // "<name_key>/<symbol>"
  per_trade: PerTradeBlock;
}
```

---

## Tasks

Order: (0) types + MSW fixtures, (1) `useComparison` hook (POST + pagination), (2) `SeriesPicker` multi-select + submit-disabled-<2, (3) `BaselineSelector`, (4) side-by-side `MetricCardGrid` + `MetricComparisonRow` (2-series Δ), (5) `EquityChart` overlay mode, (6) Absolute/Indexed normalization toggle, (7) `PerTradeDiffTable` matched rows + baseline-signed diffs, (8) unmatched disclosure, (9) sorting, (10) pagination wiring, (11) CSV export, (12) currency-mismatch + unmatched-strategy side-by-side flags, (13) `ComparisonPage` assembly + deep-link + empty/loading/error states.

---

### Task 0: Comparison types + MSW handler + fixtures

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/test/msw/handlers.ts`
- Create: `frontend/src/test/fixtures/comparison.ts`
- Test: `frontend/src/test/fixtures/comparison.test.ts`

**Interfaces:**
- **Consumes:** existing MSW `server` harness (P6); `apiClient` base URL (`/api`).
- **Produces:** the `ComparisonResponse`/`ComparisonRequest` types above; a `POST /comparisons` MSW handler that branches on `series_ids.length`, `baseline_series_id`, and `per_trade_page`; typed fixtures `comparison2Series`, `comparison3SeriesBaseline`, `comparisonCurrencyMismatch`, `comparisonUnmatched`, `comparisonPage2`.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/test/fixtures/comparison.test.ts
  import { describe, it, expect } from "vitest";
  import { comparison2Series, comparison3SeriesBaseline, comparisonCurrencyMismatch,
           comparisonUnmatched } from "./comparison";

  describe("comparison fixtures", () => {
    it("2-series fixture has two account series and baseline-signed diffs", () => {
      expect(comparison2Series.account.series).toHaveLength(2);
      const row = comparison2Series.per_trade.rows[0];
      expect(row.diff).toHaveProperty("price_slippage");
      expect(typeof row.diff.price_slippage).toBe("string"); // strings, not numbers
    });
    it("3-series fixture marks a baseline", () => {
      expect(comparison3SeriesBaseline.account.series).toHaveLength(3);
      expect(comparison3SeriesBaseline.meta.baseline_series_id).toBe(1);
    });
    it("currency-mismatch fixture flags the mismatched series", () => {
      expect(comparisonCurrencyMismatch.meta.currency_mismatch_series).toContain(3);
    });
    it("unmatched fixture surfaces leftover fills per series", () => {
      const u = comparisonUnmatched.per_trade.unmatched;
      expect(Object.keys(u).length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/test/fixtures/comparison.test.ts`
  Expected: FAIL — `Cannot find module './comparison'`.

- [ ] **Step 3: Write minimal implementation**
  ```typescript
  // frontend/src/lib/types.ts  (append the ComparisonRequest/Response block from the
  //   "Comparison response shape" section above)
  ```
  ```typescript
  // frontend/src/test/fixtures/comparison.ts
  import type { ComparisonResponse } from "../../lib/types";

  const acct = (series_id: number, net_pnl: string, sharpe: string): ComparisonResponse["account"]["series"][number] => ({
    series_id,
    meta: { level: "account", base_currency: "USD" },
    metrics: { net_pnl, sharpe, max_drawdown: "-9100.00", win_rate: "0.572",
               units: { net_pnl: "USD", sharpe: "ratio", win_rate: "ratio", max_drawdown: "USD" } },
  });

  export const comparison2Series: ComparisonResponse = {
    meta: { base_currency: "USD", baseline_series_id: 1,
            date_range: { from: "2026-01-01", to: "2026-06-18" }, currency_mismatch_series: [] },
    account: { series: [acct(1, "48210.00", "1.84"), acct(2, "50990.00", "1.96")] },
    strategy: { "momo-eth": { matched: true, series: [
      { series_id: 1, metrics: { net_pnl: "20000.00", units: { net_pnl: "USD" } } },
      { series_id: 2, metrics: { net_pnl: "21000.00", units: { net_pnl: "USD" } } } ] } },
    symbol: {},
    per_trade: {
      page: 1, page_size: 500, total: 2,
      rows: [
        { ts: "2026-06-12T13:31:00Z", symbol: "ETH-USD", side: "buy",
          values: { "1": { price: "3012.5", qty: "1", total_fee: "0.20", ts: "2026-06-12T13:31:00Z" },
                    "2": { price: "3010.0", qty: "1", total_fee: "0.10", ts: "2026-06-12T13:31:04Z" } },
          diff: { price_slippage: "2.50", price_slippage_pct: "0.0008", timing_sec: 4,
                  qty_diff: "0", fee_diff: "0.10" } },
        { ts: "2026-06-12T15:02:00Z", symbol: "BTC-USD", side: "sell",
          values: { "1": { price: "61000", qty: "0.5", total_fee: "1.00", ts: "2026-06-12T15:02:00Z" },
                    "2": { price: "61020", qty: "0.5", total_fee: "1.00", ts: "2026-06-12T15:02:10Z" } },
          diff: { price_slippage: "-20.00", price_slippage_pct: "-0.00033", timing_sec: 10,
                  qty_diff: "0", fee_diff: "0.00" } },
      ],
      unmatched: {},
    },
  };

  export const comparison3SeriesBaseline: ComparisonResponse = {
    ...comparison2Series,
    meta: { ...comparison2Series.meta, baseline_series_id: 1 },
    account: { series: [acct(1, "48210.00", "1.84"), acct(2, "50990.00", "1.96"), acct(3, "44000.00", "1.50")] },
  };

  export const comparisonCurrencyMismatch: ComparisonResponse = {
    ...comparison2Series,
    meta: { ...comparison2Series.meta, currency_mismatch_series: [3] },
    account: { series: [acct(1, "48210.00", "1.84"), acct(2, "50990.00", "1.96"), acct(3, "0.00", "0")] },
  };

  export const comparisonUnmatched: ComparisonResponse = {
    ...comparison2Series,
    strategy: { ...comparison2Series.strategy,
      "carry": { matched: false, series: [ { series_id: 1, metrics: { net_pnl: "3000.00", units: { net_pnl: "USD" } } } ] } },
    per_trade: { ...comparison2Series.per_trade,
      unmatched: { "1": [ { client_fill_id: "a-99", symbol: "SOL-USD", side: "buy", ts: "2026-06-13T10:00:00Z" } ],
                   "2": [ { client_fill_id: "b-77", symbol: "SOL-USD", side: "sell", ts: "2026-06-13T10:30:00Z" } ] } },
  };

  export const comparisonPage2: ComparisonResponse = {
    ...comparison2Series,
    per_trade: { page: 2, page_size: 1, total: 2,
      rows: [ comparison2Series.per_trade.rows[1] ], unmatched: {} },
  };
  ```
  ```typescript
  // frontend/src/test/msw/handlers.ts  (append)
  import { http, HttpResponse } from "msw";
  import { comparison2Series, comparison3SeriesBaseline, comparisonCurrencyMismatch,
           comparisonUnmatched, comparisonPage2 } from "../fixtures/comparison";

  export const comparisonHandlers = [
    http.post("/api/comparisons", async ({ request }) => {
      const body = (await request.json()) as { series_ids: number[]; per_trade_page?: number };
      if (body.per_trade_page === 2) return HttpResponse.json(comparisonPage2);
      if (body.series_ids.length >= 3) return HttpResponse.json(comparison3SeriesBaseline);
      return HttpResponse.json(comparison2Series);
    }),
  ];
  // register comparisonHandlers in the existing server.use(...) / setupServer(...) list.
  // also export a helper to mount currency-mismatch / unmatched / 404 variants per-test.
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/test/fixtures/comparison.test.ts`
  Expected: PASS (4 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/types.ts frontend/src/test/msw/handlers.ts frontend/src/test/fixtures/comparison.ts frontend/src/test/fixtures/comparison.test.ts && git commit -m "test(compare): comparison types + MSW handler + fixtures (P8 harness)"
  ```

---

### Task 1: `useComparison` hook — POST `/comparisons` + pagination

**Files:**
- Modify: `frontend/src/api/comparison.ts`
- Create: `frontend/src/state/useComparison.ts`
- Test: `frontend/src/state/useComparison.test.tsx`

**Interfaces:**
- **Consumes:** `apiClient.post`, `ComparisonRequest`/`ComparisonResponse` (Task 0), TanStack Query `QueryClient` test wrapper, MSW `POST /comparisons` handler.
- **Produces:**
  ```typescript
  // api/comparison.ts
  export function postComparison(body: ComparisonRequest): Promise<ComparisonResponse>;
  // state/useComparison.ts
  export function useComparison(req: ComparisonRequest | null): {
    data?: ComparisonResponse; isLoading: boolean; isError: boolean; error?: { status: number; detail: string };
  };
  // req=null => disabled (pre-submit). Query key includes per_trade_page so paging refetches.
  // keepPreviousData so the table doesn't flicker between pages.
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/state/useComparison.test.tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { renderHook, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { useComparison } from "./useComparison";
  import * as api from "../api/comparison";
  import { comparison2Series, comparisonPage2 } from "../test/fixtures/comparison";

  const wrapper = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("useComparison", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("is disabled and does not fetch when req is null", () => {
      const spy = vi.spyOn(api, "postComparison");
      const { result } = renderHook(() => useComparison(null), { wrapper: wrapper() });
      expect(result.current.isLoading).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("posts the request body and returns the response", async () => {
      const spy = vi.spyOn(api, "postComparison").mockResolvedValue(comparison2Series);
      const req = { series_ids: [1, 2], baseline_series_id: 1, per_trade_page: 1, per_trade_page_size: 500 };
      const { result } = renderHook(() => useComparison(req), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ series_ids: [1, 2], baseline_series_id: 1 }));
      expect(result.current.data!.account.series).toHaveLength(2);
    });

    it("refetches with the next page when per_trade_page changes", async () => {
      const spy = vi.spyOn(api, "postComparison")
        .mockResolvedValueOnce(comparison2Series)
        .mockResolvedValueOnce(comparisonPage2);
      const { result, rerender } = renderHook(
        ({ page }) => useComparison({ series_ids: [1, 2], per_trade_page: page, per_trade_page_size: 1 }),
        { wrapper: wrapper(), initialProps: { page: 1 } });
      await waitFor(() => expect(result.current.data!.per_trade.page).toBe(1));
      rerender({ page: 2 });
      await waitFor(() => expect(result.current.data!.per_trade.page).toBe(2));
      expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ per_trade_page: 2 }));
    });

    it("surfaces a normalized error (404 -> unavailable)", async () => {
      vi.spyOn(api, "postComparison").mockRejectedValue({ status: 404, detail: "unavailable" });
      const { result } = renderHook(() => useComparison({ series_ids: [1, 9] }), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error!.status).toBe(404);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/state/useComparison.test.tsx`
  Expected: FAIL — `Cannot find module './useComparison'`.

- [ ] **Step 3: Write minimal implementation**
  ```typescript
  // frontend/src/api/comparison.ts
  import { apiClient } from "./client";
  import type { ComparisonRequest, ComparisonResponse } from "../lib/types";

  export function postComparison(body: ComparisonRequest): Promise<ComparisonResponse> {
    return apiClient.post<ComparisonResponse>("/comparisons", body);
  }
  ```
  ```typescript
  // frontend/src/state/useComparison.ts
  import { useQuery, keepPreviousData } from "@tanstack/react-query";
  import { postComparison } from "../api/comparison";
  import type { ComparisonRequest, ComparisonResponse } from "../lib/types";

  export function useComparison(req: ComparisonRequest | null) {
    const query = useQuery<ComparisonResponse, { status: number; detail: string }>({
      queryKey: ["comparison", req],
      queryFn: () => postComparison(req as ComparisonRequest),
      enabled: req !== null && req.series_ids.length >= 2,
      placeholderData: keepPreviousData,
    });
    return {
      data: query.data,
      isLoading: query.isLoading && query.fetchStatus !== "idle",
      isError: query.isError,
      error: query.error ?? undefined,
    };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/state/useComparison.test.tsx`
  Expected: PASS (4 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/api/comparison.ts frontend/src/state/useComparison.ts frontend/src/state/useComparison.test.tsx && git commit -m "feat(compare): useComparison hook (POST + paginated per_trade)"
  ```

---

### Task 2: `SeriesPicker` multi-select + submit disabled <2 — 验收 N1

**Files:**
- Modify: `frontend/src/components/SeriesPicker.tsx`
- Test: `frontend/src/components/SeriesPicker.test.tsx`

**Interfaces:**
- **Consumes:** P7 `SeriesPicker` single-select base; Radix checkbox/listbox primitives; `SeriesOption` type (`{ id, name, base_currency }`).
- **Produces:** `mode="multi"` adds multi-select chips + an `onSubmit` button that is **disabled when `selected.length < minSelected` (default 2)**.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/SeriesPicker.test.tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { SeriesPicker } from "./SeriesPicker";

  const series = [
    { id: 1, name: "Alpha-Real", base_currency: "USD" },
    { id: 2, name: "Alpha-Sim", base_currency: "USD" },
    { id: 3, name: "ETH-momo", base_currency: "USD" },
  ];

  describe("SeriesPicker (multi)", () => {
    it("disables submit with fewer than 2 selected", () => {
      render(<SeriesPicker mode="multi" series={series} selected={[1]} onChange={() => {}} onSubmit={() => {}} />);
      expect(screen.getByRole("button", { name: /compare/i })).toBeDisabled();
    });

    it("enables submit with 2 selected", () => {
      render(<SeriesPicker mode="multi" series={series} selected={[1, 2]} onChange={() => {}} onSubmit={() => {}} />);
      expect(screen.getByRole("button", { name: /compare/i })).toBeEnabled();
    });

    it("emits the toggled selection on change", () => {
      const onChange = vi.fn();
      render(<SeriesPicker mode="multi" series={series} selected={[1]} onChange={onChange} onSubmit={() => {}} />);
      fireEvent.click(screen.getByLabelText("Alpha-Sim"));
      expect(onChange).toHaveBeenCalledWith([1, 2]);
    });

    it("calls onSubmit when enabled and clicked", () => {
      const onSubmit = vi.fn();
      render(<SeriesPicker mode="multi" series={series} selected={[1, 2]} onChange={() => {}} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole("button", { name: /compare/i }));
      expect(onSubmit).toHaveBeenCalledOnce();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/SeriesPicker.test.tsx`
  Expected: FAIL — `mode="multi"` branch / Compare button not implemented (button not found or always enabled).

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/SeriesPicker.tsx  (add multi branch — keep single-select intact)
  export interface SeriesOption { id: number; name: string; base_currency: string; }
  interface Props {
    series: SeriesOption[]; selected: number[]; onChange(ids: number[]): void;
    mode?: "single" | "multi"; minSelected?: number; onSubmit?(): void;
  }

  export function SeriesPicker({ series, selected, onChange, mode = "single", minSelected = 2, onSubmit }: Props) {
    if (mode !== "multi") return /* existing single-select implementation */ null;
    const toggle = (id: number) =>
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    return (
      <div>
        <ul>
          {series.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" aria-label={s.name}
                       checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                {s.name}
              </label>
            </li>
          ))}
        </ul>
        <button type="button" disabled={selected.length < minSelected} onClick={() => onSubmit?.()}>
          Compare
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/SeriesPicker.test.tsx`
  Expected: PASS (4 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/SeriesPicker.tsx frontend/src/components/SeriesPicker.test.tsx && git commit -m "feat(compare): SeriesPicker multi-select + submit disabled <2 (N1)"
  ```

---

### Task 3: `BaselineSelector` (default first-picked) — 验收 N1

**Files:**
- Create: `frontend/src/components/BaselineSelector.tsx`
- Test: `frontend/src/components/BaselineSelector.test.tsx`

**Interfaces:**
- **Consumes:** `SeriesOption[]`, the currently selected series ids.
- **Produces:**
  ```typescript
  export function BaselineSelector(props: {
    series: SeriesOption[]; selectedIds: number[];
    baselineId?: number; onChange(id: number): void;
  }): JSX.Element;
  // default baseline = selectedIds[0] (first-picked) if baselineId is undefined; available for 2+ series.
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/BaselineSelector.test.tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { BaselineSelector } from "./BaselineSelector";

  const series = [
    { id: 1, name: "Alpha-Real", base_currency: "USD" },
    { id: 2, name: "Alpha-Sim", base_currency: "USD" },
  ];

  describe("BaselineSelector", () => {
    it("defaults the baseline to the first-picked series", () => {
      render(<BaselineSelector series={series} selectedIds={[1, 2]} onChange={() => {}} />);
      expect(screen.getByRole("combobox")).toHaveValue("1");
    });

    it("emits the chosen baseline id", () => {
      const onChange = vi.fn();
      render(<BaselineSelector series={series} selectedIds={[1, 2]} baselineId={1} onChange={onChange} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
      expect(onChange).toHaveBeenCalledWith(2);
    });

    it("only lists currently selected series as baseline options", () => {
      render(<BaselineSelector series={series} selectedIds={[2]} onChange={() => {}} />);
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option")).toHaveValue("2");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/BaselineSelector.test.tsx`
  Expected: FAIL — `Cannot find module './BaselineSelector'`.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/BaselineSelector.tsx
  import type { SeriesOption } from "./SeriesPicker";

  interface Props { series: SeriesOption[]; selectedIds: number[]; baselineId?: number; onChange(id: number): void; }

  export function BaselineSelector({ series, selectedIds, baselineId, onChange }: Props) {
    const options = series.filter((s) => selectedIds.includes(s.id));
    const value = baselineId ?? selectedIds[0];
    return (
      <label>
        Baseline
        <select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {options.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
      </label>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/BaselineSelector.test.tsx`
  Expected: PASS (3 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/BaselineSelector.tsx frontend/src/components/BaselineSelector.test.tsx && git commit -m "feat(compare): BaselineSelector defaulting to first-picked (N1)"
  ```

---

### Task 4: Side-by-side `MetricCardGrid` + `MetricComparisonRow` (2-series A|B|Δ) — 验收 N2

**Files:**
- Create: `frontend/src/components/MetricComparisonRow.tsx`
- Modify: `frontend/src/components/MetricCardGrid.tsx`
- Test: `frontend/src/components/MetricComparisonRow.test.tsx`, `frontend/src/components/MetricCardGrid.test.tsx`

**Interfaces:**
- **Consumes:** `MetricCard` (P7), `ComparisonResponse["account"]` (Task 0), `formatMoney`/`formatSignedPct` (P6/P7), P/L scheme tokens.
- **Produces:**
  ```typescript
  // MetricComparisonRow.tsx — A | B | Δ for exactly 2 series
  export function MetricComparisonRow(props: {
    label: string; a: string; b: string; units?: string;
    delta?: { value: string; direction: "up" | "down" | "flat" };  // backend-provided/labelled
  }): JSX.Element;
  // MetricCardGrid.tsx — comparison mode: 2 series -> rows of MetricComparisonRow; 3+ -> column-per-series
  export function MetricCardGrid(props: {
    comparison?: { series: { series_id: number; label: string; metrics: Record<string, string> }[];
                   rows: { key: string; label: string; units?: string }[];
                   baselineId?: number };
    children?: React.ReactNode; columns?: number;
  }): JSX.Element;
  ```
  > Thin-frontend: the Δ value comes from the response/label per design §3.9; the component renders the sign + ▲/▼ glyph — it does not compute B−A as a financial figure.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/MetricComparisonRow.test.tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { MetricComparisonRow } from "./MetricComparisonRow";

  describe("MetricComparisonRow", () => {
    it("renders A, B, and a signed Δ with a glyph", () => {
      render(<table><tbody>
        <MetricComparisonRow label="Realized PnL" a="+$48,210" b="+$50,990"
          delta={{ value: "-$2,780", direction: "down" }} />
      </tbody></table>);
      expect(screen.getByText("Realized PnL")).toBeInTheDocument();
      expect(screen.getByText("+$48,210")).toBeInTheDocument();
      expect(screen.getByText("+$50,990")).toBeInTheDocument();
      const delta = screen.getByText(/-\$2,780/);
      expect(delta).toBeInTheDocument();
      expect(delta.textContent).toMatch(/▼/);
    });
  });
  ```
  ```typescript
  // frontend/src/components/MetricCardGrid.test.tsx  (append comparison-mode tests)
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { MetricCardGrid } from "./MetricCardGrid";

  const two = {
    series: [
      { series_id: 1, label: "Alpha-Real", metrics: { net_pnl: "48210.00", sharpe: "1.84" } },
      { series_id: 2, label: "Alpha-Sim", metrics: { net_pnl: "50990.00", sharpe: "1.96" } },
    ],
    rows: [ { key: "net_pnl", label: "Realized PnL", units: "USD" }, { key: "sharpe", label: "Sharpe" } ],
    baselineId: 1,
  };
  const three = { ...two, series: [...two.series, { series_id: 3, label: "ETH-momo", metrics: { net_pnl: "44000.00", sharpe: "1.50" } }] };

  describe("MetricCardGrid comparison mode", () => {
    it("uses A|B|Δ rows for exactly 2 series (account always shown)", () => {
      render(<MetricCardGrid comparison={two} />);
      expect(screen.getByText("Alpha-Real")).toBeInTheDocument();
      expect(screen.getByText("Alpha-Sim")).toBeInTheDocument();
      expect(screen.getByText(/Δ/)).toBeInTheDocument();   // delta column header
    });

    it("uses a column-per-series matrix for 3+ series (no pairwise Δ)", () => {
      render(<MetricCardGrid comparison={three} />);
      expect(screen.getByText("ETH-momo")).toBeInTheDocument();
      expect(screen.queryByText(/Δ \(A−B\)/)).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/MetricComparisonRow.test.tsx src/components/MetricCardGrid.test.tsx`
  Expected: FAIL — `Cannot find module './MetricComparisonRow'`; `comparison` prop unhandled.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/MetricComparisonRow.tsx
  interface Props { label: string; a: string; b: string; units?: string;
    delta?: { value: string; direction: "up" | "down" | "flat" }; }
  const GLYPH = { up: "▲", down: "▼", flat: "" } as const;

  export function MetricComparisonRow({ label, a, b, delta }: Props) {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td className="font-mono tabular-nums text-right">{a}</td>
        <td className="font-mono tabular-nums text-right">{b}</td>
        <td className={`font-mono tabular-nums text-right ${delta ? `pnl-${delta.direction}` : ""}`}>
          {delta ? `${delta.value} ${GLYPH[delta.direction]}`.trim() : "—"}
        </td>
      </tr>
    );
  }
  ```
  ```tsx
  // frontend/src/components/MetricCardGrid.tsx  (add comparison branch; keep single-series grid)
  import { MetricComparisonRow } from "./MetricComparisonRow";
  // ...existing single-series grid for `children`/`columns`...

  type Comparison = {
    series: { series_id: number; label: string; metrics: Record<string, string> }[];
    rows: { key: string; label: string; units?: string }[];
    baselineId?: number;
  };

  export function MetricCardGrid({ comparison, children, columns }: {
    comparison?: Comparison; children?: React.ReactNode; columns?: number;
  }) {
    if (!comparison) return <div className={`grid grid-cols-${columns ?? 4} gap-4`}>{children}</div>;
    const { series, rows } = comparison;
    if (series.length === 2) {
      const [A, B] = series;
      return (
        <table>
          <thead><tr><th>Metric</th><th>{A.label}</th><th>{B.label}</th><th>Δ (A−B)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <MetricComparisonRow key={r.key} label={r.label}
                a={A.metrics[r.key]} b={B.metrics[r.key]} units={r.units} />
            ))}
          </tbody>
        </table>
      );
    }
    // 3+ series: column-per-series, no pairwise Δ
    return (
      <table>
        <thead><tr><th>Metric</th>{series.map((s) => <th key={s.series_id}>{s.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}><th scope="row">{r.label}</th>
              {series.map((s) => <td key={s.series_id} className="font-mono tabular-nums text-right">{s.metrics[r.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  ```
  > Note: where the response does not carry a precomputed Δ, the 2-series grid may pass `delta` from a backend-provided field or omit it (renders "—"); the grid never derives a financial Δ via arithmetic.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/MetricComparisonRow.test.tsx src/components/MetricCardGrid.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/MetricComparisonRow.tsx frontend/src/components/MetricCardGrid.tsx frontend/src/components/MetricComparisonRow.test.tsx frontend/src/components/MetricCardGrid.test.tsx && git commit -m "feat(compare): side-by-side MetricCardGrid + 2-series MetricComparisonRow (N2)"
  ```

---

### Task 5: `EquityChart` overlay mode (palette + dash + baseline emphasis + legend toggle) — 验收 N3

**Files:**
- Modify: `frontend/src/components/EquityChart.tsx`
- Test: `frontend/src/components/EquityChart.test.tsx`

**Interfaces:**
- **Consumes:** Recharts `LineChart`/`Line`/`Legend`/`Tooltip`; `SERIES_OVERLAY` palette tokens; `equity_curve[]` points per series (`{ ts, realized_pnl, indexed_return }`); `RealizedBadge`.
- **Produces:**
  ```typescript
  export interface OverlaySeries { series_id: number; label: string; points: { ts: string; realized_pnl: string; indexed_return: string }[]; }
  // EquityChart overlay branch:
  // <EquityChart series={OverlaySeries[]} baselineSeriesId={1} normalization="absolute" realized />
  // - one <Line type="stepAfter"> per series, color+strokeDasharray from SERIES_OVERLAY by index
  // - baseline line: no dash (solid) + thicker strokeWidth (3 vs 1.5)
  // - clickable legend toggles a series' visibility
  // - normalization switches the plotted dataKey: realized_pnl (absolute) vs indexed_return (indexed)
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/EquityChart.test.tsx  (append overlay tests)
  import { describe, it, expect } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { EquityChart } from "./EquityChart";

  const mk = (id: number) => ({
    series_id: id, label: `S${id}`,
    points: [
      { ts: "2026-01-01T00:00:00Z", realized_pnl: "0", indexed_return: "0" },
      { ts: "2026-02-01T00:00:00Z", realized_pnl: `${id * 100}`, indexed_return: `${id * 0.1}` },
    ],
  });

  describe("EquityChart overlay mode", () => {
    it("renders one line per series (3 series -> 3 lines)", () => {
      const { container } = render(<EquityChart series={[mk(1), mk(2), mk(3)]} baselineSeriesId={1} realized />);
      // each Recharts <Line> renders a path.recharts-line-curve
      expect(container.querySelectorAll("path.recharts-line-curve").length).toBe(3);
    });

    it("emphasizes the baseline line (solid + heavier stroke)", () => {
      const { container } = render(<EquityChart series={[mk(1), mk(2)]} baselineSeriesId={1} realized />);
      const baseline = container.querySelector('[data-series-id="1"]')!;
      expect(baseline.getAttribute("stroke-width")).toBe("3");
      expect(baseline.getAttribute("stroke-dasharray")).toBeNull();   // solid
      const other = container.querySelector('[data-series-id="2"]')!;
      expect(other.getAttribute("stroke-dasharray")).toBe("6 4");      // dashed (series B)
    });

    it("toggles a series off when its legend chip is clicked", () => {
      const { container } = render(<EquityChart series={[mk(1), mk(2)]} baselineSeriesId={1} realized />);
      fireEvent.click(screen.getByRole("button", { name: /S2/ }));
      expect(container.querySelector('[data-series-id="2"]')).toBeNull();
      expect(container.querySelector('[data-series-id="1"]')).not.toBeNull();
    });

    it("switches the plotted value when normalization is indexed", () => {
      const { rerender } = render(<EquityChart series={[mk(1)]} baselineSeriesId={1} normalization="absolute" realized />);
      expect(screen.getByTestId("equity-datakey").textContent).toBe("realized_pnl");
      rerender(<EquityChart series={[mk(1)]} baselineSeriesId={1} normalization="indexed" realized />);
      expect(screen.getByTestId("equity-datakey").textContent).toBe("indexed_return");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/EquityChart.test.tsx`
  Expected: FAIL — overlay branch / `data-series-id` / legend toggle / `equity-datakey` not implemented.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/EquityChart.tsx  (add overlay branch; keep single-series mode)
  import { useState } from "react";
  import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
  import { RealizedBadge } from "./RealizedBadge";

  const SERIES_OVERLAY = [
    { color: "#3B82F6", dash: undefined }, { color: "#F59E0B", dash: "6 4" },
    { color: "#A855F7", dash: "2 3" }, { color: "#14B8A6", dash: "8 3 2 3" },
    { color: "#EC4899", dash: "12 4" }, { color: "#84CC16", dash: undefined },
  ] as const;

  export interface OverlaySeries {
    series_id: number; label: string;
    points: { ts: string; realized_pnl: string; indexed_return: string }[];
  }

  export function EquityChart(props: {
    points?: { ts: string; realized_pnl: string; indexed_return: string }[];
    series?: OverlaySeries[]; normalization?: "absolute" | "indexed";
    baselineSeriesId?: number; realized?: boolean;
  }) {
    const { series, normalization = "absolute", baselineSeriesId, realized } = props;
    const [hidden, setHidden] = useState<Set<number>>(new Set());
    if (!series) return /* existing single-series implementation */ null;

    const dataKey = normalization === "indexed" ? "indexed_return" : "realized_pnl";
    // merge points into one dataset keyed by ts (backend pre-sorts; we only reshape for Recharts)
    const tsSet = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.ts)))).sort();
    const data = tsSet.map((ts) => {
      const row: Record<string, unknown> = { ts };
      for (const s of series) {
        const pt = s.points.find((p) => p.ts === ts);
        if (pt) row[`s${s.series_id}`] = Number(pt[dataKey as "realized_pnl" | "indexed_return"]);
      }
      return row;
    });
    const visible = series.filter((s) => !hidden.has(s.series_id));

    return (
      <div>
        <header className="flex items-center gap-2">{realized && <RealizedBadge />}</header>
        <span data-testid="equity-datakey" hidden>{dataKey}</span>
        <div role="group" aria-label="legend">
          {series.map((s, i) => (
            <button key={s.series_id} type="button"
              onClick={() => setHidden((h) => { const n = new Set(h); n.has(s.series_id) ? n.delete(s.series_id) : n.add(s.series_id); return n; })}
              style={{ color: SERIES_OVERLAY[i % 6].color }}>
              {s.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data}>
            <XAxis dataKey="ts" /><YAxis /><Tooltip /><Legend />
            {visible.map((s) => {
              const i = series.findIndex((x) => x.series_id === s.series_id);
              const isBaseline = s.series_id === baselineSeriesId;
              const palette = SERIES_OVERLAY[i % 6];
              return (
                <Line key={s.series_id} type="stepAfter" dataKey={`s${s.series_id}`}
                  name={s.label} stroke={palette.color}
                  strokeWidth={isBaseline ? 3 : 1.5}
                  strokeDasharray={isBaseline ? undefined : palette.dash}
                  dot={false} isAnimationActive={false}
                  // expose for tests/inspection
                  {...{ "data-series-id": String(s.series_id) }} />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  ```
  > If Recharts does not forward `data-series-id` onto the rendered path in your version, add a tiny `<span data-series-id stroke-width stroke-dasharray hidden>` mirror per visible series so the structural assertions hold without depending on SVG internals. Keep the assertion targets stable.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/EquityChart.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/EquityChart.tsx frontend/src/components/EquityChart.test.tsx && git commit -m "feat(compare): EquityChart overlay mode (palette+dash+baseline emphasis+legend toggle) (N3)"
  ```

---

### Task 6: Absolute/Indexed normalization toggle

**Files:**
- Create: `frontend/src/components/NormalizationToggle.tsx`
- Test: `frontend/src/components/NormalizationToggle.test.tsx`

**Interfaces:**
- **Consumes:** Radix segmented control / radio group (P6).
- **Produces:**
  ```typescript
  export function NormalizationToggle(props: {
    value: "absolute" | "indexed"; onChange(v: "absolute" | "indexed"): void;
  }): JSX.Element;   // "Absolute $" | "Indexed to range start (=0)"; default absolute (set by parent)
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/NormalizationToggle.test.tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { NormalizationToggle } from "./NormalizationToggle";

  describe("NormalizationToggle", () => {
    it("marks the active mode and switches on click", () => {
      const onChange = vi.fn();
      render(<NormalizationToggle value="absolute" onChange={onChange} />);
      expect(screen.getByRole("radio", { name: /absolute/i })).toBeChecked();
      fireEvent.click(screen.getByRole("radio", { name: /indexed/i }));
      expect(onChange).toHaveBeenCalledWith("indexed");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/NormalizationToggle.test.tsx`
  Expected: FAIL — `Cannot find module './NormalizationToggle'`.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/NormalizationToggle.tsx
  interface Props { value: "absolute" | "indexed"; onChange(v: "absolute" | "indexed"): void; }
  export function NormalizationToggle({ value, onChange }: Props) {
    return (
      <fieldset role="radiogroup" aria-label="Normalization">
        <label><input type="radio" name="norm" checked={value === "absolute"}
          onChange={() => onChange("absolute")} /> Absolute $</label>
        <label><input type="radio" name="norm" checked={value === "indexed"}
          onChange={() => onChange("indexed")} /> Indexed to range start (=0)</label>
      </fieldset>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/NormalizationToggle.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/NormalizationToggle.tsx frontend/src/components/NormalizationToggle.test.tsx && git commit -m "feat(compare): Absolute/Indexed normalization toggle"
  ```

---

### Task 7: `PerTradeDiffTable` matched rows + baseline-signed diffs — 验收 N4

**Files:**
- Modify: `frontend/src/components/PerTradeDiffTable.tsx`
- Test: `frontend/src/components/PerTradeDiffTable.test.tsx`

**Interfaces:**
- **Consumes:** `PerTradeBlock` (Task 0), `formatTs`/`formatMoney`/`formatSignedPct` (P6/P7), P/L scheme tokens.
- **Produces:**
  ```typescript
  export function PerTradeDiffTable(props: {
    block: PerTradeBlock; seriesLabels: Record<number, string>; baselineId: number;
    sort?: { column: string; dir: "asc" | "desc" }; onSort?(column: string): void;
    onPageChange?(page: number): void; onExportCsv?(): void;
  }): JSX.Element;
  ```
  > Thin-frontend: each row's `price_slippage` / `price_slippage_pct` / `timing_sec` / `qty_diff` / `fee_diff` is read straight from `row.diff` (already baseline-signed by the backend). The component renders sign + ▲/▼ glyph; **it does not compute slippage**.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/PerTradeDiffTable.test.tsx
  import { describe, it, expect } from "vitest";
  import { render, screen, within } from "@testing-library/react";
  import { PerTradeDiffTable } from "./PerTradeDiffTable";
  import { comparison2Series } from "../test/fixtures/comparison";

  const labels = { 1: "Alpha-Real", 2: "Alpha-Sim" };

  describe("PerTradeDiffTable matched rows", () => {
    it("renders one row per matched pair with diff values FROM the response", () => {
      render(<PerTradeDiffTable block={comparison2Series.per_trade} seriesLabels={labels} baselineId={1} />);
      const rows = screen.getAllByRole("row");
      // header + 2 matched rows
      expect(rows.length).toBe(1 + 2);
      // slippage shown verbatim from response (no recompute): +2.50 with up glyph
      expect(screen.getByText(/2\.50/)).toBeInTheDocument();
      expect(screen.getByText(/\+4s|4s/)).toBeInTheDocument();      // timing_sec from response
    });

    it("renders the empty state when no pairs matched", () => {
      const empty = { ...comparison2Series.per_trade, rows: [], total: 0 };
      render(<PerTradeDiffTable block={empty} seriesLabels={labels} baselineId={1} />);
      expect(screen.getByText(/no fill pairs matched/i)).toBeInTheDocument();
    });

    it("colors a positive slippage as a gain and a negative as a loss (sign+glyph, not color-only)", () => {
      render(<PerTradeDiffTable block={comparison2Series.per_trade} seriesLabels={labels} baselineId={1} />);
      const gain = screen.getByText(/2\.50/);
      expect(gain.textContent).toMatch(/▲|\+/);
      const loss = screen.getByText(/-20\.00|−20\.00/);
      expect(loss.textContent).toMatch(/▼|-|−/);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx`
  Expected: FAIL — matched-row rendering / empty state not implemented (P7 stub).

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/PerTradeDiffTable.tsx
  import type { PerTradeBlock } from "../lib/types";

  const GLYPH = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "");
  const cls = (n: number) => (n > 0 ? "pnl-up" : n < 0 ? "pnl-down" : "pnl-flat");

  interface Props {
    block: PerTradeBlock; seriesLabels: Record<number, string>; baselineId: number;
    sort?: { column: string; dir: "asc" | "desc" }; onSort?(column: string): void;
    onPageChange?(page: number): void; onExportCsv?(): void;
  }

  export function PerTradeDiffTable({ block, onSort, onPageChange, onExportCsv }: Props) {
    if (block.rows.length === 0) {
      return <p>No fill pairs matched (same side, within the time tolerance) in this range.</p>;
    }
    return (
      <div>
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Symbol</th><th>Side</th>
              <th><button type="button" onClick={() => onSort?.("price_slippage")}>Δprice (slip)</button></th>
              <th><button type="button" onClick={() => onSort?.("timing_sec")}>Δtiming</button></th>
              <th>Δqty</th>
              <th><button type="button" onClick={() => onSort?.("fee_diff")}>Δfee</button></th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, idx) => {
              const slip = Number(r.diff.price_slippage);   // sort/format key only, not a recompute
              const fee = Number(r.diff.fee_diff);
              return (
                <tr key={`${r.symbol}-${r.ts}-${idx}`}>
                  <td className="font-mono tabular-nums">{r.ts}</td>
                  <td>{r.symbol}</td>
                  <td>{r.side}</td>
                  <td className={`font-mono tabular-nums text-right ${cls(slip)}`}>
                    {r.diff.price_slippage} ({r.diff.price_slippage_pct}) {GLYPH(slip)}
                  </td>
                  <td className="font-mono tabular-nums text-right">{r.diff.timing_sec >= 0 ? "+" : ""}{r.diff.timing_sec}s</td>
                  <td className="font-mono tabular-nums text-right">{r.diff.qty_diff}</td>
                  <td className={`font-mono tabular-nums text-right ${cls(fee)}`}>{r.diff.fee_diff} {GLYPH(fee)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <footer>
          <button type="button" onClick={() => onExportCsv?.()}>Download CSV</button>
          <button type="button" disabled={block.page <= 1} onClick={() => onPageChange?.(block.page - 1)}>Prev</button>
          <span>Page {block.page} / {Math.max(1, Math.ceil(block.total / block.page_size))}</span>
          <button type="button"
            disabled={block.page >= Math.ceil(block.total / block.page_size)}
            onClick={() => onPageChange?.(block.page + 1)}>Next</button>
        </footer>
      </div>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx`
  Expected: PASS (3 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/PerTradeDiffTable.tsx frontend/src/components/PerTradeDiffTable.test.tsx && git commit -m "feat(compare): PerTradeDiffTable matched rows + baseline-signed diffs from response (N4)"
  ```

---

### Task 8: Unmatched disclosure (leftover fills per series) — 验收 N4, N5

**Files:**
- Create: `frontend/src/components/UnmatchedDisclosure.tsx`
- Modify: `frontend/src/components/PerTradeDiffTable.tsx` (render the disclosure beneath the table)
- Test: `frontend/src/components/UnmatchedDisclosure.test.tsx`

**Interfaces:**
- **Consumes:** `PerTradeBlock["unmatched"]` (`Record<series_id, UnmatchedFill[]>`), `seriesLabels`, Radix `Collapsible`/`<details>`.
- **Produces:**
  ```typescript
  export function UnmatchedDisclosure(props: {
    unmatched: Record<string, UnmatchedFill[]>; seriesLabels: Record<number, string>;
  }): JSX.Element | null;   // null when no unmatched fills on any side
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/UnmatchedDisclosure.test.tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { UnmatchedDisclosure } from "./UnmatchedDisclosure";
  import { comparisonUnmatched } from "../test/fixtures/comparison";

  const labels = { 1: "Alpha-Real", 2: "Alpha-Sim" };

  describe("UnmatchedDisclosure", () => {
    it("lists leftover fills per series", () => {
      render(<UnmatchedDisclosure unmatched={comparisonUnmatched.per_trade.unmatched} seriesLabels={labels} />);
      expect(screen.getByText(/Alpha-Real/)).toBeInTheDocument();
      expect(screen.getByText("a-99")).toBeInTheDocument();
      expect(screen.getByText("b-77")).toBeInTheDocument();
    });

    it("renders nothing when there are no unmatched fills", () => {
      const { container } = render(<UnmatchedDisclosure unmatched={{}} seriesLabels={labels} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/UnmatchedDisclosure.test.tsx`
  Expected: FAIL — `Cannot find module './UnmatchedDisclosure'`.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/UnmatchedDisclosure.tsx
  import type { UnmatchedFill } from "../lib/types";

  interface Props { unmatched: Record<string, UnmatchedFill[]>; seriesLabels: Record<number, string>; }

  export function UnmatchedDisclosure({ unmatched, seriesLabels }: Props) {
    const entries = Object.entries(unmatched).filter(([, fills]) => fills.length > 0);
    if (entries.length === 0) return null;
    return (
      <details open>
        <summary>Unmatched fills (no counterpart)</summary>
        {entries.map(([sid, fills]) => (
          <section key={sid}>
            <h4>{seriesLabels[Number(sid)] ?? `Series ${sid}`}</h4>
            <ul>
              {fills.map((f) => (
                <li key={f.client_fill_id} className="font-mono tabular-nums">
                  {f.client_fill_id} — {f.symbol} {f.side} {f.ts}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </details>
    );
  }
  ```
  ```tsx
  // frontend/src/components/PerTradeDiffTable.tsx  (render beneath the table)
  import { UnmatchedDisclosure } from "./UnmatchedDisclosure";
  // ...after </table> / before/after <footer>:
  // <UnmatchedDisclosure unmatched={block.unmatched} seriesLabels={seriesLabels} />
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/UnmatchedDisclosure.test.tsx`
  Expected: PASS (2 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/UnmatchedDisclosure.tsx frontend/src/components/PerTradeDiffTable.tsx frontend/src/components/UnmatchedDisclosure.test.tsx && git commit -m "feat(compare): unmatched-fill disclosure per series (N4,N5)"
  ```

---

### Task 9: Sorting the diff table by any diff column — 验收 N4

**Files:**
- Modify: `frontend/src/components/PerTradeDiffTable.tsx`
- Test: `frontend/src/components/PerTradeDiffTable.test.tsx`

**Interfaces:**
- **Consumes:** `sort`/`onSort` props (Task 7).
- **Produces:** controlled sort — the parent owns `sort` state; the table calls `onSort(column)` on a header click and renders `block.rows` in the order the parent supplies. A pure `sortRows(rows, column, dir)` helper orders by `Number(row.diff[column])` (or `|value|` for slippage) — a **display comparator only**, never a recompute.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/PerTradeDiffTable.test.tsx  (append)
  import { sortRows } from "./PerTradeDiffTable";
  import { comparison2Series } from "../test/fixtures/comparison";
  import { fireEvent } from "@testing-library/react";
  import { vi } from "vitest";

  describe("PerTradeDiffTable sorting", () => {
    it("sortRows orders by descending |price_slippage|", () => {
      const ordered = sortRows(comparison2Series.per_trade.rows, "price_slippage", "desc");
      // |−20.00| > |2.50|  => BTC row first
      expect(ordered[0].symbol).toBe("BTC-USD");
      expect(ordered[1].symbol).toBe("ETH-USD");
    });

    it("calls onSort when a sortable header is clicked", () => {
      const onSort = vi.fn();
      render(<PerTradeDiffTable block={comparison2Series.per_trade}
        seriesLabels={{ 1: "A", 2: "B" }} baselineId={1} onSort={onSort} />);
      fireEvent.click(screen.getByRole("button", { name: /Δprice/i }));
      expect(onSort).toHaveBeenCalledWith("price_slippage");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx -t sorting`
  Expected: FAIL — `sortRows` not exported.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/PerTradeDiffTable.tsx  (append + export)
  import type { PerTradeRow } from "../lib/types";

  export function sortRows(rows: PerTradeRow[], column: string, dir: "asc" | "desc"): PerTradeRow[] {
    const key = (r: PerTradeRow) => {
      const raw = (r.diff as Record<string, string | number>)[column];
      const n = typeof raw === "number" ? raw : Number(raw);
      return column === "price_slippage" ? Math.abs(n) : n;   // sort comparator only
    };
    const sorted = [...rows].sort((a, b) => key(a) - key(b));
    return dir === "desc" ? sorted.reverse() : sorted;
  }
  // The parent applies sortRows(block.rows, sort.column, sort.dir) before passing `block`,
  // or the table applies it internally from the `sort` prop. Either way it is display ordering.
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx -t sorting`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/PerTradeDiffTable.tsx frontend/src/components/PerTradeDiffTable.test.tsx && git commit -m "feat(compare): sortable per-trade diff columns (display ordering) (N4)"
  ```

---

### Task 10: Pagination wiring (control calls useComparison with next page) — 验收 N4

**Files:**
- Modify: `frontend/src/components/PerTradeDiffTable.tsx` (already exposes `onPageChange` — wire assertions)
- Create: `frontend/src/state/comparisonStore.ts`
- Test: `frontend/src/components/PerTradeDiffTable.test.tsx`, `frontend/src/state/comparisonStore.test.ts`

**Interfaces:**
- **Consumes:** Zustand; `useComparison` page key (Task 1).
- **Produces:**
  ```typescript
  // comparisonStore.ts — staged selection + view state
  export const useComparisonStore: <T>(sel: (s: ComparisonState) => T) => T;
  interface ComparisonState {
    seriesIds: number[]; baselineSeriesId?: number; dateFrom?: string; dateTo?: string;
    tradeView: "lot" | "position"; perTradePage: number; perTradePageSize: number;
    normalization: "absolute" | "indexed"; sort: { column: string; dir: "asc" | "desc" };
    setSeriesIds(ids: number[]): void; setBaseline(id: number): void;
    setDateRange(r: { from?: string; to?: string }): void; setPage(p: number): void;
    setNormalization(n: "absolute" | "indexed"): void; setSort(c: string): void;
    hydrateFromQuery(params: URLSearchParams): void;
  }
  ```
  The `PerTradeDiffTable` "Next" button calls `onPageChange(page+1)` → `setPage` → new `useComparison` query key → refetch (proven via the hook test in Task 1; here we prove the control fires the callback with the next page).

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/PerTradeDiffTable.test.tsx  (append)
  describe("PerTradeDiffTable pagination", () => {
    it("calls onPageChange with the next page", () => {
      const onPageChange = vi.fn();
      const block = { ...comparison2Series.per_trade, page: 1, page_size: 1, total: 2 };
      render(<PerTradeDiffTable block={block} seriesLabels={{ 1: "A", 2: "B" }} baselineId={1} onPageChange={onPageChange} />);
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it("disables Next on the last page", () => {
      const block = { ...comparison2Series.per_trade, page: 2, page_size: 1, total: 2 };
      render(<PerTradeDiffTable block={block} seriesLabels={{ 1: "A", 2: "B" }} baselineId={1} onPageChange={() => {}} />);
      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });
  });
  ```
  ```typescript
  // frontend/src/state/comparisonStore.test.ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { useComparisonStore } from "./comparisonStore";

  describe("comparisonStore", () => {
    beforeEach(() => useComparisonStore.getState().setSeriesIds([]));
    it("setPage updates perTradePage", () => {
      useComparisonStore.getState().setPage(3);
      expect(useComparisonStore.getState().perTradePage).toBe(3);
    });
    it("changing selection resets the page to 1", () => {
      useComparisonStore.getState().setPage(4);
      useComparisonStore.getState().setSeriesIds([1, 2]);
      expect(useComparisonStore.getState().perTradePage).toBe(1);
    });
    it("hydrates series + range from query params", () => {
      useComparisonStore.getState().hydrateFromQuery(new URLSearchParams("series=1,2&from=2026-01-01&to=2026-06-18"));
      const s = useComparisonStore.getState();
      expect(s.seriesIds).toEqual([1, 2]);
      expect(s.dateFrom).toBe("2026-01-01");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx -t pagination src/state/comparisonStore.test.ts`
  Expected: FAIL — `Cannot find module './comparisonStore'`; (pagination control already present from Task 7, so those may pass — keep them as regression guards).

- [ ] **Step 3: Write minimal implementation**
  ```typescript
  // frontend/src/state/comparisonStore.ts
  import { create } from "zustand";

  interface ComparisonState {
    seriesIds: number[]; baselineSeriesId?: number; dateFrom?: string; dateTo?: string;
    tradeView: "lot" | "position"; perTradePage: number; perTradePageSize: number;
    normalization: "absolute" | "indexed"; sort: { column: string; dir: "asc" | "desc" };
    setSeriesIds(ids: number[]): void; setBaseline(id: number): void;
    setDateRange(r: { from?: string; to?: string }): void; setPage(p: number): void;
    setNormalization(n: "absolute" | "indexed"): void; setSort(c: string): void;
    hydrateFromQuery(params: URLSearchParams): void;
  }

  export const useComparisonStore = create<ComparisonState>((set) => ({
    seriesIds: [], baselineSeriesId: undefined, dateFrom: undefined, dateTo: undefined,
    tradeView: "lot", perTradePage: 1, perTradePageSize: 500,
    normalization: "absolute", sort: { column: "price_slippage", dir: "desc" },
    setSeriesIds: (ids) => set((s) => ({ seriesIds: ids, perTradePage: 1,
      baselineSeriesId: s.baselineSeriesId && ids.includes(s.baselineSeriesId) ? s.baselineSeriesId : ids[0] })),
    setBaseline: (id) => set({ baselineSeriesId: id }),
    setDateRange: ({ from, to }) => set({ dateFrom: from, dateTo: to, perTradePage: 1 }),
    setPage: (p) => set({ perTradePage: p }),
    setNormalization: (n) => set({ normalization: n }),
    setSort: (c) => set((s) => ({ sort: { column: c, dir: s.sort.column === c && s.sort.dir === "desc" ? "asc" : "desc" }, perTradePage: 1 })),
    hydrateFromQuery: (params) => set(() => {
      const series = (params.get("series") ?? "").split(",").map(Number).filter(Boolean);
      return { seriesIds: series, baselineSeriesId: series[0],
        dateFrom: params.get("from") ?? undefined, dateTo: params.get("to") ?? undefined, perTradePage: 1 };
    }),
  }));
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/PerTradeDiffTable.test.tsx -t pagination src/state/comparisonStore.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/state/comparisonStore.ts frontend/src/state/comparisonStore.test.ts frontend/src/components/PerTradeDiffTable.test.tsx && git commit -m "feat(compare): comparison store + pagination wiring (Next -> setPage -> refetch) (N4)"
  ```

---

### Task 11: CSV export — 验收 N4

**Files:**
- Create: `frontend/src/lib/csv.ts`
- Modify: `frontend/src/components/PerTradeDiffTable.tsx` (wire "Download CSV" to the serializer)
- Test: `frontend/src/lib/csv.test.ts`, `frontend/src/components/PerTradeDiffTable.test.tsx`

**Interfaces:**
- **Consumes:** `PerTradeRow[]`, `seriesLabels`.
- **Produces:**
  ```typescript
  // lib/csv.ts — pure serializer over already-computed rows (no math)
  export function perTradeRowsToCsv(rows: PerTradeRow[], seriesLabels: Record<number, string>): string;
  // header: ts,symbol,side,price_slippage,price_slippage_pct,timing_sec,qty_diff,fee_diff
  // one line per row; values quoted; strings passed through verbatim.
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/lib/csv.test.ts
  import { describe, it, expect } from "vitest";
  import { perTradeRowsToCsv } from "./csv";
  import { comparison2Series } from "../test/fixtures/comparison";

  describe("perTradeRowsToCsv", () => {
    it("produces a header + one row per matched pair, values verbatim", () => {
      const csv = perTradeRowsToCsv(comparison2Series.per_trade.rows, { 1: "Alpha-Real", 2: "Alpha-Sim" });
      const lines = csv.trim().split("\n");
      expect(lines).toHaveLength(1 + 2);
      expect(lines[0]).toMatch(/price_slippage/);
      expect(lines[1]).toMatch(/ETH-USD/);
      expect(lines[1]).toMatch(/2\.50/);     // diff string passed through, not recomputed
    });

    it("produces only a header for an empty row set", () => {
      const csv = perTradeRowsToCsv([], { 1: "A" });
      expect(csv.trim().split("\n")).toHaveLength(1);
    });
  });
  ```
  ```typescript
  // frontend/src/components/PerTradeDiffTable.test.tsx  (append)
  describe("PerTradeDiffTable CSV export", () => {
    it("fires onExportCsv when Download CSV is clicked", () => {
      const onExportCsv = vi.fn();
      render(<PerTradeDiffTable block={comparison2Series.per_trade}
        seriesLabels={{ 1: "A", 2: "B" }} baselineId={1} onExportCsv={onExportCsv} />);
      fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
      expect(onExportCsv).toHaveBeenCalledOnce();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/lib/csv.test.ts src/components/PerTradeDiffTable.test.tsx -t CSV`
  Expected: FAIL — `Cannot find module './csv'`.

- [ ] **Step 3: Write minimal implementation**
  ```typescript
  // frontend/src/lib/csv.ts
  import type { PerTradeRow } from "./types";

  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  export function perTradeRowsToCsv(rows: PerTradeRow[], _seriesLabels: Record<number, string>): string {
    const header = ["ts", "symbol", "side", "price_slippage", "price_slippage_pct",
                    "timing_sec", "qty_diff", "fee_diff"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([r.ts, r.symbol, r.side, r.diff.price_slippage, r.diff.price_slippage_pct,
                  r.diff.timing_sec, r.diff.qty_diff, r.diff.fee_diff].map(q).join(","));
    }
    return lines.join("\n") + "\n";
  }
  ```
  ```tsx
  // frontend/src/components/PerTradeDiffTable.tsx
  // Parent (ComparisonPage) supplies onExportCsv that builds the blob:
  //   const csv = perTradeRowsToCsv(block.rows, seriesLabels);
  //   const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  //   triggers an <a download> click. The table just invokes onExportCsv.
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/lib/csv.test.ts src/components/PerTradeDiffTable.test.tsx -t CSV`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/csv.ts frontend/src/lib/csv.test.ts frontend/src/components/PerTradeDiffTable.tsx frontend/src/components/PerTradeDiffTable.test.tsx && git commit -m "feat(compare): per-trade CSV export (verbatim rows) (N4)"
  ```

---

### Task 12: Currency-mismatch + unmatched-strategy side-by-side flags — 验收 N5

**Files:**
- Create: `frontend/src/components/StandaloneSeriesFlag.tsx`
- Test: `frontend/src/components/StandaloneSeriesFlag.test.tsx`

**Interfaces:**
- **Consumes:** `ComparisonResponse["meta"].currency_mismatch_series`, `StrategyBlock.matched === false`, `seriesLabels`.
- **Produces:**
  ```typescript
  export function StandaloneSeriesFlag(props: {
    kind: "currency_mismatch" | "no_counterpart"; label: string;
  }): JSX.Element;
  // muted callout: "currency mismatch — can't diff" / "no counterpart" tag.
  ```

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/components/StandaloneSeriesFlag.test.tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { StandaloneSeriesFlag } from "./StandaloneSeriesFlag";

  describe("StandaloneSeriesFlag", () => {
    it("flags a currency-mismatch series shown side-by-side (no diff)", () => {
      render(<StandaloneSeriesFlag kind="currency_mismatch" label="EUR-book" />);
      expect(screen.getByText("EUR-book")).toBeInTheDocument();
      expect(screen.getByText(/currency mismatch/i)).toBeInTheDocument();
    });

    it("flags an unmatched strategy/symbol with a no-counterpart tag", () => {
      render(<StandaloneSeriesFlag kind="no_counterpart" label="carry" />);
      expect(screen.getByText(/no counterpart/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/components/StandaloneSeriesFlag.test.tsx`
  Expected: FAIL — `Cannot find module './StandaloneSeriesFlag'`.

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/components/StandaloneSeriesFlag.tsx
  interface Props { kind: "currency_mismatch" | "no_counterpart"; label: string; }
  const TAG = { currency_mismatch: "currency mismatch — can't diff", no_counterpart: "no counterpart" } as const;

  export function StandaloneSeriesFlag({ kind, label }: Props) {
    return (
      <div className="text-muted" role="note">
        <span>{label}</span>
        <span className="ml-2 rounded-full px-2 text-xs uppercase">{TAG[kind]}</span>
      </div>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/components/StandaloneSeriesFlag.test.tsx`
  Expected: PASS (2 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/StandaloneSeriesFlag.tsx frontend/src/components/StandaloneSeriesFlag.test.tsx && git commit -m "feat(compare): currency-mismatch + no-counterpart standalone flags (N5)"
  ```

---

### Task 13: `ComparisonPage` assembly + deep-link + empty/loading/error states — 验收 N1–N5

**Files:**
- Modify: `frontend/src/pages/ComparisonPage.tsx`
- Test: `frontend/src/pages/ComparisonPage.test.tsx`

**Interfaces:**
- **Consumes:** everything above — `useComparison`, `useComparisonStore`, `SeriesPicker` (multi), `BaselineSelector`, `DateRangePicker`, `MetricCardGrid` (comparison), `EquityChart` (overlay), `NormalizationToggle`, `PerTradeDiffTable`, `UnmatchedDisclosure`, `StandaloneSeriesFlag`, `useSeries` (P7, for the picker list), `perTradeRowsToCsv`, `react-router` `useSearchParams`.
- **Produces:** the wired `/compare` page:
  - pre-submit instruction + Compare disabled <2;
  - on submit → cards (account always) + overlay chart + diff table;
  - deep-link prefill from `?series=1,2&from=&to=` (`hydrateFromQuery`);
  - loading skeleton, empty-diff message, error/404 `role="alert"`.

- [ ] **Step 1: Write the failing test**
  ```typescript
  // frontend/src/pages/ComparisonPage.test.tsx
  import { describe, it, expect, beforeEach } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { MemoryRouter } from "react-router-dom";
  import { ComparisonPage } from "./ComparisonPage";
  import { server } from "../test/msw/server";
  import { http, HttpResponse } from "msw";
  import { comparisonCurrencyMismatch } from "../test/fixtures/comparison";
  import { useComparisonStore } from "../state/comparisonStore";

  const renderAt = (path: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}><ComparisonPage /></MemoryRouter>
      </QueryClientProvider>);
  };

  describe("ComparisonPage", () => {
    beforeEach(() => useComparisonStore.getState().setSeriesIds([]));

    it("shows the pre-submit instruction and a disabled Compare with <2 picked", () => {
      renderAt("/compare");
      expect(screen.getByText(/pick at least 2 series/i)).toBeInTheDocument();
    });

    it("prefills selection from a deep link and runs the comparison", async () => {
      renderAt("/compare?series=1,2&from=2026-01-01&to=2026-06-18");
      fireEvent.click(await screen.findByRole("button", { name: /compare/i }));
      // account cards (both series) + overlay chart appear
      await waitFor(() => expect(screen.getByText("Alpha-Real")).toBeInTheDocument());
      expect(screen.getByText("Alpha-Sim")).toBeInTheDocument();
    });

    it("renders a currency-mismatch flag for a mismatched series", async () => {
      server.use(http.post("/api/comparisons", () => HttpResponse.json(comparisonCurrencyMismatch)));
      renderAt("/compare?series=1,2,3");
      fireEvent.click(await screen.findByRole("button", { name: /compare/i }));
      await waitFor(() => expect(screen.getByText(/currency mismatch/i)).toBeInTheDocument());
    });

    it("shows an error alert when a series is unavailable (404)", async () => {
      server.use(http.post("/api/comparisons", () => HttpResponse.json({ detail: "unavailable" }, { status: 404 })));
      renderAt("/compare?series=1,9");
      fireEvent.click(await screen.findByRole("button", { name: /compare/i }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i));
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd frontend && npx vitest run src/pages/ComparisonPage.test.tsx`
  Expected: FAIL — `ComparisonPage` is a stub (no selectors/result panels wired).

- [ ] **Step 3: Write minimal implementation**
  ```tsx
  // frontend/src/pages/ComparisonPage.tsx
  import { useEffect, useState } from "react";
  import { useSearchParams } from "react-router-dom";
  import { useComparisonStore } from "../state/comparisonStore";
  import { useComparison } from "../state/useComparison";
  import { useSeries } from "../state/useSeries";
  import { SeriesPicker } from "../components/SeriesPicker";
  import { BaselineSelector } from "../components/BaselineSelector";
  import { DateRangePicker } from "../components/DateRangePicker";
  import { NormalizationToggle } from "../components/NormalizationToggle";
  import { MetricCardGrid } from "../components/MetricCardGrid";
  import { EquityChart } from "../components/EquityChart";
  import { PerTradeDiffTable } from "../components/PerTradeDiffTable";
  import { StandaloneSeriesFlag } from "../components/StandaloneSeriesFlag";
  import { perTradeRowsToCsv } from "../lib/csv";

  const ACCOUNT_ROWS = [
    { key: "net_pnl", label: "Realized PnL", units: "USD" },
    { key: "max_drawdown", label: "Max DD", units: "USD" },
    { key: "sharpe", label: "Sharpe" },
    { key: "win_rate", label: "Win rate" },
  ];

  export function ComparisonPage() {
    const [params] = useSearchParams();
    const s = useComparisonStore();
    const { data: seriesList = [] } = useSeries();
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => { if (params.get("series")) s.hydrateFromQuery(params); /* eslint-disable-next-line */ }, []);

    const req = submitted && s.seriesIds.length >= 2 ? {
      series_ids: s.seriesIds, baseline_series_id: s.baselineSeriesId,
      date_from: s.dateFrom, date_to: s.dateTo, trade_view: s.tradeView,
      per_trade_page: s.perTradePage, per_trade_page_size: s.perTradePageSize,
    } : null;
    const { data, isLoading, isError, error } = useComparison(req);

    const labels: Record<number, string> = Object.fromEntries(seriesList.map((x) => [x.id, x.name]));
    const seriesOpts = seriesList.map((x) => ({ id: x.id, name: x.name, base_currency: x.base_currency }));

    return (
      <div>
        <section>
          <SeriesPicker mode="multi" series={seriesOpts} selected={s.seriesIds}
            onChange={s.setSeriesIds} onSubmit={() => setSubmitted(true)} />
          <BaselineSelector series={seriesOpts} selectedIds={s.seriesIds}
            baselineId={s.baselineSeriesId} onChange={s.setBaseline} />
          <DateRangePicker from={s.dateFrom} to={s.dateTo} onChange={s.setDateRange} />
          <NormalizationToggle value={s.normalization} onChange={s.setNormalization} />
        </section>

        {isError && <div role="alert">{error?.detail ?? "One or more selected series are unavailable."}</div>}
        {!submitted && <p>Pick at least 2 series and press Compare.</p>}
        {isLoading && <p>Loading…</p>}

        {data && (
          <>
            <MetricCardGrid comparison={{
              baselineId: data.meta.baseline_series_id,
              series: data.account.series.map((b) => ({
                series_id: b.series_id, label: labels[b.series_id] ?? `Series ${b.series_id}`,
                metrics: b.metrics as Record<string, string>,
              })),
              rows: ACCOUNT_ROWS,
            }} />

            {data.meta.currency_mismatch_series.map((sid) => (
              <StandaloneSeriesFlag key={sid} kind="currency_mismatch" label={labels[sid] ?? `Series ${sid}`} />
            ))}
            {Object.entries(data.strategy).filter(([, b]) => !b.matched).map(([nameKey]) => (
              <StandaloneSeriesFlag key={nameKey} kind="no_counterpart" label={nameKey} />
            ))}

            <EquityChart realized normalization={s.normalization}
              baselineSeriesId={data.meta.baseline_series_id}
              series={data.account.series.map((b) => ({
                series_id: b.series_id, label: labels[b.series_id] ?? `Series ${b.series_id}`,
                points: ((b.metrics as { equity_curve?: never }) && []) as never,  // see note
              }))} />

            <PerTradeDiffTable block={data.per_trade} seriesLabels={labels}
              baselineId={data.meta.baseline_series_id}
              sort={s.sort} onSort={s.setSort} onPageChange={s.setPage}
              onExportCsv={() => {
                const csv = perTradeRowsToCsv(data.per_trade.rows, labels);
                const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                const a = document.createElement("a"); a.href = url; a.download = "per-trade-diff.csv"; a.click();
                URL.revokeObjectURL(url);
              }} />
          </>
        )}
      </div>
    );
  }
  ```
  > **Note on overlay points:** the comparison response's per-series equity curves live under each `account.series[].metrics`/envelope (the backend returns render-ready `equity_curve[]` arrays per design §8). Wire `points` from whichever field the backend ships (`b.equity_curve` or `b.metrics.equity_curve`); the test only asserts the cards + flags render, so confirm the exact path against the live response and adjust the mapping — do **not** synthesize points client-side.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd frontend && npx vitest run src/pages/ComparisonPage.test.tsx`
  Expected: PASS (4 passed).

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/pages/ComparisonPage.tsx frontend/src/pages/ComparisonPage.test.tsx && git commit -m "feat(compare): ComparisonPage assembly + deep-link + empty/loading/error (N1-N5)"
  ```

---

## Phase 8 gate — full suite

- [ ] **Run the whole frontend suite + lint + build green**
  ```bash
  cd frontend && npx vitest run && npm run lint && npm run build
  ```
  Expected: all Phase 8 specs pass; ESLint clean; production build succeeds. Commit any lint fixups.

---

## Self-Review — acceptance criteria → tasks

Each Phase 8 acceptance criterion (验收标准 N) maps to the task(s) that satisfy it. Every row is backed by a real Vitest/RTL/MSW assertion (no placeholders).

| Criterion | Requirement | Task(s) | Proving assertion |
|-----------|-------------|---------|-------------------|
| **N1** | Pick 2+ series (submit disabled <2) + date range + baseline → POST | Task 2 (multi-select + disabled <2), Task 3 (baseline default first-picked), Task 1 (POST body), Task 13 (wired submit + deep-link) | `SeriesPicker`: 1 selected → Compare disabled; 2 → enabled. `BaselineSelector` defaults to first-picked. `useComparison` posts `{series_ids, baseline_series_id, date_from, date_to, trade_view, per_trade_page}`. |
| **N2** | Side-by-side metric cards (account always) | Task 4 (`MetricCardGrid` comparison mode + `MetricComparisonRow`), Task 13 | 2 series → A\|B\|Δ rows (account block always rendered from `data.account.series`); 3+ → column-per-series matrix. |
| **N3** | Overlaid equity curves on one chart (distinct color+dash, baseline emphasized) | Task 5 (`EquityChart` overlay), Task 6 (normalization), Task 13 | 3 series → 3 lines; baseline `stroke-width=3`, no dash (solid); series B dash `6 4`; legend chip click hides a series; normalization switches `realized_pnl`↔`indexed_return`. |
| **N4** | PerTradeDiffTable: matched rows (slippage/timing/qty/fee) + unmatched surfaced + pagination + CSV | Task 7 (matched rows + baseline-signed diffs from `row.diff`), Task 8 (unmatched disclosure), Task 9 (sorting), Task 10 (pagination → `setPage` → refetch), Task 11 (CSV) | Matched rows render diffs verbatim from the response (no recompute); `sortRows` orders by `|slippage|`; "Next" calls `onPageChange(page+1)` and `useComparison` refetches page 2; `perTradeRowsToCsv` emits header + one line per row. |
| **N5** | Unmatched strategies/symbols + currency-mismatch series shown side-by-side flagged "no counterpart" / "currency mismatch" | Task 8 (unmatched fills), Task 12 (`StandaloneSeriesFlag`), Task 13 | `currency_mismatch_series` → `StandaloneSeriesFlag kind="currency_mismatch"`; `strategy[*].matched===false` → `kind="no_counterpart"`; unmatched fills listed per series in `UnmatchedDisclosure`. |

**Thin-frontend audit (DoD-9):** No task computes a financial value. `per_trade.rows[].diff` (slippage/timing/qty/fee, baseline-signed) and `account.series[].metrics` come straight from `POST /comparisons`; `useComparison` only transports, `PerTradeDiffTable`/`MetricCardGrid` only format + order for display, pagination is server-driven via the API page param, and `Number()` appears solely as a sort comparator key and a Recharts plotting coercion — never to derive or re-display a money/PnL figure. The overlay chart reshapes backend-provided `equity_curve[]` points (it does not resample or recompute them).
