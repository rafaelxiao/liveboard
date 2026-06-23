import { create } from "zustand";

export type PnlScheme = "red-up" | "green-up";

function readInitial(): PnlScheme {
  const attr = document.documentElement.getAttribute("data-pnl");
  return attr === "green-up" ? "green-up" : "red-up"; // red-up default (UX §1.2)
}

function apply(scheme: PnlScheme): void {
  document.documentElement.setAttribute("data-pnl", scheme);
  localStorage.setItem("lb_pnl_color_scheme", scheme);
}

interface PnlState {
  scheme: PnlScheme;
  setScheme: (scheme: PnlScheme) => void;
  toggle: () => void;
}

export const usePnlStore = create<PnlState>((set, get) => ({
  scheme: readInitial(),
  setScheme: (scheme) => {
    apply(scheme);
    set({ scheme });
  },
  toggle: () => get().setScheme(get().scheme === "red-up" ? "green-up" : "red-up"),
}));
