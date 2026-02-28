import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRowPinning } from "../useRowPinning";
import type { GridRowModel } from "../../../types";

describe("useRowPinning", () => {
  const createTestRows = (): GridRowModel[] => [
    { id: { value: 1, db_type: "int4", value_type: "Integer", is_truncated: false }, name: { value: "Row 1", db_type: "text", value_type: "Text", is_truncated: false } },
    { id: { value: 2, db_type: "int4", value_type: "Integer", is_truncated: false }, name: { value: "Row 2", db_type: "text", value_type: "Text", is_truncated: false } },
    { id: { value: 3, db_type: "int4", value_type: "Integer", is_truncated: false }, name: { value: "Row 3", db_type: "text", value_type: "Text", is_truncated: false } },
    { id: { value: 4, db_type: "int4", value_type: "Integer", is_truncated: false }, name: { value: "Row 4", db_type: "text", value_type: "Text", is_truncated: false } },
    { id: { value: 5, db_type: "int4", value_type: "Integer", is_truncated: false }, name: { value: "Row 5", db_type: "text", value_type: "Text", is_truncated: false } },
  ];

  it("should initialize with pinned rows", () => {
    const rows = createTestRows();
    const { result } = renderHook(() =>
      useRowPinning({
        rows,
        initialPinned: ["row-0", "row-2"],
      }),
    );

    expect(result.current.pinnedRowIds).toEqual(["row-0", "row-2"]);
    expect(result.current.pinnedRows).toHaveLength(2);
    expect(result.current.unpinnedRows).toHaveLength(3);
    expect(result.current.isPinned("row-0")).toBe(true);
    expect(result.current.isPinned("row-1")).toBe(false);
  });

  it("should pin and unpin rows", () => {
    const rows = createTestRows();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRowPinning({ rows, onChange }),
    );

    // Pin a row
    act(() => {
      result.current.pinRow("row-1");
    });

    expect(result.current.isPinned("row-1")).toBe(true);
    expect(result.current.pinnedRows).toHaveLength(1);
    expect(onChange).toHaveBeenCalledWith(["row-1"]);

    // Unpin the row
    act(() => {
      result.current.unpinRow("row-1");
    });

    expect(result.current.isPinned("row-1")).toBe(false);
    expect(result.current.pinnedRows).toHaveLength(0);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("should toggle row pinning", () => {
    const rows = createTestRows();
    const { result } = renderHook(() =>
      useRowPinning({ rows }),
    );

    // Toggle to pin
    act(() => {
      result.current.togglePinRow("row-0");
    });
    expect(result.current.isPinned("row-0")).toBe(true);

    // Toggle to unpin
    act(() => {
      result.current.togglePinRow("row-0");
    });
    expect(result.current.isPinned("row-0")).toBe(false);
  });

  it("should respect max pinned rows limit", () => {
    const rows = createTestRows();
    const { result } = renderHook(() =>
      useRowPinning({
        rows,
        maxPinnedRows: 3,
      }),
    );

    expect(result.current.canPinMore).toBe(true);

    // Pin 3 rows
    act(() => {
      result.current.pinRow("row-0");
      result.current.pinRow("row-1");
      result.current.pinRow("row-2");
    });

    expect(result.current.pinnedRows).toHaveLength(3);
    expect(result.current.canPinMore).toBe(false);

    // Try to pin a 4th row - should be ignored
    act(() => {
      result.current.pinRow("row-3");
    });

    expect(result.current.pinnedRows).toHaveLength(3);
    expect(result.current.pinnedRowIds).not.toContain("row-3");
  });

  it("should clear all pinned rows", () => {
    const rows = createTestRows();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRowPinning({
        rows,
        initialPinned: ["row-0", "row-1", "row-2"],
        onChange,
      }),
    );

    expect(result.current.pinnedRows).toHaveLength(3);

    onChange.mockClear();

    act(() => {
      result.current.clearPinnedRows();
    });

    expect(result.current.pinnedRows).toHaveLength(0);
    expect(result.current.pinnedRowIds).toEqual([]);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("should maintain pinned row order", () => {
    const rows = createTestRows();
    const { result } = renderHook(() =>
      useRowPinning({ rows }),
    );

    act(() => {
      result.current.pinRow("row-2");
      result.current.pinRow("row-0");
      result.current.pinRow("row-4");
    });

    // Pinned rows should be in pin order, not row order
    expect(result.current.pinnedRowIds).toEqual(["row-2", "row-0", "row-4"]);
    expect(result.current.pinnedRows[0]!.id!.value).toBe(3);
    expect(result.current.pinnedRows[1]!.id!.value).toBe(1);
    expect(result.current.pinnedRows[2]!.id!.value).toBe(5);
  });

  it("should handle custom getRowId function", () => {
    const rows = createTestRows();
    const getRowId = (row: GridRowModel) => `custom-${row.id!.value}`;
    const { result } = renderHook(() =>
      useRowPinning({ rows, getRowId }),
    );

    act(() => {
      result.current.pinRow("custom-2");
    });

    expect(result.current.isPinned("custom-2")).toBe(true);
    expect(result.current.pinnedRows[0]!.id!.value).toBe(2);
  });

  it("should handle rows that no longer exist", () => {
    const rows = createTestRows();
    const { result, rerender } = renderHook(
      ({ rows }) => useRowPinning({ rows }),
      { initialProps: { rows } },
    );

    act(() => {
      result.current.pinRow("row-0");
      result.current.pinRow("row-2");
    });

    expect(result.current.pinnedRows).toHaveLength(2);

    // Remove the first row (row-0) by slicing
    const newRows = rows.slice(1);
    rerender({ rows: newRows });

    // row-0 ID is still in pinnedRowIds, but since rows changed,
    // the new row at index 0 is actually the old row-1
    // So pinnedRowIds still contains "row-0" and "row-2"
    // But now "row-0" refers to the new first row (old row-1)
    // and "row-2" refers to what is now at index 2 (old row-3)
    expect(result.current.pinnedRowIds).toContain("row-0");
    expect(result.current.pinnedRowIds).toContain("row-2");
    // Both pinned rows now exist because row IDs are index-based
    expect(result.current.pinnedRows).toHaveLength(2);
  });
});
