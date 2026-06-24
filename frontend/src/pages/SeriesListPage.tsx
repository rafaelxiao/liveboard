import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSeriesList, useCreateSeries } from "../state/useSeries";
import AlertBanner from "../components/AlertBanner";
import EmptyState from "../components/EmptyState";
import { useCompareTray } from "../state/compareTrayStore";
import CompareTray from "../components/CompareTray";
import { formatRelative } from "../lib/format";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY"];
const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Hong_Kong", "Australia/Sydney", "UTC",
];

export default function SeriesListPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const { data, isLoading, isError, refetch } = useSeriesList();
  const createMutation = useCreateSeries();
  const { ids: staged, toggle: toggleCompare } = useCompareTray();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("");
  const [sessionTz, setSessionTz] = useState("");
  const [tag, setTag] = useState("");
  const [notes, setNotes] = useState("");

  const series = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary">{t("dashboard:Series")}</h1>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          {t("dashboard:New series")}
        </button>
      </div>

      {isError && <AlertBanner message={t("dashboard:Couldn't load series.")} onRetry={() => refetch()} />}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
      )}

      {!isLoading && series.length === 0 && (
        <EmptyState
          title={t("dashboard:No series yet")}
          description={t("dashboard:Create one to start tracking trades.")}
          action={
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white"
            >
              {t("dashboard:New series")}
            </button>
          }
        />
      )}

      {series.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">{t("dashboard:Name")}</th>
              <th>{t("dashboard:Tag")}</th>
              <th>{t("dashboard:Currency")}</th>
              <th>{t("dashboard:Strategies")}</th>
              <th>{t("dashboard:Fills")}</th>
              <th>{t("dashboard:Last Ingest")}</th>
              <th>{t("dashboard:Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id} className="border-t border-border-subtle">
                <td className="py-2 text-secondary">{s.name}</td>
                <td className="text-muted">{s.tag ?? "—"}</td>
                <td className="font-mono text-secondary">{s.base_currency}</td>
                <td className="font-mono text-secondary">
                  {s.counts?.strategies ?? "—"}
                </td>
                <td className="font-mono text-secondary">
                  {s.counts?.fills != null
                    ? new Intl.NumberFormat("en-US").format(s.counts.fills)
                    : "—"}
                </td>
                <td className="text-muted">
                  {s.last_ingest_at ? formatRelative(s.last_ingest_at) : "—"}
                </td>
                <td>
                  <div className="flex gap-2">
                    <Link
                      to={`/dashboard?series=${s.id}`}
                      className="text-accent hover:underline"
                    >
                      {t("dashboard:Open")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleCompare(s.id)}
                      className={`text-sm ${staged.includes(s.id) ? "text-accent" : "text-muted hover:text-secondary"}`}
                    >
                      {staged.includes(s.id) ? "✓" : t("dashboard:Compare +")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {staged.length > 0 && <CompareTray series={series} />}

      {/* New series dialog */}
      {showForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg border border-border-default bg-surface-2 p-6">
            <h2 className="mb-4 text-lg font-semibold text-primary">{t("dashboard:New series")}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({ name, base_currency: baseCurrency, session_tz: sessionTz, tag: tag || undefined, notes: notes || undefined });
                setShowForm(false);
                setName("");
                setTag("");
                setNotes("");
              }}
              className="space-y-3"
            >
              <div>
                <label htmlFor="series-name" className="mb-1 block text-xs uppercase text-muted">{t("dashboard:Name")}</label>
                <input id="series-name" value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-sm border border-border-default bg-surface px-2 py-1.5 text-sm text-secondary" />
              </div>
              <div>
                <label htmlFor="series-tag" className="mb-1 block text-xs uppercase text-muted">{t("dashboard:Tag")}</label>
                <select id="series-tag" value={tag} onChange={(e) => setTag(e.target.value)}
                  className="w-full rounded-sm border border-border-default bg-surface px-2 py-1.5 text-sm text-secondary">
                  <option value="">{t("dashboard:Select tag")}</option>
                  <option value="live">{t("live")}</option>
                  <option value="sim">{t("sim")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="series-ccy" className="mb-1 block text-xs uppercase text-muted">{t("dashboard:Base currency")}</label>
                <select id="series-ccy" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}
                  className="w-full rounded-sm border border-border-default bg-surface px-2 py-1.5 text-sm text-secondary">
                  <option value="">{t("dashboard:Select currency")}</option>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="series-tz" className="mb-1 block text-xs uppercase text-muted">{t("dashboard:Time zone")}</label>
                <select id="series-tz" value={sessionTz} onChange={(e) => setSessionTz(e.target.value)}
                  className="w-full rounded-sm border border-border-default bg-surface px-2 py-1.5 text-sm text-secondary">
                  <option value="">{t("dashboard:Select timezone")}</option>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="series-notes" className="mb-1 block text-xs uppercase text-muted">{t("dashboard:Notes")}</label>
                <input id="series-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-sm border border-border-default bg-surface px-2 py-1.5 text-sm text-secondary" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-md border border-border-default px-3 py-1.5 text-sm text-secondary">{t("common:Cancel")}</button>
                <button type="submit" disabled={!name || !baseCurrency || !sessionTz}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                  {t("common:Create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
