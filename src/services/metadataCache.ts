import { invoke } from "@tauri-apps/api/core";
import type { EnhancedColumnMeta } from "@/types/database";

interface CacheEntry {
  data: EnhancedColumnMeta[];
  timestamp: number;
}

class MetadataCache {
  private cache = new Map<string, CacheEntry>();
  private ttl = 10 * 60 * 1000; // 10 minutes
  
  /**
   * Get columns with caching
   */
  async getColumns(
    connectionId: string,
    schema: string,
    table: string
  ): Promise<EnhancedColumnMeta[]> {
    const key = `${connectionId}:${schema}.${table}`;
    const cached = this.cache.get(key);
    
    // Check cache validity
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      console.log(`[MetadataCache] Cache hit for ${key}`);
      return cached.data;
    }
    
    console.log(`[MetadataCache] Cache miss for ${key}, fetching from backend`);
    
    try {
      // Fetch from backend
      const columns = await invoke<EnhancedColumnMeta[]>('db_get_enhanced_columns', {
        connectionId,
        schema,
        table,
      });
      
      // Cache the result
      this.cache.set(key, {
        data: columns,
        timestamp: Date.now(),
      });
      
      return columns;
    } catch (error) {
      console.error('[MetadataCache] Failed to fetch columns:', error);
      
      // If we have stale cache, return it
      if (cached) {
        console.log('[MetadataCache] Returning stale cache due to error');
        return cached.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Invalidate cache entries
   */
  invalidate(connectionId: string, schema?: string, table?: string) {
    if (!schema) {
      // Clear all for connection
      let count = 0;
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          this.cache.delete(key);
          count++;
        }
      }
      console.log(`[MetadataCache] Invalidated ${count} entries for connection ${connectionId}`);
    } else if (!table) {
      // Clear all for schema
      let count = 0;
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${connectionId}:${schema}.`)) {
          this.cache.delete(key);
          count++;
        }
      }
      console.log(`[MetadataCache] Invalidated ${count} entries for schema ${schema}`);
    } else {
      // Clear specific table
      const key = `${connectionId}:${schema}.${table}`;
      if (this.cache.delete(key)) {
        console.log(`[MetadataCache] Invalidated entry for ${key}`);
      }
    }
  }
  
  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[MetadataCache] Cleared ${size} cache entries`);
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    const entries = Array.from(this.cache.entries());
    const now = Date.now();
    
    const validEntries = entries.filter(([_, entry]) => 
      now - entry.timestamp < this.ttl
    );
    
    const staleEntries = entries.filter(([_, entry]) => 
      now - entry.timestamp >= this.ttl
    );
    
    return {
      totalEntries: entries.length,
      validEntries: validEntries.length,
      staleEntries: staleEntries.length,
      cacheSize: JSON.stringify(Array.from(this.cache.values())).length,
    };
  }
  
  /**
   * Prefetch columns for multiple tables
   */
  async prefetchTables(
    connectionId: string,
    tables: Array<{ schema: string; table: string }>
  ): Promise<void> {
    const promises = tables.map(({ schema, table }) =>
      this.getColumns(connectionId, schema, table).catch(err => {
        console.error(`[MetadataCache] Failed to prefetch ${schema}.${table}:`, err);
        return null;
      })
    );
    
    await Promise.all(promises);
    console.log(`[MetadataCache] Prefetched metadata for ${tables.length} tables`);
  }
  
  /**
   * Clean up stale entries
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[MetadataCache] Cleaned up ${removed} stale entries`);
    }
  }
  
  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup(intervalMs = 5 * 60 * 1000) {
    setInterval(() => { this.cleanup(); }, intervalMs);
    console.log(`[MetadataCache] Started periodic cleanup every ${intervalMs}ms`);
  }
}

// Export singleton instance
export const metadataCache = new MetadataCache();

// Start cleanup on initialization
if (typeof window !== 'undefined') {
  metadataCache.startPeriodicCleanup();
}