/**
 * Shared cache utilities for SQL language support.
 * Consolidates LRU cache implementations from sql-linter, context, and completion.
 */

/**
 * Generic LRU Cache with TTL support.
 * Thread-safe for single-threaded JS environments.
 */
export class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize: number = 1000, ttl: number = 30000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Clean expired entries. Call periodically for memory efficiency.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

/**
 * Instance-keyed cache factory.
 * Creates caches scoped to editor instances to prevent state corruption.
 */
const instanceCaches = new Map<string, Map<string, LRUCache<unknown>>>();

export function getInstanceCache<T>(
  instanceId: string,
  cacheKey: string,
  maxSize: number = 100,
  ttl: number = 5000
): LRUCache<T> {
  let instanceMap = instanceCaches.get(instanceId);
  if (!instanceMap) {
    instanceMap = new Map();
    instanceCaches.set(instanceId, instanceMap);
  }

  let cache = instanceMap.get(cacheKey) as LRUCache<T> | undefined;
  if (!cache) {
    cache = new LRUCache<T>(maxSize, ttl);
    instanceMap.set(cacheKey, cache);
  }

  return cache;
}

export function clearInstanceCaches(instanceId: string): void {
  instanceCaches.delete(instanceId);
}

/**
 * Fast string hash function.
 * Used for document change detection and cache keys.
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Fast document hash using sampling.
 * Hashes first/last 100 chars + length for quick change detection.
 */
export function hashDocument(doc: { length: number; sliceString: (from: number, to: number) => string }): number {
  const len = doc.length;
  if (len === 0) return 0;

  const first = doc.sliceString(0, Math.min(100, len));
  const last = len > 100 ? doc.sliceString(Math.max(0, len - 100), len) : "";

  let hash = len;
  for (let i = 0; i < first.length; i++) {
    hash = ((hash << 5) - hash + first.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < last.length; i++) {
    hash = ((hash << 5) - hash + last.charCodeAt(i)) | 0;
  }
  return hash;
}

// Cache configuration constants
export const CACHE_CONFIG = {
  // Context analysis cache
  CONTEXT_MAX_SIZE: 100,
  CONTEXT_TTL: 5000, // 5 seconds

  // Completion cache
  COMPLETION_MAX_SIZE: 50,
  COMPLETION_TTL: 10000, // 10 seconds

  // Metadata cache (tables, columns)
  METADATA_MAX_SIZE: 1000,
  METADATA_TTL: 30000, // 30 seconds

  // Entity existence cache
  ENTITY_MAX_SIZE: 1000,
  ENTITY_TTL: 30000, // 30 seconds
} as const;
