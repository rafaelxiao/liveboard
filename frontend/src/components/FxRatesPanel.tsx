import type { FxRateSummary } from "../lib/types";

export default function FxRatesPanel({
  rates,
  missingCount,
  ingestion,
}: {
  rates: FxRateSummary[];
  missingCount: number;
  ingestion: { last_batch_at?: string; rejected?: number; fills_missing_fx?: number };
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        FX Rates
        {missingCount > 0 && (
          <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning">
            {missingCount} fills missing FX
          </span>
        )}
      </h2>
      {rates.length === 0 ? (
        <p className="text-sm text-muted">No FX rates uploaded.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1">From</th>
              <th>To</th>
              <th>Latest rate</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={`${r.ccy_from}-${r.ccy_to}`} className="border-t border-border-subtle">
                <td className="py-1.5 text-secondary">{r.ccy_from}</td>
                <td className="text-secondary">{r.ccy_to}</td>
                <td className="font-mono text-secondary">{r.latest_rate}</td>
                <td className="font-mono text-secondary">{r.points} points</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ingestion.rejected != null && (
        <p className="mt-1 text-xs text-muted">
          {ingestion.rejected} rejected in last batch
        </p>
      )}
    </div>
  );
}
