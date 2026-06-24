import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DrawdownPoint } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export interface DrawdownSeries {
  name: string;
  points: DrawdownPoint[];
  color?: string;
}

interface DrawdownChartProps {
  series: DrawdownSeries[];
  baseCurrency: string;
  showCaveat?: boolean;
  mode: "absolute" | "indexed";
  onModeChange: (mode: "absolute" | "indexed") => void;
  height?: number;
}

/** Group points by calendar date, keeping the last value */
function groupByDate(points: DrawdownPoint[]): DrawdownPoint[] {
  if (points.length === 0) return [];
  const byDate = new Map<string, DrawdownPoint>();
  for (const p of points) {
    const d = p.ts.slice(0, 10);
    byDate.set(d, p);
  }
  return Array.from(byDate.values()).sort((a, b) => a.ts.localeCompare(b.ts));
}

const DD_COLORS = ["rgb(var(--pnl-loss))", "#fbbf24", "#f472b6"];

const DrawdownChart = React.memo(function DrawdownChart({
  series,
  baseCurrency,
  showCaveat,
  mode,
  onModeChange,
  height = 200,
}: DrawdownChartProps) {
  const { t } = useTranslation("dashboard");
  const activeKey = mode === "absolute" ? "drawdown" : "drawdown_pct";

  const chartData = useMemo(() => {
    if (series.length === 0) return [];
    const dateSet = new Set<string>();
    series.forEach((s) =>
      groupByDate(s.points).forEach((p) => dateSet.add(p.ts.slice(0, 10)))
    );
    const allDates = Array.from(dateSet).sort();
    const lastVals: (number | null)[] = new Array(series.length).fill(null);

    return allDates.map((date) => {
      const point: Record<string, unknown> = { ts: date };
      series.forEach((s, i) => {
        const dayPoints = s.points.filter((p) => p.ts.slice(0, 10) === date);
        if (dayPoints.length > 0) {
          const last = dayPoints[dayPoints.length - 1];
          lastVals[i] = Number(last[activeKey]);
        }
        if (lastVals[i] !== null) point[`v${i}`] = lastVals[i];
      });
      return point;
    });
  }, [series, mode, activeKey]);

  const formatValue = (v: number) =>
    mode === "absolute"
      ? formatCurrency(String(v), baseCurrency)
      : (v * 100).toFixed(2) + "%";

  const xFormatter = (ts: string) => {
    const d = new Date(ts + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">
          {t("Drawdown")}
          {showCaveat && (
            <span className="ml-2 rounded bg-warning/20 px-1 text-[10px] uppercase text-warning">
              {t("DD CAVEAT")}
            </span>
          )}
        </h3>
        <div className="inline-flex rounded-md border border-border-default">
          <button
            type="button"
            onClick={() => onModeChange("absolute")}
            className={`px-2 py-1 text-xs rounded-l-md ${mode === "absolute" ? "bg-accent text-white" : "bg-surface text-secondary"}`}
          >
            {t("Absolute")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("indexed")}
            className={`px-2 py-1 text-xs rounded-r-md ${mode === "indexed" ? "bg-accent text-white" : "bg-surface text-secondary"}`}
          >
            {t("Indexed")}
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
          {series.map((_, i) => (
            <defs key={i}>
              <linearGradient id={`ddGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series[i].color || DD_COLORS[i % DD_COLORS.length]} stopOpacity={0.25} />
                <stop offset="100%" stopColor={series[i].color || DD_COLORS[i % DD_COLORS.length]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
          ))}
          <XAxis
            dataKey="ts"
            tickFormatter={xFormatter}
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis tickFormatter={formatValue} tick={{ fontSize: 10 }} width={60} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div
                  style={{
                    background: "rgb(var(--bg-surface-3))",
                    color: "rgb(var(--text-primary))",
                    border: "1px solid rgb(var(--border-default))",
                    borderRadius: "6px",
                    padding: "4px 8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  }}
                >
                  <div style={{ color: "rgb(var(--text-muted))", marginBottom: 2, fontSize: "10px" }}>
                    {label}
                  </div>
                  {payload.map((entry, i) => (
                    <div key={i} className="font-mono" style={{ color: entry.color }}>
                      {series[i]?.name && <span style={{ color: "rgb(var(--text-secondary))" }}>{series[i].name}: </span>}
                      {formatValue(Number(entry.value))}
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "4px" }} iconType="line" />
          )}
          {series.map((s, i) => (
            <Area
              key={i}
              type="monotone"
              dataKey={`v${i}`}
              name={s.name}
              stroke={s.color || DD_COLORS[i % DD_COLORS.length]}
              fill={`url(#ddGrad${i})`}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

export default DrawdownChart;
