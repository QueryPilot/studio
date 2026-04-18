import { describe, it, expect, vi, beforeEach } from "vitest";

// Must use vi.hoisted so the mock factory can reference these before module init
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
  getStreamDecodeWorker: () => ({ decode: vi.fn(), mapRowsNormalized: vi.fn() }),
  prewarmStreamDecodeWorker: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useConnectionStore } from "@/stores/connectionStoreNew";
import { resolveEffective } from "@/services/effectiveSchemas";
import { tableStreamingService } from "@/services/tableStreamingService";
import { DbType } from "@/types/connection";

describe("E2E: resolveEffective → streamQuery → invoke", () => {
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

  it("invoke receives effectiveSchemas/effectiveDatabase", async () => {
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "c1", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
          database: "mydb", username: "u", options: {},
          databases: [{ name: "mydb", visible_schemas: ["reporting", "public"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
    const { effectiveSchemas, effectiveDatabase } = resolveEffective("c1", "mydb");
    void tableStreamingService.streamQuery(
      "c1", "tab-1", "SELECT 1", undefined, undefined, undefined, undefined,
      { effectiveSchemas, effectiveDatabase },
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const callArgs = invokeMock.mock.calls.find(([name]) => name === "execute_query")?.[1];
    expect(callArgs).toMatchObject({
      effectiveSchemas: ["reporting", "public"],
      effectiveDatabase: "mydb",
    });
  });
});
