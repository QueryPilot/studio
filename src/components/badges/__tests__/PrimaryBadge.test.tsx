import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrimaryBadge } from "@/components/badges/PrimaryBadge";

describe("PrimaryBadge", () => {
  it("renders PRIMARY label", () => {
    render(<PrimaryBadge />);
    expect(screen.getByText("PRIMARY")).toBeInTheDocument();
  });
});
