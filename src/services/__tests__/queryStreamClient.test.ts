import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInvoke,
  mockDecode,
  mockWarn,
  mockError,
  coreMockState,
} = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockDecode = vi.fn();
  const mockWarn = vi.fn();
  const mockError = vi.fn();

  const SERIALIZE_TO_IPC_FN = Symbol("SERIALIZE_TO_IPC_FN");
  let nextCallbackId = 0;
  const callbackRegistry = new Map<
    number,
    (payload: { message: unknown; id?: number }) => void
  >();

  const extractChannelId = (channel: {
    [key: symbol]: (() => string) | undefined;
  }): number => {
    const serialize = channel[SERIALIZE_TO_IPC_FN];
    if (typeof serialize !== "function") {
      throw new Error("Invalid test channel payload");
    }
    const serialized = serialize();
    return Number(serialized.replace("__CHANNEL__:", ""));
  };

  const reset = () => {
    nextCallbackId = 0;
    callbackRegistry.clear();
  };

  return {
    mockInvoke,
    mockDecode,
    mockWarn,
    mockError,
    coreMockState: {
      SERIALIZE_TO_IPC_FN,
      callbackRegistry,
      extractChannelId,
      reset,
      nextCallbackId: () => {
        nextCallbackId += 1;
        return nextCallbackId;
      },
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  transformCallback: (callback: (payload: { message: unknown; id?: number }) => void) => {
    const id = coreMockState.nextCallbackId();
    coreMockState.callbackRegistry.set(id, callback);
    return id;
  },
  SERIALIZE_TO_IPC_FN: coreMockState.SERIALIZE_TO_IPC_FN,
}));

vi.mock("../../utils/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../streamDecodeWorkerClient", () => ({
  getStreamDecodeWorker: () => ({
    decode: mockDecode,
  }),
  prewarmStreamDecodeWorker: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: mockWarn,
    error: mockError,
    debug: vi.fn(),
  },
}));

import { QueryStreamClient } from "../queryStreamClient";

describe("QueryStreamClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMockState.reset();

    mockDecode.mockImplementation((buffer: ArrayBuffer) => {
      const rowCount = new Uint8Array(buffer)[0] ?? 0;
      return Array.from({ length: rowCount }, (_, index) => [index]);
    });
  });

  it("waits for late data batches that arrive after success metadata", async () => {
    mockInvoke.mockImplementation(
      async (
        _command: string,
        args: {
          metadataChannel: { [key: symbol]: () => string };
          dataChannel: { [key: symbol]: () => string };
        },
      ) => {
        const metadataId = coreMockState.extractChannelId(args.metadataChannel);
        const dataId = coreMockState.extractChannelId(args.dataChannel);

        const emitMetadata = coreMockState.callbackRegistry.get(metadataId);
        const emitData = coreMockState.callbackRegistry.get(dataId);

        if (!emitMetadata || !emitData) {
          throw new Error("Missing IPC callback registrations");
        }

        emitMetadata({
          id: 0,
          message: {
            type: "started",
            columns: [
              {
                name: "id",
                data_type: "Integer",
                nullable: true,
                primary_key: false,
                db_type: "int4",
              },
            ],
            estimated_rows: 4,
          },
        });

        emitData({
          id: 0,
          message: Uint8Array.from([2]).buffer,
        });

        emitMetadata({
          id: 1,
          message: {
            type: "success",
            total_rows: 4,
            execution_time_ms: 12,
            fetch_count: 2,
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        emitData({
          id: 1,
          message: Uint8Array.from([2]).buffer,
        });
      },
    );

    const client = new QueryStreamClient();
    const onBatch = vi.fn();

    const result = await client.streamWithCallbacks(
      {
        connId: "conn-1",
        tabId: "query-tab-1",
        sql: "SELECT * FROM large_table",
      },
      {
        onBatch,
      },
    );

    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(onBatch.mock.calls[1]?.[1]).toBe(4);
    expect(result.totalRows).toBe(4);
    expect(result.fetchCount).toBe(2);
  });

  it("reports metadata errors once even if invoke later rejects", async () => {
    mockInvoke.mockImplementation(
      (
        _command: string,
        args: {
          metadataChannel: { [key: symbol]: () => string };
        },
      ) => {
        const metadataId = coreMockState.extractChannelId(args.metadataChannel);
        const emitMetadata = coreMockState.callbackRegistry.get(metadataId);

        if (!emitMetadata) {
          return Promise.reject(new Error("Missing metadata callback registration"));
        }

        emitMetadata({
          id: 0,
          message: {
            type: "error",
            code: "QUERY_EXECUTION_ERROR",
            message: "Internal panic while executing query",
          },
        });

        return Promise.reject(new Error("invoke rejected after metadata error"));
      },
    );

    const client = new QueryStreamClient();
    const onError = vi.fn();

    await expect(
      client.streamWithCallbacks(
        {
          connId: "conn-1",
          tabId: "query-tab-1",
          sql: "SELECT 1",
        },
        { onError },
      ),
    ).rejects.toThrow("[QUERY_EXECUTION_ERROR] Internal panic while executing query");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(String(onError.mock.calls[0]?.[0])).toContain(
      "[QUERY_EXECUTION_ERROR] Internal panic while executing query",
    );
  });
});
