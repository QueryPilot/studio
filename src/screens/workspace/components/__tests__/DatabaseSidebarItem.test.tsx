import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("SidebarItem active state auto-scroll", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls the active item to the center of the sidebar viewport", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <SidebarItem
        icon={<span data-testid="icon">icon</span>}
        name="customers"
        isActive
        onClick={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  });

  it("scrolls only the sidebar container when a container is provided", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const { rerender } = render(
      <div data-testid="sidebar-scroll-container" data-sidebar-scroll-container>
        <SidebarItem
          icon={<span data-testid="icon">icon</span>}
          name="products"
          isActive={false}
          onClick={vi.fn()}
        />
      </div>,
    );

    const container = screen.getByTestId("sidebar-scroll-container");
    const item = screen.getByTestId("sidebar-item-root");
    const scrollTo = vi.fn();

    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      value: 120,
      writable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 0,
      width: 300,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
      top: 260,
      bottom: 280,
      left: 0,
      right: 300,
      width: 300,
      height: 20,
      x: 0,
      y: 260,
      toJSON: () => ({}),
    } as DOMRect);

    // Trigger active transition to run the effect with mocked geometry.
    rerender(
      <div data-testid="sidebar-scroll-container" data-sidebar-scroll-container>
        <SidebarItem
          icon={<span data-testid="icon">icon</span>}
          name="products"
          isActive
          onClick={vi.fn()}
        />
      </div>,
    );

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: "smooth",
      top: 190,
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
