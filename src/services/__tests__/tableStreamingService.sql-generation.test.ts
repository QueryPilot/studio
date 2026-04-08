import { beforeEach, describe, expect, it, vi } from "vitest";
import { DbType } from "@/types";
import type { ColumnMeta } from "@/types/database";
import type { DatabaseAdapter } from "@/adapters/types";

const {
  mockStreamWithCallbacks,
  mockGetAdapterForConnection,
  mockGetTableCount,
  mockSortConfigToOrderBy,
} = vi.hoisted(() => ({
  mockStreamWithCallbacks: vi.fn(),
  mockGetAdapterForConnection: vi.fn(),
  mockGetTableCount: vi.fn(),
  mockSortConfigToOrderBy: vi.fn(),
}));

vi.mock("../queryStreamClient", () => ({
  queryStreamClient: {
    streamWithCallbacks: mockStreamWithCallbacks,
  },
}));

vi.mock("../streamDecodeWorkerClient", () => ({
  getStreamDecodeWorker: () => ({
    mapRowsNormalized: vi.fn((rows: unknown[][]) => Promise.resolve(rows)),
  }),
}));

vi.mock("../introspectionService", () => ({
  IntrospectionService: {
    getTableCount: mockGetTableCount,
  },
}));

vi.mock("@/adapters", () => ({
  getAdapterForConnection: mockGetAdapterForConnection,
}));

vi.mock("@/adapters/formatting", () => ({
  formatTableName: (schema: string | undefined, table: string) =>
    schema ? `"${schema}"."${table}"` : `"${table}"`,
  filterConfigToWhereClause: () => undefined,
  sortConfigToOrderBy: mockSortConfigToOrderBy,
}));

vi.mock("@/utils/tauri", () => ({ isTauri: () => true }));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../tableDataTransform", () => ({
  mapBackendColumnsToColumnMeta: (columns: Array<{ name: string }>) =>
    columns.map((column, index) => ({
      name: column.name,
      db_type: "text",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: index,
    })),
}));

import { streamEntityPage } from "../tableStreamingService";

function makeColumn(name: string, dbType: string): ColumnMeta {
  return {
    name,
    db_type: dbType,
    nullable: true,
    default: null,
    is_pk: false,
    is_fk: false,
    ordinal: 0,
  };
}

function makePostgresAdapter(): DatabaseAdapter {
  return {
    dbType: DbType.PostgreSQL,
    select: vi.fn(() => 'SELECT * FROM "public"."job_logs"'),
    selectWithEmbeddedFK: vi.fn(() => 'SELECT * FROM "public"."job_logs"'),
    transaction: vi.fn(() => ""),
    formatValue: vi.fn(() => "NULL"),
    quoteIdentifier: (name: string) => `"${name.replaceAll('"', '""')}"`,
    quoteString: (value: string) => `'${value.replaceAll("'", "''")}'`,
    addColumn: vi.fn(),
    modifyColumn: vi.fn(),
    dropColumn: vi.fn(),
    renameColumn: vi.fn(),
    createIndex: vi.fn(),
    dropIndex: vi.fn(),
    renameIndex: vi.fn(),
    createTrigger: vi.fn(),
    dropTrigger: vi.fn(),
    renameTrigger: vi.fn(),
    setTriggerEnabled: vi.fn(),
    createView: vi.fn(),
    dropView: vi.fn(),
    renameView: vi.fn(),
    refreshMaterializedView: vi.fn(),
    createConstraint: vi.fn(),
    dropConstraint: vi.fn(),
    renameConstraint: vi.fn(),
    truncateTable: vi.fn(),
    cloneTable: vi.fn(),
  } as unknown as DatabaseAdapter;
}

describe("streamEntityPage SQL generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTableCount.mockResolvedValue({ count: 0, isEstimated: false });
    mockSortConfigToOrderBy.mockReturnValue([
      { column: "id", direction: "ASC" },
    ]);
  });

  it("builds a truncated Postgres browse query for heavy columns", async () => {
    mockGetAdapterForConnection.mockResolvedValue(makePostgresAdapter());

    let capturedSql = "";
    mockStreamWithCallbacks.mockImplementation(
      (
        params: { sql: string },
        callbacks: {
          onStarted?: (columns: Array<{ name: string }>, estimatedRows?: number) => void;
          onSuccess?: (result: {
            totalRows: number;
            executionTimeMs: number;
          }) => void;
        },
      ) => {
        capturedSql = params.sql;
        callbacks.onStarted?.(
          [{ name: "id" }, { name: "run_by" }, { name: "payload" }, { name: "raw_blob" }],
          0,
        );
        callbacks.onSuccess?.({ totalRows: 0, executionTimeMs: 1 });
        return Promise.resolve();
      },
    );

    await streamEntityPage({
      connectionId: "conn-1",
      database: "db",
      schema: "public",
      entityType: "table",
      entityName: "job_logs",
      pageSize: 100,
      offset: 300,
      sorts: [{ column: "id", direction: "asc" }],
      columnsHint: [
        makeColumn("id", "uuid"),
        makeColumn("run_by", "text"),
        makeColumn("payload", "jsonb"),
        makeColumn("raw_blob", "bytea"),
      ],
    });

    expect(capturedSql).not.toContain("SELECT *");
    expect(capturedSql).toContain('"public"."job_logs"."id" AS "id"');
    expect(capturedSql).toContain(
      'CASE WHEN "public"."job_logs"."run_by" IS NULL THEN NULL WHEN octet_length("public"."job_logs"."run_by"::text) > 8192 THEN left("public"."job_logs"."run_by"::text, 8192) || \'...\' ELSE "public"."job_logs"."run_by"::text END AS "run_by"',
    );
    expect(capturedSql).toContain(
      'CASE WHEN "public"."job_logs"."payload" IS NULL THEN NULL WHEN octet_length("public"."job_logs"."payload"::text) > 8192 THEN left("public"."job_logs"."payload"::text, 8192) || \'...\' ELSE "public"."job_logs"."payload"::text END AS "payload"',
    );
    expect(capturedSql).toContain(
      'CASE WHEN "public"."job_logs"."raw_blob" IS NULL THEN NULL WHEN octet_length("public"."job_logs"."raw_blob") > 8192 THEN substring("public"."job_logs"."raw_blob" FROM 1 FOR 8192) ELSE "public"."job_logs"."raw_blob" END AS "raw_blob"',
    );
    expect(capturedSql).toContain('ORDER BY "id" ASC');
    expect(capturedSql).toContain("LIMIT 100 OFFSET 300");
  });

  it("keeps the adapter-generated SQL when an explicit select list is provided", async () => {
    const adapter = makePostgresAdapter();
    const selectMock = vi
      .spyOn(adapter, "select")
      .mockReturnValue('SELECT "ctid" FROM "public"."job_logs" LIMIT 100');
    mockGetAdapterForConnection.mockResolvedValue(adapter);

    let capturedSql = "";
    mockStreamWithCallbacks.mockImplementation(
      (
        params: { sql: string },
        callbacks: {
          onStarted?: (columns: Array<{ name: string }>, estimatedRows?: number) => void;
          onSuccess?: (result: {
            totalRows: number;
            executionTimeMs: number;
          }) => void;
        },
      ) => {
        capturedSql = params.sql;
        callbacks.onStarted?.([{ name: "ctid" }], 0);
        callbacks.onSuccess?.({ totalRows: 0, executionTimeMs: 1 });
        return Promise.resolve();
      },
    );

    await streamEntityPage({
      connectionId: "conn-1",
      database: "db",
      schema: "public",
      entityType: "table",
      entityName: "job_logs",
      pageSize: 100,
      select: ["ctid"],
      columnsHint: [makeColumn("ctid", "tid")],
    });

    expect(selectMock).toHaveBeenCalled();
    expect(capturedSql).toBe('SELECT "ctid" FROM "public"."job_logs" LIMIT 100');
  });
});
