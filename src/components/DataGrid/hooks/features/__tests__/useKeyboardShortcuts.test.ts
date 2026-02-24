import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  it("should provide keyboard shortcut methods", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onSearch }),
    );

    expect(typeof result.current.triggerSearch).toBe("function");
  });

  it("should trigger search manually", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onSearch }),
    );

    result.current.triggerSearch();
    expect(onSearch).toHaveBeenCalled();
  });

  it("should not register event listeners when disabled", () => {
    const onSearch = vi.fn();
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");

    renderHook(() =>
      useKeyboardShortcuts({ onSearch, enabled: false }),
    );

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });
});
