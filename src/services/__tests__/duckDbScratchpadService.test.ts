import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { BackendAPI, type QueryColumnMeta } from "../backend";
import {
  DuckDbScratchpadService,
  inferDuckDbTypeFromRawType,
  type DuckDbManagedObjectLineage,
  type DuckDbRedisSnapshotEntry,
} from "../duckDbScratchpadService";

vi.mock("../backend", () => ({
  BackendAPI: {
    duckdbAddFile: vi.fn(),
    duckdbReplaceManagedObject: vi.fn(),
  },
}));

const mockedBackendApi = BackendAPI as unknown as {
  duckdbAddFile: Mock;
  duckdbReplaceManagedObject: Mock;
};

describe("DuckDbScratchpadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes SQL snapshots into typed DuckDB replace payloads", () => {
    const columns: QueryColumnMeta[] = [
      {
        name: "id",
        data_type: "Integer",
        nullable: false,
        primary_key: false,
        db_type: "BIGINT",
      },
      {
        name: "payload",
        data_type: "Json",
        nullable: true,
        primary_key: false,
        db_type: "JSON",
      },
      {
        name: "created_at",
        data_type: "DateTime",
        nullable: true,
        primary_key: false,
        db_type: "TIMESTAMP",
      },
    ];

    const request = DuckDbScratchpadService.buildSqlSnapshotRequest({
      targetSchema: "main",
      targetName: "orders_snapshot",
      sourceId: "sql-orders",
      sourceKind: "sql_table",
      sourceConnectionId: "pg-1",
      sourceSpec: { schema: "public", table: "orders" },
      columns,
      rows: [
        ["42", { status: "paid" }, "2026-03-23T12:00:00Z"],
      ],
    });

    expect(request.objectKind).toBe("sql_snapshot");
    expect(request.columns).toEqual([
      { name: "id", duckdbType: "BIGINT" },
      { name: "payload", duckdbType: "JSON" },
      { name: "created_at", duckdbType: "TIMESTAMP" },
    ]);
    expect(request.rows[0]).toEqual([
      "42",
      { status: "paid" },
      "2026-03-23T12:00:00Z",
    ]);
  });

  it("normalizes Mongo snapshots into JSON-shaped DuckDB rows", () => {
    const request = DuckDbScratchpadService.buildMongoSnapshotRequest({
      targetSchema: "main",
      targetName: "users_collection",
      sourceId: "mongo-users",
      sourceConnectionId: "mongo-1",
      sourceSpec: { database: "app", collection: "users" },
      collection: "users",
      documents: [
        { _id: { $oid: "abc123" }, email: "ada@example.com" },
      ],
      importedAt: "2026-03-23T10:00:00.000Z",
    });

    expect(request.objectKind).toBe("mongo_snapshot");
    expect(request.columns).toEqual([
      { name: "_id", duckdbType: "TEXT" },
      { name: "__qp_source_collection", duckdbType: "TEXT" },
      { name: "__qp_imported_at", duckdbType: "TIMESTAMP" },
      { name: "__qp_raw", duckdbType: "JSON" },
    ]);
    expect(request.rows).toEqual([
      [
        '{"$oid":"abc123"}',
        "users",
        "2026-03-23T10:00:00.000Z",
        { _id: { $oid: "abc123" }, email: "ada@example.com" },
      ],
    ]);
  });

  it("normalizes Redis snapshots into JSON-shaped DuckDB rows", () => {
    const entries: DuckDbRedisSnapshotEntry[] = [
      {
        key: "orders:1",
        type: "hash",
        ttl: 120,
        dbIndex: 3,
        raw: { status: "paid", total: 9.99 },
      },
    ];

    const request = DuckDbScratchpadService.buildRedisSnapshotRequest({
      targetSchema: "main",
      targetName: "redis_orders",
      sourceId: "redis-orders",
      sourceConnectionId: "redis-1",
      sourceSpec: { database: 3, pattern: "orders:*" },
      entries,
      importedAt: "2026-03-23T10:00:00.000Z",
    });

    expect(request.objectKind).toBe("redis_snapshot");
    expect(request.columns).toEqual([
      { name: "key", duckdbType: "TEXT" },
      { name: "type", duckdbType: "TEXT" },
      { name: "ttl", duckdbType: "BIGINT" },
      { name: "db_index", duckdbType: "INTEGER" },
      { name: "__qp_imported_at", duckdbType: "TIMESTAMP" },
      { name: "__qp_raw", duckdbType: "JSON" },
    ]);
    expect(request.rows).toEqual([
      [
        "orders:1",
        "hash",
        120,
        3,
        "2026-03-23T10:00:00.000Z",
        { status: "paid", total: 9.99 },
      ],
    ]);
  });

  it("refreshes file-backed lineage through duckdbAddFile", async () => {
    const lineage: DuckDbManagedObjectLineage = {
      targetSchema: "main",
      targetName: "imported_users",
      objectKind: "file_import",
      sourceId: "file-users",
      sourceKind: "file",
      sourceConnectionId: null,
      sourceSpec: {
        filePath: "/tmp/users.csv",
        format: "csv",
        mode: "persist_table",
      },
      lastRefreshStatus: "success",
      lastRefreshAt: "2026-03-23 10:00:00",
      lastRowCount: 2,
      lastError: null,
    };

    mockedBackendApi.duckdbAddFile.mockResolvedValue({
      targetSchema: "main",
      targetName: "imported_users",
    });

    await DuckDbScratchpadService.refreshManagedObject("duckdb-1", lineage, {});

    expect(mockedBackendApi.duckdbAddFile).toHaveBeenCalledWith("duckdb-1", {
        filePath: "/tmp/users.csv",
        targetSchema: "main",
        targetName: "imported_users",
        sourceId: "file-users",
      });
    expect(mockedBackendApi.duckdbReplaceManagedObject).not.toHaveBeenCalled();
  });

  describe("inferDuckDbTypeFromRawType", () => {
    it("preserves INTEGER[] as-is (array shorthand)", () => {
      expect(inferDuckDbTypeFromRawType("Text", "INTEGER[]")).toBe("INTEGER[]");
    });

    it("preserves STRUCT types as-is", () => {
      const structType = "STRUCT(name VARCHAR, age INTEGER)";
      expect(inferDuckDbTypeFromRawType("Text", structType)).toBe(structType);
    });

    it("preserves MAP types as-is", () => {
      const mapType = "MAP(VARCHAR, INTEGER)";
      expect(inferDuckDbTypeFromRawType("Text", mapType)).toBe(mapType);
    });

    it("falls back to JSON when rawType is Json and dbType is undefined", () => {
      expect(inferDuckDbTypeFromRawType("Json", undefined)).toBe("JSON");
    });
  });

  it("refreshes SQL lineage via loader and atomic replace", async () => {
    const lineage: DuckDbManagedObjectLineage = {
      targetSchema: "main",
      targetName: "orders_snapshot",
      objectKind: "sql_snapshot",
      sourceId: "sql-orders",
      sourceKind: "sql_table",
      sourceConnectionId: "pg-1",
      sourceSpec: {
        schema: "public",
        table: "orders",
      },
      lastRefreshStatus: "success",
      lastRefreshAt: "2026-03-23 10:00:00",
      lastRowCount: 2,
      lastError: null,
    };

    const columns: QueryColumnMeta[] = [
      {
        name: "id",
        data_type: "Integer",
        nullable: false,
        primary_key: false,
        db_type: "BIGINT",
      },
    ];

    await DuckDbScratchpadService.refreshManagedObject("duckdb-1", lineage, {
      loadSqlSnapshot: vi.fn().mockResolvedValue({
        columns,
        rows: [["7"]],
      }),
    });

    expect(mockedBackendApi.duckdbReplaceManagedObject).toHaveBeenCalledWith(
      "duckdb-1",
      expect.objectContaining({
        targetSchema: "main",
        targetName: "orders_snapshot",
        sourceId: "sql-orders",
        sourceKind: "sql_table",
        rows: [["7"]],
      }),
    );
  });
});
