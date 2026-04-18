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
import { resolveEffective } from "@/services/effectiveSchemas";
import useWorkbenchStore from "@/stores/workbenchStore";

const STREAM_RESULT = { columns: [{ name: "id" }], totalRows: 0, executionTimeMs: 1 };

type StreamCallbacks = {
  onStarted?: (columns: unknown[], estimatedRows?: number) => void;
  onSuccess?: (result: typeof STREAM_RESULT) => void;
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

describe("tableStreamingService with tab override", () => {
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

  it("forwards connection schemas when no override", async () => {
    const callbacks = captureCallbacks();
    const r = resolveEffective("c", "d", "t1");
    const promise = tableStreamingService.streamQuery(
      "c",
      "t1",
      "SELECT 1",
      undefined,
      undefined,
      undefined,
      undefined,
      {
        effectiveSchemas: r.effectiveSchemas,
        effectiveDatabase: r.effectiveDatabase,
      },
    );
    callbacks.onStarted?.([{ name: "id" }], 0);
    callbacks.onSuccess?.(STREAM_RESULT);
    await promise;

    expect(mockStreamWithCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveSchemas: ["public"],
        effectiveDatabase: "d",
      }),
      expect.any(Object),
    );
  });

  it("forwards override schemas when set", async () => {
    useWorkbenchStore
      .getState()
      .setTabSchemaOverride("t1", ["reporting"], "warehouse");
    const callbacks = captureCallbacks();
    const r = resolveEffective("c", "d", "t1");
    const promise = tableStreamingService.streamQuery(
      "c",
      "t1",
      "SELECT 1",
      undefined,
      undefined,
      undefined,
      undefined,
      {
        effectiveSchemas: r.effectiveSchemas,
        effectiveDatabase: r.effectiveDatabase,
      },
    );
    callbacks.onStarted?.([{ name: "id" }], 0);
    callbacks.onSuccess?.(STREAM_RESULT);
    await promise;

    expect(mockStreamWithCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveSchemas: ["reporting"],
        effectiveDatabase: "warehouse",
      }),
      expect.any(Object),
    );
  });
});
