/**
 * Document-version-aware cache for AST-derived data.
 * Avoids re-parsing unchanged documents by tracking document versions.
 */

export interface CachedData {
  tables: string[];
  columns: string[];
  ctes?: string[];
  aliases?: Map<string, string>;
}

interface CacheEntry {
  version: number;
  data: CachedData;
  timestamp: number;
}

export class AstCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxAge: number;

  constructor(maxAge: number = 30000) {
    this.maxAge = maxAge;
  }

  get(docId: string, version: number): CachedData | null {
    const entry = this.cache.get(docId);
    if (!entry) return null;
    if (entry.version !== version) return null;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(docId);
      return null;
    }
    return entry.data;
  }

  set(docId: string, version: number, data: CachedData): void {
    this.cache.set(docId, { version, data, timestamp: Date.now() });
  }

  invalidate(docId: string): void {
    this.cache.delete(docId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const astCache = new AstCache();
