import { useTranslation } from "react-i18next";
import type { ComparisonEquityCurve } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { SERIES_COLORS } from "../lib/constants";

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
  hoveredTimestamp: string | null;
  baseCurrency: string;
}

export default function HoverStatsPanel({
  curves,
  hoveredTimestamp,
  baseCurrency,
}: HoverStatsPanelProps) {
  const { t } = useTranslation("compare");
  if (hoveredTimestamp === null || curves.length === 0) return null;

  // For each curve, find the point at the hovered timestamp and compute period-to-date stats
  const entries: HoverStatsEntry[] = curves.map((curve) => {
    const matchIdx = curve.equity_curve.findIndex((p) => p.ts === hoveredTimestamp);
    if (matchIdx === -1) {
      return { label: `S${curve.series_id}`, entityName: curve.name, equity: 0, pnl: 0, maxDD: 0 };
    }

    const eqPts = curve.equity_curve.slice(0, matchIdx + 1);
    const ddPts = curve.drawdown_series.slice(0, matchIdx + 1);

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

  return (
    <div className="bg-surface border border-border-default rounded-md p-3 text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-tertiary border-b border-border-default">
            <th className="text-left py-1 font-medium">{t("hoverStats.header")}</th>
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
              <th className="text-right py-1 font-medium text-tertiary">{t("delta")}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {[
            {label: t("hoverStats.equity"), getValue: (e: HoverStatsEntry) => e.equity, isPnl: true },
            { label: t("hoverStats.netPnl"), getValue: (e: HoverStatsEntry) => e.pnl, isPnl: true },
            { label: t("hoverStats.maxDD"), getValue: (e: HoverStatsEntry) => e.maxDD, isPnl: true },
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
