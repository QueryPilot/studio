import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarItem } from "../DatabaseSidebarItem";

describe("SidebarItem pending change indicator", () => {
  it("renders orange pending indicator for standard pending changes", () => {
    render(
      <SidebarItem
        icon={<span data-testid="icon">icon</span>}
        name="orders"
        isActive={false}
        onClick={vi.fn()}
        hasPendingChanges
      />,
    );

    const pulse = screen.getByTestId("pending-indicator-pulse");
    const dot = screen.getByTestId("pending-indicator-dot");

    expect(pulse).toHaveClass("bg-orange-400");
    expect(dot).toHaveClass("bg-orange-500");
  });

  it("renders destructive pending indicator and styling for delete/truncate commands", () => {
    render(
      <SidebarItem
        icon={<span data-testid="icon">icon</span>}
        name="wide_table"
        isActive={false}
        onClick={vi.fn()}
        hasPendingChanges
        pendingChangeVariant="destructive"
      />,
    );

    const root = screen.getByTestId("sidebar-item-root");
    const pulse = screen.getByTestId("pending-indicator-pulse");
    const dot = screen.getByTestId("pending-indicator-dot");

    expect(root).toHaveClass("border-l-destructive");
    expect(root).toHaveClass("bg-destructive/10");
    expect(pulse).toHaveClass("bg-destructive/70");
    expect(dot).toHaveClass("bg-destructive");
  });
});
