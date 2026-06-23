import { useTranslation } from "react-i18next";
import type { InstrumentSpec } from "../lib/types";

export default function InstrumentReviewPanel({ instruments }: { instruments: InstrumentSpec[] }) {
  const { t } = useTranslation("dashboard");
  const needReview = instruments.filter((i) => i.inferred);

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        {t("Instruments")}
        {needReview.length > 0 && (
          <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning">
            {t("{{count}} need review", { count: needReview.length })}
          </span>
        )}
      </h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-1">{t("Symbol")}</th>
            <th>{t("Asset class")}</th>
            <th>{t("Multiplier")}</th>
            <th>{t("Currency")}</th>
            <th>{t("Status")}</th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((ins) => (
            <tr key={ins.symbol} className="border-t border-border-subtle">
              <td className="py-1.5 font-mono text-secondary">{ins.symbol}</td>
              <td className="text-secondary">{ins.asset_class}</td>
              <td className="font-mono text-secondary">{ins.multiplier}</td>
              <td className="text-secondary">{ins.currency}</td>
              <td>
                {ins.inferred ? (
                  <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning">{t("⚠ inferred — review")}</span>
                ) : (
                  <span className="text-muted">{t("confirmed")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
