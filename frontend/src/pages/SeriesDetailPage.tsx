import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSeriesDetail } from "../state/useSeries";
import AlertBanner from "../components/AlertBanner";
import InstrumentReviewPanel from "../components/InstrumentReviewPanel";
import FxRatesPanel from "../components/FxRatesPanel";
import { formatRelative } from "../lib/format";

export default function SeriesDetailPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useSeriesDetail(Number(id));

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-md bg-surface-2" />;
  }
  if (isError || !data) {
    return <AlertBanner message={t("dashboard:Couldn't load series details.")} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-primary">{data.name}</h1>
          <p className="text-sm text-muted">
            {data.base_currency} · {data.session_tz}
            {data.tag && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs">{data.tag}</span>}
          </p>
          {data.notes && <p className="mt-1 text-sm text-secondary">{data.notes}</p>}
        </div>
        <Link
          to={`/dashboard?series=${data.id}`}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          {t("dashboard:Open in Dashboard →")}
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t("dashboard:Strategies")}</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1">{t("dashboard:Name")}</th>
              <th>{t("dashboard:Key")}</th>
              <th>{t("dashboard:Fills")}</th>
            </tr>
          </thead>
          <tbody>
            {data.strategies.map((s) => (
              <tr key={s.id} className="border-t border-border-subtle">
                <td className="py-1.5 text-secondary">{s.name}</td>
                <td className="font-mono text-muted">{s.name_key}</td>
                <td className="font-mono text-secondary">
                  {s.fills != null ? new Intl.NumberFormat("en-US").format(s.fills) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t("dashboard:Discovered Symbols")}</h2>
        <div className="flex flex-wrap gap-2">
          {data.symbols.map((sym) => (
            <span key={sym} className="rounded-full bg-surface-2 px-3 py-1 text-sm font-mono text-secondary">
              {sym}
            </span>
          ))}
        </div>
      </div>

      <InstrumentReviewPanel instruments={data.instruments} />
      <FxRatesPanel
        rates={data.fx_rates ?? []}
        missingCount={data.fx_missing_count ?? 0}
        ingestion={data.ingestion ?? { rejected: 0 }}
      />

      <div className="text-xs text-muted">
        {t("dashboard:Created")} {formatRelative(data.created_at)}
        {data.ingestion?.last_batch_at && ` · ${t("dashboard:Last Ingest")} ${formatRelative(data.ingestion.last_batch_at)}`}
        {data.ingestion?.rejected != null && ` · ${data.ingestion.rejected} ${t("dashboard:rejected")}`}
      </div>
    </div>
  );
}
