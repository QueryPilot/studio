import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOptimisticRows } from "./useOptimisticRows";
import { createCrudTarget, createInsertCommand } from "../utils/crudHelpers";
import type { CellValue } from "@/types";
import type { GridColumnV2, GridRowModel } from "../types";

const makeCell = (value: unknown): CellValue => ({
  value,
  value_type: "Text",
  db_type: "text",
  is_truncated: false,
});

describe("useOptimisticRows", () => {
  it("applies insert payload values to the grid field key", () => {
    const columns: GridColumnV2[] = [
      {
        id: "username",
        field: "col_0",
        name: "username",
        title: "username",
        type: "text",
        meta: null,
      },
    ];
    const usernameColumn = columns[0];
    if (!usernameColumn) {
      throw new Error("Expected username column");
    }
    const columnNameToFieldMap = new Map<string, string>([["username", "col_0"]]);
    const columnByFieldMap = new Map<string, GridColumnV2>([
      ["col_0", usernameColumn],
    ]);

    const draftRow: GridRowModel = {
      col_0: makeCell("alice"),
    };

    const command = createInsertCommand(
      draftRow,
      createCrudTarget("conn", "db", "public", "users"),
      columns,
    );

    const { result } = renderHook(() =>
      useOptimisticRows({
        displayRows: [],
        stagedCommands: [command],
        primaryKeyColumns: [],
        columnNameToFieldMap,
        columnByFieldMap,
        columns,
        getRowKey: (_row, index) => `row-${index}`,
      }),
    );

    const row = result.current[0];
    const cell = row?.col_0 as CellValue | undefined;
    expect(cell?.value).toBe("alice");
  });

  it("does not optimistically apply existing-row updates when identity columns are unavailable", () => {
    const columns: GridColumnV2[] = [
      {
        id: "username",
        field: "col_0",
        name: "username",
        title: "username",
        type: "text",
        meta: null,
      },
    ];
    const usernameColumn = columns[0];
    if (!usernameColumn) {
      throw new Error("Expected username column");
    }
    const columnNameToFieldMap = new Map<string, string>([["username", "col_0"]]);
    const columnByFieldMap = new Map<string, GridColumnV2>([
      ["col_0", usernameColumn],
    ]);

    const displayRows: GridRowModel[] = [
      { col_0: makeCell("alice") },
      { col_0: makeCell("bob") },
    ];

    const updateCommand = {
      id: "update-1",
      type: "data.update",
      target: createCrudTarget("conn", "db", "public", "users"),
      payload: {
        column: "username",
        oldValue: "alice",
        newValue: "alice-updated",
        primaryKeys: { username: "alice" },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: "Update username",
      },
      state: "staged",
    } as const;

    const { result } = renderHook(() =>
      useOptimisticRows({
        displayRows,
        stagedCommands: [updateCommand],
        primaryKeyColumns: [],
        columnNameToFieldMap,
        columnByFieldMap,
        columns,
        getRowKey: (_row, index) => `row-${index}`,
      }),
    );

    const firstRow = result.current[0];
    const firstCell = firstRow?.col_0 as CellValue | undefined;
    expect(firstCell?.value).toBe("alice");
  });
});
