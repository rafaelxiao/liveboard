import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import MetricCard from "./MetricCard";
import ConcentrationChart from "./ConcentrationChart";
import type { MetricsEnvelope } from "../lib/types";
import RealizedBadge from "./RealizedBadge";

type TFn = (key: string) => string;

interface MetricCardGridProps {
  envelope: MetricsEnvelope;
}

export default function MetricCardGrid({ envelope }: MetricCardGridProps) {
  const { t } = useTranslation("dashboard");
  const { meta, metrics } = envelope;
  const isSymbol = meta.level === "symbol";
  const ccy = meta.base_currency;

  // Always call all hooks — never conditionally
  const symbolCards = useMemo(() => getSymbolCards(metrics, ccy, t), [metrics, ccy, t]);
  const performance = useMemo(() => getPerformanceCards(metrics, ccy, meta, t), [metrics, ccy, meta, t]);
  const tradeBehavior = useMemo(() => getTradeBehaviorCards(metrics, ccy, t), [metrics, ccy, t]);

  if (isSymbol) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 responsive-card-grid">
          {symbolCards.map((c, i) => <MetricCard key={i} {...c} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-primary">{t("Performance")}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 responsive-card-grid">
          {performance.map((c, i) => <MetricCard key={i} {...c} />)}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-primary">{t("Trade Behavior")}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 responsive-card-grid">
          {tradeBehavior.map((c, i) => <MetricCard key={i} {...c} />)}
        </div>
      </section>
      {(envelope.metrics.concentration_curve.length > 0 || envelope.metrics.loss_concentration_curve.length > 0) && (
        <ConcentrationChart
          gainCurve={envelope.metrics.concentration_curve}
          lossCurve={envelope.metrics.loss_concentration_curve}
        />
      )}
    </div>
  );
}

function getPerformanceCards(m: MetricsEnvelope["metrics"], ccy: string, meta: MetricsEnvelope["meta"], t: TFn) {
  const endValue = String((parseFloat(meta.capital_base || "0") + parseFloat(m.net_pnl || "0")).toFixed(2));
  return [
    { label: t("Net PnL"), value: m.net_pnl, unit: "USD", baseCurrency: ccy, isPnl: true, badge: <RealizedBadge variant="header" /> },
    { label: t("End Value"), value: endValue, unit: "USD", baseCurrency: ccy },
    { label: t("Total Fees"), value: m.total_fees, unit: "USD", baseCurrency: ccy },
    { label: t("Max Drawdown"), value: m.max_drawdown, unit: "USD", baseCurrency: ccy, isPnl: true, badge: meta.flags.open_positions_exist ? <RealizedBadge variant="caveat" /> : undefined },
    { label: t("TWR"), value: m.twr, unit: "ratio", baseCurrency: ccy, display: "percent" as const },
    { label: t("CAGR"), value: m.cagr, unit: "ratio", baseCurrency: ccy, display: "percent" as const },
    { label: t("Volatility"), value: m.volatility, unit: "annualized_ratio", baseCurrency: ccy, display: "percent" as const },
    { label: t("Sharpe"), value: m.sharpe, unit: "ratio", baseCurrency: ccy, suppressed: meta.flags.sharpe_suppressed, lowSample: meta.flags.low_sample },
    { label: t("Sortino"), value: m.sortino, unit: "ratio", baseCurrency: ccy, suppressed: meta.flags.sharpe_suppressed, lowSample: meta.flags.low_sample },
    { label: t("Calmar"), value: m.calmar, unit: "ratio", baseCurrency: ccy },
  ];
}

function getTradeBehaviorCards(m: MetricsEnvelope["metrics"], ccy: string, t: TFn) {
  return [
    { label: t("Trade Count"), value: String(m.trade_count), unit: "count", baseCurrency: ccy },
    { label: t("Win Rate"), value: m.win_rate, unit: "ratio", baseCurrency: ccy, display: "percent" as const },
    { label: t("Profit Factor"), value: m.profit_factor, unit: "ratio", baseCurrency: ccy },
    { label: t("Payoff Ratio"), value: m.payoff_ratio, unit: "ratio", baseCurrency: ccy },
    { label: t("Expectancy"), value: m.expectancy, unit: "USD", baseCurrency: ccy, isPnl: true },
    { label: t("Avg Holding"), value: String(m.avg_holding_secs), unit: "seconds", baseCurrency: ccy },
    { label: t("Max Consec Wins"), value: String(m.max_consec_wins), unit: "count", baseCurrency: ccy },
    { label: t("Max Consec Losses"), value: String(m.max_consec_losses), unit: "count", baseCurrency: ccy },
    { label: t("Largest Win"), value: m.largest_win, unit: "USD", baseCurrency: ccy, isPnl: true },
    { label: t("Largest Loss"), value: m.largest_loss, unit: "USD", baseCurrency: ccy, isPnl: true },
  ];
}

function getSymbolCards(m: MetricsEnvelope["metrics"], ccy: string, t: TFn) {
  return [
    { label: t("Net PnL"), value: m.net_pnl, unit: "USD", baseCurrency: ccy, isPnl: true, badge: <RealizedBadge variant="header" /> },
    { label: t("Total Fees"), value: m.total_fees, unit: "USD", baseCurrency: ccy },
    { label: t("Win Rate"), value: m.win_rate, unit: "ratio", baseCurrency: ccy, display: "percent" as const },
    { label: t("Profit Factor"), value: m.profit_factor, unit: "ratio", baseCurrency: ccy },
    { label: t("Expectancy"), value: m.expectancy, unit: "USD", baseCurrency: ccy, isPnl: true },
    { label: t("Trade Count"), value: String(m.trade_count), unit: "count", baseCurrency: ccy },
    { label: t("Contribution"), value: m.contribution_pct, unit: "ratio", baseCurrency: ccy, display: "percent" as const },
  ];
}
