// Presentation helpers only. No financial computation lives in the frontend.
export function formatRelative(iso: string, locale?: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(diffSec);
  const loc = locale || navigator.language;
  if (abs < 60) return loc.startsWith("zh") ? "刚刚" : "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}${loc.startsWith("zh") ? "分钟前" : "m ago"}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}${loc.startsWith("zh") ? "小时前" : "h ago"}`;
  return new Date(iso).toLocaleDateString(loc);
}

// ── Phase 7+ display formatters (pure, no financial math) ──

export function formatCurrency(value: string, ccy: string, locale?: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  try {
    return new Intl.NumberFormat(locale || navigator.language, { style: "currency", currency: ccy }).format(n);
  } catch {
    return `${ccy} ${n.toFixed(2)}`;
  }
}

export function formatPercent(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return `${(n * 100).toFixed(1)}%`;
}

export function formatRatio(value: string, dp = 2): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toFixed(dp);
}

export function formatSeconds(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function glyphFor(sign: -1 | 0 | 1): string {
  if (sign === 1) return "▲";
  if (sign === -1) return "▼";
  return "";
}

export function pnlClassFor(value: string, _scheme: "red-up" | "green-up"): string {
  void _scheme; // kept for API contract — hue resolved by CSS [data-pnl]
  const n = Number(value);
  // Sign → semantic class; hue resolved by CSS via [data-pnl] attribute
  if (n > 0) return "text-pnl-gain";
  if (n < 0) return "text-pnl-loss";
  return "text-pnl-neutral";
}

