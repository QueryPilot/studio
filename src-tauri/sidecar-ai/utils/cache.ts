/**
 * Connection-aware cache for database metadata
 * Keys are prefixed with connectionId to handle concurrent users
 */

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

// Maximum cache entries per connection to prevent memory leaks
const MAX_ENTRIES_PER_CONNECTION = 100;

class MetadataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private connectionEntryCount = new Map<string, number>();

  /**
   * Build a cache key with connection context
   */
  private buildKey(connectionId: string, type: string, ...parts: string[]): string {
    return `${connectionId}:${type}:${parts.join(":")}`;
  }

  /**
   * Get a value from cache
   */
  get<T>(connectionId: string, type: string, ...parts: string[]): T | undefined {
    const key = this.buildKey(connectionId, type, ...parts);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) return undefined;

    // Check expiry
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.decrementCount(connectionId);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in cache with optional TTL
   */
  set<T>(
    connectionId: string,
    type: string,
    parts: string[],
    value: T,
    ttlMs: number = DEFAULT_TTL_MS
  ): void {
    const key = this.buildKey(connectionId, type, ...parts);

    // Check if we're adding a new entry
    const isNewEntry = !this.cache.has(key);

    // Enforce max entries per connection
    if (isNewEntry) {
      const currentCount = this.connectionEntryCount.get(connectionId) || 0;
      if (currentCount >= MAX_ENTRIES_PER_CONNECTION) {
        // Evict oldest entries for this connection
        this.evictOldestForConnection(connectionId);
      }
      this.connectionEntryCount.set(connectionId, currentCount + 1);
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(connectionId: string, type: string, ...parts: string[]): boolean {
    return this.get(connectionId, type, ...parts) !== undefined;
  }

  /**
   * Delete a specific cache entry
   */
  delete(connectionId: string, type: string, ...parts: string[]): boolean {
    const key = this.buildKey(connectionId, type, ...parts);
    const existed = this.cache.has(key);
    if (existed) {
      this.cache.delete(key);
      this.decrementCount(connectionId);
    }
    return existed;
  }

  /**
   * Clear all cache entries for a connection
   */
  clearConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    this.connectionEntryCount.delete(connectionId);
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.connectionEntryCount.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { totalEntries: number; connectionCounts: Record<string, number> } {
    return {
      totalEntries: this.cache.size,
      connectionCounts: Object.fromEntries(this.connectionEntryCount),
    };
  }

  private decrementCount(connectionId: string): void {
    const count = this.connectionEntryCount.get(connectionId) || 0;
    if (count <= 1) {
      this.connectionEntryCount.delete(connectionId);
    } else {
      this.connectionEntryCount.set(connectionId, count - 1);
    }
  }

  private evictOldestForConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix) && entry.expiry < oldestExpiry) {
        oldestKey = key;
        oldestExpiry = entry.expiry;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.decrementCount(connectionId);
    }
  }
}

// Singleton instance
export const metadataCache = new MetadataCache();

// Cache key types for type safety
export const CacheTypes = {
  TABLES: "tables",
  TABLE_STRUCTURE: "table_structure",
  TABLE_COLUMNS: "table_columns",
  CONSTRAINTS: "constraints",
  INDEXES: "indexes",
  FOREIGN_KEYS: "foreign_keys",
} as const;

export type CacheType = (typeof CacheTypes)[keyof typeof CacheTypes];
