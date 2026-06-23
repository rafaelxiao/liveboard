import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderWithProviders } from "../lib/test-utils";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";
import RequireAuth from "./RequireAuth";

function Protected() {
  return <div>protected content</div>;
}
function LoginStub() {
  return <div>login page</div>;
}
function AwaitingStub() {
  return <div>awaiting approval page</div>;
}

function renderGuarded(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/api-keys" element={<Protected />} />
      </Route>
      <Route path="/login" element={<LoginStub />} />
      <Route path="/awaiting-approval" element={<AwaitingStub />} />
    </Routes>,
    { route },
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("redirects an unauthenticated user to /login", () => {
    renderGuarded("/api-keys");
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("redirects an authed-but-pending user to /awaiting-approval (J3)", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" });
    renderGuarded("/api-keys");
    expect(screen.getByText("awaiting approval page")).toBeInTheDocument();
  });

  it("renders the protected outlet for an approved user", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "ok@x.c", role: "user", status: "approved", created_at: "x" });
    renderGuarded("/api-keys");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
