import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContributionBars from "../ContributionBars";

describe("ContributionBars", () => {
  const contributions = [
    { symbol: "513300.SH", pnl: "3999.00", pct: "0.268" },
    { symbol: "159792.SZ", pnl: "-18937.00", pct: "-1.268" },
  ];

  it("renders all symbols", () => {
    render(<ContributionBars contributions={contributions} baseCurrency="CNY" />);
    expect(screen.getByText("513300.SH")).toBeDefined();
    expect(screen.getByText("159792.SZ")).toBeDefined();
  });

  it("shows positive PnL with green styling", () => {
    render(<ContributionBars contributions={contributions} baseCurrency="CNY" />);
    // The positive value should have text-pnl-gain class somewhere in its row
    const gainRow = screen.getByText("513300.SH").closest("div");
    expect(gainRow?.parentElement?.querySelector(".text-pnl-gain")).toBeDefined();
  });

  it("shows percentage values", () => {
    render(<ContributionBars contributions={contributions} baseCurrency="CNY" />);
    expect(screen.getByText("+26.8%")).toBeDefined();
    expect(screen.getByText("-126.8%")).toBeDefined();
  });

  it("returns null for empty contributions", () => {
    const { container } = render(<ContributionBars contributions={[]} baseCurrency="CNY" />);
    expect(container.firstChild).toBeNull();
  });
});
