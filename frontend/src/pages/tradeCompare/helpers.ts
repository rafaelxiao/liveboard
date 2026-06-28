import type { FillOut } from "../../lib/types";

export interface RoundTrip {
  buys: FillOut[];
  sells: FillOut[];
}

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtPnl(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

export function r2(v: number): string {
  return v.toFixed(2);
}

export function pairFills(fills: FillOut[]): RoundTrip[] {
  const result: RoundTrip[] = [];
  const bQueue: FillOut[] = [];
  for (const f of fills) {
    if (f.side === "buy") {
      bQueue.push(f);
    } else {
      if (bQueue.length > 0) {
        result.push({ buys: [...bQueue], sells: [f] });
        bQueue.length = 0;
      }
    }
  }
  if (bQueue.length > 0) {
    result.push({ buys: [...bQueue], sells: [] });
  }
  return result;
}

export function calcDailyPnl(fills: FillOut[]): number {
  let pnl = 0;
  const bQueue: FillOut[] = [];
  for (const f of fills) {
    if (f.side === "buy") {
      bQueue.push(f);
    } else if (bQueue.length > 0) {
      const buy = bQueue[bQueue.length - 1];
      pnl += (parseFloat(f.price) - parseFloat(buy.price)) * parseFloat(f.qty);
      bQueue.length = 0;
    }
  }
  return pnl;
}
