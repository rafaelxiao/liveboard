import { create } from "zustand";

import type { UserOut } from "../lib/types";
import { useTokenStore } from "./tokenStore";

interface AuthState {
  user: UserOut | null;
  setUser: (user: UserOut | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));

export const selectIsAuthed = (): boolean => Boolean(useTokenStore.getState().accessToken);
export const selectIsAdmin = (): boolean => useAuthStore.getState().user?.role === "admin";
export const selectIsApproved = (): boolean => useAuthStore.getState().user?.status === "approved";
