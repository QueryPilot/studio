import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useCellHoverIcons } from "../useCellHoverIcons";

describe("useCellHoverIcons", () => {
  it("should provide hover icon methods", () => {
    const { result } = renderHook(() =>
      useCellHoverIcons({
        columns: [],
        rows: [],
      }),
    );

    expect(typeof result.current.onItemHovered).toBe("function");
    expect(typeof result.current.drawCell).toBe("function");
    expect(typeof result.current.clearFkPreview).toBe("function");
    expect(result.current.hoveredCell).toBeNull();
  });
});
