import { create } from "zustand";

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbStore {
  segments: BreadcrumbSegment[];
  setSegments: (segments: BreadcrumbSegment[]) => void;
}

export const useBreadcrumbStore = create<BreadcrumbStore>((set) => ({
  segments: [],
  setSegments: (segments) => set({ segments }),
}));
