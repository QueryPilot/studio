import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useCrudOperations } from "../useCrudOperations";

const mockStageCommand = vi.fn();
const mockCommitChanges = vi.fn();
const mockDiscardChanges = vi.fn();
const mockGetTableKey = vi.fn(() => "conn:db:table");

const mockState = {
  stageCommand: mockStageCommand,
  commitChanges: mockCommitChanges,
  discardChanges: mockDiscardChanges,
  getTableKey: mockGetTableKey,
  stagedCommands: new Map(),
};

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: vi.fn((selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState,
  ),
}));

describe("useCrudOperations", () => {
  const defaultOptions = {
    connectionId: "test-conn",
    database: "testdb",
    table: "users",
    primaryKeyColumns: ["id"],
  };

  it("should provide CRUD operation methods", () => {
    const { result } = renderHook(() => useCrudOperations(defaultOptions));

    expect(typeof result.current.stageEdit).toBe("function");
    expect(typeof result.current.stageDelete).toBe("function");
    expect(typeof result.current.stageInsert).toBe("function");
    expect(typeof result.current.commitChanges).toBe("function");
    expect(typeof result.current.discardChanges).toBe("function");
    expect(typeof result.current.pendingCount).toBe("number");
  });

  it("should have zero pending count initially", () => {
    const { result } = renderHook(() => useCrudOperations(defaultOptions));

    expect(result.current.pendingCount).toBe(0);
  });
});
