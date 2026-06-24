import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import SettingsPage from "./SettingsPage";
import { server } from "../test/setup";
import { ToastProvider } from "../components/Toast";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>,
    { route: "/settings" },
  );
}

describe("SettingsPage", () => {
  it("renders an empty state when there are no keys", async () => {
    server.use(http.get("/liveboard/api/v1/api-keys", () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it("lists keys with name, prefix, last used and created (J2)", async () => {
    server.use(
      http.get("/liveboard/api/v1/api-keys", () =>
        HttpResponse.json([
          { id: 1, name: "ingest-bot", prefix: "lb_8f3a", last_used_at: "2026-06-18T14:02:00Z", created_at: "2026-06-01T00:00:00Z" },
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("ingest-bot")).toBeInTheDocument();
    expect(screen.getByText(/lb_8f3a/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
  });

  it("revokes a key and removes it from the list (J2)", async () => {
    let listed = [
      { id: 1, name: "ingest-bot", prefix: "lb_8f3a", last_used_at: null, created_at: "2026-06-01T00:00:00Z" },
    ];
    server.use(
      http.get("/liveboard/api/v1/api-keys", () => HttpResponse.json(listed)),
      http.delete("/liveboard/api/v1/api-keys/1", () => {
        listed = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /revoke/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByText("ingest-bot")).not.toBeInTheDocument());
  });
});
