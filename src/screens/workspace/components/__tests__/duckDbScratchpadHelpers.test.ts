import { describe, expect, it, vi } from "vitest";
import {
  defaultDuckDbTargetNameFromFile,
  defaultDuckDbTargetNameFromSnapshotSource,
  fetchRedisSnapshotRawValue,
  type DuckDbSnapshotSource,
  type RedisSnapshotAdapter,
} from "../duckDbScratchpadHelpers";

describe("duckDbScratchpadHelpers", () => {
  it("derives file import target names from the basename without the extension", () => {
    expect(
      defaultDuckDbTargetNameFromFile("/tmp/export/public.orders.parquet"),
    ).toBe("public_orders");
  });

  it("derives SQL snapshot target names from the object name instead of schema prefixes", () => {
    const source: DuckDbSnapshotSource = {
      kind: "sql",
      sourceConnectionId: "pg-1",
      sourceConnectionName: "PG",
      sourceDatabase: "app",
      schema: "public",
      name: "orders",
      objectType: "table",
    };

    expect(defaultDuckDbTargetNameFromSnapshotSource(source)).toBe("orders");
  });

  it("derives Mongo snapshot target names from the collection name instead of the database prefix", () => {
    const source: DuckDbSnapshotSource = {
      kind: "mongo",
      sourceConnectionId: "mongo-1",
      sourceConnectionName: "Mongo",
      sourceDatabase: "app",
      collection: "users",
    };

    expect(defaultDuckDbTargetNameFromSnapshotSource(source)).toBe("users");
  });

  it("passes no count limit when loading Redis stream snapshots", async () => {
    const streamRange = vi.fn().mockResolvedValue([{ id: "1-0", values: {} }]);
    const adapter: RedisSnapshotAdapter = {
      hashGetAll: vi.fn(),
      listRange: vi.fn(),
      setMembers: vi.fn(),
      zsetRange: vi.fn(),
      streamRange,
      getKey: vi.fn(),
    };

    const result = await fetchRedisSnapshotRawValue(adapter, "events", "stream");

    expect(streamRange).toHaveBeenCalledWith("events", "-", "+");
    expect(result).toEqual([{ id: "1-0", values: {} }]);
  });
});
