import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import {
  CompactSelection,
  GridCellKind,
  type GridCell,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import { BaseDataGrid } from "../BaseDataGrid";
import type { EditableDataGridRef } from "../EditableDataGrid";
import type {
  CrudCommandFactory,
  GridColumnV2,
  GridRowModel,
} from "@/components/DataGrid/types";
import { buildCrudTableKey, useCrudStore } from "@/stores/crudStore";
import { dataGridRegistry } from "@/services/dataGridRegistry";

const GRID_ID = "test-delete-range-selection";
const DELETE_TARGET = {
  connectionId: "test-conn",
  database: "test-db",
  schema: "public",
  table: "kv-table",
} as const;

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

const rows: GridRowModel[] = Array.from({ length: 5 }, (_, index) => ({
  col_0: {
    value: `row-${index}`,
    db_type: "text",
    value_type: "Text",
    is_truncated: false,
  },
  col_1: {
    value: `value-${index}`,
    db_type: "text",
    value_type: "Text",
    is_truncated: false,
  },
}));

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
  throw new Error("Expected test columns to be initialized");
}

const commandFactory: CrudCommandFactory = {
  ...DELETE_TARGET,
  table: DELETE_TARGET.table,
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
    const idValue = (row?.col_0 as { value?: unknown } | undefined)?.value;
    return typeof idValue === "string" ? `id:${idValue}` : `row:${index}`;
  },
  createEditCommand: () => null,
  createInsertCommand: () => {
    throw new Error("createInsertCommand should not be called in this test");
  },
  createDeleteCommand: (row, rowKey) => {
    const idValue = (row.col_0 as { value?: unknown } | undefined)?.value;
    return {
      id: `delete:${rowKey}`,
      type: "data.delete",
      target: DELETE_TARGET,
      payload: {
        primaryKeys: { id: idValue },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: `Delete ${rowKey}`,
        affectedRows: 1,
      },
      state: "staged",
    };
  },
};

const getCellContent = (_cell: Item): GridCell => ({
  kind: GridCellKind.Text,
  data: "",
  displayData: "",
  allowOverlay: false,
  readonly: true,
});

describe("BaseDataGrid row deletion staging", () => {
  beforeEach(() => {
    editableGridPropsRef.current = null;
    useCrudStore.getState().discardAll();
    dataGridRegistry.clearFocused(GRID_ID);
  });

  afterEach(() => {
    useCrudStore.getState().discardAll();
    dataGridRegistry.clearFocused(GRID_ID);
  });

  it("stages delete commands for all rows included in a range selection", () => {
    render(
      <BaseDataGrid
        gridId={GRID_ID}
        rows={rows}
        columns={columns}
        connectionId={DELETE_TARGET.connectionId}
        database={DELETE_TARGET.database}
        schema={DELETE_TARGET.schema}
        tableName={DELETE_TARGET.table}
        paradigm="sql"
        commandFactory={commandFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;

    expect(onSelectionChange).toBeTypeOf("function");

    const selection: GridSelection = {
      rows: CompactSelection.fromSingleSelection(1),
      columns: CompactSelection.empty(),
      current: {
        cell: [0, 1],
        range: { x: 0, y: 1, width: 1, height: 3 },
        rangeStack: [],
      },
    };

    act(() => {
      onSelectionChange?.(selection);
    });

    act(() => {
      dataGridRegistry.setFocused(GRID_ID);
      dataGridRegistry.getFocused()?.deleteRows?.();
    });

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];
    const deletedPrimaryKeys = stagedCommands.map(
      (command) =>
        (
          command.payload as {
            primaryKeys?: { id?: unknown };
          }
        ).primaryKeys?.id,
    );

    expect(stagedCommands).toHaveLength(3);
    expect(deletedPrimaryKeys).toEqual(["row-1", "row-2", "row-3"]);
  });
});
