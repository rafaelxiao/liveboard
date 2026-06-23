import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { renderWithProviders } from "./lib/test-utils";

describe("App bootstrap", () => {
  it("renders the LiveBoard brand wordmark", () => {
    renderWithProviders(
      <AuthProvider>
        <App />
      </AuthProvider>,
      { route: "/login" },
    );
    expect(screen.getByText(/LiveBoard/i)).toBeInTheDocument();
  });
});
