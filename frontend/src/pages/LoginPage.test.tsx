import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import LoginPage from "./LoginPage";
import { server } from "../test/setup";
import { AuthProvider } from "../auth/AuthContext";
import { useAuthStore } from "../auth/authStore";
import { useTokenStore } from "../auth/tokenStore";
import { renderWithProviders } from "../lib/test-utils";

function renderLogin(route = "/login") {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>dashboard landing</div>} />
        <Route path="/awaiting-approval" element={<div>awaiting page</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/email/i), "u@x.c");
  await userEvent.type(screen.getByLabelText(/password/i), "pw");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("captures a 403 and shows 'awaiting approval' (I2), not a generic error", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ error: { code: "forbidden", message: "awaiting approval" } }, { status: 403 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText(/awaiting admin approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /awaiting/i })).toHaveAttribute("href", "/awaiting-approval");
  });

  it("shows 'incorrect email or password' on 401", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ error: { code: "unauthorized", message: "bad creds" } }, { status: 401 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it("stores tokens and redirects to /dashboard on success (I3)", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ access_token: "a1", refresh_token: "r1" }),
      ),
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByText("dashboard landing")).toBeInTheDocument());
    expect(useTokenStore.getState().accessToken).toBe("a1");
  });
});
