import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { useComparison } from "../state/useComparison";
import { useSeriesList } from "../state/useSeries";
import type { ComparisonRequest, ComparisonLevel, StrategyKey } from "../lib/types";
import EntityPicker from "../components/EntityPicker";
import DateRangePicker from "../components/DateRangePicker";
import NormalizationToggle from "../components/NormalizationToggle";
import HoverStatsPanel from "../components/HoverStatsPanel";
import ComparisonTable from "../components/ComparisonTable";
import AlertBanner from "../components/AlertBanner";
import EmptyState from "../components/EmptyState";
import StandaloneSeriesFlag from "../components/StandaloneSeriesFlag";
import { SkeletonCard } from "../components/SkeletonCard";
import { formatCurrency } from "../lib/format";
import { SERIES_COLORS } from "../lib/constants";

const NORMALIZED_BASE = 100_000;

export default function ComparisonPage() {
  const { t } = useTranslation("compare");
  const [searchParams, setSearchParams] = useSearchParams();

  // Level state
  const level: ComparisonLevel = (searchParams.get("level") as ComparisonLevel) || "account";

  const LEVEL_OPTIONS: { value: ComparisonLevel; label: string }[] = [
    { value: "account", label: t("level.account") },
    { value: "strategy", label: t("level.strategy") },
  ];

  // Account mode: series IDs
  const selectedIds = useMemo(
    () =>
      searchParams
        .get("series")
        ?.split(",")
        .map(Number)
        .filter((n) => !isNaN(n)) ?? [],
    [searchParams]
  );

  // Strategy mode: strategy keys
  const strategyKeys: StrategyKey[] = useMemo(() => {
    const raw = searchParams.get("strategies");
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }, [searchParams]);

  // Date range
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  // Normalization
  const [normalization, setNormalization] = useState<"absolute" | "indexed">("absolute");
  const [submitted, setSubmitted] = useState(false);
  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);

  // Load series list for pickers
  const { data: seriesList } = useSeriesList();

  // Build request — derive series_ids from strategyKeys in strategy mode
  const derivedSeriesIds = useMemo(() => {
    if (level === "strategy") {
      return [...new Set(strategyKeys.map(k => k.series_id))];
    }
    return selectedIds;
  }, [level, selectedIds, strategyKeys]);

  const req: ComparisonRequest | null =
    submitted && derivedSeriesIds.length >= 2
      ? {
          series_ids: derivedSeriesIds,
          level,
          strategy_keys: level === "strategy" ? strategyKeys : undefined,
          date_from: from,
          date_to: to,
        }
      : null;

  const { data, isLoading, error, refetch } = useComparison(req);

  // Collect available strategies for the strategy picker
  const availableStrategies = useMemo(() => {
    if (!seriesList || level !== "strategy") return [];
    return seriesList.flatMap((s) =>
      (s.strategies ?? []).map((st) => ({
        series_id: s.id,
        series_name: s.name,
        name_key: st.name_key,
        name: st.name,
      }))
    );
  }, [seriesList, level]);

  // Merge equity curves for chart (timestamp-based alignment)
  const chartData = useMemo(() => {
    if (!data?.equity_curves) return [];
    const curves = data.equity_curves;
    if (curves.length === 0) return [];

    // Collect union of all timestamps across all curves
    const tsSet = new Set<string>();
    curves.forEach((c) => c.equity_curve.forEach((p) => tsSet.add(p.ts)));
    const allTs = Array.from(tsSet).sort();

    // Track last known value per curve to carry-forward missing points
    const lastVal: (number | null)[] = new Array(curves.length).fill(null);

    return allTs.map((ts) => {
      const point: Record<string, unknown> = { ts };
      curves.forEach((curve, ci) => {
        const match = curve.equity_curve.find((p) => p.ts === ts);
        if (match) {
          const val =
            normalization === "indexed"
              ? parseFloat(match.indexed_return) * 100
              : (parseFloat(match.indexed_return) + 1) * NORMALIZED_BASE;
          lastVal[ci] = val;
        }
        // Carry-forward: use last known value for missing timestamps
        if (lastVal[ci] !== null) {
          point[`v${ci}`] = lastVal[ci];
        }
      });
      return point;
    });
  }, [data, normalization]);

  // URL updaters
  const setParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([k, v]) => {
          if (v === undefined) next.delete(k);
          else next.set(k, v);
        });
        return next;
      });
    },
    [setSearchParams]
  );

  const handleCompare = () => {
    if (level === "account" && selectedIds.length < 2) return;
    if (level === "strategy" && strategyKeys.length < 2) return;
    setSubmitted(true);
  };

  // Y-axis formatter
  const yAxisFormatter = (v: number) => {
    if (normalization === "indexed") return `${v.toFixed(1)}%`;
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(0);
  };

  const baseCurrency = data?.meta?.base_currency || "USD";

  return (
    <div className="space-y-4">
      {/* Level toggle row */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-md border border-border-default overflow-hidden h-8">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setParams({ level: opt.value, series: undefined, strategies: undefined });
                setSubmitted(false);
              }}
              className={`px-3 text-sm font-medium transition-colors duration-150 ${
                level === opt.value
                  ? "border-accent bg-accent text-white"
                  : "border-transparent bg-surface text-secondary hover:bg-surface-2"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entity selection row */}
      <div>
        <EntityPicker
          level={level}
          series={seriesList ?? []}
          selected={selectedIds}
          onSelectedChange={(ids: number[]) => setParams({ series: ids.join(",") })}
          strategyKeys={strategyKeys}
          onStrategyKeysChange={(keys: StrategyKey[]) =>
            setParams({ strategies: JSON.stringify(keys) })
          }
          availableStrategies={availableStrategies}
        />
      </div>

      {/* Second row — Date range + Compare button */}
      <div className="flex items-center gap-3">
        <DateRangePicker
          from={from}
          to={to}
          onChange={(range) => {
            setParams({ from: range.from ?? undefined, to: range.to ?? undefined });
          }}
        />

        <button
          type="button"
          onClick={handleCompare}
          disabled={
            (level === "account" && selectedIds.length < 2) ||
            (level === "strategy" && strategyKeys.length < 2)
          }
          className="rounded-md border border-accent bg-accent text-white px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed h-8"
        >
          {t("compare")}
        </button>
      </div>

      {/* Content */}
      {!submitted && (
        <EmptyState title={t("emptyState")} />
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <div className="h-[300px] bg-surface rounded-md animate-pulse" />
        </div>
      )}

      {error && !isLoading && (
        <AlertBanner
          message={`${t("comparisonFailed")} ${(error as Error).message}`}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <>
          {/* Currency mismatch flags */}
          {data.meta.currency_mismatch_series.map((sid) => (
            <StandaloneSeriesFlag key={sid} kind="currency-mismatch" name={`Series ${sid}`} />
          ))}

          {/* Chart */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-secondary">{t("equityCurves")}</h3>
              <NormalizationToggle
                value={normalization}
                onChange={setNormalization}
              />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                onMouseMove={(e) => {
                  if (e?.activeTooltipIndex !== undefined && typeof e.activeTooltipIndex === "number") {
                    const ts = chartData[e.activeTooltipIndex]?.ts as string | undefined;
                    if (ts) setHoveredTimestamp(ts);
                  }
                }}
                onMouseLeave={() => setHoveredTimestamp(null)}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={yAxisFormatter} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={(props) => {
                    const { active, payload, label } = props;
                    if (!active || !payload || payload.length === 0) return null;

                    const values = data.equity_curves.map((_, i) => {
                      const entry = payload.find((p) => p.dataKey === `v${i}`);
                      if (!entry) return null;
                      const num = Number(entry.value);
                      if (isNaN(num)) return null;
                      return { name: data.equity_curves[i].name, value: num, color: SERIES_COLORS[i % SERIES_COLORS.length] };
                    }).filter(Boolean) as Array<{ name: string; value: number; color: string }>;

                    if (values.length === 0) return null;

                    return (
                      <div
                        style={{
                          backgroundColor: "rgb(var(--bg-surface-3))",
                          color: "rgb(var(--text-primary))",
                          border: "1px solid rgb(var(--border-default))",
                          borderRadius: "6px",
                          padding: "6px 10px",
                          fontSize: "12px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                        }}
                      >
                        <div style={{ color: "rgb(var(--text-muted))", marginBottom: 4, fontSize: "10px" }}>{label}</div>
                        {values.map((v, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                            <span style={{ color: "rgb(var(--text-secondary))" }}>{v.name}:</span>
                            <span className="font-mono" style={{ color: "rgb(var(--text-primary))" }}>
                              {normalization === "indexed"
                                ? `${v.value.toFixed(2)}%`
                                : formatCurrency(String(v.value), baseCurrency)}
                            </span>
                          </div>
                        ))}
                        {values.length === 2 && (
                          <div className="flex items-center gap-2 mt-1 pt-1" style={{ borderTop: "1px solid rgb(var(--border-default))" }}>
                            <span style={{ color: "rgb(var(--text-muted))", fontSize: "10px" }}>Δ</span>
                            <span className={`font-mono ${values[0].value - values[1].value >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                              {normalization === "indexed"
                                ? `${(values[0].value - values[1].value) >= 0 ? "+" : ""}${(values[0].value - values[1].value).toFixed(2)}%`
                                : formatCurrency(String(values[0].value - values[1].value), baseCurrency)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={normalization === "indexed" ? 0 : NORMALIZED_BASE} stroke="var(--border-default)" />
                <Legend
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  iconType="line"
                />
                {data.equity_curves.map((curve, i) => (
                  <Line
                    key={curve.series_id}
                    type="monotone"
                    dataKey={`v${i}`}
                    name={curve.name}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Hover Stats Panel */}
          <HoverStatsPanel
            curves={data.equity_curves}
            hoveredTimestamp={hoveredTimestamp}
            baseCurrency={baseCurrency}
          />

          {/* Head-to-Head Table */}
          <div>
            <h3 className="text-sm font-medium text-secondary mb-2">
              {t("headToHead")}
            </h3>
            <ComparisonTable
              account={data.account}
              curves={data.equity_curves}
              baseCurrency={baseCurrency}
            />
          </div>
        </>
      )}
    </div>
  );
}
