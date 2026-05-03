import {
  BackendAPI,
  type DuckDbAddFileRequest,
  type DuckDbColumnDefinition,
  type DuckDbManagedObjectLineage,
  type DuckDbManagedObjectSummary,
  type DuckDbReplaceManagedObjectRequest,
  type QueryColumnMeta,
  type RawCellValue,
  type RawCellValueType,
} from "./backend";

export interface DuckDbSqlSnapshotInput {
  targetSchema: string;
  targetName: string;
  sourceId: string;
  sourceKind: string;
  sourceConnectionId?: string | null;
  sourceSpec: Record<string, unknown>;
  columns: QueryColumnMeta[];
  rows: RawCellValue[][];
  objectKind?: string;
}

export interface DuckDbMongoSnapshotInput {
  targetSchema: string;
  targetName: string;
  sourceId: string;
  sourceConnectionId?: string | null;
  sourceSpec: Record<string, unknown>;
  collection: string;
  documents: Record<string, unknown>[];
  importedAt?: string;
}

export interface DuckDbRedisSnapshotEntry {
  key: string;
  type: string;
  ttl: number;
  dbIndex: number;
  raw: unknown;
}

export interface DuckDbRedisSnapshotInput {
  targetSchema: string;
  targetName: string;
  sourceId: string;
  sourceConnectionId?: string | null;
  sourceSpec: Record<string, unknown>;
  entries: DuckDbRedisSnapshotEntry[];
  importedAt?: string;
}

export interface DuckDbRefreshLoaders {
  loadSqlSnapshot?: (
    lineage: DuckDbManagedObjectLineage,
  ) => Promise<{ columns: QueryColumnMeta[]; rows: RawCellValue[][] }>;
  loadMongoSnapshot?: (
    lineage: DuckDbManagedObjectLineage,
  ) => Promise<Record<string, unknown>[]>;
  loadRedisSnapshot?: (
    lineage: DuckDbManagedObjectLineage,
  ) => Promise<DuckDbRedisSnapshotEntry[]>;
}

export function inferDuckDbTypeFromRawType(
  rawType: RawCellValueType | undefined,
  dbType?: string,
): string {
  if (dbType) {
    const upper = dbType.toUpperCase();
    if (
      upper.startsWith("STRUCT") ||
      upper.startsWith("LIST") ||
      upper.startsWith("MAP") ||
      upper.startsWith("UNION") ||
      upper.includes("[]") ||
      upper.startsWith("ARRAY")
    ) {
      return dbType;
    }
  }

  if (typeof dbType === "string" && dbType.trim()) {
    const normalized = dbType.trim().toUpperCase();
    if (
      /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT|BOOLEAN|DATE|TIME|TIMESTAMP|TIMESTAMPTZ|BLOB|JSON|VARCHAR|TEXT|CHAR)/.test(
        normalized,
      )
    ) {
      if (
        rawType === "Json" ||
        typeof rawType === "object" ||
        normalized.includes("JSON")
      ) {
        return "JSON";
      }
      if (rawType === "Binary") return "BLOB";
      return normalized;
    }
  }

  if (
    rawType === "Json" ||
    typeof rawType === "object" ||
    rawType === undefined
  ) {
    return "JSON";
  }

  switch (rawType) {
    case "Integer":
      return "BIGINT";
    case "Decimal":
      return "DOUBLE";
    case "Boolean":
      return "BOOLEAN";
    case "Date":
      return "DATE";
    case "Time":
      return "TIME";
    case "DateTime":
      return "TIMESTAMP";
    case "Binary":
      return "BLOB";
    default:
      return "TEXT";
  }
}

function normalizeMongoId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function isoTimestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export const DuckDbScratchpadService = {
  buildSqlSnapshotRequest(
    input: DuckDbSqlSnapshotInput,
  ): DuckDbReplaceManagedObjectRequest {
    return {
      targetSchema: input.targetSchema,
      targetName: input.targetName,
      objectKind: input.objectKind ?? "sql_snapshot",
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      sourceConnectionId: input.sourceConnectionId ?? null,
      sourceSpec: input.sourceSpec,
      columns: input.columns.map((column) => ({
        name: column.name,
        duckdbType: inferDuckDbTypeFromRawType(column.data_type, column.db_type),
      })),
      rows: input.rows,
    };
  },

  buildMongoSnapshotRequest(
    input: DuckDbMongoSnapshotInput,
  ): DuckDbReplaceManagedObjectRequest {
    const importedAt = isoTimestamp(input.importedAt);
    return {
      targetSchema: input.targetSchema,
      targetName: input.targetName,
      objectKind: "mongo_snapshot",
      sourceId: input.sourceId,
      sourceKind: "mongo_collection",
      sourceConnectionId: input.sourceConnectionId ?? null,
      sourceSpec: input.sourceSpec,
      columns: [
        { name: "_id", duckdbType: "TEXT" },
        { name: "__qp_source_collection", duckdbType: "TEXT" },
        { name: "__qp_imported_at", duckdbType: "TIMESTAMP" },
        { name: "__qp_raw", duckdbType: "JSON" },
      ],
      rows: input.documents.map((document) => [
        normalizeMongoId(document._id),
        input.collection,
        importedAt,
        document as RawCellValue,
      ]),
    };
  },

  buildRedisSnapshotRequest(
    input: DuckDbRedisSnapshotInput,
  ): DuckDbReplaceManagedObjectRequest {
    const importedAt = isoTimestamp(input.importedAt);
    return {
      targetSchema: input.targetSchema,
      targetName: input.targetName,
      objectKind: "redis_snapshot",
      sourceId: input.sourceId,
      sourceKind: "redis_keys",
      sourceConnectionId: input.sourceConnectionId ?? null,
      sourceSpec: input.sourceSpec,
      columns: [
        { name: "key", duckdbType: "TEXT" },
        { name: "type", duckdbType: "TEXT" },
        { name: "ttl", duckdbType: "BIGINT" },
        { name: "db_index", duckdbType: "INTEGER" },
        { name: "__qp_imported_at", duckdbType: "TIMESTAMP" },
        { name: "__qp_raw", duckdbType: "JSON" },
      ],
      rows: input.entries.map((entry) => [
        entry.key,
        entry.type,
        entry.ttl,
        entry.dbIndex,
        importedAt,
        entry.raw as RawCellValue,
      ]),
    };
  },

  async importFile(
    connId: string,
    request: DuckDbAddFileRequest,
  ): Promise<DuckDbManagedObjectSummary> {
    return BackendAPI.duckdbAddFile(connId, request);
  },

  async listExcelSheets(connId: string, filePath: string): Promise<string[]> {
    return BackendAPI.duckdbListExcelSheets(connId, filePath);
  },

  async replaceManagedObject(
    connId: string,
    request: DuckDbReplaceManagedObjectRequest,
  ): Promise<DuckDbManagedObjectSummary> {
    return BackendAPI.duckdbReplaceManagedObject(connId, request);
  },

  async listManagedObjects(
    connId: string,
  ): Promise<DuckDbManagedObjectSummary[]> {
    return BackendAPI.duckdbListManagedObjects(connId);
  },

  async getObjectLineage(
    connId: string,
    targetSchema: string,
    targetName: string,
  ): Promise<DuckDbManagedObjectLineage | null> {
    return BackendAPI.duckdbGetObjectLineage(connId, targetSchema, targetName);
  },

  async refreshManagedObject(
    connId: string,
    lineage: DuckDbManagedObjectLineage,
    loaders: DuckDbRefreshLoaders,
  ): Promise<DuckDbManagedObjectSummary> {
    if (lineage.sourceKind === "file") {
      const sourceSpec = expectRecord(lineage.sourceSpec, "DuckDB file source spec");
      const filePath = sourceSpec.filePath;
      if (typeof filePath !== "string" || !filePath) {
        throw new Error("DuckDB file source spec is missing filePath");
      }

      return BackendAPI.duckdbAddFile(connId, {
        filePath,
        targetSchema: lineage.targetSchema,
        targetName: lineage.targetName,
        sourceId: lineage.sourceId,
      });
    }

    if (lineage.sourceKind.startsWith("sql")) {
      if (!loaders.loadSqlSnapshot) {
        throw new Error("No SQL scratchpad refresh loader was provided");
      }
      const snapshot = await loaders.loadSqlSnapshot(lineage);
      return BackendAPI.duckdbReplaceManagedObject(
        connId,
        DuckDbScratchpadService.buildSqlSnapshotRequest({
          targetSchema: lineage.targetSchema,
          targetName: lineage.targetName,
          sourceId: lineage.sourceId,
          sourceKind: lineage.sourceKind,
          sourceConnectionId: lineage.sourceConnectionId ?? null,
          sourceSpec: lineage.sourceSpec,
          columns: snapshot.columns,
          rows: snapshot.rows,
          objectKind: lineage.objectKind,
        }),
      );
    }

    if (lineage.sourceKind === "mongo_collection") {
      if (!loaders.loadMongoSnapshot) {
        throw new Error("No MongoDB scratchpad refresh loader was provided");
      }
      const sourceSpec = expectRecord(
        lineage.sourceSpec,
        "MongoDB scratchpad source spec",
      );
      const collection = sourceSpec.collection;
      if (typeof collection !== "string" || !collection) {
        throw new Error("MongoDB scratchpad source spec is missing collection");
      }
      const documents = await loaders.loadMongoSnapshot(lineage);
      return BackendAPI.duckdbReplaceManagedObject(
        connId,
        DuckDbScratchpadService.buildMongoSnapshotRequest({
          targetSchema: lineage.targetSchema,
          targetName: lineage.targetName,
          sourceId: lineage.sourceId,
          sourceConnectionId: lineage.sourceConnectionId ?? null,
          sourceSpec,
          collection,
          documents,
        }),
      );
    }

    if (lineage.sourceKind === "redis_keys") {
      if (!loaders.loadRedisSnapshot) {
        throw new Error("No Redis scratchpad refresh loader was provided");
      }
      const entries = await loaders.loadRedisSnapshot(lineage);
      return BackendAPI.duckdbReplaceManagedObject(
        connId,
        DuckDbScratchpadService.buildRedisSnapshotRequest({
          targetSchema: lineage.targetSchema,
          targetName: lineage.targetName,
          sourceId: lineage.sourceId,
          sourceConnectionId: lineage.sourceConnectionId ?? null,
          sourceSpec: lineage.sourceSpec,
          entries,
        }),
      );
    }

    throw new Error(`Unsupported DuckDB scratchpad source kind: ${lineage.sourceKind}`);
  },
} as const;

export type {
  DuckDbAddFileRequest,
  DuckDbColumnDefinition,
  DuckDbManagedObjectLineage,
  DuckDbManagedObjectSummary,
  DuckDbReplaceManagedObjectRequest,
};
