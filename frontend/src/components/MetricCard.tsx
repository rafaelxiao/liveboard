import { useTranslation } from "react-i18next";
import { formatCurrency, formatPercent, formatRatio, formatSeconds, glyphFor, pnlClassFor } from "../lib/format";
import { usePnlStore } from "../state/pnlStore";
import React, { type ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | null;
  unit: string;
  baseCurrency: string;
  isPnl?: boolean;
  display?: "percent" | "ratio" | "auto";
  delta?: string | null;
  lowSample?: boolean;
  suppressed?: boolean;
  badge?: ReactNode;
  className?: string;
}

function formatValue(value: string, unit: string, display?: string, _fallbackCcy?: string): string {
  void _fallbackCcy; // kept for API symmetry
  if (unit === "USD" || unit.length === 3) {
    return formatCurrency(value, unit);
  }
  if (display === "percent" || unit.includes("percent")) {
    return formatPercent(value);
  }
  if (unit === "ratio" || unit === "annualized_ratio") {
    return display === "percent" ? formatPercent(value) : formatRatio(value);
  }
  if (unit === "seconds") {
    return formatSeconds(Number(value));
  }
  if (unit === "count") {
    return Number(value).toLocaleString("en-US");
  }
  return value;
}

const MetricCard = React.memo(function MetricCard({
  label, value, unit, baseCurrency, isPnl, display,
  lowSample, suppressed, badge, className,
}: MetricCardProps) {
  const scheme = usePnlStore((s) => s.scheme);
  const { t } = useTranslation("dashboard");

  if (suppressed || value === null || value === undefined) {
    return (
      <div className={`rounded-lg border border-border-default bg-surface p-4 transition-colors duration-150 ${className ?? ""}`}>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className="text-lg font-medium text-disabled">—</div>
        {lowSample && <div className="mt-1 text-xs text-warning">{t("low sample")}</div>}
      </div>
    );
  }

  const formatted = formatValue(value, unit, display, baseCurrency);
  const n = Number(value);
  const sign: -1 | 0 | 1 = n > 0 ? 1 : n < 0 ? -1 : 0;
  const colorClass = isPnl ? pnlClassFor(value, scheme) : "text-primary";

  return (
    <div className={`rounded-lg border border-border-default bg-surface p-4 transition-colors duration-150 ${className ?? ""}`}>
      <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-muted">
        {label}
        {badge}
      </div>
      <div className={`font-mono text-lg font-medium tabular-nums ${colorClass}`}>
        {formatted}
        {isPnl && sign !== 0 && <span className="ml-1 text-sm">{glyphFor(sign)}</span>}
      </div>
      {lowSample && (
        <div className="mt-1 text-xs text-warning">{t("low sample — interpret with care")}</div>
      )}
    </div>
  );
});

export default MetricCard;
