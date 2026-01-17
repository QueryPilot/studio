import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useStagedChangesIndicator } from "../useStagedChangesIndicator";

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: vi.fn(() => ({
    stagedCommands: new Map(),
    getTableKey: vi.fn(() => "test-conn:testdb:users"),
  })),
}));

describe("useStagedChangesIndicator", () => {
  it("should provide staged changes map", () => {
    const { result } = renderHook(() =>
      useStagedChangesIndicator({
        connectionId: "test-conn",
        database: "testdb",
        table: "users",
        rows: [],
        columns: [],
      }),
    );

    expect(result.current).toBeDefined();
    expect(result.current.rowChanges).toBeInstanceOf(Map);
    expect(result.current.deletedRows).toBeInstanceOf(Set);
    expect(result.current.insertedRows).toBeInstanceOf(Set);
  });
});
