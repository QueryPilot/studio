import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { GridCellKind, type GridCell, type Item } from "@glideapps/glide-data-grid";
import { BaseDataGrid } from "../BaseDataGrid";
import type { EditableDataGridRef } from "../EditableDataGrid";
import type { QuickFilterRef } from "../../components/QuickFilter";
import type { GridRowModel, GridColumnV2 } from "@/components/DataGrid/types";

const { gridFocusSpy } = vi.hoisted(() => ({
  gridFocusSpy: vi.fn(),
}));

vi.mock("../EditableDataGrid", async () => {
  const ReactModule = await import("react");

  const MockEditableDataGrid = ReactModule.forwardRef<
    EditableDataGridRef,
    Record<string, unknown>
  >(function MockEditableDataGrid(_props, ref) {
    ReactModule.useImperativeHandle(
      ref,
      () =>
        ({
          focus: gridFocusSpy,
          appendRow: () => Promise.resolve(),
        }) as unknown as EditableDataGridRef,
      [],
    );

    return <div data-testid="mock-editable-grid" />;
  });

  return { EditableDataGrid: MockEditableDataGrid };
});

const mockRows: GridRowModel[] = [
  { col_0: { value: "A", db_type: "text", value_type: "Text", is_truncated: false } },
];

const mockColumns: GridColumnV2[] = [
  { id: "col_0", field: "col_0", title: "Column 1", name: "col1", width: 100, type: "text" },
];

const mockGetCellContent = (_cell: Item): GridCell => ({
  kind: GridCellKind.Text,
  data: "",
  displayData: "",
  allowOverlay: false,
  readonly: true,
});

describe("BaseDataGrid quick filter focus guard", () => {
  beforeEach(() => {
    gridFocusSpy.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does not auto-focus grid while QuickFilter is focused", () => {
    const quickFilterRef = {
      current: {
        focus: vi.fn(),
        isFocusWithin: vi.fn(() => true),
      },
    } as React.RefObject<QuickFilterRef | null>;

    render(
      <BaseDataGrid
        gridId="test-quickfilter-focused"
        rows={mockRows}
        columns={mockColumns}
        getCellContent={mockGetCellContent}
        connectionId="test-connection"
        paradigm="sql"
        enableFiltering={false}
        focused={true}
        externalQuickFilterRef={quickFilterRef}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(quickFilterRef.current?.isFocusWithin).toHaveBeenCalled();
    expect(gridFocusSpy).not.toHaveBeenCalled();
  });

  it("auto-focuses grid when QuickFilter is not focused", () => {
    const quickFilterRef = {
      current: {
        focus: vi.fn(),
        isFocusWithin: vi.fn(() => false),
      },
    } as React.RefObject<QuickFilterRef | null>;

    render(
      <BaseDataGrid
        gridId="test-quickfilter-not-focused"
        rows={mockRows}
        columns={mockColumns}
        getCellContent={mockGetCellContent}
        connectionId="test-connection"
        paradigm="sql"
        enableFiltering={false}
        focused={true}
        externalQuickFilterRef={quickFilterRef}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(gridFocusSpy).toHaveBeenCalledTimes(1);
  });
});
