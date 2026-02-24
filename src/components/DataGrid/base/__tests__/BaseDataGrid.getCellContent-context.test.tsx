import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import { BaseDataGrid } from "../BaseDataGrid";
import type {
  CrudCommandFactory,
  GridColumnV2,
  GridRowModel,
} from "@/components/DataGrid/types";
import { useCrudStore } from "@/stores/crudStore";
import type { EditableDataGridRef } from "../EditableDataGrid";

const { capturedCells } = vi.hoisted(() => ({
  capturedCells: {
    first: null as GridCell | null,
    second: null as GridCell | null,
  },
}));

vi.mock("../EditableDataGrid", async () => {
  const ReactModule = await import("react");

  const MockEditableDataGrid = ReactModule.forwardRef<
    EditableDataGridRef,
    Record<string, unknown>
  >(function MockEditableDataGrid(props, ref) {
    const getCellContent = props.getCellContent as
      | ((cell: [number, number]) => GridCell)
      | undefined;

    if (getCellContent) {
      capturedCells.first = getCellContent([0, 0]);
      capturedCells.second = getCellContent([1, 0]);
    }

    ReactModule.useImperativeHandle(
      ref,
      () =>
        ({
          focus: () => {},
          appendRow: async () => {},
        }) as EditableDataGridRef,
      [],
    );

    return <div data-testid="mock-editable-grid" />;
  });

  return { EditableDataGrid: MockEditableDataGrid };
});

const existingRows: GridRowModel[] = [
  {
    col_0: {
      value: "existing-id",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
    col_1: {
      value: "existing-value",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
  },
];

const columns: GridColumnV2[] = [
  {
    id: "id",
    field: "col_0",
    title: "ID",
    name: "id",
    type: "text",
    width: 120,
    meta: {
      name: "id",
      db_type: "text",
      nullable: false,
      default: null,
      is_pk: true,
      is_fk: false,
      ordinal: 0,
    },
  },
  {
    id: "value",
    field: "col_1",
    title: "Value",
    name: "value",
    type: "text",
    width: 200,
    meta: {
      name: "value",
      db_type: "text",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 1,
    },
  },
];

const idColumn = columns[0];
const valueColumn = columns[1];

if (!idColumn || !valueColumn) {
  throw new Error("Test columns are not initialized");
}

const commandFactory: CrudCommandFactory = {
  connectionId: "test-conn",
  database: "test-db",
  schema: "public",
  table: "kv-table",
  primaryKeyColumns: ["id"],
  columnNameToFieldMap: new Map([
    ["id", "col_0"],
    ["value", "col_1"],
  ]),
  columnByFieldMap: new Map([
    ["col_0", idColumn],
    ["col_1", valueColumn],
  ]),
  getRowKey: (row, index) => {
    if (!row) return `row-${index}`;
    const idCell = row.col_0 as { value?: unknown } | undefined;
    const id = idCell?.value;
    if (id == null) return `row-${index}`;
    if (
      typeof id === "string" ||
      typeof id === "number" ||
      typeof id === "boolean"
    ) {
      return `id:${id}`;
    }
    return `id:${JSON.stringify(id)}`;
  },
  createEditCommand: () => null,
  createInsertCommand: () => {
    throw new Error("not used in this test");
  },
  createDeleteCommand: () => {
    throw new Error("not used in this test");
  },
};

describe("BaseDataGrid getCellContent context", () => {
  beforeEach(() => {
    capturedCells.first = null;
    capturedCells.second = null;
    useCrudStore.getState().discardAll();
  });

  it("passes effective optimistic row context to adapter getCellContent", () => {
    useCrudStore.getState().stageCommand({
      id: "insert-cmd",
      type: "data.insert",
      target: {
        connectionId: "test-conn",
        database: "test-db",
        schema: "public",
        table: "kv-table",
      },
      payload: {
        tempId: "insert-temp-1",
        values: {
          id: "inserted-id",
          value: "inserted-value",
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: "Insert row",
      },
      state: "staged",
    });

    render(
      <BaseDataGrid
        gridId="test-grid"
        rows={existingRows}
        columns={columns}
        connectionId="test-conn"
        database="test-db"
        schema="public"
        tableName="kv-table"
        paradigm="keyvalue"
        commandFactory={commandFactory}
        getCellContent={(
          _cell,
          context?: {
            row?: GridRowModel;
            column?: GridColumnV2;
          },
        ) => {
          const row = context?.row;
          const column = context?.column;
          if (!row || !column) {
            return {
              kind: GridCellKind.Text,
              data: "",
              displayData: "",
              allowOverlay: false,
              readonly: true,
            };
          }

          const cellValue = row[column.field] as { value?: unknown } | undefined;
          const rawValue = cellValue?.value ?? "";
          const displayValue =
            typeof rawValue === "string" ||
            typeof rawValue === "number" ||
            typeof rawValue === "boolean"
              ? String(rawValue)
              : JSON.stringify(rawValue);
          return {
            kind: GridCellKind.Text,
            data: displayValue,
            displayData: displayValue,
            allowOverlay: true,
            readonly: false,
          };
        }}
      />,
    );

    expect(capturedCells.first).not.toBeNull();
    expect(capturedCells.second).not.toBeNull();
    expect(capturedCells.first?.kind).toBe(GridCellKind.Text);
    expect(capturedCells.second?.kind).toBe(GridCellKind.Text);

    if (!capturedCells.first || capturedCells.first.kind !== GridCellKind.Text) {
      throw new Error("first cell is missing text display data");
    }
    if (
      !capturedCells.second ||
      capturedCells.second.kind !== GridCellKind.Text
    ) {
      throw new Error("second cell is missing text display data");
    }

    expect(capturedCells.first.displayData).toBe("inserted-id");
    expect(capturedCells.second.displayData).toBe("inserted-value");
  });
});
