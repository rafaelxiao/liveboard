export function FxMissingBanner() {
  return (
    <div role="alert" className="rounded-md border border-warning bg-surface-2 px-3 py-2 text-sm text-warning">
      Some fills are missing FX rates and are excluded from base-currency aggregates.
    </div>
  );
}

export function LowSampleFootnote() {
  return (
    <p className="text-xs text-warning">
      Low sample — interpret with care (fewer than 20 round-trips or 30 active days).
    </p>
  );
}
