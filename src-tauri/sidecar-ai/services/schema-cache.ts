/**
 * Schema Cache
 *
 * Paradigm-aware caching for database metadata with TTL and smart preloading.
 */

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt?: number;
  createdAt: number;
}

interface CacheOptions {
  maxEntriesPerConnection?: number;
  defaultTtl?: number;
}

interface SetOptions {
  ttl?: number;
}

export interface PreloadStrategy {
  maxPreload: number;
  prioritize: (items: string[]) => string[];
}

/**
 * Simple in-memory cache with TTL and LRU eviction per connection.
 */
export class SchemaCache {
  private cache = new Map<string, CacheEntry>();
  private connectionKeys = new Map<string, Set<string>>();
  private maxEntriesPerConnection: number;
  private defaultTtl?: number;

  constructor(options: CacheOptions = {}) {
    this.maxEntriesPerConnection = options.maxEntriesPerConnection || 100;
    this.defaultTtl = options.defaultTtl;
  }

  set<T>(key: string, value: T, options: SetOptions = {}): void {
    const ttl = options.ttl ?? this.defaultTtl;
    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : undefined,
    };

    // Extract connection ID from key (format: "connId:...")
    const connId = this.extractConnectionId(key);
    if (connId) {
      this.enforceConnectionLimit(connId, key);
    }

    this.cache.set(key, entry);

    // Track connection keys
    if (connId) {
      if (!this.connectionKeys.has(connId)) {
        this.connectionKeys.set(connId, new Set());
      }
      this.connectionKeys.get(connId)!.add(key);
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.cache.delete(key);

    // Remove from connection tracking
    const connId = this.extractConnectionId(key);
    if (connId) {
      this.connectionKeys.get(connId)?.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
    this.connectionKeys.clear();
  }

  clearConnection(connectionId: string): void {
    const keys = this.connectionKeys.get(connectionId);
    if (keys) {
      keys.forEach((key) => this.cache.delete(key));
      this.connectionKeys.delete(connectionId);
    }
  }

  private extractConnectionId(key: string): string | null {
    const parts = key.split(":");
    return parts.length > 1 ? parts[0] : null;
  }

  private enforceConnectionLimit(connId: string, newKey: string): void {
    const keys = this.connectionKeys.get(connId);
    if (!keys) return;

    if (keys.size >= this.maxEntriesPerConnection) {
      // Evict oldest entry
      const oldestKey = this.findOldestKey(Array.from(keys));
      if (oldestKey && oldestKey !== newKey) {
        this.delete(oldestKey);
      }
    }
  }

  private findOldestKey(keys: string[]): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry && entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}

/**
 * Common table/collection names to prioritize for preloading.
 */
const SQL_COMMON_NAMES = [
  "users",
  "accounts",
  "orders",
  "products",
  "customers",
  "transactions",
  "payments",
  "invoices",
];

const DOCUMENT_COMMON_NAMES = [
  "users",
  "accounts",
  "products",
  "orders",
  "customers",
  "sessions",
];

/**
 * Get preload strategy for a database paradigm.
 */
export function getPreloadStrategy(paradigm: string): PreloadStrategy {
  switch (paradigm) {
    case "sql":
      return {
        maxPreload: 10,
        prioritize: (items: string[]) => {
          // Sort by: priority list order first, then alphabetically
          return items.sort((a, b) => {
            const aIndex = SQL_COMMON_NAMES.indexOf(a.toLowerCase());
            const bIndex = SQL_COMMON_NAMES.indexOf(b.toLowerCase());

            const aCommon = aIndex !== -1;
            const bCommon = bIndex !== -1;

            if (aCommon && !bCommon) return -1;
            if (!aCommon && bCommon) return 1;
            if (aCommon && bCommon) return aIndex - bIndex;

            // Both uncommon - sort alphabetically
            return a.localeCompare(b);
          });
        },
      };

    case "document":
      return {
        maxPreload: 5,
        prioritize: (items: string[]) => {
          return items.sort((a, b) => {
            const aIndex = DOCUMENT_COMMON_NAMES.indexOf(a.toLowerCase());
            const bIndex = DOCUMENT_COMMON_NAMES.indexOf(b.toLowerCase());

            const aCommon = aIndex !== -1;
            const bCommon = bIndex !== -1;

            if (aCommon && !bCommon) return -1;
            if (!aCommon && bCommon) return 1;
            if (aCommon && bCommon) return aIndex - bIndex;

            return a.localeCompare(b);
          });
        },
      };

    case "keyvalue":
      return {
        maxPreload: 0, // No preloading for key-value stores
        prioritize: (items: string[]) => items, // No prioritization
      };

    default:
      return {
        maxPreload: 0,
        prioritize: (items: string[]) => items,
      };
  }
}
