import { create } from "zustand";

const KEY = "lb_trade_grouping";

function read(): string {
  try {
    return localStorage.getItem(KEY) || "day";
  } catch {
    return "day";
  }
}

function write(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // ignore
  }
}

interface TradeGroupingState {
  grouping: string;
  setGrouping: (v: string) => void;
}

export const useTradeGroupingStore = create<TradeGroupingState>((set) => ({
  grouping: read(),
  setGrouping: (v) => {
    write(v);
    set({ grouping: v });
  },
}));
