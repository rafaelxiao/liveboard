import { describe, it, expect } from "vitest";
import { comparison2Series, comparison3SeriesBaseline, comparisonCurrencyMismatch,
         comparisonUnmatched } from "./comparison";

describe("comparison fixtures", () => {
  it("2-series fixture has two account series and baseline-signed diffs", () => {
    expect(comparison2Series.account.series).toHaveLength(2);
    const row = comparison2Series.per_trade.rows[0];
    expect(row.diff).toHaveProperty("price_slippage");
    expect(typeof row.diff.price_slippage).toBe("string");
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
