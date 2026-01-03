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
    const columnNameToFieldMap = new Map([["username", "col_0"]]);
    const columnByFieldMap = new Map([["col_0", columns[0]]]);

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
});
