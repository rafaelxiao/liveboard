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
  per_trade: {
    page: 1, page_size: 500, total: 2,
    rows: [
      { ts: "2026-06-12T13:31:00Z", symbol: "ETH-USD", side: "buy", name_key: "test-strategy",
        values: { "1": { price: "3012.5", qty: "1", total_fee: "0.20", ts: "2026-06-12T13:31:00Z" },
                  "2": { price: "3010.0", qty: "1", total_fee: "0.10", ts: "2026-06-12T13:31:04Z" } },
        diff: { price_slippage: "2.50", price_slippage_pct: "0.0008", timing_sec: 4,
                qty_diff: "0", fee_diff: "0.10" } },
      { ts: "2026-06-12T15:02:00Z", symbol: "BTC-USD", side: "sell", name_key: "test-strategy",
        values: { "1": { price: "61000", qty: "0.5", total_fee: "1.00", ts: "2026-06-12T15:02:00Z" },
                  "2": { price: "61020", qty: "0.5", total_fee: "1.00", ts: "2026-06-12T15:02:10Z" } },
        diff: { price_slippage: "-20.00", price_slippage_pct: "-0.00033", timing_sec: 10,
                qty_diff: "0", fee_diff: "0.00" } },
    ],
    unmatched: {},
  },
  equity_curves: [],
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
