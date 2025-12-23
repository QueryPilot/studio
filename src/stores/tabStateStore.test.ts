import { describe, it, expect, beforeEach } from "vitest";
import { useTabStateStore } from "./tabStateStore";
import type { QueryResult } from "./tabStateStore";

describe("tabStateStore - Pin Result Feature", () => {
  beforeEach(() => {
    const store = useTabStateStore.getState();
    store.queryStates.clear();
  });

  it("should pin current result", () => {
    const store = useTabStateStore.getState();
    const tabId = "test-tab-1";

    const mockResult: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "test"]],
      rowCount: 1,
      executionTime: 100,
    };

    store.setQueryState(tabId, {
      result: mockResult,
      lastExecutedQuery: "SELECT * FROM test",
    });

    store.pinResult(tabId);

    const state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toEqual(mockResult);
    expect(state?.pinnedResultQuery).toBe("SELECT * FROM test");
  });

  it("should not pin if no result exists", () => {
    const store = useTabStateStore.getState();
    const tabId = "test-tab-2";

    store.setQueryState(tabId, {
      result: null,
      lastExecutedQuery: "",
    });

    store.pinResult(tabId);

    const state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toBeUndefined();
    expect(state?.pinnedResultQuery).toBeUndefined();
  });

  it("should unpin result", () => {
    const store = useTabStateStore.getState();
    const tabId = "test-tab-3";

    const mockResult: QueryResult = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      executionTime: 50,
    };

    store.setQueryState(tabId, {
      result: mockResult,
      lastExecutedQuery: "SELECT id FROM test",
    });

    store.pinResult(tabId);

    let state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toEqual(mockResult);

    store.unpinResult(tabId);

    state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toBeNull();
    expect(state?.pinnedResultQuery).toBeUndefined();
  });

  it("should clear pinned result", () => {
    const store = useTabStateStore.getState();
    const tabId = "test-tab-4";

    const mockResult: QueryResult = {
      columns: ["count"],
      rows: [[42]],
      rowCount: 1,
      executionTime: 25,
    };

    store.setQueryState(tabId, {
      result: mockResult,
      lastExecutedQuery: "SELECT COUNT(*) FROM test",
    });

    store.pinResult(tabId);

    let state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toEqual(mockResult);

    store.clearPinnedResult(tabId);

    state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toBeNull();
    expect(state?.pinnedResultQuery).toBeUndefined();
  });

  it("should preserve current result when pinning", () => {
    const store = useTabStateStore.getState();
    const tabId = "test-tab-5";

    const firstResult: QueryResult = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      executionTime: 10,
    };

    const secondResult: QueryResult = {
      columns: ["id", "name"],
      rows: [[2, "new"]],
      rowCount: 1,
      executionTime: 20,
    };

    store.setQueryState(tabId, {
      result: firstResult,
      lastExecutedQuery: "SELECT id FROM test",
    });

    store.pinResult(tabId);

    store.setQueryState(tabId, {
      result: secondResult,
      lastExecutedQuery: "SELECT * FROM test",
    });

    const state = store.getQueryState(tabId);
    expect(state?.pinnedResult).toEqual(firstResult);
    expect(state?.pinnedResultQuery).toBe("SELECT id FROM test");
    expect(state?.result).toEqual(secondResult);
    expect(state?.lastExecutedQuery).toBe("SELECT * FROM test");
  });

  it("should handle multiple tabs independently", () => {
    const store = useTabStateStore.getState();
    const tabId1 = "test-tab-6";
    const tabId2 = "test-tab-7";

    const result1: QueryResult = {
      columns: ["col1"],
      rows: [["a"]],
      rowCount: 1,
      executionTime: 5,
    };

    const result2: QueryResult = {
      columns: ["col2"],
      rows: [["b"]],
      rowCount: 1,
      executionTime: 15,
    };

    store.setQueryState(tabId1, {
      result: result1,
      lastExecutedQuery: "SELECT col1",
    });

    store.setQueryState(tabId2, {
      result: result2,
      lastExecutedQuery: "SELECT col2",
    });

    store.pinResult(tabId1);

    const state1 = store.getQueryState(tabId1);
    const state2 = store.getQueryState(tabId2);

    expect(state1?.pinnedResult).toEqual(result1);
    expect(state2?.pinnedResult).toBeUndefined();
  });
});
