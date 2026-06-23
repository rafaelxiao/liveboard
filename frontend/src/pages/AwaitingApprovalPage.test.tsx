import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import AwaitingApprovalPage from "./AwaitingApprovalPage";
import { server } from "../test/setup";
import { AuthProvider } from "../auth/AuthContext";
import { useAuthStore } from "../auth/authStore";
import { useTokenStore } from "../auth/tokenStore";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />
        <Route path="/dashboard" element={<div>dashboard landing</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </AuthProvider>,
    { route: "/awaiting-approval" },
  );
}

describe("AwaitingApprovalPage", () => {
  beforeEach(() => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" });
  });

  it("shows the pending explanation with the user's email", () => {
    renderPage();
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByText(/p@x\.c/)).toBeInTheDocument();
  });

  it("Check status routes to /dashboard once the account is approved", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "p@x.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /check status/i }));
    await waitFor(() => expect(screen.getByText("dashboard landing")).toBeInTheDocument());
  });

  it("Check status while still pending shows a gentle still-pending note", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" }),
      ),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /check status/i }));
    expect(await screen.findByText(/still pending/i)).toBeInTheDocument();
  });

  it("Log out clears tokens and returns to /login", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
    expect(useTokenStore.getState().accessToken).toBeNull();
  });
});
