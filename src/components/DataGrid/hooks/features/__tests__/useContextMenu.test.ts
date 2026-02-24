import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useContextMenu } from "../useContextMenu";

describe("useContextMenu", () => {
  it("should provide context menu methods", () => {
    const { result } = renderHook(() => useContextMenu());

    expect(result.current.contextMenuTarget.current).toBeNull();
    expect(typeof result.current.handleCellContextMenu).toBe("function");
    expect(typeof result.current.handleHeaderContextMenu).toBe("function");
    expect(typeof result.current.clearContextMenu).toBe("function");
  });

  it("should handle cell context menu", () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useContextMenu({ onContextMenu }));

    const cell: [number, number] = [5, 10];
    const mockEvent = {
      target: {
        getBoundingClientRect: () => ({ x: 100, y: 200, width: 50, height: 20 }),
      },
    } as any;

    act(() => {
      result.current.handleCellContextMenu(cell, mockEvent);
    });

    expect(result.current.contextMenuTarget.current).toEqual({
      type: "cell",
      col: 5,
      row: 10,
      bounds: { x: 100, y: 200, width: 50, height: 20 },
    });
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("should handle header context menu", () => {
    const onContextMenu = vi.fn();
    const { result } = renderHook(() => useContextMenu({ onContextMenu }));

    const mockBounds = { x: 150, y: 50, width: 100, height: 30 } as any;

    act(() => {
      result.current.handleHeaderContextMenu(3, { bounds: mockBounds });
    });

    expect(result.current.contextMenuTarget.current).toEqual({
      type: "header",
      col: 3,
      bounds: mockBounds,
    });
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("should clear context menu", () => {
    const { result } = renderHook(() => useContextMenu());

    // Set some state first
    act(() => {
      result.current.handleHeaderContextMenu(0, { bounds: {} as any });
    });

    expect(result.current.contextMenuTarget.current).not.toBeNull();

    // Clear it
    act(() => {
      result.current.clearContextMenu();
    });

    expect(result.current.contextMenuTarget.current).toBeNull();
  });
});
