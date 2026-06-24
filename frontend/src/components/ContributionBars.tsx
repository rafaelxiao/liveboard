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

function DivergingBarRow({ symbol, pnl, pct, maxAbs, ccy }: {
  symbol: string; pnl: number; pct: number; maxAbs: number; ccy: string;
}) {
  const isGain = pnl >= 0;
  const barWidth = Math.max((Math.abs(pnl) / Math.max(maxAbs, 1)) * 50, 1); // 50% = half bar

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 font-mono text-[13px] text-secondary" title={symbol}>
        {symbol}
      </span>

      {/* Diverging bar area: center line at 50% */}
      <div className="flex-1 h-5 relative flex items-center">
        {/* Zero line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-default z-10" />

        {isGain ? (
          /* Gain bar: extends right from center */
          <div className="absolute left-1/2 top-1 bottom-1 rounded-r-sm bg-pnl-gain/40" style={{ width: `${barWidth}%` }} />
        ) : (
          /* Loss bar: extends left from center */
          <div className="absolute top-1 bottom-1 rounded-l-sm bg-pnl-loss/40" style={{ right: "50%", width: `${barWidth}%` }} />
        )}
      </div>

      {/* Right-aligned value block */}
      <div className="w-40 shrink-0 flex items-center justify-between">
        <span className={`font-mono text-[13px] tabular-nums ${isGain ? "text-pnl-gain" : "text-pnl-loss"}`}>
          {fmtCompact(pnl, ccy)}
        </span>
        <span className={`font-mono text-[12px] tabular-nums w-14 text-right ${isGain ? "text-pnl-gain/70" : "text-pnl-loss/70"}`}>
          {isGain ? `+${(pct * 100).toFixed(1)}%` : `${(pct * 100).toFixed(1)}%`}
        </span>
      </div>
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

  const maxAbs = Math.max(...converted.map((c) => Math.abs(c.pnl)), 1);

  // Sort by absolute PnL descending
  const sorted = [...converted].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-primary">{t("PnL Contribution")}</h3>
      <div className="space-y-1.5">
        {sorted.map((c) => (
          <DivergingBarRow key={c.symbol} symbol={c.symbol} pnl={c.pnl} pct={c.pct} maxAbs={maxAbs} ccy={baseCurrency} />
        ))}
      </div>
    </div>
  );
});

export default ContributionBars;
