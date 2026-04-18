import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStreamWithCallbacks } = vi.hoisted(() => ({
  mockStreamWithCallbacks: vi.fn(),
}));

vi.mock("@/services/queryStreamClient", () => ({
  queryStreamClient: { streamWithCallbacks: mockStreamWithCallbacks },
}));
vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({ getVisibleSchemas: () => ["public"] }),
  },
}));
vi.mock("@/utils/tauri", () => ({ isTauri: () => true }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/services/tableDataTransform", () => ({
  mapBackendColumnsToColumnMeta: (cols: unknown[]) =>
    cols.map((c: unknown) => ({ name: (c as { name?: string }).name ?? "col", db_type: "text" })),
  normalizeBackendValue: (v: unknown) => v,
}));

import { tableStreamingService } from "@/services/tableStreamingService";
import useWorkbenchStore from "@/stores/workbenchStore";

type StreamCallbacks = {
  onStarted?: (columns: unknown[], estimatedRows?: number) => void;
  onSuccess?: (result: { columns: unknown[]; totalRows: number; executionTimeMs: number }) => void;
  onError?: (error: Error) => void;
};

function captureCallbacks(): StreamCallbacks {
  const captured: StreamCallbacks = {};
  mockStreamWithCallbacks.mockImplementation(
    (_params: unknown, callbacks: StreamCallbacks) => {
      Object.assign(captured, callbacks);
      return Promise.resolve();
    },
  );
  return captured;
}

describe("tableStreamingService streaming error with schema override hint", () => {
  beforeEach(() => {
    mockStreamWithCallbacks.mockClear();
    tableStreamingService.cancel();
    useWorkbenchStore.setState({
      layoutTree: null,
      panelContents: new Map(),
      layoutHistory: [],
      historyIndex: -1,
    });
    useWorkbenchStore.getState().initializeLayout();
    const panelId = Array.from(
      useWorkbenchStore.getState().panelContents.keys(),
    )[0]!;
    useWorkbenchStore
      .getState()
      .addTab(panelId, "t1", { connectionId: "c", database: "d" });
  });

  it("appends override hint to streaming error when tab override is set", async () => {
    useWorkbenchStore.getState().setTabSchemaOverride("t1", ["reporting"]);
    const callbacks = captureCallbacks();
    const promise = tableStreamingService.streamQuery("c", "t1", "SELECT 1");
    callbacks.onError?.(new Error('schema "reporting" does not exist'));
    await expect(promise).rejects.toThrow(
      /Tab overrides schema `reporting` which may not exist/,
    );
  });

  it("does not append hint when no tab override is set", async () => {
    const callbacks = captureCallbacks();
    const promise = tableStreamingService.streamQuery("c", "t1", "SELECT 1");
    callbacks.onError?.(new Error('schema "reporting" does not exist'));
    await expect(promise).rejects.toThrow(/schema "reporting" does not exist/);
    await expect(promise).rejects.not.toThrow(/Tab overrides schema/);
  });
});
