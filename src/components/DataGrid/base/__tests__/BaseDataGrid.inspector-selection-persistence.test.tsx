import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import {
  CompactSelection,
  GridCellKind,
  type GridCell,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import type { ReactNode } from "react";
import { BaseDataGrid } from "../BaseDataGrid";
import type { EditableDataGridRef } from "../EditableDataGrid";
import type { GridColumnV2, GridRowModel } from "@/components/DataGrid/types";
import { dataGridRegistry } from "@/services/dataGridRegistry";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";

const GRID_ID = "test-inspector-selection-with-filter";

const { editableGridPropsRef } = vi.hoisted(() => ({
  editableGridPropsRef: {
    current: null as Record<string, unknown> | null,
  },
}));

vi.mock("../EditableDataGrid", async () => {
  const ReactModule = await import("react");

  const MockEditableDataGrid = ReactModule.forwardRef<
    EditableDataGridRef,
    Record<string, unknown>
  >(function MockEditableDataGrid(props, ref) {
    editableGridPropsRef.current = props;

    ReactModule.useImperativeHandle(
      ref,
      () =>
        ({
          focus: () => {},
          appendRow: () => Promise.resolve(),
        }) as EditableDataGridRef,
      [],
    );

    return <div data-testid="mock-editable-grid" />;
  });

  return { EditableDataGrid: MockEditableDataGrid };
});

vi.mock("../../components/UnifiedContextMenu", () => {
  type UnifiedContextMenuMockProps = Record<string, unknown> & {
    children?: ReactNode;
  };
  return {
    UnifiedContextMenu: (props: UnifiedContextMenuMockProps) => {
      return <>{props.children}</>;
    },
  };
});

const rows: GridRowModel[] = [
  {
    col_0: {
      value: "row-0",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
  },
  {
    col_0: {
      value: "row-1",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
  },
  {
    col_0: {
      value: "row-2",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
  },
];

const columns: GridColumnV2[] = [
  {
    id: "col_0",
    field: "col_0",
    title: "Value",
    name: "value",
    type: "text",
    width: 180,
  },
];

const getCellContent = (_cell: Item): GridCell => ({
  kind: GridCellKind.Text,
  data: "",
  displayData: "",
  allowOverlay: false,
  readonly: true,
});

describe("BaseDataGrid inspector selection persistence", () => {
  beforeEach(() => {
    editableGridPropsRef.current = null;
    dataGridRegistry.clearFocused(GRID_ID);
    act(() => {
      useGridPreferencesStore.getState().setQuickFilter(GRID_ID, {
        value: "row-1",
        mode: "search",
      });
    });
  });

  afterEach(() => {
    dataGridRegistry.clearFocused(GRID_ID);
    act(() => {
      useGridPreferencesStore.getState().setQuickFilter(GRID_ID, undefined);
    });
  });

  it("preserves selected rows when inspector is toggled with an active quick filter", async () => {
    render(
      <BaseDataGrid
        gridId={GRID_ID}
        rows={rows}
        columns={columns}
        getCellContent={getCellContent}
        connectionId="test-connection"
        paradigm="sql"
      />,
    );

    await waitFor(() => {
      const visibleRows =
        (editableGridPropsRef.current?.rows as GridRowModel[] | undefined) ??
        [];
      expect(visibleRows.length).toBe(1);
    });

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;
    expect(onSelectionChange).toBeTypeOf("function");

    const selectedRow: GridSelection = {
      rows: CompactSelection.fromSingleSelection(0),
      columns: CompactSelection.empty(),
      current: {
        cell: [0, 0],
        range: { x: 0, y: 0, width: 1, height: 1 },
        rangeStack: [],
      },
    };

    act(() => {
      onSelectionChange?.(selectedRow);
    });

    act(() => {
      dataGridRegistry.setFocused(GRID_ID);
      dataGridRegistry.getFocused()?.toggleInspector?.();
    });

    const transientResetSelection: GridSelection = {
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
      current: {
        cell: [0, 0],
        range: { x: 0, y: 0, width: 0, height: 0 },
        rangeStack: [],
      },
    };

    act(() => {
      onSelectionChange?.(transientResetSelection);
    });

    const latestSelection = editableGridPropsRef.current
      ?.gridSelection as GridSelection | undefined;

    expect(latestSelection?.rows.length ?? 0).toBe(1);
  });
});
