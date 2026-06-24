import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import RegisterPage from "./RegisterPage";
import { server } from "../test/setup";
import { renderWithProviders } from "../lib/test-utils";

function renderRegister() {
  return renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<div>dashboard-ish landing</div>} />
      <Route path="/awaiting-approval" element={<div>awaiting page</div>} />
    </Routes>,
    { route: "/register" },
  );
}

async function fill(email: string, pw: string, confirm = pw) {
  await userEvent.type(screen.getByLabelText(/^email/i), email);
  await userEvent.type(screen.getByLabelText(/^password/i), pw);
  await userEvent.type(screen.getByLabelText(/confirm/i), confirm);
  await userEvent.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterPage", () => {
  it("on 201 shows pending-approval confirmation and does NOT enter dashboard (I1)", async () => {
    server.use(
      http.post("/liveboard/api/v1/auth/register", () =>
        HttpResponse.json({ id: 1, email: "n@x.c", role: "user", status: "pending", created_at: "x" }, { status: 201 }),
      ),
    );
    renderRegister();
    await fill("n@x.c", "longenoughpw");
    expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to status/i })).toHaveAttribute("href", "/awaiting-approval");
    expect(screen.queryByText("dashboard-ish landing")).not.toBeInTheDocument();
  });

  it("on 409 shows an email-already-registered inline error", async () => {
    server.use(
      http.post("/liveboard/api/v1/auth/register", () =>
        HttpResponse.json({ error: { code: "conflict", message: "email exists" } }, { status: 409 }),
      ),
    );
    renderRegister();
    await fill("dupe@x.c", "longenoughpw");
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });

  it("blocks submit when confirm does not match (client-side validation)", async () => {
    renderRegister();
    await fill("n@x.c", "longenoughpw", "different");
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });
});
