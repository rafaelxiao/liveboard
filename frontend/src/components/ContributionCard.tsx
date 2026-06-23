import { formatPercent } from "../lib/format";

export default function ContributionCard({ value }: { value: string | null }) {
  if (value === null || value === undefined) return null;
  const pct = Number(value);
  const display = formatPercent(value);
  const barWidth = Math.min(Math.max(pct * 100, 0), 100);

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted">Contribution to Strategy</div>
      <div className="mb-1 font-mono text-lg font-medium text-primary">{display}</div>
      <div className="h-2 w-full rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}
