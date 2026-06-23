import { create } from "zustand";

interface CompareTrayState {
  ids: number[];
  toggle: (id: number) => void;
  clear: () => void;
}

export const useCompareTray = create<CompareTrayState>((set) => ({
  ids: [],
  toggle: (id) =>
    set((s) => ({
      ids: s.ids.includes(id) ? s.ids.filter((i) => i !== id) : [...s.ids, id],
    })),
  clear: () => set({ ids: [] }),
}));
