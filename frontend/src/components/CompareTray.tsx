import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCompareTray } from "../state/compareTrayStore";
import type { SeriesSummary } from "../lib/types";

export default function CompareTray({ series }: { series: SeriesSummary[] }) {
  const { t } = useTranslation();
  const { ids, clear } = useCompareTray();
  if (ids.length === 0) return null;

  const staged = series.filter((s) => ids.includes(s.id));
  const baselineCcy = staged[0]?.base_currency;

  return (
    <div className="fixed bottom-0 left-60 right-0 z-20 border-t border-border-default bg-surface p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-primary">{t("{{count}} series staged", { count: staged.length })}</span>
          {staged.map((s) => (
            <span key={s.id} className="text-sm text-secondary">
              {s.name}
              {s.base_currency !== baselineCcy && (
                <span className="ml-1 rounded bg-warning/20 px-1 text-xs text-warning">
                  {t("currency mismatch")}
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {staged.length >= 2 && (
            <Link
              to={`/compare?series=${ids.join(",")}`}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white"
            >
              {t("Compare")} →
            </Link>
          )}
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-border-default px-3 py-1 text-sm text-secondary"
          >
            {t("Clear")}
          </button>
        </div>
      </div>
    </div>
  );
}
