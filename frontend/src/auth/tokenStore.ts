import { create } from "zustand";

import { refresh } from "../api/auth";
import { configureClient } from "../api/client";
import type { TokenPair } from "../lib/types";

interface TokenState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (tokens: TokenPair) => void;
  clear: () => void;
  silentRefresh: () => Promise<boolean>;
}

export const useTokenStore = create<TokenState>((set, get) => ({
  accessToken: localStorage.getItem("lb_access"),
  refreshToken: localStorage.getItem("lb_refresh"),

  setTokens: ({ access_token, refresh_token }) => {
    localStorage.setItem("lb_access", access_token);
    localStorage.setItem("lb_refresh", refresh_token);
    set({ accessToken: access_token, refreshToken: refresh_token });
  },

  clear: () => {
    localStorage.removeItem("lb_access");
    localStorage.removeItem("lb_refresh");
    set({ accessToken: null, refreshToken: null });
  },

  silentRefresh: async () => {
    const token = get().refreshToken;
    if (!token) return false;
    try {
      const { access_token } = await refresh(token);
      localStorage.setItem("lb_access", access_token);
      set({ accessToken: access_token });
      return true;
    } catch {
      get().clear();
      return false;
    }
  },
}));

// Wire the API client to read tokens + perform silent refresh on 401.
configureClient({
  getAccessToken: () => useTokenStore.getState().accessToken,
  refreshAndRetry: () => useTokenStore.getState().silentRefresh(),
});
