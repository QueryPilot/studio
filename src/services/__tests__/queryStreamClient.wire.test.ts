import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock, coreMockState } = vi.hoisted(() => {
  const invokeMock = vi.fn().mockResolvedValue(undefined);
  const SERIALIZE_TO_IPC_FN = Symbol("SERIALIZE_TO_IPC_FN");
  let nextCallbackId = 0;
  const callbackRegistry = new Map<number, (payload: unknown) => void>();
  const coreMockState = {
    SERIALIZE_TO_IPC_FN,
    callbackRegistry,
    nextCallbackId: () => {
      nextCallbackId += 1;
      return nextCallbackId;
    },
    reset: () => {
      nextCallbackId = 0;
      callbackRegistry.clear();
    },
  };
  return { invokeMock, coreMockState };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  transformCallback: (callback: (payload: unknown) => void) => {
    const id = coreMockState.nextCallbackId();
    coreMockState.callbackRegistry.set(id, callback);
    return id;
  },
  SERIALIZE_TO_IPC_FN: coreMockState.SERIALIZE_TO_IPC_FN,
}));
vi.mock("@/utils/tauri", () => ({ isTauri: () => true }));
vi.mock("@/services/streamDecodeWorkerClient", () => ({
  getStreamDecodeWorker: () => ({ decode: vi.fn() }),
  prewarmStreamDecodeWorker: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { queryStreamClient } from "@/services/queryStreamClient";

describe("queryStreamClient wire forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMockState.reset();
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        unregisterCallback: (id: number) => {
          coreMockState.callbackRegistry.delete(id);
        },
      },
    });
  });

  it("forwards effectiveSchemas/effectiveDatabase in execute_query invoke", async () => {
    void queryStreamClient.streamWithCallbacks(
      {
        connId: "c1", tabId: "t1", sql: "SELECT 1",
        effectiveSchemas: ["reporting", "public"],
        effectiveDatabase: "mydb",
      },
      { onError: () => {} },
    );
    // Give the microtask queue a tick for invoke to be called.
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeMock).toHaveBeenCalledWith(
      "execute_query",
      expect.objectContaining({
        connId: "c1",
        tabId: "t1",
        sql: "SELECT 1",
        effectiveSchemas: ["reporting", "public"],
        effectiveDatabase: "mydb",
      }),
    );
  });
});
