import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useMetrics } from "../state/useMetrics";
import { useSeriesList } from "../state/useSeries";
import { searchToParams, paramsToSearch, DEFAULT_PARAMS, type DashboardParams } from "../lib/dashboardParams";
import { useBreadcrumbStore, type BreadcrumbSegment } from "../state/breadcrumbStore";
import MetricCardGrid from "../components/MetricCardGrid";
import HierarchyNav from "../components/HierarchyNav";
import DateRangePicker from "../components/DateRangePicker";

import EquityChart from "../components/EquityChart";
import DrawdownChart from "../components/DrawdownChart";
import ContributionCard from "../components/ContributionCard";
import ContributionBars from "../components/ContributionBars";
import AlertBanner from "../components/AlertBanner";
import { FxMissingBanner, LowSampleFootnote } from "../components/FlagBanners";
import { SkeletonCard, SkeletonChart } from "../components/SkeletonCard";
import { Layers, TrendingUp, BarChart3, Hash } from "lucide-react";
import { formatCurrency } from "../lib/format";

export default function DashboardPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const params = searchParams.get("series")
    ? searchToParams(searchParams.toString())
    : DEFAULT_PARAMS;

  const { data, isLoading, isError, refetch } = useMetrics(params);
  const { data: seriesList } = useSeriesList();
  const [equityMode, setEquityMode] = useState<"absolute" | "indexed">("absolute");
  const [drawdownMode, setDrawdownMode] = useState<"absolute" | "indexed">("absolute");

  const update = useCallback(
    (patch: Partial<DashboardParams>) => {
      const next = { ...params, ...patch };
      setSearchParams(new URLSearchParams(paramsToSearch(next)));
    },
    [params, setSearchParams],
  );

  const setBreadcrumb = useBreadcrumbStore((s) => s.setSegments);

  const level: "account" | "strategy" | "symbol" = params.symbol
    ? "symbol"
    : params.strategy
      ? "strategy"
      : "account";

  const seriesName = seriesList?.find((s) => s.id === params.series)?.name ?? `Series ${params.series}`;

  useEffect(() => {
    const segs: BreadcrumbSegment[] = [];
    if (level === "strategy" || level === "symbol") {
      segs.push({
        label: "Account",
        onClick: () => update({ strategy: undefined, symbol: undefined }),
      });
    }
    if (params.strategy) {
      segs.push({ label: params.strategy });
    }
    if (params.symbol) {
      segs.push({ label: params.symbol });
    }
    setBreadcrumb(segs);
    return () => setBreadcrumb([]);
  }, [level, params.strategy, params.symbol, setBreadcrumb, update]);

  const isSymbol = level === "symbol";

  // Series overview — no series selected yet
  if (!params.series) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-primary">{t("Dashboard", { ns: "common" })}</h1>
        {seriesList && seriesList.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {seriesList.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSearchParams(new URLSearchParams(paramsToSearch({ ...params, series: s.id })))}
                className="rounded-lg border border-border-default bg-surface p-5 text-left transition-colors duration-150 hover:border-accent hover:bg-surface-2 cursor-pointer"
              >
                <div className="mb-3 flex items-center gap-2">
                  <Layers size={16} className="text-accent" />
                  <span className="font-semibold text-primary">{s.name}</span>
                  <span className={`ml-auto rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                    s.tag === "sim"
                      ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  }`}>
                    {t(s.tag || "real")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">{t("Currency")}</span>
                    <span className="font-mono text-primary">{s.base_currency}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      <Hash size={10} className="inline mr-1" />
                      {t("Fills")}
                    </span>
                    <span className="font-mono text-primary">{s.counts?.fills ?? "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      <BarChart3 size={10} className="inline mr-1" />
                      {t("Strategies")}
                    </span>
                    <span className="font-mono text-primary">{s.counts?.strategies ?? "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      <TrendingUp size={10} className="inline mr-1" />
                      {t("Capital")}
                    </span>
                    <span className="font-mono text-primary">
                      {s.summary?.capital_base
                        ? formatCurrency(s.summary.capital_base, s.base_currency)
                        : "—"}
                    </span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      {t("Approx. Net PnL")}
                    </span>
                    <span className={`font-mono text-sm font-semibold ${
                      s.summary?.cumulative_pnl
                        ? Number(s.summary.cumulative_pnl) >= 0
                          ? "text-pnl-gain"
                          : "text-pnl-loss"
                        : "text-muted"
                    }`}>
                      {s.summary?.cumulative_pnl
                        ? formatCurrency(s.summary.cumulative_pnl, s.base_currency)
                        : "—"}
                    </span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">{t("Last Ingest")}</span>
                    <span className="font-mono text-xs text-secondary">
                      {s.last_ingest_at ? new Date(s.last_ingest_at).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border-default bg-surface p-8 text-center">
            <Layers size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-secondary">{t("No series yet")}</p>
            <p className="text-xs text-muted mt-1">{t("Create a series via the API to get started")}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hierarchy breadcrumb + controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <HierarchyNav
            seriesName={seriesName}
            seriesId={params.series ?? 0}
            level={level}
            strategies={data?.meta.strategies ?? []}
            symbols={data?.meta.symbols ?? []}
            selectedStrategy={params.strategy}
            selectedSymbol={params.symbol}
            onBackToOverview={() => setSearchParams(new URLSearchParams())}
            onBackToAccount={() => update({ strategy: undefined, symbol: undefined })}
            onBackToStrategy={() => update({ symbol: undefined })}
            onSelectStrategy={(s) => update({ strategy: s, symbol: undefined })}
            onSelectSymbol={(s) => update({ symbol: s })}
          />
        </div>
      </div>

      {/* Date range — dedicated line */}
      <DateRangePicker
        from={params.from}
        to={params.to}
        onChange={(range) => update({ from: range.from, to: range.to })}
      />

      {/* Error */}
      {isError && <AlertBanner message={t("Couldn't load metrics.")} onRetry={() => refetch()} />}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonChart />
        </div>
      )}

      {/* Data */}
      {data && (
        <>
          {/* Flag banners — read from flags, never recomputed */}
          {data.meta.flags.fx_missing && <FxMissingBanner />}
          {data.meta.flags.low_sample && <LowSampleFootnote />}

          {/* Metric cards */}
          <MetricCardGrid envelope={data} />

          {/* Symbol-level contribution bars (account/strategy level) */}
          {!isSymbol && data.symbol_contributions && data.symbol_contributions.length > 0 && (
            <ContributionBars
              contributions={data.symbol_contributions}
              baseCurrency={data.meta.base_currency}
            />
          )}

          {/* Symbol-level contribution card (symbol level only) */}
          {isSymbol && data.metrics.contribution_pct != null && (
            <ContributionCard value={data.metrics.contribution_pct} />
          )}

          {/* Charts — hidden at symbol level (no return-based metrics) */}
          {!isSymbol && (
            <>
              <EquityChart
                points={data.equity_curve}
                baseCurrency={data.meta.base_currency}
                mode={equityMode}
                onModeChange={setEquityMode}
              />
              <DrawdownChart
                points={data.drawdown_series}
                baseCurrency={data.meta.base_currency}
                showCaveat={data.meta.flags.open_positions_exist}
                mode={drawdownMode}
                onModeChange={setDrawdownMode}
              />
            </>
          )}

          {/* Suppressed flags footnote */}
          {data.meta.flags.sharpe_suppressed && (
            <p className="text-xs text-warning">
              {t("Sharpe/Sortino suppressed — fewer than 5 round-trips in range.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
