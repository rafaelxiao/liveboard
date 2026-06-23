import React from "react";
import { useTranslation } from "react-i18next";

function fmtCompact(value: number, ccy: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${ccy}`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K ${ccy}`;
  return `${value.toFixed(0)} ${ccy}`;
}

interface Contribution {
  symbol: string;
  pnl: number;
  pct: number;
}

interface ContributionBarsProps {
  contributions: { symbol: string; pnl: string; pct: string }[];
  baseCurrency: string;
}

function BarRow({ symbol, pnl, pct, maxAbs, ccy, color }: {
  symbol: string; pnl: number; pct: number; maxAbs: number; ccy: string;
  color: "gain" | "loss";
}) {
  const isGain = color === "gain";
  const barWidth = Math.max((Math.abs(pnl) / Math.max(maxAbs, 1)) * 100, 2);

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 font-mono text-[13px] text-secondary truncate" title={symbol}>
        {symbol}
      </span>
      <div className="flex-1 h-5 rounded-sm bg-surface-2 relative overflow-hidden">
        <div
          className={`h-full rounded-sm ${isGain ? "bg-pnl-gain/40" : "bg-pnl-loss/40"}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className={`w-24 shrink-0 text-right font-mono text-[13px] tabular-nums whitespace-nowrap ${isGain ? "text-pnl-gain" : "text-pnl-loss"}`}>
        {isGain ? "+" : ""}{fmtCompact(pnl, ccy)}
      </span>
      <span className={`w-14 shrink-0 text-right font-mono text-[12px] whitespace-nowrap ${isGain ? "text-pnl-gain/70" : "text-pnl-loss/70"}`}>
        {isGain ? "+" : ""}{(pct * 100).toFixed(1)}%
      </span>
    </div>
  );
}

const ContributionBars = React.memo(function ContributionBars({ contributions, baseCurrency }: ContributionBarsProps) {
  const { t } = useTranslation("dashboard");
  if (!contributions || contributions.length === 0) return null;

  const converted: Contribution[] = contributions.map((c) => ({
    symbol: c.symbol,
    pnl: Number(c.pnl),
    pct: Number(c.pct),
  }));

  const gainers = converted
    .filter((c) => c.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 5);

  const losers = converted
    .filter((c) => c.pnl < 0)
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 5);

  const maxGain = Math.max(...gainers.map((g) => g.pnl), 0);
  const maxLoss = Math.max(...losers.map((l) => Math.abs(l.pnl)), 0);
  const globalMax = Math.max(maxGain, maxLoss, 1);

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-primary">{t("PnL Contribution")}</h3>
      {gainers.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">{t("Top Gainers")}</p>
          <div className="space-y-1.5">
            {gainers.map((g) => (
              <BarRow key={g.symbol} symbol={g.symbol} pnl={g.pnl} pct={g.pct} maxAbs={globalMax} ccy={baseCurrency} color="gain" />
            ))}
          </div>
        </div>
      )}
      {losers.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">{t("Top Losers")}</p>
          <div className="space-y-1.5">
            {losers.map((l) => (
              <BarRow key={l.symbol} symbol={l.symbol} pnl={l.pnl} pct={l.pct} maxAbs={globalMax} ccy={baseCurrency} color="loss" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default ContributionBars;
