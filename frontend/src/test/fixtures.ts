import type {
  EquityPoint, DrawdownPoint, FlagsBlock, MetaBlock, MetricsBlock,
  MetricsEnvelope, SeriesDetail, SeriesSummary,
} from "../lib/types";

export function makeEnvelope(overrides: Partial<{
  meta: Partial<MetaBlock & { flags: Partial<FlagsBlock> }>;
  metrics: Partial<MetricsBlock>;
  equity_curve: Partial<EquityPoint>[];
  drawdown_series: Partial<DrawdownPoint>[];
}> = {}): MetricsEnvelope {
  const defaultFlags: FlagsBlock = {
    realized_only: true, low_sample: false, sharpe_suppressed: false,
    fx_missing: false, open_positions_exist: false,
  };
  const flags = { ...defaultFlags, ...overrides.meta?.flags };

  return {
    meta: {
      level: "account", base_currency: "USD", session_tz: "America/New_York",
      date_range: { from: "2026-01-01", to: "2026-06-18" },
      capital_base: "100000.00",
      sample: { round_trips: 142, active_days: 88 },
      flags,
      ...overrides.meta,
    },
    metrics: {
      net_pnl: "48210.00", gross_pnl: "50140.00", total_fees: "1930.00",
      fees_on_open_positions: "120.00",
      twr: "0.142", cagr: "0.118", volatility: "0.094",
      sharpe: "1.84", sortino: "2.40", calmar: "1.31",
      max_drawdown: "-9100.00",
      win_rate: "0.572", profit_factor: "1.92", payoff_ratio: "1.93",
      expectancy: "184.00", max_consec_wins: 7, max_consec_losses: 4,
      largest_win: "4100.00", largest_loss: "-2000.00",
      avg_holding_secs: 11520, trade_count: 1204,
      contribution_pct: null,
      concentration_curve: [],
      loss_concentration_curve: [],
      alpha: null, beta: null, information_ratio: null,
      units: {
        net_pnl: "USD", gross_pnl: "USD", total_fees: "USD", fees_on_open_positions: "USD",
        twr: "ratio", cagr: "ratio", volatility: "annualized_ratio",
        sharpe: "ratio", sortino: "ratio", calmar: "ratio", max_drawdown: "USD",
        win_rate: "ratio", profit_factor: "ratio", payoff_ratio: "ratio",
        expectancy: "USD", max_consec_wins: "count", max_consec_losses: "count",
        largest_win: "USD", largest_loss: "USD",
        avg_holding_secs: "seconds", trade_count: "count",
      },
      ...overrides.metrics,
    },
    equity_curve: [{ ts: "2026-01-02T20:00:00Z", realized_pnl: "320.00", indexed_return: "0.0032" }],
    drawdown_series: [{ ts: "2026-01-02T20:00:00Z", drawdown: "0.00", drawdown_pct: "0.0" }],
    symbol_contributions: [],
  };
}

export const accountEnvelope = makeEnvelope();

export const strategyEnvelope = makeEnvelope({
  meta: { level: "strategy", strategy: "momo-eth" },
});

export const symbolEnvelope = makeEnvelope({
  meta: { level: "symbol", strategy: "momo-eth", symbol: "ETH-USD", capital_base: null },
  metrics: {
    twr: null, cagr: null, volatility: null,
    sharpe: null, sortino: null, calmar: null, max_drawdown: null,
    contribution_pct: "0.35",
  },
});

export const seriesList: SeriesSummary[] = [
  { id: 1, name: "Alpha-Real", tag: "real", base_currency: "USD", created_at: "2026-01-01T00:00:00Z", counts: { strategies: 4, fills: 4200 }, last_ingest_at: "2026-06-18T20:00:00Z" },
  { id: 2, name: "Alpha-Sim", tag: "sim", base_currency: "USD", created_at: "2026-01-01T00:00:00Z", counts: { strategies: 4, fills: 4100 }, last_ingest_at: "2026-06-18T20:00:00Z" },
];

export const seriesDetail: SeriesDetail = {
  id: 1, name: "Alpha-Real", tag: "real", base_currency: "USD", session_tz: "America/New_York",
  created_at: "2026-01-01T00:00:00Z",
  strategies: [
    { id: 1, name: "momentum-equity", name_key: "momentum-equity", fills: 1200 },
    { id: 2, name: "mean-rev-crypto", name_key: "mean-rev-crypto", fills: 800 },
  ],
  symbols: ["ES", "NQ", "BTC-USD", "ETH-USD"],
  instruments: [
    { symbol: "ES", asset_class: "future", multiplier: "50.000000000000", currency: "USD", inferred: false },
    { symbol: "NQ", asset_class: "future", multiplier: "20.000000000000", currency: "USD", inferred: false },
    { symbol: "BTC-USD", asset_class: "crypto", multiplier: "1.000000000000", currency: "USD", inferred: true },
    { symbol: "ETH-USD", asset_class: "crypto", multiplier: "1.000000000000", currency: "USD", inferred: true },
  ],
};
