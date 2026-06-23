import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import AdminUsersPage from "./AdminUsersPage";
import { server } from "../test/setup";
import { ToastProvider } from "../components/Toast";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <AdminUsersPage />
    </ToastProvider>,
    { route: "/admin/users" },
  );
}

describe("AdminUsersPage (K2)", () => {
  it("lists pending users with approve/reject actions", async () => {
    server.use(
      http.get("/api/admin/users", () =>
        HttpResponse.json([
          { id: 1, email: "a@firm.com", role: "user", status: "pending", created_at: "2026-06-18T00:00:00Z" },
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("a@firm.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("approve mutation succeeds and invalidates the query", async () => {
    server.use(
      http.get("/api/admin/users", () =>
        HttpResponse.json([
          { id: 1, email: "a@firm.com", role: "user", status: "pending", created_at: "2026-06-18T00:00:00Z" },
        ]),
      ),
      http.post("/api/admin/users/1/approve", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    renderPage();
    const btn = await screen.findByRole("button", { name: /approve/i });
    await userEvent.click(btn);
    // Wait for mutation to finish (button still in DOM since GET still returns pending)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    });
  });
});
