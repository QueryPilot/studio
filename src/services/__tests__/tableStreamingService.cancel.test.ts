import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for TableStreamingService cancellation and generation counter.
 *
 * We mock queryStreamClient.streamWithCallbacks to control callback timing
 * and verify that cancel() properly rejects promises and prevents stale callbacks.
 */

// Mock the queryStreamClient module — use vi.hoisted so the fn is available at hoist time
const { mockStreamWithCallbacks } = vi.hoisted(() => ({
  mockStreamWithCallbacks: vi.fn(),
}));
vi.mock("../queryStreamClient", () => ({
  queryStreamClient: {
    streamWithCallbacks: mockStreamWithCallbacks,
  },
}));

// Mock isTauri — streamEntityPage checks this but TableStreamingService doesn't
vi.mock("@/utils/tauri", () => ({ isTauri: () => true }));

// Mock logger to suppress output
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock mapBackendColumnsToColumnMeta
vi.mock("../tableDataTransform", () => ({
  mapBackendColumnsToColumnMeta: (cols: unknown[]) =>
    cols.map((c: unknown) => ({
      name: (c as { name?: string })?.name ?? "col",
      db_type: "text",
    })),
  normalizeBackendValue: (v: unknown) => v,
}));

// Import after mocks
import { tableStreamingService } from "../tableStreamingService";

// Helper: captures the callbacks passed to streamWithCallbacks
function captureCallbacks() {
  const captured: {
    onStarted?: (columns: unknown[], estimatedRows?: number) => void;
    onBatch?: (batch: { rows: unknown[][]; rowOffset: number }, totalSoFar: number) => void;
    onSuccess?: (result: {
      columns: unknown[];
      totalRows: number;
      executionTimeMs: number;
      cursorSetupMs?: number;
      totalStreamingMs?: number;
      fetchCount?: number;
      networkMs?: number;
      conversionMs?: number;
      ipcSendMs?: number;
    }) => void;
    onError?: (error: Error) => void;
  } = {};

  mockStreamWithCallbacks.mockImplementation(
    (_params: unknown, callbacks: typeof captured) => {
      Object.assign(captured, callbacks);
      return Promise.resolve();
    },
  );

  return captured;
}

const STREAM_RESULT = {
  columns: [{ name: "id" }],
  totalRows: 2,
  executionTimeMs: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the service state by calling cancel
  tableStreamingService.cancel();
});

describe("TableStreamingService cancellation", () => {
  it("resolves normally when onSuccess fires with all rows accumulated", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Simulate backend callbacks
    callbacks.onStarted?.([{ name: "id" }], 2);
    callbacks.onBatch?.({ rows: [[1], [2]], rowOffset: 0 }, 2);
    callbacks.onSuccess?.(STREAM_RESULT);

    const result = await promise;
    expect(result.isComplete).toBe(true);
    expect(result.rows).toEqual([[1], [2]]);
    expect(result.totalRows).toBe(2);
  });

  it("rejects with AbortError when cancel() is called during streaming", async () => {
    captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Cancel before any callbacks fire
    tableStreamingService.cancel();

    await expect(promise).rejects.toThrow("Query cancelled");
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with AbortError when cancel() is called after onBatch", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Simulate partial progress
    callbacks.onStarted?.([{ name: "id" }], 10);
    callbacks.onBatch?.({ rows: [[1], [2]], rowOffset: 0 }, 2);

    // Cancel mid-stream
    tableStreamingService.cancel();

    await expect(promise).rejects.toThrow("Query cancelled");
  });

  it("resolves immediately on onSuccess even if cancel() is called afterwards", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Fire onBatch + onSuccess — promise resolves immediately (no polling)
    callbacks.onBatch?.({ rows: [[1]], rowOffset: 0 }, 1);
    callbacks.onSuccess?.({ ...STREAM_RESULT, totalRows: 1 });

    // Cancel after success — no-op since promise already resolved
    tableStreamingService.cancel();

    const result = await promise;
    expect(result.isComplete).toBe(true);
  });

  it("ignores stale onBatch callbacks after cancel via generation counter", async () => {
    const callbacks = captureCallbacks();

    const promise1 = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Save references to old callbacks
    const staleOnBatch = callbacks.onBatch;
    const staleOnSuccess = callbacks.onSuccess;

    // Start a new query (implicitly cancels the old one)
    const callbacks2 = captureCallbacks();
    const promise2 = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 2",
    );

    // Old callbacks fire (from backend finishing the old query) — should be no-ops
    staleOnBatch?.({ rows: [[999]], rowOffset: 0 }, 1);
    staleOnSuccess?.({ ...STREAM_RESULT, totalRows: 1 });

    // New query completes normally
    callbacks2.onStarted?.([{ name: "id" }], 1);
    callbacks2.onBatch?.({ rows: [[42]], rowOffset: 0 }, 1);
    callbacks2.onSuccess?.({ ...STREAM_RESULT, totalRows: 1 });

    // Old promise should have been rejected
    await expect(promise1).rejects.toThrow("Query cancelled");

    // New promise resolves with correct data (not corrupted by stale callback)
    const result2 = await promise2;
    expect(result2.rows).toEqual([[42]]);
    expect(result2.rows).not.toContainEqual([999]);
  });

  it("double cancel() does not throw", () => {
    expect(() => {
      tableStreamingService.cancel();
      tableStreamingService.cancel();
    }).not.toThrow();
  });

  it("cancel() before any streamQuery is safe", () => {
    expect(() => tableStreamingService.cancel()).not.toThrow();
  });

  it("isStreamingActive() reflects correct state", async () => {
    const callbacks = captureCallbacks();

    expect(tableStreamingService.isStreamingActive()).toBe(false);

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    expect(tableStreamingService.isStreamingActive()).toBe(true);

    // Complete the stream
    callbacks.onStarted?.([{ name: "id" }], 1);
    callbacks.onBatch?.({ rows: [[1]], rowOffset: 0 }, 1);
    callbacks.onSuccess?.({ ...STREAM_RESULT, totalRows: 1 });

    await promise;
    expect(tableStreamingService.isStreamingActive()).toBe(false);
  });

  it("isStreamingActive() returns false after cancel()", async () => {
    captureCallbacks();
    const promise = tableStreamingService.streamQuery("conn-1", "tab-1", "SELECT 1");

    expect(tableStreamingService.isStreamingActive()).toBe(true);

    tableStreamingService.cancel();
    expect(tableStreamingService.isStreamingActive()).toBe(false);

    // Consume the rejection to avoid unhandled promise rejection
    await expect(promise).rejects.toThrow("Query cancelled");
  });

  it("rejects with the error when onError fires", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT bad_syntax",
    );

    callbacks.onError?.(new Error("syntax error at position 7"));

    await expect(promise).rejects.toThrow("syntax error at position 7");
  });

  it("ignores stale onError after cancel", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    const staleOnError = callbacks.onError;

    // Cancel (rejects with AbortError)
    tableStreamingService.cancel();

    // Stale onError arrives — should be ignored (generation mismatch)
    staleOnError?.(new Error("connection reset"));

    // Should reject with AbortError, not "connection reset"
    await expect(promise).rejects.toThrow("Query cancelled");
  });

  it("resolves immediately with accumulated rows on onSuccess (no polling)", async () => {
    const callbacks = captureCallbacks();

    const promise = tableStreamingService.streamQuery(
      "conn-1",
      "tab-1",
      "SELECT 1",
    );

    // Backend says 100 rows total but only 50 arrive via onBatch
    callbacks.onStarted?.([{ name: "id" }], 100);
    callbacks.onBatch?.({ rows: Array.from({ length: 50 }, (_, i) => [i]), rowOffset: 0 }, 50);
    callbacks.onSuccess?.({
      columns: [{ name: "id" }],
      totalRows: 100,
      executionTimeMs: 200,
    });

    // Resolves immediately with whatever rows are accumulated
    const result = await promise;
    expect(result.isComplete).toBe(true);
    expect(result.rows).toHaveLength(50);
    expect(result.totalRows).toBe(100);
  });
});
