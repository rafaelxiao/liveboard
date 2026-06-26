import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useMetrics } from "../state/useMetrics";
import { useSeriesList } from "../state/useSeries";
import { searchToParams, paramsToSearch, DEFAULT_PARAMS, type DashboardParams } from "../lib/dashboardParams";
import { useBreadcrumbStore } from "../state/breadcrumbStore";
import { useTradeGroupingStore } from "../state/tradeGroupingStore";
import MetricCardGrid from "../components/MetricCardGrid";
import HierarchyNav from "../components/HierarchyNav";
import DateRangePicker from "../components/DateRangePicker";

import EquityChart from "../components/EquityChart";
import DrawdownChart from "../components/DrawdownChart";
import ContributionBars from "../components/ContributionBars";
import AlertBanner from "../components/AlertBanner";
import { FxMissingBanner, LowSampleFootnote } from "../components/FlagBanners";
import { SkeletonCard, SkeletonChart } from "../components/SkeletonCard";
import { Layers, Hash, ArrowRight } from "lucide-react";
import { formatCurrency } from "../lib/format";
import ShareDialog from "../components/ShareDialog";
import Modal from "../components/Modal";
import Select from "../components/Select";
import { createSeries } from "../state/useSeriesCreate";

function CreateSeriesButton({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("live");
  const [currency, setCurrency] = useState("CNY");
  const [tz] = useState("Asia/Shanghai");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSubmitting(true);
    setError("");
    try {
      await createSeries({ name: name.trim(), tag: tag as "live" | "sim", base_currency: currency, session_tz: tz });
      setName("");
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs text-secondary hover:text-primary hover:border-accent">
        + {t("New series")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("New series")}>
        <div className="space-y-3">
          <label className="text-xs text-secondary block">
            {t("Name")}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-series" className="mt-1 block w-full rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary h-8" />
          </label>
          <Select label={t("Tag")} value={tag} onChange={(e) => setTag(e.target.value)} className="w-full">
            <option value="live">live</option>
            <option value="sim">sim</option>
          </Select>
          <label className="text-xs text-secondary block">
            {t("Currency")}
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 block w-full rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary h-8" />
          </label>
          {error && <p className="text-xs text-pnl-loss">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} disabled={submitting} className="rounded-md bg-accent text-white px-4 py-1.5 text-xs font-medium disabled:opacity-50">
              {submitting ? "..." : t("Create")}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-md border border-border-default px-3 py-1.5 text-xs text-secondary">
              {t("Cancel")}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawParams = searchParams.get("series")
    ? searchToParams(searchParams.toString())
    : DEFAULT_PARAMS;

  // Always derive level from strategy/symbol, ignoring the URL level param
  const params: DashboardParams = {
    ...rawParams,
    level: rawParams.symbol ? "symbol" : rawParams.strategy ? "strategy" : "account",
  };

  const tradeGrouping = useTradeGroupingStore((s) => s.grouping);

  const effectiveParams = { ...params, trade_grouping: tradeGrouping };

  const { data, isLoading, isError, refetch } = useMetrics(effectiveParams);
  const { data: seriesList, refetch: refetchSeries } = useSeriesList();
  const [equityMode, setEquityMode] = useState<"absolute" | "indexed">("absolute");
  const [drawdownMode, setDrawdownMode] = useState<"absolute" | "indexed">("absolute");

  // Cache last-known strategies/symbols so nav doesn't flash during refetch
  const lastStrategies = useRef<string[]>([]);
  const lastSymbols = useRef<string[]>([]);
  if (data) {
    lastStrategies.current = data.meta.strategies ?? [];
    lastSymbols.current = data.meta.symbols ?? [];
  }

  const deriveLevel = (p: Partial<DashboardParams>): "account" | "strategy" | "symbol" => {
    const symbol = "symbol" in p ? p.symbol : params.symbol;
    const strategy = "strategy" in p ? p.strategy : params.strategy;
    return symbol ? "symbol" : strategy ? "strategy" : "account";
  };

  const update = useCallback(
    (patch: Partial<DashboardParams>) => {
      const next = { ...params, ...patch, level: deriveLevel(patch) };
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
    setBreadcrumb([]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const isSymbol = level === "symbol";

  // Series overview — no series selected yet
  if (!params.series) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-primary">{t("Dashboard", { ns: "common" })}</h1>
          <CreateSeriesButton onCreated={refetchSeries} />
        </div>
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
                    {t(s.tag || "live")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">{t("Currency")}</span>
                    <span className="font-mono text-primary">{s.base_currency}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      <Hash size={10} className="inline mr-1" />{t("Fills")}
                    </span>
                    <span className="font-mono text-primary">{s.counts?.fills ?? "—"}</span>
                  </div>
                  <div className="col-span-2 border-t border-border-subtle pt-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] uppercase tracking-wide text-muted">{t("Start Capital")}</span>
                      <span className="font-mono text-sm font-semibold text-primary">
                        {s.summary?.capital_base ? formatCurrency(s.summary.capital_base, s.base_currency) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] uppercase tracking-wide text-muted">{t("Net PnL")}</span>
                      <span className={`font-mono text-sm font-semibold ${
                        s.summary?.cumulative_pnl
                          ? Number(s.summary.cumulative_pnl) >= 0 ? "text-pnl-gain" : "text-pnl-loss"
                          : "text-muted"
                      }`}>
                        {s.summary?.cumulative_pnl ? formatCurrency(s.summary.cumulative_pnl, s.base_currency) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] uppercase tracking-wide text-muted">{t("End Capital")}</span>
                      <span className={`font-mono text-sm font-semibold ${
                        s.summary?.end_capital
                          ? Number(s.summary.end_capital) >= Number(s.summary.capital_base || "0") ? "text-pnl-gain" : "text-pnl-loss"
                          : "text-muted"
                      }`}>
                        {s.summary?.end_capital ? formatCurrency(s.summary.end_capital, s.base_currency) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2 border-t border-border-subtle pt-2">
                    <div className="grid grid-cols-3 gap-x-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted">{t("Return")}</span>
                        <span className={`font-mono text-sm font-semibold ${
                          s.summary?.return_pct
                            ? Number(s.summary.return_pct) >= 0 ? "text-pnl-gain" : "text-pnl-loss"
                            : "text-muted"
                        }`}>
                          {s.summary?.return_pct ? (Number(s.summary.return_pct) * 100).toFixed(2) + "%" : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted">{t("Sharpe")}</span>
                        <span className={`font-mono text-sm font-semibold ${
                          s.summary?.sharpe
                            ? Number(s.summary.sharpe) >= 1 ? "text-pnl-gain" : Number(s.summary.sharpe) >= 0 ? "text-accent" : "text-pnl-loss"
                            : "text-muted"
                        }`}>
                          {s.summary?.sharpe ? Number(s.summary.sharpe).toFixed(3) : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted">{t("Max Drawdown")}</span>
                        <span className="font-mono text-sm font-semibold text-pnl-loss">
                          {s.summary?.max_drawdown_pct
                            ? (Number(s.summary.max_drawdown_pct) * 100).toFixed(1) + "%"
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 border-t border-border-subtle pt-1.5">
                    <span className="text-[10px] text-muted flex items-center gap-1">
                      {s.summary?.trade_start && s.summary?.trade_end ? (
                        <>{s.summary.trade_start} <ArrowRight size={12} className="inline-block align-middle" /> {s.summary.trade_end}</>
                      ) : s.last_ingest_at ? (
                        `Ingested ${new Date(s.last_ingest_at).toLocaleDateString()}`
                      ) : "—"}
                    </span>
                  </div>
                  <div className="col-span-2 border-t border-border-subtle pt-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-xs font-medium text-accent hover:bg-accent/20 cursor-pointer transition-colors"
                      role="button"
                      onClick={(e) => { e.stopPropagation(); window.open(`${import.meta.env.BASE_URL}series/${s.id}/account`, '_self'); }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {t("dashboard:Account")}
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
            strategies={lastStrategies.current}
            symbols={lastSymbols.current}
            selectedStrategy={params.strategy}
            selectedSymbol={params.symbol}
            onBackToOverview={() => setSearchParams(new URLSearchParams())}
            onSelectStrategy={(s) => update({ strategy: s || undefined, symbol: undefined })}
            onSelectSymbol={(s) => update({ symbol: s })}
          />
        </div>
        {params.series && (
          <ShareDialog
            seriesId={params.series}
            seriesName={seriesName}
            tradeStart={seriesList?.find((s) => s.id === params.series)?.summary?.trade_start}
          />
        )}
      </div>

      {/* Date range */}
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

          {/* Charts */}
          <EquityChart
            series={[{ name: "", points: data.equity_curve }]}
            baseCurrency={data.meta.base_currency}
            mode={equityMode}
            onModeChange={setEquityMode}
            hideModeToggle={isSymbol}
          />
          <DrawdownChart
            series={[{ name: "", points: data.drawdown_series }]}
            baseCurrency={data.meta.base_currency}
            showCaveat={data.meta.flags.open_positions_exist}
            mode={drawdownMode}
            onModeChange={setDrawdownMode}
          />

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
