import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useOptimisticRows } from "../useOptimisticRows";

describe("useOptimisticRows", () => {
  it("should return optimistic rows", () => {
    const { result } = renderHook(() =>
      useOptimisticRows({
        displayRows: [{ data: { id: 1 } }],
        stagedCommands: [],
        primaryKeyColumns: ["id"],
        columnNameToFieldMap: new Map(),
        columnByFieldMap: new Map(),
        getRowId: (row: any) => String(row.data.id),
      }),
    );

    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(1);
  });
});
