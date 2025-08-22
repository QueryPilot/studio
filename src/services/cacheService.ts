import { LRUCache } from 'lru-cache';
import Dexie, { type Table } from 'dexie';

interface SchemaCache {
  tables: any[];
  views: any[];
  functions: any[];
  timestamp: number;
}

interface TableDataCache {
  columns: string[];
  rows: any[][];
  totalCount: number;
  timestamp: number;
}

interface QueryResultCache {
  columns: string[];
  rows: any[][];
  executionTime: number;
  timestamp: number;
}

interface WorkspaceStateCache {
  id: string;
  tabs: any[];
  activeTabId: string;
  scrollPositions: Record<string, number>;
  selections: Record<string, any>;
}

interface ColumnOrderCache {
  key: string; // connectionId:schema:table
  columnOrder: string[];
  timestamp: number;
}

class CacheDatabase extends Dexie {
  schemaCache!: Table<{ connectionId: string; data: SchemaCache }>;
  tableDataCache!: Table<{ key: string; data: TableDataCache }>;
  workspaceState!: Table<WorkspaceStateCache>;
  columnOrder!: Table<ColumnOrderCache>;

  constructor() {
    super('DevDBStudioCache');
    this.version(2).stores({
      schemaCache: 'connectionId',
      tableDataCache: 'key',
      workspaceState: 'id',
      columnOrder: 'key'
    });
  }
}

export class CacheService {
  private static instance: CacheService;
  
  // Memory caches
  private schemaCache = new Map<string, SchemaCache>();
  private tableDataCache: LRUCache<string, TableDataCache>;
  private queryCache: LRUCache<string, QueryResultCache>;
  
  // IndexedDB
  private db: CacheDatabase;
  
  // Configuration
  private readonly SCHEMA_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly TABLE_DATA_TTL = 2 * 60 * 1000; // 2 minutes
  private readonly QUERY_TTL = 60 * 1000; // 1 minute
  
  // Performance metrics
  private metrics = {
    schemaHits: 0,
    schemaMisses: 0,
    tableHits: 0,
    tableMisses: 0,
    queryHits: 0,
    queryMisses: 0,
    totalEvictions: 0
  };

  private constructor() {
    // Initialize LRU caches
    this.tableDataCache = new LRUCache<string, TableDataCache>({
      max: 500,
      ttl: this.TABLE_DATA_TTL,
      dispose: () => {
        this.metrics.totalEvictions++;
      }
    });
    
    this.queryCache = new LRUCache<string, QueryResultCache>({
      max: 100,
      ttl: this.QUERY_TTL,
      sizeCalculation: (value) => {
        // Estimate size based on rows
        return value.rows.length;
      },
      maxSize: 10000, // Max 10000 rows total across all cached queries
    });
    
    // Initialize IndexedDB
    this.db = new CacheDatabase();
    
    // Start memory monitoring
    this.startMemoryMonitoring();
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  // Schema caching
  async getSchema(connectionId: string): Promise<SchemaCache | null> {
    // Check memory cache
    const cached = this.schemaCache.get(connectionId);
    if (cached && Date.now() - cached.timestamp < this.SCHEMA_TTL) {
      this.metrics.schemaHits++;
      return cached;
    }
    
    // Check IndexedDB
    try {
      const persisted = await this.db.schemaCache.get(connectionId);
      if (persisted && Date.now() - persisted.data.timestamp < this.SCHEMA_TTL) {
        this.schemaCache.set(connectionId, persisted.data);
        this.metrics.schemaHits++;
        return persisted.data;
      }
    } catch (error) {
      console.error('Error reading schema from IndexedDB:', error);
    }
    
    this.metrics.schemaMisses++;
    return null;
  }

  async setSchema(connectionId: string, tables: any[], views: any[], functions: any[]): Promise<void> {
    const data: SchemaCache = {
      tables,
      views,
      functions,
      timestamp: Date.now()
    };
    
    // Update memory cache
    this.schemaCache.set(connectionId, data);
    
    // Persist to IndexedDB
    try {
      await this.db.schemaCache.put({ connectionId, data });
    } catch (error) {
      console.error('Error persisting schema to IndexedDB:', error);
    }
  }

  // Table data caching
  getTableData(connectionId: string, schema: string, table: string, offset: number, limit: number): TableDataCache | null {
    const key = this.getTableDataKey(connectionId, schema, table, offset, limit);
    const cached = this.tableDataCache.get(key);
    
    if (cached) {
      this.metrics.tableHits++;
      return cached;
    }
    
    this.metrics.tableMisses++;
    return null;
  }

  async setTableData(
    connectionId: string,
    schema: string,
    table: string,
    offset: number,
    limit: number,
    data: TableDataCache
  ): Promise<void> {
    const key = this.getTableDataKey(connectionId, schema, table, offset, limit);
    data.timestamp = Date.now();
    
    // Update memory cache
    this.tableDataCache.set(key, data);
    
    // Persist to IndexedDB (only first page for quick restoration)
    if (offset === 0) {
      try {
        await this.db.tableDataCache.put({ key, data });
      } catch (error) {
        console.error('Error persisting table data to IndexedDB:', error);
      }
    }
  }

  // Query result caching
  getQueryResult(connectionId: string, query: string): QueryResultCache | null {
    const key = this.getQueryKey(connectionId, query);
    const cached = this.queryCache.get(key);
    
    if (cached) {
      this.metrics.queryHits++;
      return cached;
    }
    
    this.metrics.queryMisses++;
    return null;
  }

  setQueryResult(connectionId: string, query: string, result: QueryResultCache): void {
    const key = this.getQueryKey(connectionId, query);
    result.timestamp = Date.now();
    this.queryCache.set(key, result);
  }

  // Workspace state management
  async getWorkspaceState(workspaceId: string): Promise<WorkspaceStateCache | null> {
    try {
      const state = await this.db.workspaceState.get(workspaceId);
      return state || null;
    } catch (error) {
      console.error('Error reading workspace state:', error);
      return null;
    }
  }

  async setWorkspaceState(state: WorkspaceStateCache): Promise<void> {
    try {
      await this.db.workspaceState.put(state);
    } catch (error) {
      console.error('Error persisting workspace state:', error);
    }
  }

  // Column order management (no TTL - persistent)
  async getColumnOrder(connectionId: string, schema: string, table: string): Promise<string[] | null> {
    const key = this.getTableKey(connectionId, schema, table);
    try {
      const cached = await this.db.columnOrder.get(key);
      return cached ? cached.columnOrder : null;
    } catch (error) {
      console.error('Error reading column order:', error);
      return null;
    }
  }

  async setColumnOrder(connectionId: string, schema: string, table: string, columnOrder: string[]): Promise<void> {
    const key = this.getTableKey(connectionId, schema, table);
    try {
      await this.db.columnOrder.put({
        key,
        columnOrder,
        timestamp: Date.now()
      });
      console.log(`[CacheService] Saved column order for ${key}`);
    } catch (error) {
      console.error('Error persisting column order:', error);
    }
  }

  // Cache invalidation
  invalidateConnection(connectionId: string): void {
    // Clear schema cache
    this.schemaCache.delete(connectionId);
    
    // Clear table data for this connection
    const keysToDelete: string[] = [];
    this.tableDataCache.forEach((_value, key) => {
      if (key.startsWith(connectionId)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.tableDataCache.delete(key));
    
    // Clear queries for this connection
    this.queryCache.forEach((_value, key) => {
      if (key.startsWith(connectionId)) {
        this.queryCache.delete(key);
      }
    });
  }

  invalidateTable(connectionId: string, schema: string, table: string): void {
    const prefix = `${connectionId}:${schema}:${table}`;
    const keysToDelete: string[] = [];
    
    this.tableDataCache.forEach((_value, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.tableDataCache.delete(key));
  }

  // Clear all caches
  async clearAll(): Promise<void> {
    this.schemaCache.clear();
    this.tableDataCache.clear();
    this.queryCache.clear();
    
    try {
      await this.db.schemaCache.clear();
      await this.db.tableDataCache.clear();
      await this.db.workspaceState.clear();
      await this.db.columnOrder.clear();
    } catch (error) {
      console.error('Error clearing IndexedDB:', error);
    }
  }

  // Performance monitoring
  getMetrics() {
    const totalSchemaRequests = this.metrics.schemaHits + this.metrics.schemaMisses;
    const totalTableRequests = this.metrics.tableHits + this.metrics.tableMisses;
    const totalQueryRequests = this.metrics.queryHits + this.metrics.queryMisses;
    
    return {
      ...this.metrics,
      schemaHitRate: totalSchemaRequests > 0 ? this.metrics.schemaHits / totalSchemaRequests : 0,
      tableHitRate: totalTableRequests > 0 ? this.metrics.tableHits / totalTableRequests : 0,
      queryHitRate: totalQueryRequests > 0 ? this.metrics.queryHits / totalQueryRequests : 0,
      tableCacheSize: this.tableDataCache.size,
      queryCacheSize: this.queryCache.size,
    };
  }

  // Helper methods
  private getTableDataKey(connectionId: string, schema: string, table: string, offset: number, limit: number): string {
    return `${connectionId}:${schema}:${table}:${offset}:${limit}`;
  }

  private getTableKey(connectionId: string, schema: string, table: string): string {
    return `${connectionId}:${schema}:${table}`;
  }

  private getQueryKey(connectionId: string, query: string): string {
    // Simple hash for query
    const queryHash = this.hashString(query.toLowerCase().replace(/\s+/g, ' ').trim());
    return `${connectionId}:${queryHash}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  private startMemoryMonitoring(): void {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      setInterval(() => {
        const memory = (performance as any).memory;
        const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        
        if (usageRatio > 0.9) {
          console.warn('High memory usage detected, reducing cache size');
          this.reduceCacheSize();
        }
      }, 30000); // Check every 30 seconds
    }
  }

  private reduceCacheSize(): void {
    // Clear half of the LRU caches
    const tableDataSize = this.tableDataCache.size;
    const querySize = this.queryCache.size;
    
    if (tableDataSize > 100) {
      // Remove oldest entries
      const entriesToRemove = Math.floor(tableDataSize / 2);
      const keys = Array.from(this.tableDataCache.keys()).slice(0, entriesToRemove);
      keys.forEach(key => this.tableDataCache.delete(key));
    }
    
    if (querySize > 20) {
      const entriesToRemove = Math.floor(querySize / 2);
      const keys = Array.from(this.queryCache.keys()).slice(0, entriesToRemove);
      keys.forEach(key => this.queryCache.delete(key));
    }
  }
}

// Export singleton instance getter
export const cacheService = CacheService.getInstance();