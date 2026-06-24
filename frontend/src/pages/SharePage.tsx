import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import type { SharedSeriesOut } from "../lib/types";
import EquityChart from "../components/EquityChart";
import DrawdownChart from "../components/DrawdownChart";
import { useEffect, useState } from "react";
import { formatCurrency, formatPercent, formatRatio } from "../lib/format";

async function fetchShared(token: string): Promise<SharedSeriesOut> {
  return apiFetch<SharedSeriesOut>(`/public/share/${token}`);
}

export default function SharePage() {
  const { t } = useTranslation("share");
  const { token } = useParams<{ token: string }>();
  const [chartMode, setChartMode] = useState<"absolute" | "indexed">("absolute");
  const [ddMode, setDdMode] = useState<"absolute" | "indexed">("absolute");

  const { data, isLoading, error } = useQuery({
    queryKey: ["share", token],
    queryFn: () => fetchShared(token!),
    enabled: !!token,
  });

  const { i18n } = useTranslation();

  // Apply stored settings — must be before any early returns
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  useEffect(() => {
    if (data?.pnl_color_scheme) {
      document.documentElement.setAttribute("data-pnl", data.pnl_color_scheme);
    }
    if (data?.lang && data.lang !== i18n.language) {
      i18n.changeLanguage(data.lang);
    }
  }, [data, i18n]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "rgb(var(--bg-app))" }}>
        <div className="text-muted text-sm">{t("loading")}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "rgb(var(--bg-app))" }}>
        <div className="text-center space-y-3">
          <p className="text-pnl-loss text-lg font-semibold">{t("expired")}</p>
          <p className="text-muted text-sm">{t("expiredDesc")}</p>
        </div>
      </div>
    );
  }

  const { series, metrics } = data;
  const ccy = series.base_currency;
  const isSim = series.tag === "sim";

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto" style={{ background: "rgb(var(--bg-app))" }}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold" style={{ color: "rgb(var(--text-primary))" }}>
            {series.name}
          </h1>
          {series.tag && (
            <span
              className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${
                isSim
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              }`}
            >
              {series.tag}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm" style={{ color: "rgb(var(--text-muted))" }}>
          <span>{ccy}</span>
          <span>
            {metrics?.meta?.date_range?.from_ || series.summary?.trade_start}
            {" → "}
            {metrics?.meta?.date_range?.to || series.summary?.trade_end || "present"}
          </span>
          <span>{metrics?.meta?.sample?.active_days ? metrics.meta.sample.active_days + t("days") : ""}</span>
        </div>
      </div>

      {/* Summary cards — use metrics data to respect start date */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SummaryCard
          label={t("startCapital")}
          value={series.summary?.capital_base ? formatCurrency(series.summary.capital_base, ccy) : "—"}
        />
        <SummaryCard
          label={t("netPnl")}
          value={metrics?.metrics?.net_pnl ? formatCurrency(metrics.metrics.net_pnl, ccy) : "—"}
          valueClass={
            metrics?.metrics?.net_pnl
              ? Number(metrics.metrics.net_pnl) >= 0
                ? "text-pnl-gain"
                : "text-pnl-loss"
              : ""
          }
        />
        <SummaryCard
          label={t("return")}
          value={(() => {
            const pnl = metrics?.metrics?.net_pnl;
            const cap = series.summary?.capital_base;
            if (pnl && cap && Number(cap) !== 0) {
              return ((Number(pnl) / Number(cap)) * 100).toFixed(2) + "%";
            }
            return "—";
          })()}
          valueClass={
            metrics?.metrics?.net_pnl
              ? Number(metrics.metrics.net_pnl) >= 0
                ? "text-pnl-gain"
                : "text-pnl-loss"
              : ""
          }
        />
        <SummaryCard
          label={t("sharpe")}
          value={metrics?.metrics?.sharpe ? Number(metrics.metrics.sharpe).toFixed(3) : "—"}
          valueClass={
            metrics?.metrics?.sharpe
              ? Number(metrics.metrics.sharpe) >= 1
                ? "text-pnl-gain"
                : Number(metrics.metrics.sharpe) >= 0
                ? "text-accent"
                : "text-pnl-loss"
              : ""
          }
        />
      </div>

      {/* Equity chart */}
      {metrics?.equity_curve && metrics.equity_curve.length > 0 && (
        <div className="mb-8">
          <EquityChart
            series={[{ name: series.name, points: metrics.equity_curve }]}
            baseCurrency={ccy}
            mode={chartMode}
            onModeChange={setChartMode}
          />
        </div>
      )}

      {metrics?.drawdown_series && metrics.drawdown_series.length > 0 && (
        <div className="mb-8">
          <DrawdownChart
            series={[{ name: series.name, points: metrics.drawdown_series }]}
            baseCurrency={ccy}
            mode={ddMode}
            onModeChange={setDdMode}
          />
        </div>
      )}

      {/* Metrics */}
      {metrics?.metrics && (
        <div className="rounded-lg border border-border-default bg-surface p-5 mb-8">
          <h2 className="text-sm font-semibold mb-4" style={{ color: "rgb(var(--text-primary))" }}>
            {t("metrics")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            {([
              ["netPnl", t("netPnl"), metrics.metrics.net_pnl, "pnl"],
              ["grossPnl", t("grossPnl"), metrics.metrics.gross_pnl, "pnl"],
              ["totalFees", t("totalFees"), metrics.metrics.total_fees, "pnl"],
              ["maxDrawdown", t("maxDrawdown"), metrics.metrics.max_drawdown, "pnl"],
              ["twr", t("twr"), metrics.metrics.twr, "pct"],
              ["cagr", t("cagr"), metrics.metrics.cagr, "pct"],
              ["volatility", t("volatility"), metrics.metrics.volatility, "pct"],
              ["sharpe", t("sharpe"), metrics.metrics.sharpe, "ratio"],
              ["sortino", t("sortino"), metrics.metrics.sortino, "ratio"],
              ["winRate", t("winRate"), metrics.metrics.win_rate, "pct"],
              ["profitFactor", t("profitFactor"), metrics.metrics.profit_factor, "ratio"],
            ] as [string, string, string | null, string][]).map(([colorKey, label, value, fmt]) => {
              const colorClass = metricColor(colorKey, value);
              return (
                <div key={colorKey} className="flex justify-between items-baseline gap-2">
                  <span className="whitespace-nowrap" style={{ color: "rgb(var(--text-muted))" }}>{label}</span>
                  <span className={`font-mono text-right whitespace-nowrap ${colorClass}`}>
                    {formatMetricValue(value, fmt, ccy)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center mt-12 pb-6">
        <span className="text-xs" style={{ color: "rgb(var(--text-muted))" }}>
          {t("footer")}
        </span>
      </div>
    </div>
  );
}

function metricColor(colorKey: string, value: string | null): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (isNaN(n)) return "";
  switch (colorKey) {
    case "netPnl":
    case "grossPnl":
      return n >= 0 ? "text-pnl-gain" : "text-pnl-loss";
    case "maxDrawdown":
      return "text-pnl-loss";
    case "twr":
    case "cagr":
      return n >= 0 ? "text-pnl-gain" : "text-pnl-loss";
    case "sharpe":
      return n >= 1 ? "text-pnl-gain" : n >= 0 ? "text-accent" : "text-pnl-loss";
    case "sortino":
      return n >= 1 ? "text-pnl-gain" : n >= 0 ? "text-accent" : "text-pnl-loss";
    case "winRate":
      return n >= 0.5 ? "text-pnl-gain" : "text-pnl-loss";
    case "profitFactor":
      return n >= 1 ? "text-pnl-gain" : "text-pnl-loss";
    default:
      return "";
  }
}

function formatMetricValue(v: string | null, fmt: string, ccy: string): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  switch (fmt) {
    case "pnl":
      return formatCurrency(v, ccy);
    case "pct":
      return formatPercent(v);
    case "ratio":
      return formatRatio(v, 2);
    case "int":
      return Math.round(n).toLocaleString();
    default:
      return v;
  }
}

function SummaryCard({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "rgb(var(--text-muted))" }}>
        {label}
      </div>
      <div className={`font-mono text-lg font-semibold ${valueClass}`} style={!valueClass ? { color: "rgb(var(--text-primary))" } : undefined}>
        {value}
      </div>
    </div>
  );
}
