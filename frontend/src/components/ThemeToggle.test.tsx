import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "./ThemeToggle";
import { useThemeStore } from "../state/themeStore";
import { renderWithProviders } from "../lib/test-utils";

describe("ThemeToggle", () => {
  beforeEach(() => useThemeStore.setState({ theme: "dark" }));

  it("clicking toggles the theme and persists it", async () => {
    renderWithProviders(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("lb_theme")).toBe("light");
  });
});
