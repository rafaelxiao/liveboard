import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatusChip from "./StatusChip";
import { renderWithProviders } from "../lib/test-utils";

describe("StatusChip", () => {
  it("renders the status label", () => {
    renderWithProviders(<StatusChip status="pending" />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });
});
