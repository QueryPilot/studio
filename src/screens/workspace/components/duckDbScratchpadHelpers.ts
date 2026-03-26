export type DuckDbSnapshotSource =
  | {
      kind: "sql";
      sourceConnectionId: string;
      sourceConnectionName: string;
      sourceDatabase: string;
      schema: string;
      name: string;
      objectType: "table" | "view" | "materialized_view";
    }
  | {
      kind: "mongo";
      sourceConnectionId: string;
      sourceConnectionName: string;
      sourceDatabase: string;
      collection: string;
    }
  | {
      kind: "redis";
      sourceConnectionId: string;
      sourceConnectionName: string;
      dbIndex: number;
    };

export interface RedisSnapshotAdapter {
  hashGetAll(key: string): Promise<unknown>;
  listRange(key: string, start: number, stop: number): Promise<unknown>;
  setMembers(key: string): Promise<unknown>;
  zsetRange(
    key: string,
    start: number,
    stop: number,
    withScores?: boolean,
  ): Promise<unknown>;
  streamRange(
    key: string,
    start: string,
    end: string,
    count?: number,
  ): Promise<unknown>;
  getKey(key: string): Promise<unknown>;
}

const DEFAULT_DUCKDB_TABLE_NAME = "scratchpad_data";

export function sanitizeDuckDbObjectName(
  value: string,
  fallback = DEFAULT_DUCKDB_TABLE_NAME,
): string {
  const base = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

  if (!base) return fallback;
  if (/^[0-9]/.test(base)) {
    return `_${base}`;
  }
  return base;
}

function getBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function defaultDuckDbTargetNameFromFile(filePath: string): string {
  return sanitizeDuckDbObjectName(getBaseName(filePath).replace(/\.[^.]+$/, ""));
}

export function defaultDuckDbTargetNameFromSnapshotSource(
  source: DuckDbSnapshotSource,
): string {
  switch (source.kind) {
    case "sql":
      return sanitizeDuckDbObjectName(source.name);
    case "mongo":
      return sanitizeDuckDbObjectName(source.collection);
    case "redis":
      return sanitizeDuckDbObjectName(`db${source.dbIndex}`);
  }
}

export function describeDuckDbSnapshotSource(
  source: DuckDbSnapshotSource,
): string {
  switch (source.kind) {
    case "sql":
      return `${source.schema}.${source.name}`;
    case "mongo":
      return `${source.sourceDatabase}.${source.collection}`;
    case "redis":
      return `db${source.dbIndex}`;
  }
}

export async function fetchRedisSnapshotRawValue(
  adapter: RedisSnapshotAdapter,
  key: string,
  keyType: string,
): Promise<unknown> {
  switch (keyType) {
    case "hash":
      return adapter.hashGetAll(key);
    case "list":
      return adapter.listRange(key, 0, -1);
    case "set":
      return adapter.setMembers(key);
    case "zset":
      return adapter.zsetRange(key, 0, -1, true);
    case "stream":
      return adapter.streamRange(key, "-", "+");
    case "string":
    case "unknown":
    default:
      return adapter.getKey(key);
  }
}
