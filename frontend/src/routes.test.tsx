import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AppRoutes from "./routes";
import { AuthProvider } from "./auth/AuthContext";
import { useAuthStore } from "./auth/authStore";
import { useTokenStore } from "./auth/tokenStore";
import { renderWithProviders } from "./lib/test-utils";

function renderApp(route: string) {
  return renderWithProviders(
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>,
    { route },
  );
}

describe("AppRoutes", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("shows the public login page at /login without auth", () => {
    renderApp("/login");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("redirects an unauthenticated visit to /settings back to login", () => {
    renderApp("/settings");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders the app shell with sidebar nav for an approved user at /dashboard", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "ok@x.c", role: "user", status: "approved", created_at: "x" });
    renderApp("/dashboard");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument();
  });
});
