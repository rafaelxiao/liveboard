# LiveBoard Phase 7 — Dashboard (Single-Series Analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the primary single-series analysis surface — `SeriesListPage` (list w/ counts + base currency, create form, compare tray, currency-mismatch flag), `SeriesDetailPage` (strategies, discovered symbols, `InstrumentReviewPanel` for inferred instruments, `FxRatesPanel` for `fx_missing` gaps, ingestion status), and `DashboardPage` (series/level/date/trade-view/active-days selectors → metric cards + stepped equity chart w/ Absolute/Indexed toggle + below-zero drawdown chart + trade-stats table, all URL-synced) — wired to `GET /series`, `GET /series/{id}`, and `GET /series/{id}/metrics`. The frontend performs **zero financial computation**: it fetches the self-describing metrics envelope, then only **formats** (base currency + active P/L color scheme) and **toggles visibility** of cards/charts/badges per `meta.flags`. Acceptance gate = 验收标准 **L** (L1, L2) and **M** (M1–M5).

**Architecture:** A thin React 18 + TypeScript SPA layered on the Phase 6 shell. TanStack Query (`state/useSeries.ts`, `state/useMetrics.ts`) transports backend-computed data; query keys encode every selector so a selector change is a refetch. Zustand (`auth`, `theme`, `pnl_color_scheme` from Phase 6) supplies presentation prefs. Pages stay thin; presentational components (`MetricCard`, `EquityChart`, `DrawdownChart`, `TradeStatsTable`, `ContributionCard`, `RealizedBadge`, `LevelSelector`, `TradeViewSelector`, `DateRangePicker`, `SeriesPicker`) receive typed props derived from the envelope and render render-ready values. Dashboard selector state lives in the URL query string (`?series=&level=&strategy=&symbol=&from=&to=&trade_view=&active_days_only=`) so views are shareable. Recharts renders the stepped equity line and below-zero drawdown area. Tests are Vitest + React Testing Library with MSW mocking the `/api/*` envelope; assertions confirm the component **reads** values from the response and never derives them.

**Tech Stack:** React 18, TypeScript ^5, Vite ^5, @tanstack/react-query ^5, Zustand ^4, Tailwind CSS ^3, Radix UI / shadcn-ui (segmented controls, popovers), Recharts ^2, react-router-dom ^6, Lucide icons, Fira Sans (UI) + Fira Code (numeric, tabular-nums). Tests: Vitest ^1 + @testing-library/react + @testing-library/user-event + @testing-library/jest-dom + MSW ^2. Lint: ESLint + Prettier.

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

> **Frontend corollary of the constraints (Phase 7 binding):** the React layer **only formats and toggles visibility**. It parses numeric strings solely to apply locale/currency/percent formatting and to choose a color/glyph from the active P/L scheme — it never sums, averages, ratios, indexes, or otherwise derives a displayed number. The Absolute/Indexed equity toggle **switches which backend-provided series** is plotted (`equity_curve[].realized_pnl` vs `equity_curve[].indexed_return`); it does not compute an index. Every badge/caveat/hide decision reads a `meta.flags.*` boolean or `meta.level` — never a recomputed threshold. Tests assert exactly this (see Critical Test Rules).

---

## Assumptions — Phase 6 is complete (consume, do not rebuild)

These exist from Phase 6 and are **consumed** by Phase 7. Do not re-implement them; if a named export differs in the real Phase 6 tree, adapt the import path but keep the contract.

| Phase 6 artifact | Path | Phase 7 use |
|------------------|------|-------------|
| App shell + routing | `src/App.tsx`, `src/routes.tsx`, `AppShell/Sidebar/Topbar` | Mount `/series`, `/series/:id`, `/dashboard` under `RequireAuth` (+approved) |
| Route guards | `src/auth/RequireAuth.tsx`, `RequireAdmin.tsx` | Wrap the new routes |
| API client | `src/api/client.ts` | `apiGet`/`apiPost` w/ base URL, JWT header, error normalization to `{error:{code,message,details}}` |
| Auth context/store | `src/auth/AuthContext.tsx`, Zustand auth store | Current user / token for requests |
| Theme store | Zustand `theme` store | Charts read active theme tokens |
| **P/L scheme store** | Zustand `pnl_color_scheme` store (`'red-up'` default \| `'green-up'`) | `MetricCard`, charts, deltas resolve `pnl/gain`·`pnl/loss` |
| Shared chrome | `AlertBanner`, `Toast`, `EmptyState`, `StatusChip`, `ConfirmPopover`, `CopyButton` | Reuse for error/empty/banner/tag/confirm |
| Skeletons | `SkeletonRows` (exists); `SkeletonCard`/`SkeletonChart` (this phase adds if absent) | Loading placeholders w/ reserved height |
| Design tokens | Tailwind theme (`bg/*`, `text/*`, `accent/*`, `pnl/*`, `warning`, `info`, `drawdown/fill`) | All styling |
| Format helpers | `src/lib/format.ts` (may be a Phase 6 stub) | Extended this phase: `formatCurrency`, `formatPercent`, `formatRatio`, `formatSignedDelta`, `formatSeconds`, `glyphFor` |
| Query client | `@tanstack/react-query` `QueryClientProvider` in `main.tsx` | `useSeries`/`useMetrics` hooks |
| Test setup | `vitest.config.ts`, `src/test/setup.ts` (jest-dom), MSW (this phase adds `src/test/server.ts` if absent) | All RTL tests |

> If `pnl_color_scheme` store, the P/L tokens, or the MSW test server were not delivered in Phase 6, Task 1 (test harness) establishes the minimal versions needed; flag the gap to team-lead rather than silently diverging.

---

## The metrics envelope contract (design §8) — the single source of truth this phase formats

Every `GET /series/{id}/metrics` response is the self-describing envelope below. `lib/types.ts` mirrors it exactly; components are typed against it. **Numbers are strings.** Symbol level nulls the return-based fields.

```jsonc
{
  "meta": {
    "level": "account",                       // "account" | "strategy" | "symbol"
    "base_currency": "USD",                   // ISO-4217 — drives currency formatting
    "session_tz": "America/New_York",
    "date_range": { "from": "2026-01-01", "to": "2026-06-18" },
    "trade_view": "lot",                      // "lot" | "position"
    "active_days_only": false,
    "strategy": "momo-eth",                   // present at strategy/symbol level
    "symbol": "ETH-USD",                      // present at symbol level
    "capital_base": "100000.00",              // null at symbol level
    "sample": { "round_trips": 142, "active_days": 88 },
    "flags": {
      "realized_only": true,
      "low_sample": false,
      "sharpe_suppressed": false,
      "fx_missing": false,
      "open_positions_exist": true
    }
  },
  "metrics": {
    "net_pnl": "48210.00", "gross_pnl": "50140.00", "total_fees": "1930.00",
    "fees_on_open_positions": "120.00",
    "twr": "0.142", "cagr": "0.118", "volatility": "0.094",
    "sharpe": "1.84", "sortino": "2.40", "calmar": "1.31",
    "max_drawdown": "-9100.00",
    "win_rate": "0.572", "profit_factor": "1.92", "payoff_ratio": "1.93",
    "expectancy": "184.00", "max_consec_wins": 7, "max_consec_losses": 4,
    "largest_win": "4100.00", "largest_loss": "-2000.00",
    "avg_holding_secs": 11520, "trade_count": 1204,
    "contribution_pct": null,                 // present (non-null) only at symbol level
    "alpha": null, "beta": null, "information_ratio": null,
    "units": {
      "net_pnl": "USD", "gross_pnl": "USD", "total_fees": "USD",
      "twr": "ratio", "cagr": "ratio", "volatility": "annualized_ratio",
      "sharpe": "ratio", "sortino": "ratio", "calmar": "ratio",
      "max_drawdown": "USD", "win_rate": "ratio", "profit_factor": "ratio",
      "payoff_ratio": "ratio", "expectancy": "USD",
      "avg_holding_secs": "seconds", "trade_count": "count",
      "contribution_pct": "ratio"
    }
  },
  "equity_curve":    [ { "ts": "2026-01-02T20:00:00Z", "realized_pnl": "320.00", "indexed_return": "0.0032" } ],
  "drawdown_series": [ { "ts": "2026-01-02T20:00:00Z", "drawdown": "0.00", "drawdown_pct": "0.0" } ]
}
```

`GET /series` and `GET /series/{id}` shapes (design §8):

```jsonc
// GET /series  →
[ { "id": 1, "name": "Alpha-Real", "tag": "real", "base_currency": "USD",
    "created_at": "2026-06-01T00:00:00Z",
    "counts": { "strategies": 4, "fills": 12481 },
    "last_ingest_at": "2026-06-18T14:02:00Z" } ]

// GET /series/{id}  →
{ "id": 1, "name": "Alpha-Real", "tag": "real", "notes": "live book, IB",
  "base_currency": "USD", "session_tz": "America/New_York", "created_at": "...",
  "strategies": [ { "id": 10, "name": "momo-eth", "name_key": "momo-eth", "fills": 4102 } ],
  "symbols": [ "ETH-USD", "BTC-USD", "SOL-USD" ],
  "instruments": [ { "symbol": "ES", "asset_class": "future", "multiplier": "50",
                     "currency": "USD", "inferred": false },
                   { "symbol": "NEW-X", "asset_class": "equity", "multiplier": "1",
                     "currency": "USD", "inferred": true } ],
  "fx_rates": [ { "ccy_from": "EUR", "ccy_to": "USD", "latest_rate": "1.08",
                  "points": 12 } ],
  "fx_missing_count": 2,
  "ingestion": { "last_batch_at": "2026-06-18T14:02:00Z", "rejected": 0,
                 "fills_missing_fx": 2 } }

// POST /series  body { name, tag, notes?, base_currency, session_tz, strategies?, instruments?, fund_movements? } → 201 { series_id }
```

> The `counts`, `last_ingest_at`, `symbols`, `instruments[].inferred`, `fx_rates`, `fx_missing_count`, and `ingestion` fields are read render-ready from the backend; the frontend never derives a count. If the live Phase 2 `GET /series` omits `last_ingest_at`/`counts`, treat them as optional and render `—`; flag the contract gap to team-lead.

---

## File Structure

Every file this phase creates or modifies (paths relative to repo root `LiveBoard/`):

| File | Responsibility |
|------|----------------|
| `frontend/src/lib/types.ts` | **(modify)** Add `SeriesSummary`, `SeriesDetail`, `Strategy`, `InstrumentSpec`, `FxRateSummary`, `MetricsEnvelope`, `MetaBlock`, `FlagsBlock`, `MetricsBlock`, `EquityPoint`, `DrawdownPoint`, `Level`, `TradeView` |
| `frontend/src/lib/format.ts` | **(modify)** `formatCurrency`, `formatPercent`, `formatRatio`, `formatSignedDelta`, `formatSeconds`, `glyphFor`, `pnlClassFor` (scheme-aware) |
| `frontend/src/api/series.ts` | **(modify/create)** `getSeries()`, `getSeriesDetail(id)`, `createSeries(body)` |
| `frontend/src/api/metrics.ts` | **(modify/create)** `getMetrics(seriesId, params)` → `MetricsEnvelope` |
| `frontend/src/state/useSeries.ts` | **(modify/create)** `useSeriesList()`, `useSeriesDetail(id)`, `useCreateSeries()` (TanStack Query) |
| `frontend/src/state/useMetrics.ts` | **(modify/create)** `useMetrics(params)` w/ selector-encoding query key |
| `frontend/src/state/compareTrayStore.ts` | Zustand store staging series ids for comparison (read by CompareTray) |
| `frontend/src/lib/dashboardParams.ts` | URL ⇄ `DashboardParams` (de)serialization helpers + defaults |
| `frontend/src/components/RealizedBadge.tsx` | "REALIZED" info pill + tooltip; variants for header / Max-DD caveat |
| `frontend/src/components/MetricCard.tsx` | Label + Fira-Code value + signed Δ + ▲/▼ in active P/L scheme; suppressed `—`; low-sample footnote; optional `RealizedBadge` |
| `frontend/src/components/MetricCardGrid.tsx` | Responsive grid of `MetricCard`; selects card set by level |
| `frontend/src/components/LevelSelector.tsx` | Segmented radio group: Account \| Strategy \| Symbol |
| `frontend/src/components/TradeViewSelector.tsx` | Segmented radio group: Per-lot \| Per-position |
| `frontend/src/components/ActiveDaysToggle.tsx` | Toggle for `active_days_only` |
| `frontend/src/components/DateRangePicker.tsx` | `from`/`to` + presets (1M/3M/YTD/All); inclusive boundaries |
| `frontend/src/components/SeriesPicker.tsx` | **(modify)** Single-select variant for Dashboard (multi-select stays for Phase 8) |
| `frontend/src/components/EquityChart.tsx` | Recharts stepped line + Absolute/Indexed toggle reading `realized_pnl`/`indexed_return` |
| `frontend/src/components/DrawdownChart.tsx` | Recharts below-zero area + max-DD marker |
| `frontend/src/components/TradeStatsTable.tsx` | Win rate, avg win/loss, profit factor, payoff, expectancy, consec, hold, count |
| `frontend/src/components/ContributionCard.tsx` | Symbol-level "contribution to strategy" + inline bar |
| `frontend/src/components/CompareTray.tsx` | Sticky tray on SeriesList; currency-mismatch flag; deep-link to `/compare` |
| `frontend/src/components/SkeletonCard.tsx`, `SkeletonChart.tsx` | Loading placeholders (only if Phase 6 lacks them) |
| `frontend/src/components/FlagBanners.tsx` | `FxMissingBanner` (amber) + low-sample footnote helper |
| `frontend/src/pages/SeriesListPage.tsx` | List + counts + currency; New-series form; CompareTray host |
| `frontend/src/pages/SeriesDetailPage.tsx` | Header + Strategies + Symbols + InstrumentReviewPanel + FxRatesPanel + ingestion status |
| `frontend/src/components/InstrumentReviewPanel.tsx` | Lists instruments; highlights `inferred=true` to confirm/correct |
| `frontend/src/components/FxRatesPanel.tsx` | View FX rates; surfaces `fx_missing` gaps |
| `frontend/src/pages/DashboardPage.tsx` | Controls bar + grid + charts + table; URL-synced; flag-driven states |
| `frontend/src/routes.tsx` | **(modify)** Register `/series`, `/series/:id`, `/dashboard` |
| `frontend/src/test/server.ts` | **(create if absent)** MSW server + default handlers for `/api/series*` + `/api/series/:id/metrics` |
| `frontend/src/test/fixtures.ts` | Reusable envelope/series fixtures + builders (`makeEnvelope({level, flags})`) |
| `frontend/src/test/setup.ts` | **(modify)** Start/stop MSW; jest-dom; ResizeObserver + matchMedia polyfills for Recharts |
| `frontend/src/components/__tests__/*.test.tsx` | Per-component Vitest/RTL tests |
| `frontend/src/pages/__tests__/*.test.tsx` | Page-level Vitest/RTL tests w/ MSW |
| `frontend/src/state/__tests__/*.test.tsx` | Hook tests (query-key / refetch) |

---

## Tasks

> Work from `frontend/`. All `npm` / `vitest` commands run from `frontend/` unless a path says otherwise. The repo is **not** assumed to be a git repo at the lab root; commit messages below use the `P7:` prefix. Each task is: **failing test → run (FAIL) → minimal real TSX → run (PASS) → commit.**

---

### Task 1: Test harness — MSW server, fixtures, Recharts polyfills, type/format foundation

**Files:**
- Create: `frontend/src/test/server.ts`, `frontend/src/test/fixtures.ts`
- Modify: `frontend/src/test/setup.ts`, `frontend/src/lib/types.ts`, `frontend/src/lib/format.ts`
- Test: `frontend/src/lib/__tests__/format.test.ts`

**Interfaces:**
- Consumes (Phase 6): `vitest.config.ts`, existing `setup.ts`, Zustand `pnl_color_scheme` store (`usePnlScheme()` → `'red-up'|'green-up'`).
- Produces (Phase 7+):
  - `lib/types.ts`: `Level = 'account'|'strategy'|'symbol'`; `TradeView = 'lot'|'position'`; `FlagsBlock`, `MetaBlock`, `MetricsBlock`, `EquityPoint`, `DrawdownPoint`, `MetricsEnvelope`; `SeriesSummary`, `SeriesDetail`, `Strategy`, `InstrumentSpec`, `FxRateSummary`. (Exact shapes mirror the envelope contract above — Phase 8 reuses these.)
  - `lib/format.ts` pure formatters (no fetching, no math beyond locale formatting):
    - `formatCurrency(value: string, ccy: string): string` — parses the decimal string, formats with `Intl.NumberFormat(..., {style:'currency', currency: ccy})`, preserves sign.
    - `formatPercent(value: string): string` — ratio string → `"14.2%"` (×100, 1 dp).
    - `formatRatio(value: string, dp?: number): string` — `"1.84"`.
    - `formatSeconds(secs: number): string` — `"3h 12m"`.
    - `glyphFor(sign: -1|0|1): '▲'|'▼'|''` — gain glyph `▲`, loss `▼`, zero ``.
    - `pnlClassFor(value: string, scheme: 'red-up'|'green-up'): string` — returns the Tailwind class token for `pnl/gain`/`pnl/loss`/`pnl/neutral`. **Sign → semantic, scheme → hue.** `red-up`: positive→`text-pnl-gain` (rose), `green-up`: positive→`text-pnl-gain` (emerald). The class name is scheme-independent (`text-pnl-gain`), and the *token's hue* is resolved by the CSS layer; this function only maps **sign → gain/loss/neutral class**.
    - `formatSignedDelta(value: string, unit: string, ccy: string): { text: string; glyph: string; sign: -1|0|1 }`.
  - `test/server.ts`: `export const server = setupServer(...defaultHandlers)` (MSW v2) + exported `defaultHandlers`.
  - `test/fixtures.ts`: `makeEnvelope(overrides)`, `accountEnvelope`, `strategyEnvelope`, `symbolEnvelope`, `seriesList`, `seriesDetail` builders.

- [ ] **Step 1: Write the failing test** — `frontend/src/lib/__tests__/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  formatCurrency, formatPercent, formatRatio, formatSeconds,
  glyphFor, pnlClassFor, formatSignedDelta,
} from '../format';

describe('format', () => {
  it('formats a decimal string as base currency, preserving sign', () => {
    expect(formatCurrency('48210.00', 'USD')).toBe('$48,210.00');
    expect(formatCurrency('-9100.00', 'USD')).toBe('-$9,100.00');
    // non-USD base currency must be honored, not hardcoded
    expect(formatCurrency('1000.00', 'EUR')).toMatch(/€|EUR/);
  });

  it('formats a ratio string as a percent', () => {
    expect(formatPercent('0.142')).toBe('14.2%');
    expect(formatPercent('0.572')).toBe('57.2%');
  });

  it('formats a ratio to fixed decimals', () => {
    expect(formatRatio('1.84')).toBe('1.84');
  });

  it('formats seconds as h/m', () => {
    expect(formatSeconds(11520)).toBe('3h 12m');
  });

  it('chooses glyph from sign only', () => {
    expect(glyphFor(1)).toBe('▲');
    expect(glyphFor(-1)).toBe('▼');
    expect(glyphFor(0)).toBe('');
  });

  it('maps sign to gain/loss/neutral class regardless of scheme (hue resolved by CSS)', () => {
    // positive value is always "gain" semantically; class is scheme-independent
    expect(pnlClassFor('48210.00', 'red-up')).toBe('text-pnl-gain');
    expect(pnlClassFor('48210.00', 'green-up')).toBe('text-pnl-gain');
    expect(pnlClassFor('-9100.00', 'red-up')).toBe('text-pnl-loss');
    expect(pnlClassFor('0', 'red-up')).toBe('text-pnl-neutral');
  });

  it('builds a signed delta with glyph + sign', () => {
    const d = formatSignedDelta('184.00', 'USD', 'USD');
    expect(d.sign).toBe(1);
    expect(d.glyph).toBe('▲');
    expect(d.text.startsWith('+')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run src/lib/__tests__/format.test.ts`
Expected: FAIL — `format.ts` lacks these exports (or file missing): "does not provide an export named 'formatCurrency'".

- [ ] **Step 3: Write minimal implementation** — implement the formatters in `lib/format.ts` (pure, locale-only; `pnlClassFor` maps sign→class), the TS types in `lib/types.ts`, and the test infra:

`frontend/src/test/setup.ts` (extend Phase 6 setup):
```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Recharts/ResponsiveContainer needs sizing + matchMedia in jsdom
class ResizeObserverStub {
  observe() {} unobserve() {} disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as any);
if (!window.matchMedia) {
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener() {},
       removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }) as any;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`frontend/src/test/server.ts`:
```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { accountEnvelope, seriesDetail, seriesList } from './fixtures';

export const defaultHandlers = [
  http.get('/api/series', () => HttpResponse.json(seriesList)),
  http.get('/api/series/:id', () => HttpResponse.json(seriesDetail)),
  http.get('/api/series/:id/metrics', () => HttpResponse.json(accountEnvelope)),
];
export const server = setupServer(...defaultHandlers);
```

`frontend/src/test/fixtures.ts` — `makeEnvelope` returns a complete account envelope and applies deep overrides for `meta.level`, `meta.flags`, `metrics`, `equity_curve`, `drawdown_series`; export `accountEnvelope`, `strategyEnvelope`, `symbolEnvelope` (symbol nulls return fields + sets `contribution_pct`), `seriesList`, `seriesDetail`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run src/lib/__tests__/format.test.ts`
Expected: PASS — all format assertions pass. Then `npx vitest run` (full) still green.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/types.ts frontend/src/lib/format.ts frontend/src/test/server.ts frontend/src/test/fixtures.ts frontend/src/test/setup.ts frontend/src/lib/__tests__/format.test.ts
git commit -m "P7: test harness (MSW server + fixtures + Recharts polyfills) + envelope types + format helpers"
```

---

### Task 2: `useSeries` hooks + `SeriesListPage` (list, counts, base currency) — L1

**Files:**
- Modify/Create: `frontend/src/api/series.ts`, `frontend/src/state/useSeries.ts`
- Create: `frontend/src/pages/SeriesListPage.tsx`
- Modify: `frontend/src/routes.tsx`
- Test: `frontend/src/pages/__tests__/SeriesListPage.test.tsx`

**Interfaces:**
- Consumes: `api/client.ts` (`apiGet`), `MetricsEnvelope`-adjacent types `SeriesSummary` (Task 1), Phase 6 `EmptyState`/`AlertBanner`/`SkeletonRows`/`StatusChip`, `QueryClientProvider`.
- Produces (Phase 8 reuses `useSeriesList`):
  - `api/series.ts`: `getSeries(): Promise<SeriesSummary[]>`.
  - `state/useSeries.ts`: `useSeriesList()` → `UseQueryResult<SeriesSummary[]>` with `queryKey: ['series']`.
  - `pages/SeriesListPage.tsx`: table of `{name, tag (StatusChip), base_currency, counts.strategies, counts.fills, last_ingest_at, actions}`; loading skeleton; empty onboarding card; error banner. `Open` → `/dashboard?series=:id`.

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/__tests__/SeriesListPage.test.tsx`. A test render helper (in `test/fixtures.ts` or inline) wraps with `QueryClientProvider` + `MemoryRouter`.
```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import { seriesList } from '../../test/fixtures';
import SeriesListPage from '../SeriesListPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/series']}>
        <SeriesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SeriesListPage (L1)', () => {
  it('lists series with strategy/fill counts and base currency', async () => {
    renderPage();
    expect(await screen.findByText('Alpha-Real')).toBeInTheDocument();
    const row = screen.getByText('Alpha-Real').closest('tr')!;
    // counts + currency are read from the backend response, not derived
    expect(row).toHaveTextContent(String(seriesList[0].counts.strategies));
    expect(row).toHaveTextContent('12,481'); // fills, formatted
    expect(row).toHaveTextContent(seriesList[0].base_currency); // "USD"
  });

  it('links Open to the dashboard for that series', async () => {
    renderPage();
    const open = (await screen.findAllByRole('link', { name: /open/i }))[0];
    expect(open).toHaveAttribute('href', expect.stringContaining('/dashboard?series=1'));
  });

  it('shows a helpful empty state when there are no series', async () => {
    server.use(http.get('/api/series', () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no series yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new series/i })).toBeInTheDocument();
  });

  it('shows an error banner on failure', async () => {
    server.use(http.get('/api/series', () => HttpResponse.json({ error: { code: 'x', message: 'boom' } }, { status: 500 })));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesListPage.test.tsx`
Expected: FAIL — "Cannot find module '../SeriesListPage'" (page not created yet).

- [ ] **Step 3: Write minimal implementation** — `getSeries` (apiGet `/series`), `useSeriesList`, and `SeriesListPage` rendering the table from the query result (formatting counts with `Intl.NumberFormat`, currency from `base_currency`), loading→`SkeletonRows`, `data.length===0`→`EmptyState`, error→`AlertBanner role="alert"`. Register the route in `routes.tsx` under `RequireAuth`. The "New series" button can be a stub that opens nothing yet (Task 3 wires the form).

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesListPage.test.tsx`
Expected: PASS — 4 tests pass (list+counts+currency, Open link, empty, error).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/series.ts frontend/src/state/useSeries.ts frontend/src/pages/SeriesListPage.tsx frontend/src/routes.tsx frontend/src/pages/__tests__/SeriesListPage.test.tsx
git commit -m "P7: useSeriesList + SeriesListPage (counts, base currency, empty/error) [L1]"
```

---

### Task 3: New-series create form (`base_currency` + `session_tz`) — L2 (create)

**Files:**
- Modify: `frontend/src/api/series.ts`, `frontend/src/state/useSeries.ts`, `frontend/src/pages/SeriesListPage.tsx`
- Test: `frontend/src/pages/__tests__/SeriesListPage.create.test.tsx`

**Interfaces:**
- Consumes: `apiPost` from `api/client.ts`, Radix dialog (Phase 6 modal primitive), `useQueryClient` for invalidation.
- Produces:
  - `api/series.ts`: `createSeries(body: { name; tag?; notes?; base_currency; session_tz }): Promise<{ series_id: number }>`.
  - `state/useSeries.ts`: `useCreateSeries()` → mutation that invalidates `['series']` on success.
  - `SeriesListPage`: "New series" opens a form capturing `name`, `tag`, `notes`, **required** `base_currency` (ISO-4217 select) and **required** `session_tz` (IANA tz select). Submit disabled until name + currency + tz set.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import SeriesListPage from '../SeriesListPage';

function renderPage() { /* same wrapper as Task 2 */ }

describe('SeriesListPage create form (L2)', () => {
  it('requires base_currency and session_tz before submit is enabled', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /new series/i }));
    const submit = screen.getByRole('button', { name: /create/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/name/i), 'New-Book');
    expect(submit).toBeDisabled(); // currency + tz still required
    await userEvent.selectOptions(screen.getByLabelText(/base currency/i), 'USD');
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), 'America/New_York');
    expect(submit).toBeEnabled();
  });

  it('posts base_currency and session_tz and refreshes the list', async () => {
    let body: any = null;
    server.use(http.post('/api/series', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ series_id: 99 }, { status: 201 });
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /new series/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'New-Book');
    await userEvent.selectOptions(screen.getByLabelText(/base currency/i), 'EUR');
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), 'Europe/London');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(body).toMatchObject({
      name: 'New-Book', base_currency: 'EUR', session_tz: 'Europe/London',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesListPage.create.test.tsx`
Expected: FAIL — no "New series" dialog / no `base currency` field yet.

- [ ] **Step 3: Write minimal implementation** — add the dialog form + `createSeries`/`useCreateSeries`; disable submit until required fields set; on success invalidate `['series']` and close.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesListPage.create.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/series.ts frontend/src/state/useSeries.ts frontend/src/pages/SeriesListPage.tsx frontend/src/pages/__tests__/SeriesListPage.create.test.tsx
git commit -m "P7: New-series create form (base_currency + session_tz, required) [L2]"
```

---

### Task 4: CompareTray + currency-mismatch flag

**Files:**
- Create: `frontend/src/state/compareTrayStore.ts`, `frontend/src/components/CompareTray.tsx`
- Modify: `frontend/src/pages/SeriesListPage.tsx`
- Test: `frontend/src/components/__tests__/CompareTray.test.tsx`

**Interfaces:**
- Consumes: Zustand, `SeriesSummary` (incl. `base_currency`), Phase 6 chips.
- Produces:
  - `compareTrayStore.ts`: `useCompareTray()` → `{ ids: number[]; toggle(id); clear() }`.
  - `CompareTray.tsx`: sticky bottom tray listing staged series; "Compare →" deep-links to `/compare?series=a,b`; rows with a `base_currency` differing from the first-staged series show a "currency mismatch — can't diff" flag and disable/exclude the Compare action.
  - `SeriesListPage`: each row's "Compare +" calls `toggle(id)`; renders `<CompareTray series={list} />` when ≥1 staged.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompareTray from '../CompareTray';

const usd1 = { id: 1, name: 'Alpha-Real', base_currency: 'USD' } as any;
const usd2 = { id: 2, name: 'Alpha-Sim', base_currency: 'USD' } as any;
const eur3 = { id: 3, name: 'Euro-Book', base_currency: 'EUR' } as any;

describe('CompareTray', () => {
  it('shows staged series and a Compare link deep-linking to /compare', () => {
    render(<MemoryRouter><CompareTray series={[usd1, usd2]} stagedIds={[1, 2]} /></MemoryRouter>);
    expect(screen.getByText('Alpha-Real')).toBeInTheDocument();
    expect(screen.getByText('Alpha-Sim')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /compare/i }))
      .toHaveAttribute('href', expect.stringContaining('/compare?series=1,2'));
  });

  it('flags a base_currency mismatch and does not offer a diff for the odd series', () => {
    render(<MemoryRouter><CompareTray series={[usd1, eur3]} stagedIds={[1, 3]} /></MemoryRouter>);
    expect(screen.getByText(/currency mismatch/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/CompareTray.test.tsx`
Expected: FAIL — `CompareTray` missing.

- [ ] **Step 3: Write minimal implementation** — store + tray; mismatch detected by comparing each staged series' `base_currency` against the first staged one (a presentation guard, not a computation of values).

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/CompareTray.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/state/compareTrayStore.ts frontend/src/components/CompareTray.tsx frontend/src/pages/SeriesListPage.tsx frontend/src/components/__tests__/CompareTray.test.tsx
git commit -m "P7: CompareTray (staging + deep-link) + currency-mismatch flag"
```

---

### Task 5: `SeriesDetailPage` — strategies + discovered symbols — L2 (detail)

**Files:**
- Modify: `frontend/src/api/series.ts`, `frontend/src/state/useSeries.ts`
- Create: `frontend/src/pages/SeriesDetailPage.tsx`
- Modify: `frontend/src/routes.tsx`
- Test: `frontend/src/pages/__tests__/SeriesDetailPage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `SeriesDetail` type, Phase 6 chrome.
- Produces:
  - `getSeriesDetail(id): Promise<SeriesDetail>`; `useSeriesDetail(id)` → `queryKey: ['series', id]`.
  - `SeriesDetailPage`: header (name, tag, `base_currency · session_tz`, notes, created), Strategies list (name + fill counts from `strategies[].fills`), discovered Symbols as chips (`symbols[]`), `Open in Dashboard` → `/dashboard?series=:id`. (Instrument/FX panels added in Tasks 6–7.)

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SeriesDetailPage from '../SeriesDetailPage';

function renderDetail(id = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/series/${id}`]}>
        <Routes><Route path="/series/:id" element={<SeriesDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SeriesDetailPage (L2)', () => {
  it('shows the base currency, session tz, strategies with fill counts, and discovered symbols', async () => {
    renderDetail();
    expect(await screen.findByText('momo-eth')).toBeInTheDocument();
    expect(screen.getByText(/4,102/)).toBeInTheDocument();   // strategy fills, formatted
    expect(screen.getByText('ETH-USD')).toBeInTheDocument(); // discovered symbol chip
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });

  it('links Open in Dashboard to ?series=:id', async () => {
    renderDetail();
    expect(await screen.findByRole('link', { name: /dashboard/i }))
      .toHaveAttribute('href', expect.stringContaining('/dashboard?series=1'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesDetailPage.test.tsx`
Expected: FAIL — page missing.

- [ ] **Step 3: Write minimal implementation** — hook + page reading `useParams().id`, rendering header/strategies/symbols.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/pages/__tests__/SeriesDetailPage.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/series.ts frontend/src/state/useSeries.ts frontend/src/pages/SeriesDetailPage.tsx frontend/src/routes.tsx frontend/src/pages/__tests__/SeriesDetailPage.test.tsx
git commit -m "P7: useSeriesDetail + SeriesDetailPage (strategies + discovered symbols) [L2]"
```

---

### Task 6: `InstrumentReviewPanel` (inferred-instrument review)

**Files:**
- Create: `frontend/src/components/InstrumentReviewPanel.tsx`
- Modify: `frontend/src/pages/SeriesDetailPage.tsx`
- Test: `frontend/src/components/__tests__/InstrumentReviewPanel.test.tsx`

**Interfaces:**
- Consumes: `InstrumentSpec[]` from `SeriesDetail.instruments`.
- Produces: `InstrumentReviewPanel({ instruments }: { instruments: InstrumentSpec[] })` — a table of `symbol / asset_class / multiplier / currency`; rows with `inferred=true` carry a `⚠ inferred — confirm/correct` warning chip (amber `warning` token). Renders a section header count of how many need review (read from the data, not computed beyond `.filter(i=>i.inferred).length` for display — acceptable as it is a count of flagged rows, not a financial metric).

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import InstrumentReviewPanel from '../InstrumentReviewPanel';

const instruments = [
  { symbol: 'ES', asset_class: 'future', multiplier: '50', currency: 'USD', inferred: false },
  { symbol: 'NEW-X', asset_class: 'equity', multiplier: '1', currency: 'USD', inferred: true },
];

describe('InstrumentReviewPanel', () => {
  it('renders multiplier and asset class from the response (not computed)', () => {
    render(<InstrumentReviewPanel instruments={instruments as any} />);
    const es = screen.getByText('ES').closest('tr')!;
    expect(es).toHaveTextContent('future');
    expect(es).toHaveTextContent('50');
  });

  it('highlights inferred instruments for review and not confirmed ones', () => {
    render(<InstrumentReviewPanel instruments={instruments as any} />);
    const newx = screen.getByText('NEW-X').closest('tr')!;
    expect(within(newx).getByText(/inferred/i)).toBeInTheDocument();
    const es = screen.getByText('ES').closest('tr')!;
    expect(within(es).queryByText(/inferred/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/InstrumentReviewPanel.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — the panel + mount it on `SeriesDetailPage`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/InstrumentReviewPanel.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/InstrumentReviewPanel.tsx frontend/src/pages/SeriesDetailPage.tsx frontend/src/components/__tests__/InstrumentReviewPanel.test.tsx
git commit -m "P7: InstrumentReviewPanel (highlights inferred instruments)"
```

---

### Task 7: `FxRatesPanel` (fx_missing gaps)

**Files:**
- Create: `frontend/src/components/FxRatesPanel.tsx`
- Modify: `frontend/src/pages/SeriesDetailPage.tsx`
- Test: `frontend/src/components/__tests__/FxRatesPanel.test.tsx`

**Interfaces:**
- Consumes: `SeriesDetail.fx_rates` (`FxRateSummary[]`) + `SeriesDetail.fx_missing_count` + `SeriesDetail.ingestion`.
- Produces: `FxRatesPanel({ rates, missingCount, ingestion })` — lists each rate (`EUR→USD 1.08 (12 points)`), and when `missingCount > 0` renders an amber `warning` note "`N fills missing FX`" plus the ingestion summary (last batch, rejected). When `missingCount === 0`, no amber gap note.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FxRatesPanel from '../FxRatesPanel';

const rates = [{ ccy_from: 'EUR', ccy_to: 'USD', latest_rate: '1.08', points: 12 }];
const ingestion = { last_batch_at: '2026-06-18T14:02:00Z', rejected: 0, fills_missing_fx: 2 };

describe('FxRatesPanel', () => {
  it('lists rates with point counts', () => {
    render(<FxRatesPanel rates={rates as any} missingCount={0} ingestion={{ ...ingestion, fills_missing_fx: 0 }} />);
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/1\.08/)).toBeInTheDocument();
    expect(screen.getByText(/12 points/)).toBeInTheDocument();
    expect(screen.queryByText(/missing fx/i)).not.toBeInTheDocument();
  });

  it('surfaces an fx_missing gap when missingCount > 0', () => {
    render(<FxRatesPanel rates={rates as any} missingCount={2} ingestion={ingestion as any} />);
    expect(screen.getByText(/2 fills missing fx/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/FxRatesPanel.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — panel + mount on detail page.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/FxRatesPanel.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/FxRatesPanel.tsx frontend/src/pages/SeriesDetailPage.tsx frontend/src/components/__tests__/FxRatesPanel.test.tsx
git commit -m "P7: FxRatesPanel (rates list + fx_missing gap surfacing)"
```

---

### Task 8: `useMetrics` hook — selector-encoding query key drives refetch

**Files:**
- Modify/Create: `frontend/src/api/metrics.ts`, `frontend/src/state/useMetrics.ts`, `frontend/src/lib/dashboardParams.ts`
- Test: `frontend/src/state/__tests__/useMetrics.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `MetricsEnvelope`, `Level`/`TradeView`.
- Produces (Phase 8 reuses the param shape):
  - `lib/dashboardParams.ts`: `interface DashboardParams { series: number; level: Level; strategy?: string; symbol?: string; from?: string; to?: string; trade_view: TradeView; active_days_only: boolean }`; `paramsToSearch(p): string`, `searchToParams(qs): DashboardParams` (with defaults: `level='account'`, `trade_view='lot'`, `active_days_only=false`).
  - `api/metrics.ts`: `getMetrics(p: DashboardParams): Promise<MetricsEnvelope>` — builds the query string `?level=&strategy=&symbol=&date_from=&date_to=&trade_view=&active_days_only=` (only includes strategy/symbol when relevant).
  - `state/useMetrics.ts`: `useMetrics(p: DashboardParams)` → `queryKey: ['metrics', p.series, p.level, p.strategy ?? null, p.symbol ?? null, p.from ?? null, p.to ?? null, p.trade_view, p.active_days_only]`, `enabled: !!p.series`.

- [ ] **Step 1: Write the failing test** — assert that **changing a selector changes the request** (MSW captures the URL) and the query key:
```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/server';
import { accountEnvelope } from '../../test/fixtures';
import { useMetrics } from '../useMetrics';
import { paramsToSearch, searchToParams } from '../../lib/dashboardParams';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: any) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useMetrics', () => {
  it('requests with level/trade_view/active_days_only params and returns the envelope', async () => {
    let url = '';
    server.use(http.get('/api/series/:id/metrics', ({ request }) => {
      url = request.url; return HttpResponse.json(accountEnvelope);
    }));
    const params = { series: 1, level: 'account', trade_view: 'lot', active_days_only: false } as const;
    const { result } = renderHook(() => useMetrics(params), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(url).toContain('level=account');
    expect(url).toContain('trade_view=lot');
    expect(url).toContain('active_days_only=false');
    expect(result.current.data!.meta.level).toBe('account');
  });

  it('changing level changes the outgoing request params (refetch)', async () => {
    const seen: string[] = [];
    server.use(http.get('/api/series/:id/metrics', ({ request }) => {
      seen.push(new URL(request.url).searchParams.get('level')!);
      return HttpResponse.json(accountEnvelope);
    }));
    const { result, rerender } = renderHook(
      ({ p }) => useMetrics(p),
      { wrapper: wrapper(), initialProps: { p: { series: 1, level: 'account', trade_view: 'lot', active_days_only: false } as any } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ p: { series: 1, level: 'strategy', strategy: 'momo-eth', trade_view: 'lot', active_days_only: false } as any });
    await waitFor(() => expect(seen).toContain('strategy'));
    expect(seen).toEqual(expect.arrayContaining(['account', 'strategy']));
  });

  it('round-trips dashboard params through the URL', () => {
    const p = { series: 1, level: 'symbol', strategy: 'momo-eth', symbol: 'ETH-USD',
                from: '2026-01-01', to: '2026-06-18', trade_view: 'position', active_days_only: true } as const;
    expect(searchToParams(paramsToSearch(p))).toEqual(p);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/state/__tests__/useMetrics.test.tsx`
Expected: FAIL — `useMetrics`/`dashboardParams` missing.

- [ ] **Step 3: Write minimal implementation** — `dashboardParams.ts`, `getMetrics`, `useMetrics`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/state/__tests__/useMetrics.test.tsx`
Expected: PASS — 3 tests pass (params present, refetch on level change, URL round-trip).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/metrics.ts frontend/src/state/useMetrics.ts frontend/src/lib/dashboardParams.ts frontend/src/state/__tests__/useMetrics.test.tsx
git commit -m "P7: useMetrics hook + dashboardParams (selector-encoding query key → refetch) [M1]"
```

---

### Task 9: `MetricCard` (+ signed Δ + ▲/▼ in P/L scheme) and `MetricCardGrid`

**Files:**
- Create: `frontend/src/components/MetricCard.tsx`, `frontend/src/components/MetricCardGrid.tsx`
- Test: `frontend/src/components/__tests__/MetricCard.test.tsx`, `frontend/src/components/__tests__/MetricCardGrid.test.tsx`

**Interfaces:**
- Consumes: `lib/format.ts` (formatters + `pnlClassFor`/`glyphFor`), Phase 6 `pnl_color_scheme` store, `RealizedBadge` (Task 13 — for now accept an optional `badge` prop slot), `MetricsBlock` + `units`.
- Produces (Phase 8 reuses both):
  - `MetricCard` props:
    ```ts
    interface MetricCardProps {
      label: string;            // e.g. "Net PnL"
      value: string | null;     // decimal/ratio string from the envelope; null → suppressed
      unit: string;             // from metrics.units[field]: "USD"|"ratio"|"annualized_ratio"|"seconds"|"count"
      baseCurrency: string;     // meta.base_currency — for currency formatting
      isPnl?: boolean;          // when true, value sign drives P/L color + glyph
      delta?: string | null;    // optional signed delta string (used by Phase 8 comparison)
      lowSample?: boolean;      // adds amber footnote "low sample — interpret with care"
      suppressed?: boolean;     // shows "—" + insufficient-data tooltip
      badge?: React.ReactNode;  // optional RealizedBadge slot
    }
    ```
    Behavior: formats `value` by `unit` (`USD`→`formatCurrency`, `ratio`→`formatRatio`, `annualized_ratio`/`win_rate` percent→`formatPercent`, `seconds`→`formatSeconds`, `count`→integer). When `suppressed || value===null` renders `—`. When `isPnl`, wraps the value in `pnlClassFor(value, scheme)` and appends `glyphFor(sign)`. Reads the scheme from the store (default `red-up`).
  - `MetricCardGrid` props: `{ envelope: MetricsEnvelope }` — picks the card set by `meta.level` (account/strategy = full return-based set; symbol = PnL/trade-stat set, handled fully in Task 14) and maps each metric field to a `MetricCard` using `metrics.units`.

- [ ] **Step 1: Write the failing test** — `MetricCard.test.tsx`:
```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricCard from '../MetricCard';
// helper to set the pnl scheme store; adjust import to the Phase 6 store
import { usePnlScheme } from '../../state/pnlScheme'; // or wherever Phase 6 put it

describe('MetricCard', () => {
  beforeEach(() => usePnlScheme.setState?.({ scheme: 'red-up' }));

  it('formats a PnL value in base currency and appends the gain glyph for a positive value', () => {
    render(<MetricCard label="Net PnL" value="48210.00" unit="USD" baseCurrency="USD" isPnl />);
    const el = screen.getByText(/\$48,210\.00/);
    expect(el).toBeInTheDocument();
    expect(screen.getByText('▲')).toBeInTheDocument();     // gain glyph
    expect(el.className).toContain('text-pnl-gain');        // P/L scheme color class
  });

  it('uses the loss glyph + loss class for a negative PnL value', () => {
    render(<MetricCard label="Max DD" value="-9100.00" unit="USD" baseCurrency="USD" isPnl />);
    expect(screen.getByText('▼')).toBeInTheDocument();
    expect(screen.getByText(/-\$9,100\.00/).className).toContain('text-pnl-loss');
  });

  it('renders a ratio metric as percent and a sharpe as a plain ratio', () => {
    const { rerender } = render(<MetricCard label="TWR" value="0.142" unit="ratio" baseCurrency="USD" />);
    expect(screen.getByText('14.2%')).toBeInTheDocument(); // win_rate/twr style ratio→percent set by unit mapping
    rerender(<MetricCard label="Sharpe" value="1.84" unit="ratio" baseCurrency="USD" />);
    expect(screen.getByText('1.84')).toBeInTheDocument();
  });

  it('shows an em dash and no number when suppressed', () => {
    render(<MetricCard label="Sharpe" value={null} unit="ratio" baseCurrency="USD" suppressed />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an amber low-sample footnote when lowSample', () => {
    render(<MetricCard label="Sharpe" value="1.10" unit="ratio" baseCurrency="USD" lowSample />);
    expect(screen.getByText(/low sample/i)).toBeInTheDocument();
  });

  it('formats avg holding seconds as h/m', () => {
    render(<MetricCard label="Avg hold" value="11520" unit="seconds" baseCurrency="USD" />);
    expect(screen.getByText('3h 12m')).toBeInTheDocument();
  });
});
```
> Note on TWR vs Sharpe both having `unit: "ratio"`: the percent-vs-ratio distinction is a **display** choice keyed on the field, not the unit. Implement `MetricCardGrid` to pass a `display: 'percent'|'ratio'` hint for return-style fields (twr/cagr/win_rate/volatility → percent; sharpe/sortino/calmar/profit_factor/payoff → ratio). Adjust the third test to pass that hint, or split units in the envelope contract; keep the assertion that the **value comes from the prop**, never computed.

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/MetricCard.test.tsx`
Expected: FAIL — `MetricCard` missing.

- [ ] **Step 3: Write minimal implementation** — `MetricCard` (format by unit/display hint, P/L color+glyph via store, suppressed `—`, low-sample footnote) and `MetricCardGrid` (maps account/strategy fields → cards; symbol handled in Task 14).

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/MetricCard.test.tsx src/components/__tests__/MetricCardGrid.test.tsx`
Expected: PASS — all MetricCard + grid tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/MetricCard.tsx frontend/src/components/MetricCardGrid.tsx frontend/src/components/__tests__/MetricCard.test.tsx frontend/src/components/__tests__/MetricCardGrid.test.tsx
git commit -m "P7: MetricCard (currency/percent/ratio format + P/L color+glyph + suppressed/low-sample) + MetricCardGrid [M2]"
```

---

### Task 10: `LevelSelector` + URL sync (account|strategy|symbol)

**Files:**
- Create: `frontend/src/components/LevelSelector.tsx`
- Test: `frontend/src/components/__tests__/LevelSelector.test.tsx`

**Interfaces:**
- Consumes: Radix segmented control / radio group primitive (a11y: `role="radiogroup"`).
- Produces: `LevelSelector({ value, onChange }: { value: Level; onChange(l: Level): void })` — three options Account/Strategy/Symbol as an arrow-navigable radio group; `aria-checked` on the active option. (URL wiring lives in `DashboardPage`, Task 16; this task proves the control + accessibility + callback.)

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LevelSelector from '../LevelSelector';

describe('LevelSelector', () => {
  it('marks the active level and fires onChange on selection', async () => {
    const onChange = vi.fn();
    render(<LevelSelector value="account" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: /level/i });
    expect(group).toBeInTheDocument();
    const account = screen.getByRole('radio', { name: /account/i });
    expect(account).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /symbol/i }));
    expect(onChange).toHaveBeenCalledWith('symbol');
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/LevelSelector.test.tsx`
Expected: FAIL — `LevelSelector` missing.

- [ ] **Step 3: Write minimal implementation** — Radix radio-group-based segmented control; `aria-checked` on active; arrow-key navigation; calls `onChange`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/LevelSelector.test.tsx`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/LevelSelector.tsx frontend/src/components/__tests__/LevelSelector.test.tsx
git commit -m "P7: LevelSelector (accessible segmented radio group)"
```

---

### Task 11: `DateRangePicker` (presets + inclusive boundaries)

**Files:**
- Create: `frontend/src/components/DateRangePicker.tsx`
- Test: `frontend/src/components/__tests__/DateRangePicker.test.tsx`

**Interfaces:**
- Consumes: Radix popover primitive (Phase 6).
- Produces: `DateRangePicker({ from, to, onChange }: { from?: string; to?: string; onChange(range: { from?: string; to?: string }): void })` — `from`/`to` date inputs + preset buttons (1M / 3M / YTD / All). Selecting a preset computes the date strings **from the current date only** (calendar arithmetic for presets is presentation/navigation, not financial computation) and calls `onChange`. "All" clears `from`/`to` (backend treats absent bounds as full range). Boundaries are inclusive-start/inclusive-end (passed straight through as `date_from`/`date_to`).

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateRangePicker from '../DateRangePicker';

describe('DateRangePicker', () => {
  it('emits the typed from/to range', async () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-01-01" to="2026-06-18" onChange={onChange} />);
    const from = screen.getByLabelText(/from/i) as HTMLInputElement;
    expect(from.value).toBe('2026-01-01');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-02-01');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-02-01' }));
  });

  it('clears the range when the "All" preset is chosen', async () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-01-01" to="2026-06-18" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/DateRangePicker.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — inputs + preset buttons; presets compute date strings via `Date` arithmetic; "All" emits cleared bounds.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/DateRangePicker.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/DateRangePicker.tsx frontend/src/components/__tests__/DateRangePicker.test.tsx
git commit -m "P7: DateRangePicker (presets + inclusive boundaries)"
```

---

### Task 12: `TradeViewSelector` + `ActiveDaysToggle`

**Files:**
- Create: `frontend/src/components/TradeViewSelector.tsx`, `frontend/src/components/ActiveDaysToggle.tsx`
- Test: `frontend/src/components/__tests__/TradeViewSelector.test.tsx`, `frontend/src/components/__tests__/ActiveDaysToggle.test.tsx`

**Interfaces:**
- Consumes: Radix radio group / switch primitives.
- Produces:
  - `TradeViewSelector({ value, onChange }: { value: TradeView; onChange(v: TradeView): void })` — Per-lot / Per-position radio group → `trade_view`.
  - `ActiveDaysToggle({ value, onChange }: { value: boolean; onChange(v: boolean): void })` — switch for `active_days_only`; `role="switch"` + `aria-checked`.

- [ ] **Step 1: Write the failing test** — `TradeViewSelector.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TradeViewSelector from '../TradeViewSelector';

describe('TradeViewSelector', () => {
  it('shows the active trade view and fires onChange', async () => {
    const onChange = vi.fn();
    render(<TradeViewSelector value="lot" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /per-lot/i })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /per-position/i }));
    expect(onChange).toHaveBeenCalledWith('position');
  });
});
```
`ActiveDaysToggle.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActiveDaysToggle from '../ActiveDaysToggle';

describe('ActiveDaysToggle', () => {
  it('reflects state and toggles', async () => {
    const onChange = vi.fn();
    render(<ActiveDaysToggle value={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /active days/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/TradeViewSelector.test.tsx src/components/__tests__/ActiveDaysToggle.test.tsx`
Expected: FAIL — components missing.

- [ ] **Step 3: Write minimal implementation** — both controls.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/TradeViewSelector.test.tsx src/components/__tests__/ActiveDaysToggle.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/TradeViewSelector.tsx frontend/src/components/ActiveDaysToggle.tsx frontend/src/components/__tests__/TradeViewSelector.test.tsx frontend/src/components/__tests__/ActiveDaysToggle.test.tsx
git commit -m "P7: TradeViewSelector + ActiveDaysToggle (drive trade_view / active_days_only)"
```

---

### Task 13: `EquityChart` (stepped) + Absolute/Indexed toggle

**Files:**
- Create: `frontend/src/components/EquityChart.tsx`
- Test: `frontend/src/components/__tests__/EquityChart.test.tsx`

**Interfaces:**
- Consumes: Recharts `LineChart`/`Line` (`type="stepAfter"`), `EquityPoint[]`, theme + P/L tokens, `RealizedBadge` (Task 15 slot — accept a `badge` prop).
- Produces (Phase 8 reuses, adding overlay mode):
  - `EquityChart({ points, baseCurrency, mode, onModeChange }: { points: EquityPoint[]; baseCurrency: string; mode: 'absolute'|'indexed'; onModeChange(m): void })`.
  - Renders a stepped line. In `absolute` mode the plotted series is `points[].realized_pnl`; in `indexed` mode it is `points[].indexed_return`. The Absolute/Indexed toggle calls `onModeChange`. **The component never computes the index** — it selects which backend field to read. Exposes the active series + dataKey via `data-*` attributes / test ids so the test can assert which field drives the chart without depending on Recharts' SVG internals.

> Recharts rendering in jsdom is unreliable for pixel assertions. Assert on (a) the toggle calling `onModeChange`, and (b) a `data-series-key` attribute the component sets to `'realized_pnl'` or `'indexed_return'` based on `mode`, and (c) that the value passed to the chart equals the corresponding field from `points` (e.g. render a hidden `<span data-testid="first-y">` with the first point's selected value, read straight from props). This keeps the test about *data selection*, not Recharts.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EquityChart from '../EquityChart';

const points = [
  { ts: '2026-01-02T20:00:00Z', realized_pnl: '320.00', indexed_return: '0.0032' },
  { ts: '2026-01-03T20:00:00Z', realized_pnl: '540.00', indexed_return: '0.0054' },
];

describe('EquityChart', () => {
  it('plots the realized_pnl series in absolute mode', () => {
    render(<EquityChart points={points} baseCurrency="USD" mode="absolute" onModeChange={() => {}} />);
    expect(screen.getByTestId('equity-series-key')).toHaveTextContent('realized_pnl');
    // value is read straight from the prop, never computed
    expect(screen.getByTestId('equity-first-y')).toHaveTextContent('320.00');
  });

  it('plots the indexed_return series in indexed mode', () => {
    render(<EquityChart points={points} baseCurrency="USD" mode="indexed" onModeChange={() => {}} />);
    expect(screen.getByTestId('equity-series-key')).toHaveTextContent('indexed_return');
    expect(screen.getByTestId('equity-first-y')).toHaveTextContent('0.0032');
  });

  it('calls onModeChange when the Indexed toggle is pressed', async () => {
    const onModeChange = vi.fn();
    render(<EquityChart points={points} baseCurrency="USD" mode="absolute" onModeChange={onModeChange} />);
    await userEvent.click(screen.getByRole('button', { name: /indexed/i }));
    expect(onModeChange).toHaveBeenCalledWith('indexed');
  });

  it('uses a stepped line geometry (stepAfter)', () => {
    render(<EquityChart points={points} baseCurrency="USD" mode="absolute" onModeChange={() => {}} />);
    expect(screen.getByTestId('equity-line-type')).toHaveTextContent('stepAfter');
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/EquityChart.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — chart wrapped in `ResponsiveContainer`; `Line type="stepAfter"`; the data array maps each point to `{ ts, y: mode==='absolute' ? realized_pnl : indexed_return }`; emit the `data-testid` hooks (`equity-series-key`, `equity-first-y`, `equity-line-type`); Absolute/Indexed toggle buttons.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/EquityChart.test.tsx`
Expected: PASS — 4 tests pass (absolute series, indexed series, toggle callback, stepped type).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/EquityChart.tsx frontend/src/components/__tests__/EquityChart.test.tsx
git commit -m "P7: EquityChart (stepped line + Absolute/Indexed toggle reads equity_curve fields, no recompute) [M2]"
```

---

### Task 14: `DrawdownChart` (below-zero area + max-DD marker)

**Files:**
- Create: `frontend/src/components/DrawdownChart.tsx`
- Test: `frontend/src/components/__tests__/DrawdownChart.test.tsx`

**Interfaces:**
- Consumes: Recharts `AreaChart`/`Area`, `DrawdownPoint[]`, `drawdown/fill` token, `RealizedBadge` slot.
- Produces: `DrawdownChart({ points, baseCurrency, maxDrawdown }: { points: DrawdownPoint[]; baseCurrency: string; maxDrawdown: string })` — area anchored at a 0 baseline filling downward (values ≤ 0 from `points[].drawdown`); annotates the trough with a `Max DD <formatted maxDrawdown>` label + `▼`. The max-DD value is passed in from the envelope (`metrics.max_drawdown`), **not** derived from the series.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DrawdownChart from '../DrawdownChart';

const points = [
  { ts: '2026-01-02T20:00:00Z', drawdown: '0.00', drawdown_pct: '0.0' },
  { ts: '2026-01-05T20:00:00Z', drawdown: '-9100.00', drawdown_pct: '-0.09' },
];

describe('DrawdownChart', () => {
  it('renders an area anchored at zero, filling downward', () => {
    render(<DrawdownChart points={points} baseCurrency="USD" maxDrawdown="-9100.00" />);
    expect(screen.getByTestId('drawdown-baseline')).toHaveTextContent('0');
    expect(screen.getByTestId('drawdown-series-key')).toHaveTextContent('drawdown');
  });

  it('labels the max drawdown from the envelope value (not computed) with a down glyph', () => {
    render(<DrawdownChart points={points} baseCurrency="USD" maxDrawdown="-9100.00" />);
    expect(screen.getByText(/max dd/i)).toHaveTextContent(/-\$9,100\.00/);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/DrawdownChart.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — area chart with baseline 0, `data-testid` hooks, max-DD label from prop + `formatCurrency`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/DrawdownChart.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/DrawdownChart.tsx frontend/src/components/__tests__/DrawdownChart.test.tsx
git commit -m "P7: DrawdownChart (below-zero area + max-DD marker from envelope) [M2]"
```

---

### Task 15: `RealizedBadge` + Max-DD caveat (open_positions_exist)

**Files:**
- Create: `frontend/src/components/RealizedBadge.tsx`
- Modify: `frontend/src/components/EquityChart.tsx`, `DrawdownChart.tsx`, `MetricCard.tsx` (wire the badge slot)
- Test: `frontend/src/components/__tests__/RealizedBadge.test.tsx`

**Interfaces:**
- Consumes: `info` + `warning` tokens; Radix tooltip.
- Produces: `RealizedBadge({ variant }: { variant?: 'pill' | 'maxdd-caveat' })`:
  - `'pill'` (default): a small `info`-colored "REALIZED" pill with tooltip *"Cumulative realized PnL only. Open positions are not marked to market; unrealized swings are not shown."*
  - `'maxdd-caveat'`: a stronger amber `warning` note *"Drawdown reflects closed trades only; open-position risk is not captured."* — rendered next to Max DD only when `flags.open_positions_exist`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RealizedBadge from '../RealizedBadge';

describe('RealizedBadge', () => {
  it('renders the REALIZED pill', () => {
    render(<RealizedBadge />);
    expect(screen.getByText(/realized/i)).toBeInTheDocument();
  });

  it('renders the stronger max-DD caveat variant', () => {
    render(<RealizedBadge variant="maxdd-caveat" />);
    expect(screen.getByText(/open-position risk is not captured/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/RealizedBadge.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — badge with both variants; wire the `badge` slot into `EquityChart`/`DrawdownChart` headers and the Net PnL `MetricCard`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/RealizedBadge.test.tsx`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/RealizedBadge.tsx frontend/src/components/EquityChart.tsx frontend/src/components/DrawdownChart.tsx frontend/src/components/MetricCard.tsx frontend/src/components/__tests__/RealizedBadge.test.tsx
git commit -m "P7: RealizedBadge (pill + max-DD open-positions caveat) wired into charts/cards [M3]"
```

---

### Task 16: Symbol-level hiding + `ContributionCard`

**Files:**
- Create: `frontend/src/components/ContributionCard.tsx`
- Modify: `frontend/src/components/MetricCardGrid.tsx`
- Test: `frontend/src/components/__tests__/ContributionCard.test.tsx`, `frontend/src/components/__tests__/MetricCardGrid.symbol.test.tsx`

**Interfaces:**
- Consumes: `MetricsEnvelope` with `meta.level==='symbol'` (return fields null, `metrics.contribution_pct` set).
- Produces:
  - `ContributionCard({ contributionPct, strategyName }: { contributionPct: string; strategyName: string })` — renders e.g. "ETH-USD = 38% of momo-eth PnL" with a tiny inline bar; percent via `formatPercent`.
  - `MetricCardGrid` symbol behavior: when `meta.level==='symbol'`, render PnL/trade-stat cards (net/gross PnL, fees, win rate, avg win/loss, profit factor, payoff, expectancy, hold, count) **plus** `ContributionCard`, and **omit** TWR/CAGR/vol/Sharpe/Sortino/Calmar/Max DD/α/β/IR. A muted note: *"Symbols have no capital base, so return%/Sharpe don't apply."* The decision is driven purely by `meta.level` — never by inspecting whether values are null.

- [ ] **Step 1: Write the failing test** — `MetricCardGrid.symbol.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricCardGrid from '../MetricCardGrid';
import { symbolEnvelope, accountEnvelope } from '../../test/fixtures';

describe('MetricCardGrid symbol-level hiding (M4)', () => {
  it('omits return-based cards and shows contribution at symbol level', () => {
    render(<MetricCardGrid envelope={symbolEnvelope} />);
    // return-based metrics must NOT be present
    expect(screen.queryByText(/sharpe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^TWR$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/calmar/i)).not.toBeInTheDocument();
    // PnL + contribution present
    expect(screen.getByText(/net pnl/i)).toBeInTheDocument();
    expect(screen.getByText(/contribution/i)).toBeInTheDocument();
    expect(screen.getByText(/no capital base/i)).toBeInTheDocument();
  });

  it('shows Sharpe and return-based cards at account level', () => {
    render(<MetricCardGrid envelope={accountEnvelope} />);
    expect(screen.getByText(/sharpe/i)).toBeInTheDocument();
  });
});
```
`ContributionCard.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContributionCard from '../ContributionCard';

describe('ContributionCard', () => {
  it('renders the contribution percent from the envelope', () => {
    render(<ContributionCard contributionPct="0.38" strategyName="momo-eth" />);
    expect(screen.getByText(/38%/)).toBeInTheDocument();
    expect(screen.getByText(/momo-eth/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/ContributionCard.test.tsx src/components/__tests__/MetricCardGrid.symbol.test.tsx`
Expected: FAIL — `ContributionCard` missing / grid does not branch on level.

- [ ] **Step 3: Write minimal implementation** — `ContributionCard` + the level branch in `MetricCardGrid`.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/ContributionCard.test.tsx src/components/__tests__/MetricCardGrid.symbol.test.tsx`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/ContributionCard.tsx frontend/src/components/MetricCardGrid.tsx frontend/src/components/__tests__/ContributionCard.test.tsx frontend/src/components/__tests__/MetricCardGrid.symbol.test.tsx
git commit -m "P7: symbol-level hiding (no return%/Sharpe) + ContributionCard [M4]"
```

---

### Task 17: `TradeStatsTable`

**Files:**
- Create: `frontend/src/components/TradeStatsTable.tsx`
- Test: `frontend/src/components/__tests__/TradeStatsTable.test.tsx`

**Interfaces:**
- Consumes: `MetricsBlock` (win_rate, avg win/loss via largest/avg fields, profit factor, payoff, expectancy, consec, avg_holding_secs, trade_count) + `units`.
- Produces: `TradeStatsTable({ metrics, units, baseCurrency }: { metrics: MetricsBlock; units: Record<string,string>; baseCurrency: string })` — a table of trade stats formatted by unit; numeric cells Fira Code tabular. All values read from props, none computed.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TradeStatsTable from '../TradeStatsTable';
import { accountEnvelope } from '../../test/fixtures';

describe('TradeStatsTable', () => {
  it('renders win rate, profit factor, expectancy and trade count from the envelope', () => {
    const { metrics } = accountEnvelope;
    render(<TradeStatsTable metrics={metrics} units={metrics.units} baseCurrency="USD" />);
    expect(screen.getByText('57.2%')).toBeInTheDocument();         // win_rate ratio→percent
    expect(screen.getByText('1.92')).toBeInTheDocument();          // profit_factor ratio
    expect(screen.getByText(/\$184\.00/)).toBeInTheDocument();     // expectancy USD
    expect(screen.getByText('1,204')).toBeInTheDocument();         // trade_count count
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/components/__tests__/TradeStatsTable.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation** — table formatting each field by its `units` entry (with the percent/ratio display hint from Task 9).

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/components/__tests__/TradeStatsTable.test.tsx`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/TradeStatsTable.tsx frontend/src/components/__tests__/TradeStatsTable.test.tsx
git commit -m "P7: TradeStatsTable (all values read from envelope)"
```

---

### Task 18: `DashboardPage` assembly — URL state + flag-driven states (loading/empty/error, low_sample/sharpe_suppressed/fx_missing)

**Files:**
- Create: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/components/FlagBanners.tsx`, `frontend/src/routes.tsx`
- Test: `frontend/src/pages/__tests__/DashboardPage.test.tsx`, `frontend/src/pages/__tests__/DashboardPage.flags.test.tsx`, `frontend/src/pages/__tests__/DashboardPage.url.test.tsx`

**Interfaces:**
- Consumes: everything above — `useMetrics`, `useSeriesList` (for the picker), `SeriesPicker` (single-select), `LevelSelector`, `TradeViewSelector`, `ActiveDaysToggle`, `DateRangePicker`, `MetricCardGrid`, `EquityChart`, `DrawdownChart`, `TradeStatsTable`, `RealizedBadge`, `FxMissingBanner`, `SkeletonCard`/`SkeletonChart`, `EmptyState`, `AlertBanner`, `dashboardParams`.
- Produces: `DashboardPage` — sticky controls bar; reads/writes selector state in the URL (`?series=&level=&strategy=&symbol=&from=&to=&trade_view=&active_days_only=`) via `useSearchParams` + `dashboardParams`; conditional strategy/symbol dropdowns (strategy at strategy/symbol; symbol at symbol); on `meta.flags` renders: low-sample footnotes (Task 9), suppressed Sharpe/Sortino/Calmar `—` (`flags.sharpe_suppressed`), `FxMissingBanner` (`flags.fx_missing`), max-DD caveat (`flags.open_positions_exist`); loading→skeletons, empty (no realized trades)→centered message + `—` cards, error→`AlertBanner role="alert"` + Retry. At account/strategy shows charts; at symbol hides charts (Task 16). Charts/cards consume `useMetrics(params)`.

- [ ] **Step 1: Write the failing test** — `DashboardPage.flags.test.tsx` (the keystone flag-driven assertions):
```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import { makeEnvelope, symbolEnvelope } from '../../test/fixtures';
import DashboardPage from '../DashboardPage';

function renderDash(initial = '/dashboard?series=1&level=account') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}><DashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage flag-driven states (M3/M4/M5)', () => {
  it('renders the RealizedBadge when flags.realized_only is true', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({ meta: { flags: { realized_only: true } } }))));
    renderDash();
    expect((await screen.findAllByText(/realized/i)).length).toBeGreaterThan(0);
  });

  it('shows "—" for Sharpe when flags.sharpe_suppressed is true', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({
        meta: { flags: { sharpe_suppressed: true } },
        metrics: { sharpe: null, sortino: null, calmar: null },
      }))));
    renderDash();
    const sharpe = (await screen.findByText(/sharpe/i)).closest('[data-card]')!;
    expect(sharpe).toHaveTextContent('—');
  });

  it('shows the amber fx_missing banner when flags.fx_missing is true', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({ meta: { flags: { fx_missing: true } } }))));
    renderDash();
    expect(await screen.findByText(/missing fx/i)).toBeInTheDocument();
  });

  it('shows the stronger Max-DD caveat when flags.open_positions_exist', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({ meta: { flags: { open_positions_exist: true } } }))));
    renderDash();
    expect(await screen.findByText(/open-position risk is not captured/i)).toBeInTheDocument();
  });

  it('at symbol level hides the equity chart and Sharpe, shows contribution', async () => {
    server.use(http.get('/api/series/:id/metrics', () => HttpResponse.json(symbolEnvelope)));
    renderDash('/dashboard?series=1&level=symbol&strategy=momo-eth&symbol=ETH-USD');
    await screen.findByText(/contribution/i);
    expect(screen.queryByTestId('equity-series-key')).not.toBeInTheDocument(); // EquityChart not rendered
    expect(screen.queryByText(/sharpe/i)).not.toBeInTheDocument();
  });

  it('shows a low-sample footnote when flags.low_sample', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({ meta: { flags: { low_sample: true } } }))));
    renderDash();
    expect((await screen.findAllByText(/low sample/i)).length).toBeGreaterThan(0);
  });
});
```
`DashboardPage.url.test.tsx` (URL sync + refetch on selector change):
```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import { accountEnvelope, strategyEnvelope } from '../../test/fixtures';
import DashboardPage from '../DashboardPage';

describe('DashboardPage URL state + refetch (M1)', () => {
  it('refetches with the new level when LevelSelector changes', async () => {
    const levels: string[] = [];
    server.use(http.get('/api/series/:id/metrics', ({ request }) => {
      const lvl = new URL(request.url).searchParams.get('level')!;
      levels.push(lvl);
      return HttpResponse.json(lvl === 'strategy' ? strategyEnvelope : accountEnvelope);
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard?series=1&level=account']}><DashboardPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(levels).toContain('account'));
    await userEvent.click(screen.getByRole('radio', { name: /strategy/i }));
    await waitFor(() => expect(levels).toContain('strategy'));
  });
});
```
`DashboardPage.test.tsx` (loading + empty + error):
```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import { makeEnvelope } from '../../test/fixtures';
import DashboardPage from '../DashboardPage';

function renderDash(initial = '/dashboard?series=1&level=account') { /* wrapper as above */ }

describe('DashboardPage loading/empty/error (M5)', () => {
  it('shows skeletons while loading', async () => {
    server.use(http.get('/api/series/:id/metrics', async () => { await delay(50); return HttpResponse.json(makeEnvelope({})); }));
    renderDash();
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });

  it('shows an empty message when there are no realized trades in range', async () => {
    server.use(http.get('/api/series/:id/metrics', () =>
      HttpResponse.json(makeEnvelope({ meta: { sample: { round_trips: 0, active_days: 0 } }, equity_curve: [], drawdown_series: [] }))));
    renderDash();
    expect(await screen.findByText(/no realized trades/i)).toBeInTheDocument();
  });

  it('shows an error banner with retry on failure', async () => {
    server.use(http.get('/api/series/:id/metrics', () => HttpResponse.json({ error: { code: 'x', message: 'boom' } }, { status: 500 })));
    renderDash();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd frontend && npx vitest run src/pages/__tests__/DashboardPage.flags.test.tsx src/pages/__tests__/DashboardPage.url.test.tsx src/pages/__tests__/DashboardPage.test.tsx`
Expected: FAIL — `DashboardPage` missing.

- [ ] **Step 3: Write minimal implementation** — assemble the page: controls bar wired to URL params (`useSearchParams` + `dashboardParams`), `useMetrics(params)`, conditional strategy/symbol dropdowns, `MetricCardGrid`/charts/table, `FlagBanners`, skeleton/empty/error states; `FxMissingBanner` in `FlagBanners.tsx`. Decisions driven by `meta.level` and `meta.flags`. Register `/dashboard` route.

- [ ] **Step 4: Run to verify it passes**
Run: `cd frontend && npx vitest run src/pages/__tests__/DashboardPage.flags.test.tsx src/pages/__tests__/DashboardPage.url.test.tsx src/pages/__tests__/DashboardPage.test.tsx`
Expected: PASS — all DashboardPage tests pass (realized badge, suppressed `—`, fx banner, max-DD caveat, symbol hiding, low-sample, refetch-on-level, loading/empty/error).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/components/FlagBanners.tsx frontend/src/routes.tsx frontend/src/pages/__tests__/DashboardPage.flags.test.tsx frontend/src/pages/__tests__/DashboardPage.url.test.tsx frontend/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "P7: DashboardPage assembly — URL-synced selectors + flag-driven states (loading/empty/error, low_sample/suppressed/fx_missing) [M1/M2/M3/M5]"
```

---

### Task 19: Phase 7 acceptance-gate verification (full green run)

**Files:**
- Modify: none (verification + any small fixes surfaced).

**Interfaces:**
- Consumes: everything above.
- Produces: a recorded, reproducible pass of the full Phase 7 frontend gate.

- [ ] **Step 1: Full test suite**
Run: `cd frontend && npx vitest run`
Expected: PASS — every Phase 7 spec green (format, SeriesListPage list/create, CompareTray, SeriesDetailPage, InstrumentReviewPanel, FxRatesPanel, useMetrics, MetricCard/Grid, LevelSelector, DateRangePicker, TradeViewSelector, ActiveDaysToggle, EquityChart, DrawdownChart, RealizedBadge, ContributionCard, TradeStatsTable, DashboardPage flags/url/states), plus all Phase 6 suites still green.

- [ ] **Step 2: Lint + build**
Run: `cd frontend && npm run lint && npm run build`
Expected: PASS — ESLint clean; `tsc` + Vite build succeed (types in `lib/types.ts` consistent with component props).

- [ ] **Step 3: Thin-frontend audit (manual grep)**
Run: `cd frontend && grep -rnE "reduce\(|\.sum|Math\.(sqrt|pow)|/ *capital|cumulative|drawdown *=|sharpe *=" src/components src/pages src/lib/format.ts || echo "no computation found"`
Expected: no financial aggregation/derivation in components/pages. Formatting-only arithmetic (×100 for percent, locale formatting, preset date math) is allowed; any PnL/Sharpe/drawdown/index computation is a gate failure. (DoD-9 / thin-frontend.)

- [ ] **Step 4: Commit (only if fixes were needed)**
```bash
git add -A
git commit -m "P7: acceptance-gate verification — vitest green, lint+build pass, thin-frontend audit"
```

---

## Self-Review — Phase 7 acceptance-criteria coverage (验收标准 L & M)

Each frontend acceptance criterion maps to the task(s) that satisfy it and the test that proves it:

| Criterion | Requirement | Task(s) | Proving test(s) |
|-----------|-------------|---------|-----------------|
| **L1** | List series with counts (strategies/fills) + ingestion status + base currency | **Task 2** | `SeriesListPage.test.tsx` — asserts counts + `base_currency` read from response; empty + error states |
| **L2** | Create a series; detail page shows strategies + discovered symbols (+ inferred-instrument review) | **Task 3** (create w/ `base_currency`+`session_tz`), **Task 5** (detail strategies+symbols), **Task 6** (InstrumentReviewPanel) | `SeriesListPage.create.test.tsx`, `SeriesDetailPage.test.tsx`, `InstrumentReviewPanel.test.tsx` |
| **M1** | series/level/date/trade_view/active_days selectors; changing them refetches | **Task 8** (query-key refetch), **Tasks 10–12** (selectors), **Task 18** (URL wiring + refetch) | `useMetrics.test.tsx` (refetch on level change), `LevelSelector`/`DateRangePicker`/`TradeViewSelector`/`ActiveDaysToggle` tests, `DashboardPage.url.test.tsx` |
| **M2** | metric cards (incl. TWR/CAGR/vol/Calmar/expectancy); equity + drawdown charts at account/strategy; units/flags from backend, frontend doesn't compute | **Task 9** (MetricCard/Grid), **Task 13** (EquityChart), **Task 14** (DrawdownChart), **Task 17** (TradeStatsTable) | `MetricCard.test.tsx`, `MetricCardGrid.test.tsx`, `EquityChart.test.tsx` (reads `realized_pnl`/`indexed_return`), `DrawdownChart.test.tsx`, `TradeStatsTable.test.tsx` |
| **M3** | "realized" labeling everywhere; stronger Max-DD caveat when `open_positions_exist` | **Task 15** (RealizedBadge + caveat), wired in **Task 18** | `RealizedBadge.test.tsx`, `DashboardPage.flags.test.tsx` (realized_only → badge; open_positions_exist → caveat) |
| **M4** | symbol level hides return%/Sharpe + charts, shows contribution | **Task 16** (symbol hiding + ContributionCard), **Task 18** (charts hidden at symbol) | `MetricCardGrid.symbol.test.tsx`, `ContributionCard.test.tsx`, `DashboardPage.flags.test.tsx` (symbol level: no equity chart, no Sharpe, contribution present) |
| **M5** | loading/empty/error; `low_sample`/`sharpe_suppressed`(value "—")/`fx_missing` driven by flags | **Task 9** (low-sample footnote, suppressed `—`), **Task 18** (loading/empty/error + FxMissingBanner) | `DashboardPage.flags.test.tsx` (sharpe_suppressed → `—`, fx_missing → amber banner, low_sample → footnote), `DashboardPage.test.tsx` (skeleton, empty, error+retry) |

**Thin-frontend (DoD-9) enforcement:** Task 1's `format.ts` is the only place numeric strings are touched, and only for locale/currency/percent formatting + sign→color/glyph mapping. Every chart/card/badge/hide decision reads a backend field (`equity_curve[].realized_pnl`/`indexed_return`, `metrics.*`, `meta.level`, `meta.flags.*`) — never a recomputed value: `EquityChart` *selects* a backend series for the Absolute/Indexed toggle (Task 13), `DrawdownChart` *labels* the envelope's `max_drawdown` (Task 14), symbol hiding keys on `meta.level` (Task 16), and suppression/low-sample/fx-missing key on `meta.flags.*` (Tasks 9, 18). Task 19 Step 3 adds a grep audit as a backstop. Currency formatting always uses `meta.base_currency`; P/L color + glyph always use the active `pnl_color_scheme` (default `red-up`) via `pnlClassFor`/`glyphFor` — proven in `MetricCard.test.tsx`.

**Suggested-order conformance:** the task sequence follows the requested order — (1) useSeries+list+create → (2) compare tray + currency mismatch → (3) detail strategies/symbols → (4) InstrumentReviewPanel → (5) FxRatesPanel → (6) useMetrics → (7) MetricCard/Grid → (8) LevelSelector+URL → (9) DateRangePicker → (10) TradeViewSelector+active-days → (11) EquityChart+toggle → (12) DrawdownChart+marker → (13) RealizedBadge+Max-DD caveat → (14) symbol hiding+ContributionCard → (15) TradeStatsTable → (16) loading/empty/error + flag states + DashboardPage assembly + URL state. (Tasks are renumbered 1–19 here with the test harness as Task 1 and the gate run as Task 19.)