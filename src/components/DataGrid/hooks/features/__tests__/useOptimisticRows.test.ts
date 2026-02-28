import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useOptimisticRows } from "../useOptimisticRows";
import type { GridRowModel } from "../../../types";

describe("useOptimisticRows", () => {
  it("should return optimistic rows", () => {
    const displayRows: GridRowModel[] = [
      { col_0: { value: 1, db_type: "int4", value_type: "Integer", is_truncated: false } },
    ];
    const { result } = renderHook(() =>
      useOptimisticRows({
        displayRows,
        stagedCommands: [],
        primaryKeyColumns: ["id"],
        columnNameToFieldMap: new Map(),
        columnByFieldMap: new Map(),
        columns: [],
        getRowKey: (_row, index) => String(index),
      }),
    );

    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(1);
  });
});
