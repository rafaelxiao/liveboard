import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquityChart from "../EquityChart";

const points = [
  { ts: "2025-01-01T12:00:00Z", realized_pnl: "100", indexed_return: "0.05" },
  { ts: "2025-01-02T12:00:00Z", realized_pnl: "200", indexed_return: "0.10" },
];

describe("EquityChart", () => {
  it("renders in absolute mode", () => {
    render(
      <EquityChart
        series={[{ name: "test", points }]}
        baseCurrency="USD"
        mode="absolute"
        onModeChange={() => {}}
      />
    );
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
  });

  it("renders in indexed mode", () => {
    render(
      <EquityChart
        series={[{ name: "test", points }]}
        baseCurrency="USD"
        mode="indexed"
        onModeChange={() => {}}
      />
    );
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
  });

  it("calls onModeChange when Indexed toggle pressed", async () => {
    const onModeChange = vi.fn();
    render(
      <EquityChart
        series={[{ name: "test", points }]}
        baseCurrency="USD"
        mode="absolute"
        onModeChange={onModeChange}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /indexed/i }));
    expect(onModeChange).toHaveBeenCalledWith("indexed");
  });
});
