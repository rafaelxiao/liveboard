import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import PnlColorToggle from "./PnlColorToggle";
import { usePnlStore } from "../state/pnlStore";
import { renderWithProviders } from "../lib/test-utils";

describe("PnlColorToggle", () => {
  beforeEach(() => usePnlStore.setState({ scheme: "red-up" }));

  it("starts with red-up selected", () => {
    renderWithProviders(<PnlColorToggle />);
    expect(screen.getByRole("radio", { name: /red = gain/i, checked: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /green = gain/i, checked: false })).toBeInTheDocument();
  });

  it("switches to green-up on click", async () => {
    renderWithProviders(<PnlColorToggle />);
    await userEvent.click(screen.getByRole("radio", { name: /green = gain/i }));
    expect(usePnlStore.getState().scheme).toBe("green-up");
    expect(localStorage.getItem("lb_pnl_color_scheme")).toBe("green-up");
  });
});
