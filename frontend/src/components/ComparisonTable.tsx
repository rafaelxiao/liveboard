import React from "react";
import { useTranslation } from "react-i18next";
import type { AccountSeriesBlock, ComparisonEquityCurve } from "../lib/types";
import { formatCurrency, formatPercent, formatRatio } from "../lib/format";
import { SERIES_COLORS } from "../lib/constants";

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

interface ComparisonTableProps {
  account: { series: AccountSeriesBlock[] };
  curves: ComparisonEquityCurve[];
  baseCurrency: string;
}

const ComparisonTable = React.memo(function ComparisonTable({ account, curves, baseCurrency }: ComparisonTableProps) {
  const { t } = useTranslation("compare");
  const seriesList = account.series;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default">
            <th className="text-left py-2 px-3 font-medium text-secondary sticky left-0 bg-surface z-10">
              {t("metric")}
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
                {t("delta")}
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
                  {t(`metrics.${label}`)}
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
});

export default ComparisonTable;

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
