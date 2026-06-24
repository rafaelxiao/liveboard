import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DrawdownChart from "../DrawdownChart";

const points = [
  { ts: "2026-01-02T20:00:00Z", drawdown: "0.00", drawdown_pct: "0.0" },
  { ts: "2026-01-03T20:00:00Z", drawdown: "-500.00", drawdown_pct: "-0.005" },
];

function noop() {}

describe("DrawdownChart", () => {
  it("shows DD caveat when open positions exist", () => {
    render(
      <DrawdownChart series={[{ name: "", points }]} baseCurrency="$" showCaveat mode="absolute" onModeChange={noop} />
    );
    expect(screen.getByText(/dd caveat/i)).toBeInTheDocument();
  });

  it("does not show caveat when false", () => {
    render(
      <DrawdownChart series={[{ name: "", points }]} baseCurrency="$" showCaveat={false} mode="absolute" onModeChange={noop} />
    );
    expect(screen.queryByText(/dd caveat/i)).not.toBeInTheDocument();
  });

  it("renders in absolute mode", () => {
    render(
      <DrawdownChart series={[{ name: "", points }]} baseCurrency="$" mode="absolute" onModeChange={noop} />
    );
    expect(screen.getByText("Drawdown")).toBeInTheDocument();
  });

  it("renders in indexed mode", () => {
    render(
      <DrawdownChart series={[{ name: "", points }]} baseCurrency="$" mode="indexed" onModeChange={noop} />
    );
    expect(screen.getByText("Drawdown")).toBeInTheDocument();
  });
});
