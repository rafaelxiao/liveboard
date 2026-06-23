import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Sidebar from "./Sidebar";
import { useAuthStore } from "../auth/authStore";
import { renderWithProviders } from "../lib/test-utils";

describe("Sidebar", () => {
  beforeEach(() => useAuthStore.getState().clear());

  it("hides the Admin nav item for a non-admin user", () => {
    useAuthStore.getState().setUser({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" });
    renderWithProviders(<Sidebar />, { route: "/dashboard" });
    expect(screen.queryByRole("link", { name: /Admin/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
  });

  it("shows the Admin nav item for an admin user", () => {
    useAuthStore.getState().setUser({ id: 2, email: "a@x.c", role: "admin", status: "approved", created_at: "x" });
    renderWithProviders(<Sidebar />, { route: "/dashboard" });
    expect(screen.getByRole("link", { name: /Admin/i })).toBeInTheDocument();
  });
});
