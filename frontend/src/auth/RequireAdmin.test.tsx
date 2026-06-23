import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderWithProviders } from "../lib/test-utils";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";
import RequireAdmin from "./RequireAdmin";

function AdminPage() {
  return <div>admin users page</div>;
}
function SeriesStub() {
  return <div>dashboard landing</div>;
}

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAdmin />}>
        <Route path="/admin/users" element={<AdminPage />} />
      </Route>
      <Route path="/dashboard" element={<SeriesStub />} />
    </Routes>,
    { route: "/admin/users" },
  );
}

describe("RequireAdmin (K1)", () => {
  beforeEach(() => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().clear();
  });

  it("redirects a non-admin user away from the admin route", () => {
    useAuthStore.getState().setUser({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" });
    renderGuarded();
    expect(screen.getByText("dashboard landing")).toBeInTheDocument();
    expect(screen.queryByText("admin users page")).not.toBeInTheDocument();
  });

  it("renders the admin outlet for an admin user", () => {
    useAuthStore.getState().setUser({ id: 2, email: "a@x.c", role: "admin", status: "approved", created_at: "x" });
    renderGuarded();
    expect(screen.getByText("admin users page")).toBeInTheDocument();
  });
});
