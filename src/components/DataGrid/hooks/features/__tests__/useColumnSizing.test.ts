import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useColumnSizing } from "../useColumnSizing";
import type { GridColumnV2 } from "../../../types";

describe("useColumnSizing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createTestColumns = (): GridColumnV2[] => [
    { id: "col1", field: "col1", name: "Column 1", title: "Column 1", width: 100 },
    { id: "col2", field: "col2", name: "Column 2", title: "Column 2", width: 150 },
    { id: "col3", field: "col3", name: "Column 3", title: "Column 3", width: 200 },
  ];

  it("should initialize with column widths", () => {
    const columns = createTestColumns();
    const { result } = renderHook(() =>
      useColumnSizing({
        columns,
        initialWidths: { col1: 120, col2: 180 },
      }),
    );

    // Wait for initialization effect
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.columnWidths).toEqual({ col1: 120, col2: 180 });
    expect(result.current.sizedColumns[0]!.width).toBe(120);
    expect(result.current.sizedColumns[1]!.width).toBe(180);
    expect(result.current.sizedColumns[2]!.width).toBe(200); // default
  });

  it("should handle column resize with batched updates", () => {
    const columns = createTestColumns();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnSizing({
        columns,
        onChange,
      }),
    );

    const column = { id: "col1" } as any;

    // Start dragging
    act(() => {
      result.current.handleColumnResize(column, 250);
    });

    expect(result.current.isDragging()).toBe(true);

    // End dragging - should trigger onChange
    act(() => {
      result.current.handleColumnResizeEnd(column, 250);
    });

    expect(result.current.isDragging()).toBe(false);
    expect(onChange).toHaveBeenCalledWith({ col1: 250 });
    expect(result.current.columnWidths).toEqual({ col1: 250 });
  });

  it("should clamp width values to min/max", () => {
    const columns = createTestColumns();
    const { result } = renderHook(() =>
      useColumnSizing({
        columns,
        minColumnWidth: 50,
        maxColumnWidth: 500,
      }),
    );

    // Try to set width below minimum
    act(() => {
      result.current.setColumnWidth("col1", 30);
    });
    expect(result.current.columnWidths.col1).toBe(50);

    // Try to set width above maximum
    act(() => {
      result.current.setColumnWidth("col2", 600);
    });
    expect(result.current.columnWidths.col2).toBe(500);
  });

  it("should auto-size column based on measured width", () => {
    const columns = createTestColumns();
    const { result } = renderHook(() =>
      useColumnSizing({ columns }),
    );

    const measure = vi.fn(() => 175);

    act(() => {
      result.current.autoSizeColumn("col1", measure);
    });

    expect(measure).toHaveBeenCalled();
    expect(result.current.columnWidths.col1).toBe(175);
  });

  it("should reset column widths", () => {
    const columns = createTestColumns();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnSizing({
        columns,
        onChange,
      }),
    );

    // Set some widths first
    act(() => {
      result.current.setColumnWidth("col1", 120);
      result.current.setColumnWidth("col2", 180);
    });

    onChange.mockClear();

    // Reset to empty
    act(() => {
      result.current.resetColumnWidths();
    });

    expect(result.current.columnWidths).toEqual({});
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("should reset to new widths", () => {
    const columns = createTestColumns();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnSizing({ columns, onChange }),
    );

    act(() => {
      result.current.resetColumnWidths({ col1: 300, col2: 350 });
    });

    expect(result.current.columnWidths).toEqual({ col1: 300, col2: 350 });
    expect(onChange).toHaveBeenCalledWith({ col1: 300, col2: 350 });
  });

  it("should sanitize widths on column changes", () => {
    const columns = createTestColumns();
    const { result, rerender } = renderHook(
      ({ cols }) => useColumnSizing({ columns: cols }),
      { initialProps: { cols: columns } },
    );

    // Set widths for all columns
    act(() => {
      result.current.setColumnWidth("col1", 120);
      result.current.setColumnWidth("col2", 180);
      result.current.setColumnWidth("col3", 220);
    });

    // Remove col2 from columns
    const newColumns = columns.filter((c) => c.id !== "col2");
    rerender({ cols: newColumns });

    // col2 width should be removed
    expect(result.current.columnWidths).toEqual({ col1: 120, col3: 220 });
  });

  it("should not call onChange during drag", () => {
    const columns = createTestColumns();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnSizing({ columns, onChange }),
    );

    const column = { id: "col1" } as any;

    onChange.mockClear();

    // Resize during drag
    act(() => {
      result.current.handleColumnResize(column, 250);
    });

    // Should not call onChange during drag
    expect(onChange).not.toHaveBeenCalled();

    // End drag
    act(() => {
      result.current.handleColumnResizeEnd(column, 250);
    });

    // Should call onChange after drag ends
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
