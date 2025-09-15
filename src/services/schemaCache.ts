import {
  databaseService,
  type TableMeta,
  type ColumnMeta,
} from "@/services/databaseService";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
  accessCount: number;
  lastAccessed: number;
}

export interface SchemaItem {
  name: string;
}

interface CacheContext {
  connectionId: string;
  database?: string;
  schema?: string;
}

class SchemaCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private context?: CacheContext;

  private readonly ttlConfig = {
    default: 5 * 60 * 1000,
    databases: 10 * 60 * 1000,
    schemas: 10 * 60 * 1000,
    tables: 5 * 60 * 1000,
    columns: 5 * 60 * 1000,
    functions: 10 * 60 * 1000,
  };

  private maxCacheSize = 1000;

  setContext(ctx: CacheContext) {
    this.context = ctx;
  }

  async getSchemas(connectionId: string): Promise<SchemaItem[]> {
    const key = `schemas:${connectionId}`;
    const cached = this.get<SchemaItem[]>(key, this.ttlConfig.schemas);
    if (cached) return cached;

    const raw = await databaseService.listSchemas(
      connectionId,
      this.context?.database || "",
    );
    const schemas = raw.map((name) => ({ name }));
    this.set(key, schemas, this.ttlConfig.schemas);
    return schemas;
  }

  async getTables(connectionId: string, schema?: string): Promise<TableMeta[]> {
    const s = schema || this.context?.schema || "public";
    const key = `tables:${connectionId}:${s}`;
    const cached = this.get<TableMeta[]>(key, this.ttlConfig.tables);
    if (cached) return cached;

    const tables = await databaseService.listTables(
      connectionId,
      this.context?.database || "",
      s,
    );
    this.set(key, tables, this.ttlConfig.tables);
    return tables;
  }

  async getTableColumns(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<ColumnMeta[]> {
    const key = `columns:${connectionId}:${schema}.${table}`;
    const cached = this.get<ColumnMeta[]>(key, this.ttlConfig.columns);
    if (cached) return cached;

    const columns = await databaseService.getTableColumns(
      connectionId,
      this.context?.database || "",
      schema,
      table,
    );
    this.set(key, columns, this.ttlConfig.columns);
    return columns;
  }

  hasTableColumns(
    connectionId: string,
    schema: string,
    table: string,
  ): boolean {
    return this.cache.has(`columns:${connectionId}:${schema}.${table}`);
  }

  prefetchSchema(schema?: string): void {
    const ctx = this.context;
    if (!ctx) return;
    const s = schema || ctx.schema;
    if (!s) return;
    this.getTables(ctx.connectionId, s).catch(() => void 0);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  // Testing helpers
  setForTest(key: string, data: any, ttl?: number) {
    this.set(key, data, ttl);
  }
  getForTest<T>(key: string): T | undefined {
    return this.get<T>(key, this.ttlConfig.default);
  }

  private get<T>(key: string, ttl: number): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const expired = Date.now() - entry.timestamp > (entry.ttl ?? ttl);
    if (expired) {
      this.cache.delete(key);
      return undefined;
    }
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    return entry.data as T;
  }

  private set<T>(key: string, data: T, ttl?: number): void {
    if (this.cache.size >= this.maxCacheSize) this.evictLRU();
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? this.ttlConfig.default,
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }
    if (lruKey) this.cache.delete(lruKey);
  }
}

export const schemaCache = new SchemaCache();

export type { TableMeta, ColumnMeta };
