import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from "recharts";
import type { EquityPoint } from "../lib/types";
import { formatCurrency } from "../lib/format";

export interface EquityCurveSeries {
  name: string;
  points: EquityPoint[];
  color?: string;
}

interface EquityChartProps {
  /** Single series (dashboard/share) or multiple series (compare) */
  series: EquityCurveSeries[];
  baseCurrency: string;
  mode: "absolute" | "indexed";
  onModeChange: (mode: "absolute" | "indexed") => void;
  hideModeToggle?: boolean;
  height?: number;
}

/** Group points by calendar date, keeping the last value of each day */
function groupByDate(points: EquityPoint[]): EquityPoint[] {
  if (points.length === 0) return [];
  const byDate = new Map<string, EquityPoint>();
  for (const p of points) {
    const d = p.ts.slice(0, 10); // "2025-11-19"
    byDate.set(d, p);
  }
  return Array.from(byDate.values()).sort((a, b) => a.ts.localeCompare(b.ts));
}

const SERIES_COLORS = [
  "rgb(var(--accent-primary))",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
];

const EquityChart = React.memo(function EquityChart({
  series,
  baseCurrency,
  mode,
  onModeChange,
  hideModeToggle,
  height = 300,
}: EquityChartProps) {
  const { t } = useTranslation("dashboard");

  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    // Collect union of all dates
    const dateSet = new Set<string>();
    series.forEach((s) =>
      groupByDate(s.points).forEach((p) => {
        dateSet.add(p.ts.slice(0, 10));
      })
    );
    const allDates = Array.from(dateSet).sort();

    // Build chart rows — one per date
    const lastVals: (number | null)[] = new Array(series.length).fill(null);

    return allDates.map((date) => {
      const point: Record<string, unknown> = { ts: date };
      series.forEach((s, i) => {
        const dayPoints = s.points.filter((p) => p.ts.slice(0, 10) === date);
        if (dayPoints.length > 0) {
          const last = dayPoints[dayPoints.length - 1];
          const val =
            mode === "indexed"
              ? parseFloat(last.indexed_return) * 100
              : parseFloat(last.realized_pnl);
          lastVals[i] = val;
        }
        if (lastVals[i] !== null) {
          point[`v${i}`] = lastVals[i];
        }
      });
      return point;
    });
  }, [series, mode]);

  const yFormatter = (v: number) => {
    if (mode === "indexed") return `${v.toFixed(1)}%`;
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  const xFormatter = (ts: string) => {
    const d = new Date(ts + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">
          {t("Equity Curve")}
          <span className="ml-2 text-[10px] font-normal text-muted">
            {chartData.length} daily points
          </span>
        </h3>
        {!hideModeToggle && (
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
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
          <XAxis
            dataKey="ts"
            tickFormatter={xFormatter}
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis tickFormatter={yFormatter} tick={{ fontSize: 10 }} width={60} />
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
                    padding: "6px 10px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  }}
                >
                  <div style={{ color: "rgb(var(--text-muted))", marginBottom: 4, fontSize: "10px" }}>
                    {label}
                  </div>
                  {payload.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span style={{ color: "rgb(var(--text-secondary))" }}>
                        {series[i]?.name}:
                      </span>
                      <span style={{ color: "rgb(var(--text-primary))" }}>
                        {mode === "indexed"
                          ? `${Number(entry.value).toFixed(2)}%`
                          : formatCurrency(String(entry.value), baseCurrency)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="var(--border-default)" />
          {series.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              iconType="line"
            />
          )}
          {series.map((s, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`v${i}`}
              name={s.name}
              stroke={s.color || SERIES_COLORS[i % SERIES_COLORS.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export default EquityChart;
