import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";

import { login as apiLogin, me as apiMe } from "../api/auth";
import type { UserOut } from "../lib/types";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

interface AuthContextValue {
  user: UserOut | null;
  isAuthed: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  login: (email: string, password: string) => Promise<UserOut>;
  logout: () => void;
  refreshMe: () => Promise<UserOut>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const accessToken = useTokenStore((s) => s.accessToken);
  const setTokens = useTokenStore((s) => s.setTokens);
  const clearTokens = useTokenStore((s) => s.clear);

  // Load user on mount if token exists but user not yet loaded (e.g. page refresh)
  useEffect(() => {
    if (accessToken && !user) {
      apiMe().then(setUser).catch(() => {
        clearTokens();
        setUser(null);
      });
    }
  }, [accessToken, user, setUser, clearTokens]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await apiLogin(email, password);
      setTokens(tokens);
      const fetched = await apiMe();
      setUser(fetched);
      return fetched;
    },
    [setTokens, setUser],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, [clearTokens, setUser]);

  const refreshMe = useCallback(async () => {
    const fetched = await apiMe();
    setUser(fetched);
    return fetched;
  }, [setUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthed: Boolean(accessToken),
      isAdmin: user?.role === "admin",
      isApproved: user?.status === "approved",
      login,
      logout,
      refreshMe,
    }),
    [user, accessToken, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
