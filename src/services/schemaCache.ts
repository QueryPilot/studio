import {
  databaseService,
  type TableMeta,
  type ColumnMeta,
} from "@/services/databaseService";
import { relationshipService } from "@/services/relationshipService";
import type { TableRelationshipGraph } from "@/types/relationships";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  connectionId: string;
  priority: "low" | "medium" | "high";
}

export interface SchemaItem {
  name: string;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  prefetches: number;
}

interface PrefetchQueue {
  items: Array<{
    key: string;
    fetcher: () => Promise<any>;
    priority: number;
  }>;
  processing: boolean;
}

class SchemaCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private inFlight: Map<string, Promise<any>> = new Map();
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    prefetches: 0,
  };
  private prefetchQueue: PrefetchQueue = {
    items: [],
    processing: false,
  };
  private accessPatterns: Map<string, string[]> = new Map();
  private currentConnectionId: string | null = null;

  private readonly ttlConfig = {
    databases: 30 * 60 * 1000, // 30 min - rarely changes
    schemas: 20 * 60 * 1000, // 20 min - rarely changes
    tables: 10 * 60 * 1000, // 10 min - can change
    columns: 10 * 60 * 1000, // 10 min - can change
    functions: 30 * 60 * 1000, // 30 min - rarely changes
    relationships: 15 * 60 * 1000, // 15 min - FK constraints rarely change
    recent: 2 * 60 * 1000, // 2 min - for frequently accessed items
  };

  private readonly maxCacheSize = 2000;
  private readonly maxAccessPatternSize = 100;

  // Connection change handling
  setConnection(connectionId: string) {
    if (this.currentConnectionId !== connectionId) {
      this.invalidateConnection(this.currentConnectionId);
      this.currentConnectionId = connectionId;
      this.prefetchCommonData(connectionId);
    }
  }

  // Main cache operations with improved logic
  async getSchemas(connectionId: string): Promise<SchemaItem[]> {
    const key = `schemas:${connectionId}`;
    const cached = this.get<SchemaItem[]>(key);

    if (cached) {
      this.recordAccess(key);
      return cached;
    }

    this.metrics.misses++;
    const raw = await databaseService.listSchemas(connectionId, "");
    const schemas = raw.map((name) => ({ name }));

    this.set(key, schemas, {
      ttl: this.ttlConfig.schemas,
      priority: "high",
      connectionId,
    });

    // Prefetch tables for common schemas
    this.prefetchTablesForSchemas(connectionId, schemas.slice(0, 3));

    return schemas;
  }

  async getTables(connectionId: string, schema?: string): Promise<TableMeta[]> {
    const s = schema || "public";
    const key = `tables:${connectionId}:${s}`;
    const cached = this.get<TableMeta[]>(key);

    if (cached) {
      this.recordAccess(key);
      this.prefetchRelatedTables(connectionId, s);
      return cached;
    }

    // Coalesce concurrent fetches
    const existing = this.inFlight.get(key) as Promise<TableMeta[]> | undefined;
    if (existing) {
      return existing;
    }

    this.metrics.misses++;
    const promise = databaseService
      .listTables(connectionId, "", s)
      .then((tables) => {
        this.set(key, tables, {
          ttl: this.ttlConfig.tables,
          priority: "high",
          connectionId,
        });

        // Prefetch columns for frequently used tables
        this.prefetchColumnsForTables(connectionId, s, tables.slice(0, 5));

        return tables;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  async getTableColumns(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<ColumnMeta[]> {
    const key = `columns:${connectionId}:${schema}.${table}`;
    const cached = this.get<ColumnMeta[]>(key);

    if (cached) {
      this.recordAccess(key);
      this.prefetchRelatedColumns(connectionId, schema, table);
      return cached;
    }

    // Coalesce concurrent fetches
    const existing = this.inFlight.get(key) as
      | Promise<ColumnMeta[]>
      | undefined;
    if (existing) {
      return existing;
    }

    this.metrics.misses++;
    const promise = databaseService
      .getTableColumns(connectionId, "", schema, table)
      .then((columns) => {
        // Adaptive TTL based on table size
        const ttl =
          columns.length > 50
            ? this.ttlConfig.columns * 0.5 // Shorter TTL for large tables
            : this.ttlConfig.columns;

        this.set(key, columns, {
          ttl,
          priority: columns.length > 100 ? "low" : "medium",
          connectionId,
        });

        return columns;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Get enum (or set) values for a specific column, cached and deduped.
   */
  /**
   * Get relationship graph for a schema (foreign key relationships)
   */
  async getRelationshipGraph(
    connectionId: string,
    schema: string,
  ): Promise<TableRelationshipGraph> {
    const key = `relationships:${connectionId}:${schema}`;
    const cached = this.get<TableRelationshipGraph>(key);

    if (cached) {
      this.recordAccess(key);
      return cached;
    }

    // Coalesce concurrent fetches
    const existing = this.inFlight.get(key) as
      | Promise<TableRelationshipGraph>
      | undefined;
    if (existing) {
      return existing;
    }

    this.metrics.misses++;
    const promise = (async () => {
      // Get all tables in schema first
      const tables = await this.getTables(connectionId, schema);

      // Build relationship graph
      const graph = await relationshipService.buildRelationshipGraph(
        connectionId,
        schema,
        tables,
      );

      this.set(key, graph, {
        ttl: this.ttlConfig.relationships,
        priority: "medium",
        connectionId,
      });

      return graph;
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  async getColumnEnumValues(
    connectionId: string,
    schema: string,
    table: string,
    column: string,
  ): Promise<string[]> {
    const key = `enumvals:${connectionId}:${schema}.${table}.${column}`;
    const cached = this.get<string[]>(key);
    if (cached) return cached;

    const existing = this.inFlight.get(key) as Promise<string[]> | undefined;
    if (existing) return existing;

    const fetchPromise = (async () => {
      console.debug(
        `[SchemaCache] Enum fetch start ${schema}.${table}.${column} (conn=${connectionId})`,
      );
      // Try fast path from columns cache first
      try {
        const cols = await this.getTableColumns(connectionId, schema, table);
        const meta = cols.find(
          (c) => c.name.toLowerCase() === column.toLowerCase(),
        );
        const values =
          (meta as any)?.enum_values || (meta as any)?.set_values || [];
        console.debug(`[SchemaCache] Column meta enum fast-path`, {
          foundMeta: !!meta,
          count: Array.isArray(values) ? values.length : 0,
        });
        if (Array.isArray(values) && values.length > 0) {
          this.set(key, values, {
            ttl: this.ttlConfig.recent,
            priority: "medium",
            connectionId,
          });
          console.debug(`[SchemaCache] Enum cached (fast)`, values);
          return values;
        }
      } catch {
        // fallthrough
      }

      // Fallback to full structure for richer metadata
      try {
        const structure = await databaseService.getTableStructure(
          connectionId,
          "",
          schema,
          table,
          {
            includeConstraints: true,
            includeIndexes: false,
            includeTriggers: false,
            includeStatistics: false,
            includeForeignKeys: false,
          },
        );
        const meta = structure.columns.find(
          (c) => c.name.toLowerCase() === column.toLowerCase(),
        ) as any;
        let values: string[] = meta?.enum_values || meta?.set_values || [];
        console.debug(`[SchemaCache] Structure-based enum`, {
          hasMeta: !!meta,
          fromMetaCount: values?.length || 0,
        });
        if (!values || values.length === 0) {
          // Try parse CHECK constraints like: CHECK (priority IN ('low','high'))
          for (const cons of structure.constraints) {
            const def = (cons as any)?.definition as string | undefined;
            if (!def) continue;
            const colRegex = new RegExp(`\\b${column}\\b`, "i");
            if (!colRegex.test(def)) continue;
            const m = def.match(/\bIN\s*\(([^)]+)\)/i);
            if (m && m[1]) {
              const parts = m[1]
                .split(",")
                .map((s) => s.trim().replace(/^['\"]|['\"]$/g, ""))
                .filter(Boolean);
              if (parts.length > 0) {
                values = parts;
                console.debug(`[SchemaCache] Enum parsed from CHECK`, values);
                break;
              }
            }
          }
        }
        if (Array.isArray(values)) {
          this.set(key, values, {
            ttl: this.ttlConfig.recent,
            priority: "medium",
            connectionId,
          });
          console.debug(`[SchemaCache] Enum cached (structure)`, values);
          return values;
        }
      } catch {
        // ignore
      }

      // Default empty array to avoid spamming backend
      this.set(key, [], {
        ttl: this.ttlConfig.recent,
        priority: "low",
        connectionId,
      });
      console.debug(`[SchemaCache] Enum not found -> caching empty`);
      return [];
    })();

    this.inFlight.set(key, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  // Improved prefetching strategies
  private async prefetchCommonData(connectionId: string) {
    this.metrics.prefetches++;

    // Common schemas to prefetch
    const commonSchemas = ["public", "dbo", "main"];

    for (const schema of commonSchemas) {
      this.enqueuePrefetch(
        `tables:${connectionId}:${schema}`,
        () => databaseService.listTables(connectionId, "", schema),
        10,
      );
    }

    this.processPrefetchQueue();
  }

  private prefetchTablesForSchemas(
    connectionId: string,
    schemas: SchemaItem[],
  ) {
    for (const schema of schemas) {
      this.enqueuePrefetch(
        `tables:${connectionId}:${schema.name}`,
        () => databaseService.listTables(connectionId, "", schema.name),
        5,
      );
    }
    this.processPrefetchQueue();
  }

  private prefetchColumnsForTables(
    connectionId: string,
    schema: string,
    tables: TableMeta[],
  ) {
    // Prioritize tables alphabetically for consistent ordering
    const sortedTables = [...tables].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const table of sortedTables.slice(0, 3)) {
      this.enqueuePrefetch(
        `columns:${connectionId}:${schema}.${table.name}`,
        () =>
          databaseService.getTableColumns(connectionId, "", schema, table.name),
        3,
      );
    }
    this.processPrefetchQueue();
  }

  private prefetchRelatedTables(connectionId: string, schema: string) {
    // Based on access patterns, prefetch related schemas
    const pattern = this.accessPatterns.get(`schemas:${connectionId}`);
    if (!pattern) return;

    const relatedSchemas = pattern
      .map((key) => key.split(":")[2])
      .filter((s, i, arr) => s && s !== schema && arr.indexOf(s) === i)
      .slice(0, 2);

    for (const relatedSchema of relatedSchemas) {
      this.enqueuePrefetch(
        `tables:${connectionId}:${relatedSchema}`,
        () => databaseService.listTables(connectionId, "", relatedSchema),
        2,
      );
    }
  }

  private prefetchRelatedColumns(
    connectionId: string,
    schema: string,
    table: string,
  ) {
    // Look for JOIN patterns - if this table is often joined with others
    const pattern = this.accessPatterns.get(`tables:${connectionId}:${schema}`);
    if (!pattern) return;

    // Find other tables accessed in the same pattern
    const relatedTables = pattern
      .filter((key) => key.startsWith(`columns:${connectionId}:${schema}.`))
      .map((key) => key.split(".")[1])
      .filter((t, i, arr) => t && t !== table && arr.indexOf(t) === i)
      .slice(0, 2);

    for (const relatedTable of relatedTables) {
      this.enqueuePrefetch(
        `columns:${connectionId}:${schema}.${relatedTable}`,
        () =>
          databaseService.getTableColumns(
            connectionId,
            "",
            schema,
            relatedTable,
          ),
        1,
      );
    }
  }

  // Prefetch queue management
  private enqueuePrefetch(
    key: string,
    fetcher: () => Promise<any>,
    priority: number,
  ) {
    // Don't prefetch if already cached
    if (this.cache.has(key)) return;

    // Check if already in queue
    const existing = this.prefetchQueue.items.find((item) => item.key === key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      return;
    }

    this.prefetchQueue.items.push({ key, fetcher, priority });
    this.prefetchQueue.items.sort((a, b) => b.priority - a.priority);
  }

  private async processPrefetchQueue() {
    if (
      this.prefetchQueue.processing ||
      this.prefetchQueue.items.length === 0
    ) {
      return;
    }

    this.prefetchQueue.processing = true;

    while (this.prefetchQueue.items.length > 0) {
      const item = this.prefetchQueue.items.shift()!;

      // Skip if already cached
      if (this.cache.has(item.key)) continue;

      try {
        const data = await item.fetcher();
        const [type, connId, ...rest] = item.key.split(":");

        this.set(item.key, data, {
          ttl:
            this.ttlConfig[type as keyof typeof this.ttlConfig] ||
            this.ttlConfig.tables,
          priority: "low",
          connectionId: connId,
        });
      } catch (error) {
        // Silent fail for prefetch
        console.debug(`Prefetch failed for ${item.key}:`, error);
      }

      // Small delay to avoid overwhelming the backend
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.prefetchQueue.processing = false;
  }

  // Access pattern tracking
  private recordAccess(key: string) {
    const [type, connectionId] = key.split(":");
    const patternKey = `${type}:${connectionId}`;

    let pattern = this.accessPatterns.get(patternKey) || [];
    pattern.unshift(key);

    // Keep only recent patterns
    if (pattern.length > this.maxAccessPatternSize) {
      pattern = pattern.slice(0, this.maxAccessPatternSize);
    }

    this.accessPatterns.set(patternKey, pattern);
  }

  // Cache management
  private get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    const expired = now - entry.timestamp > entry.ttl;

    if (expired) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access info
    entry.lastAccessed = now;
    entry.accessCount++;

    // Promote frequently accessed items
    if (entry.accessCount > 10 && entry.priority === "low") {
      entry.priority = "medium";
      entry.ttl = Math.min(entry.ttl * 1.5, this.ttlConfig.tables);
    } else if (entry.accessCount > 50 && entry.priority === "medium") {
      entry.priority = "high";
      entry.ttl = Math.min(entry.ttl * 2, this.ttlConfig.schemas);
    }

    this.metrics.hits++;
    return entry.data as T;
  }

  private set<T>(
    key: string,
    data: T,
    options: {
      ttl: number;
      priority: "low" | "medium" | "high";
      connectionId: string;
    },
  ): void {
    // Evict if needed
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: options.ttl,
      accessCount: 0,
      lastAccessed: Date.now(),
      connectionId: options.connectionId,
      priority: options.priority,
    });
  }

  private evictLRU(): void {
    let victim: { key: string; score: number } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      // Calculate eviction score (lower = more likely to evict)
      let score = entry.lastAccessed / 1000; // Time factor

      // Priority boost
      if (entry.priority === "high") score += 1000000;
      else if (entry.priority === "medium") score += 100000;

      // Access frequency boost
      score += entry.accessCount * 10000;

      // TTL factor (longer TTL = more valuable)
      score += entry.ttl / 1000;

      if (!victim || score < victim.score) {
        victim = { key, score };
      }
    }

    if (victim) {
      this.cache.delete(victim.key);
      this.metrics.evictions++;
    }
  }

  // Invalidation strategies
  invalidateConnection(connectionId: string | null) {
    if (!connectionId) return;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.connectionId === connectionId) {
        this.cache.delete(key);
      }
    }

    // Clear access patterns for this connection
    for (const key of this.accessPatterns.keys()) {
      if (key.includes(connectionId)) {
        this.accessPatterns.delete(key);
      }
    }
  }

  invalidateTable(connectionId: string, schema: string, table: string) {
    const patterns = [
      `columns:${connectionId}:${schema}.${table}`,
      `indexes:${connectionId}:${schema}.${table}`,
      `constraints:${connectionId}:${schema}.${table}`,
    ];

    for (const pattern of patterns) {
      this.cache.delete(pattern);
    }

    // Also invalidate the tables list since counts may have changed
    this.cache.delete(`tables:${connectionId}:${schema}`);
  }

  invalidateSchema(connectionId: string, schema: string) {
    for (const key of this.cache.keys()) {
      if (
        key.startsWith(`tables:${connectionId}:${schema}`) ||
        key.startsWith(`columns:${connectionId}:${schema}.`)
      ) {
        this.cache.delete(key);
      }
    }
  }

  // Refresh stale data in background
  async refreshStale() {
    const now = Date.now();
    const staleThreshold = 0.8; // Refresh when 80% of TTL expired

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      const staleRatio = age / entry.ttl;

      if (staleRatio > staleThreshold && entry.priority !== "low") {
        // Re-fetch in background
        const [type, connectionId, ...rest] = key.split(":");

        if (type === "schemas") {
          this.getSchemas(connectionId).catch(() => {});
        } else if (type === "tables") {
          this.getTables(connectionId, rest[0]).catch(() => {});
        } else if (type === "columns") {
          const [schema, table] = rest[0].split(".");
          this.getTableColumns(connectionId, schema, table).catch(() => {});
        }
      }
    }
  }

  // Metrics and debugging
  getMetrics(): CacheMetrics & { size: number; hitRate: number } {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      size: this.cache.size,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
    };
  }

  getCacheInfo(): Array<{
    key: string;
    age: number;
    accessCount: number;
    priority: string;
  }> {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: Math.round((now - entry.timestamp) / 1000),
      accessCount: entry.accessCount,
      priority: entry.priority,
    }));
  }

  // Clear everything
  clear() {
    this.cache.clear();
    this.accessPatterns.clear();
    this.prefetchQueue.items = [];
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      prefetches: 0,
    };
  }
}

export const schemaCache = new SchemaCache();

// Auto-refresh stale data every 5 minutes
setInterval(() => {
  schemaCache.refreshStale().catch(console.error);
}, 5 * 60 * 1000);

export type { TableMeta, ColumnMeta };
