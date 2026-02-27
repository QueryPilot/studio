import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
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

const { editableGridPropsRef, unifiedContextMenuPropsRef } = vi.hoisted(() => ({
  editableGridPropsRef: {
    current: null as Record<string, unknown> | null,
  },
  unifiedContextMenuPropsRef: {
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
      unifiedContextMenuPropsRef.current = props;
      return <>{props.children}</>;
    },
  };
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

const flushAsyncWork = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("BaseDataGrid row deletion staging", () => {
  beforeEach(() => {
    editableGridPropsRef.current = null;
    unifiedContextMenuPropsRef.current = null;
    vi.stubGlobal("confirm", vi.fn(() => true));
    useCrudStore.getState().discardAll();
    dataGridRegistry.clearFocused(GRID_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("does not stage row delete commands when deterministic identity columns are unavailable", () => {
    const createDeleteCommand = vi.fn(commandFactory.createDeleteCommand);
    const noIdentityFactory: CrudCommandFactory = {
      ...commandFactory,
      primaryKeyColumns: [],
      createDeleteCommand,
    };

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
        commandFactory={noIdentityFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;

    const selection: GridSelection = {
      rows: CompactSelection.fromSingleSelection(0),
      columns: CompactSelection.empty(),
      current: {
        cell: [0, 0],
        range: { x: 0, y: 0, width: 1, height: 1 },
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

    expect(createDeleteCommand).not.toHaveBeenCalled();
    expect(stagedCommands).toHaveLength(0);
  });

  it("wires explicit best-effort context actions when deterministic identity is unavailable", () => {
    const noIdentityFactory: CrudCommandFactory = {
      ...commandFactory,
      primaryKeyColumns: [],
    };

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
        commandFactory={noIdentityFactory}
        getCellContent={getCellContent}
      />,
    );

    expect(unifiedContextMenuPropsRef.current?.onBestEffortEditRows).toBeTypeOf("function");
    expect(unifiedContextMenuPropsRef.current?.onBestEffortDeleteRows).toBeTypeOf("function");
  });

  it("stages best-effort delete when pre-check validation passes", async () => {
    const validateCommand = vi.fn(() => Promise.resolve({ valid: true }));
    const noIdentityFactory: CrudCommandFactory = {
      ...commandFactory,
      primaryKeyColumns: [],
      validateCommand,
      createDeleteCommand: (row, rowKey) => {
        const baseCommand = commandFactory.createDeleteCommand(row, rowKey);
        return {
          ...baseCommand,
          metadata: {
            ...baseCommand.metadata,
            tags: ["matcher:best_effort"],
          },
        };
      },
    };

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
        commandFactory={noIdentityFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;

    act(() => {
      onSelectionChange?.({
        rows: CompactSelection.fromSingleSelection(0),
        columns: CompactSelection.empty(),
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      });
    });

    const onBestEffortDeleteRows = unifiedContextMenuPropsRef.current
      ?.onBestEffortDeleteRows as (() => void) | undefined;

    act(() => {
      onBestEffortDeleteRows?.();
    });
    await flushAsyncWork();

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];

    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(stagedCommands).toHaveLength(1);
  });

  it("does not stage best-effort delete when pre-check validation fails", async () => {
    const validateCommand = vi.fn(() =>
      Promise.resolve({
        valid: false,
        reason: "Best-effort blocked: multiple rows match current values",
      }),
    );
    const noIdentityFactory: CrudCommandFactory = {
      ...commandFactory,
      primaryKeyColumns: [],
      validateCommand,
      createDeleteCommand: (row, rowKey) => {
        const baseCommand = commandFactory.createDeleteCommand(row, rowKey);
        return {
          ...baseCommand,
          metadata: {
            ...baseCommand.metadata,
            tags: ["matcher:best_effort"],
          },
        };
      },
    };

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
        commandFactory={noIdentityFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;

    act(() => {
      onSelectionChange?.({
        rows: CompactSelection.fromSingleSelection(0),
        columns: CompactSelection.empty(),
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      });
    });

    const onBestEffortDeleteRows = unifiedContextMenuPropsRef.current
      ?.onBestEffortDeleteRows as (() => void) | undefined;

    act(() => {
      onBestEffortDeleteRows?.();
    });
    await flushAsyncWork();

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];

    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(stagedCommands).toHaveLength(0);
  });

  it("validates best-effort tagged delete commands even when deterministic identity exists", async () => {
    const validateCommand = vi.fn(() =>
      Promise.resolve({
        valid: false,
        reason: "Best-effort blocked: multiple rows match current values",
      }),
    );
    const deterministicFactory: CrudCommandFactory = {
      ...commandFactory,
      validateCommand,
      createDeleteCommand: (row, rowKey) => {
        const baseCommand = commandFactory.createDeleteCommand(row, rowKey);
        return {
          ...baseCommand,
          metadata: {
            ...baseCommand.metadata,
            tags: ["matcher:best_effort"],
          },
        };
      },
    };

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
        commandFactory={deterministicFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;

    act(() => {
      onSelectionChange?.({
        rows: CompactSelection.empty(),
        columns: CompactSelection.empty(),
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      });
    });

    act(() => {
      dataGridRegistry.setFocused(GRID_ID);
      dataGridRegistry.getFocused()?.deleteRows?.();
    });
    await flushAsyncWork();

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];

    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(stagedCommands).toHaveLength(0);
  });

  it("validates best-effort tagged edit commands even when deterministic identity exists", async () => {
    const validateCommand = vi.fn(() =>
      Promise.resolve({
        valid: false,
        reason: "Best-effort blocked: multiple rows match current values",
      }),
    );
    const createEditCommand = vi.fn(() => ({
      id: "update:best-effort-deterministic-path",
      type: "data.update" as const,
      target: DELETE_TARGET,
      payload: {
        column: "value",
        oldValue: "value-0",
        newValue: "value-0-updated",
        primaryKeys: { value: "value-0" },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: "Best-effort update in deterministic flow",
        tags: ["matcher:best_effort"],
      },
      state: "staged" as const,
    }));
    const deterministicFactory: CrudCommandFactory = {
      ...commandFactory,
      validateCommand,
      createEditCommand,
    };

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
        commandFactory={deterministicFactory}
        getCellContent={getCellContent}
      />,
    );

    const onCellEditCommit = editableGridPropsRef.current?.onCellEditCommit as
      | ((event: {
          cell: [number, number];
          rowIndex: number;
          columnIndex: number;
          column: GridColumnV2;
          row: GridRowModel;
          newValue: GridCell;
          previousValue: unknown;
        }) => unknown)
      | undefined;

    const row = rows[0];
    if (!row) {
      throw new Error("Expected test row");
    }

    act(() => {
      onCellEditCommit?.({
        cell: [1, 0],
        rowIndex: 0,
        columnIndex: 1,
        column: valueColumn,
        row,
        newValue: {
          kind: GridCellKind.Text,
          data: "value-0-updated",
          displayData: "value-0-updated",
          allowOverlay: true,
        },
        previousValue: row.col_1,
      });
    });
    await flushAsyncWork();

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];

    expect(createEditCommand).toHaveBeenCalledTimes(1);
    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(stagedCommands).toHaveLength(0);
  });

  it("stages best-effort edit only after explicit arm action", async () => {
    const validateCommand = vi.fn(() => Promise.resolve({ valid: true }));
    const createEditCommand = vi.fn(() => ({
      id: "update:best-effort",
      type: "data.update" as const,
      target: DELETE_TARGET,
      payload: {
        column: "value",
        oldValue: "value-0",
        newValue: "value-0-updated",
        primaryKeys: { value: "value-0" },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: "Best-effort update",
        tags: ["matcher:best_effort"],
      },
      state: "staged" as const,
    }));

    const noIdentityFactory: CrudCommandFactory = {
      ...commandFactory,
      primaryKeyColumns: [],
      validateCommand,
      createEditCommand,
    };

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
        commandFactory={noIdentityFactory}
        getCellContent={getCellContent}
      />,
    );

    const onSelectionChange = editableGridPropsRef.current?.onSelectionChange as
      | ((selection: GridSelection) => void)
      | undefined;
    const onCellEditCommit = editableGridPropsRef.current?.onCellEditCommit as
      | ((event: {
          cell: [number, number];
          rowIndex: number;
          columnIndex: number;
          column: GridColumnV2;
          row: GridRowModel;
          newValue: GridCell;
          previousValue: unknown;
        }) => unknown)
      | undefined;

    act(() => {
      onSelectionChange?.({
        rows: CompactSelection.fromSingleSelection(0),
        columns: CompactSelection.empty(),
        current: {
          cell: [1, 0],
          range: { x: 1, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      });
    });

    const row = rows[0];
    if (!row) {
      throw new Error("Expected test row");
    }
    const editEvent = {
      cell: [1, 0] as [number, number],
      rowIndex: 0,
      columnIndex: 1,
      column: valueColumn,
      row,
      newValue: {
        kind: GridCellKind.Text,
        data: "value-0-updated",
        displayData: "value-0-updated",
        allowOverlay: true,
      } as GridCell,
      previousValue: row.col_1,
    };

    // Without explicit arm action, strict mode blocks best-effort edit.
    act(() => {
      onCellEditCommit?.(editEvent);
    });
    await flushAsyncWork();

    expect(createEditCommand).not.toHaveBeenCalled();

    const onBestEffortEditRows = unifiedContextMenuPropsRef.current
      ?.onBestEffortEditRows as (() => void) | undefined;
    act(() => {
      onBestEffortEditRows?.();
    });

    act(() => {
      onCellEditCommit?.(editEvent);
    });
    await flushAsyncWork();

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];
    expect(createEditCommand).toHaveBeenCalledTimes(1);
    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(stagedCommands).toHaveLength(1);
  });

  it("keeps delete shortcut active when Glide hidden input is focused", () => {
    const { container } = render(
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

    act(() => {
      onSelectionChange?.({
        rows: CompactSelection.fromSingleSelection(0),
        columns: CompactSelection.empty(),
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      });
    });

    const gridRoot = container.querySelector('[data-testid="base-datagrid"]');
    const hiddenInputHost = document.createElement("div");
    hiddenInputHost.className = "gdg-style";
    const hiddenInput = document.createElement("input");
    hiddenInputHost.appendChild(hiddenInput);
    gridRoot?.appendChild(hiddenInputHost);
    hiddenInput.focus();

    act(() => {
      dataGridRegistry.setFocused(GRID_ID);
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "d",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const tableKey = buildCrudTableKey(DELETE_TARGET);
    const stagedCommands = useCrudStore.getState().stagedCommands.get(tableKey) ?? [];
    expect(stagedCommands).toHaveLength(1);
    expect(stagedCommands[0]?.type).toBe("data.delete");
  });
});
