import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useFillOperations } from "../useFillOperations";
import { GridCellKind, type GridCell, CompactSelection } from "@glideapps/glide-data-grid";

describe("useFillOperations", () => {
  const createTextCell = (text: string): GridCell => ({
    kind: GridCellKind.Text,
    data: text,
    displayData: text,
    allowOverlay: true,
  });

  it("should provide fill operations", () => {
    const getCellContent = vi.fn(() => createTextCell("test"));
    const onBatchEdit = vi.fn();

    const { result } = renderHook(() =>
      useFillOperations({
        getCellContent,
        onBatchEdit,
        columnCount: 10,
        rowCount: 100,
      }),
    );

    expect(typeof result.current.fillDown).toBe("function");
    expect(typeof result.current.fillRight).toBe("function");
  });

  it("should return false for invalid selection", () => {
    const getCellContent = vi.fn();
    const onBatchEdit = vi.fn();

    const { result } = renderHook(() =>
      useFillOperations({
        getCellContent,
        onBatchEdit,
        columnCount: 10,
        rowCount: 100,
      }),
    );

    expect(result.current.fillDown(undefined)).toBe(false);
    expect(result.current.fillRight(undefined)).toBe(false);
  });

  it("should perform fillDown with valid selection", () => {
    const getCellContent = vi.fn((cell) => createTextCell(`value-${cell[0]}-${cell[1]}`));
    const onBatchEdit = vi.fn();

    const { result } = renderHook(() =>
      useFillOperations({
        getCellContent,
        onBatchEdit,
        columnCount: 10,
        rowCount: 100,
      }),
    );

    const selection = {
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
      current: {
        range: { x: 0, y: 0, width: 2, height: 5 },
        rangeStack: [],
        cell: [0, 0] as [number, number],
      },
    };

    const filled = result.current.fillDown(selection);
    expect(filled).toBe(true);
    expect(onBatchEdit).toHaveBeenCalled();
  });
});
