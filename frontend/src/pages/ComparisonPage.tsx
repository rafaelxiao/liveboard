import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import EquityChart from "../components/EquityChart";
import DrawdownChart from "../components/DrawdownChart";
import { useComparison } from "../state/useComparison";
import { useSeriesList } from "../state/useSeries";
import { useTradeGroupingStore } from "../state/tradeGroupingStore";
import type { ComparisonRequest, ComparisonLevel, StrategyKey } from "../lib/types";
import EntityPicker from "../components/EntityPicker";
import DateRangePicker from "../components/DateRangePicker";
import ComparisonTable from "../components/ComparisonTable";
import AlertBanner from "../components/AlertBanner";
import EmptyState from "../components/EmptyState";
import StandaloneSeriesFlag from "../components/StandaloneSeriesFlag";
import { SkeletonCard } from "../components/SkeletonCard";
import { formatCurrency } from "../lib/format";
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
  const [ddMode, setDdMode] = useState<"absolute" | "indexed">("absolute");
  const [submitted, setSubmitted] = useState(false);

  // Load series list for pickers
  const { data: seriesList } = useSeriesList();

  // Build request — derive series_ids from strategyKeys in strategy mode
  const derivedSeriesIds = useMemo(() => {
    if (level === "strategy") {
      return [...new Set(strategyKeys.map(k => k.series_id))];
    }
    return selectedIds;
  }, [level, selectedIds, strategyKeys]);

  const tradeGrouping = useTradeGroupingStore((s) => s.grouping);

  const req: ComparisonRequest | null =
    submitted && derivedSeriesIds.length >= 2
      ? {
          series_ids: derivedSeriesIds,
          level,
          strategy_keys: level === "strategy" ? strategyKeys : undefined,
          date_from: from,
          date_to: to,
          trade_grouping: tradeGrouping,
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

    // Auto-align to overlapping date range when no dates are set
    if (!from && !to && seriesList) {
      const selectedSeries = seriesList.filter((s) => derivedSeriesIds.includes(s.id));
      const starts = selectedSeries.map((s) => s.summary?.trade_start).filter(Boolean) as string[];
      const ends = selectedSeries.map((s) => s.summary?.trade_end).filter(Boolean) as string[];
      if (starts.length >= 2 && ends.length >= 2) {
        const overlapFrom = starts.sort().reverse()[0]; // latest start
        const overlapTo = ends.sort()[0]; // earliest end
        setParams({ from: overlapFrom, to: overlapTo });
        setSubmitted(true);
        return;
      }
    }

    setSubmitted(true);
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
          <EquityChart
            series={data.equity_curves.map((c) => ({
              name: c.name,
              points: c.equity_curve,
            }))}
            baseCurrency={baseCurrency}
            mode={normalization}
            onModeChange={setNormalization}
          />

          <DrawdownChart
            series={data.equity_curves.map((c) => ({
              name: c.name,
              points: c.drawdown_series,
            }))}
            baseCurrency={baseCurrency}
            mode={ddMode}
            onModeChange={setDdMode}
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

          {/* PnL Breakdown */}
          {data.pnl_breakdown && data.pnl_breakdown.rows.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-secondary mb-2">
                PnL Breakdown ({data.pnl_breakdown.first_name} - {data.pnl_breakdown.second_name})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-default">
                      {data.pnl_breakdown.rows[0]?.name_key && (
                        <th className="text-left py-2 px-3 font-medium text-secondary">Strategy</th>
                      )}
                      <th className="text-left py-2 px-3 font-medium text-secondary">Month</th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">{data.pnl_breakdown.first_name} PnL</th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">{data.pnl_breakdown.second_name} PnL</th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">Total Δ</th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">Shared Δ</th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">Date Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pnl_breakdown.rows.map((row, i) => {
                      const td = parseFloat(row.total_delta);
                      const sd = parseFloat(row.shared_delta);
                      const dd = parseFloat(row.date_delta);
                      return (
                        <tr key={i} className="border-b border-border-default/50 hover:bg-surface-2/50">
                          {row.name_key && (
                            <td className="py-1.5 px-3 text-secondary">{row.name_key}</td>
                          )}
                          <td className="py-1.5 px-3 text-secondary">{row.month}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-secondary">
                            {formatCurrency(row.first_pnl, baseCurrency)}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-secondary">
                            {formatCurrency(row.second_pnl, baseCurrency)}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-mono ${td >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                            {formatCurrency(row.total_delta, baseCurrency)}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-mono ${sd >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                            {formatCurrency(row.shared_delta, baseCurrency)}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-mono ${dd >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                            {formatCurrency(row.date_delta, baseCurrency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border-default font-semibold">
                      <td className="py-1.5 px-3 text-secondary" colSpan={data.pnl_breakdown.rows[0]?.name_key ? 2 : 1}>
                        TOTAL
                      </td>
                      {(() => {
                        const tl = data.pnl_breakdown.rows.reduce((s, r) => s + parseFloat(r.first_pnl), 0);
                        const ts = data.pnl_breakdown.rows.reduce((s, r) => s + parseFloat(r.second_pnl), 0);
                        const tt = data.pnl_breakdown.rows.reduce((s, r) => s + parseFloat(r.total_delta), 0);
                        const tsh = data.pnl_breakdown.rows.reduce((s, r) => s + parseFloat(r.shared_delta), 0);
                        const td = data.pnl_breakdown.rows.reduce((s, r) => s + parseFloat(r.date_delta), 0);
                        return (
                          <>
                            <td className="py-1.5 px-3 text-right font-mono text-secondary">{formatCurrency(String(tl), baseCurrency)}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-secondary">{formatCurrency(String(ts), baseCurrency)}</td>
                            <td className={`py-1.5 px-3 text-right font-mono ${tt >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{formatCurrency(String(tt), baseCurrency)}</td>
                            <td className={`py-1.5 px-3 text-right font-mono ${tsh >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{formatCurrency(String(tsh), baseCurrency)}</td>
                            <td className={`py-1.5 px-3 text-right font-mono ${td >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{formatCurrency(String(td), baseCurrency)}</td>
                          </>
                        );
                      })()}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                Shared Δ = difference on days both strategies traded. Date Δ = difference from days only one traded.
              </p>
              {level === "strategy" && strategyKeys.length === 2 && strategyKeys[0].name_key === strategyKeys[1].name_key && (
                <a
                  href={`${import.meta.env.BASE_URL}trade-compare?series_1=${strategyKeys[0].series_id}&series_2=${strategyKeys[1].series_id}&strategy=${strategyKeys[0].name_key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-md border border-accent bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Trade-by-trade chart
                </a>
              )}
            </div>
          )}

          {/* Execution Quality Table */}
          {data.execution && data.execution.groups.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-secondary mb-2">
                {t("executionQuality")}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-default">
                      {data.execution.groups[0]?.name_key && !data.execution.groups[0]?.symbol && (
                        <th className="text-left py-2 px-3 font-medium text-secondary">
                          {t("strategy")}
                        </th>
                      )}
                      {data.execution.groups[0]?.symbol && (
                        <th className="text-left py-2 px-3 font-medium text-secondary">
                          {t("symbol")}
                        </th>
                      )}
                      <th className="text-right py-2 px-3 font-medium text-secondary">
                        Round Trips
                      </th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">
                        {t("deltaBps")}
                      </th>
                      <th className="text-right py-2 px-3 font-medium text-secondary">
                        {t("estimatedImpact")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.execution.groups.map((g) => {
                      const bps = parseFloat(g.weighted_avg_bps);
                      const impact = parseFloat(g.estimated_pnl_impact);
                      // Neutral coloring by magnitude only — no good/bad judgment
                      const absImpact = Math.abs(impact);
                      const colorClass =
                        absImpact < 100
                          ? "text-secondary"
                          : "text-accent";
                      return (
                        <tr
                          key={`${g.name_key}-${g.symbol}`}
                          className="border-b border-border-default/50 hover:bg-surface-2/50"
                        >
                          {g.name_key && !g.symbol && (
                            <td className="py-1.5 px-3 text-secondary">{g.name_key}</td>
                          )}
                          {g.symbol && (
                            <td className="py-1.5 px-3 text-secondary font-mono">
                              {g.symbol}
                              {g.note && <span className="ml-1 text-[10px] text-muted">({g.note})</span>}
                            </td>
                          )}
                          <td className="py-1.5 px-3 text-right font-mono text-secondary">
                            {g.daily_groups}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-mono ${colorClass}`}>
                            {isNaN(bps) ? "—" : `${bps > 0 ? "+" : ""}${bps.toFixed(1)} bps`}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-mono ${colorClass}`}>
                            {isNaN(impact) ? "—" : `${impact > 0 ? "+" : ""}${formatCurrency(String(impact), baseCurrency)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                Per-trade spread = (sell − buy) / buy. +Δ = baseline captures more spread (better execution).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
