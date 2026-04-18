import type { DBMLSchema } from "@/services/dbmlService";

interface CacheEntry {
  schema: DBMLSchema;
  timestamp: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES_PER_CONNECTION = 32;

function legacyKey(
  connectionId: string,
  database: string,
  schema: string,
): string {
  const safeDatabase = database || "__default__";
  return `${connectionId}::${safeDatabase}::${schema}`;
}

function schemasKey(
  connectionId: string,
  database: string,
  schemas: string[],
): string {
  const safeDatabase = database || "__default__";
  const sorted = schemas.slice().sort().join("|");
  return `${connectionId}::${safeDatabase}::${sorted}`;
}

function connectionPrefix(connectionId: string): string {
  return `${connectionId}::`;
}

class ERDCache {
  // Map preserves insertion order — used for LRU eviction.
  private cache = new Map<string, CacheEntry>();

  get(connectionId: string, database: string, schema: string): DBMLSchema | null {
    return this.readKey(legacyKey(connectionId, database, schema));
  }

  set(connectionId: string, database: string, schema: string, value: DBMLSchema): void {
    this.writeKey(connectionId, legacyKey(connectionId, database, schema), value);
  }

  getSchemas(
    connectionId: string,
    database: string,
    schemas: string[],
  ): DBMLSchema | null {
    return this.readKey(schemasKey(connectionId, database, schemas));
  }

  setSchemas(
    connectionId: string,
    database: string,
    schemas: string[],
    value: DBMLSchema,
  ): void {
    this.writeKey(connectionId, schemasKey(connectionId, database, schemas), value);
  }

  clear(connectionId?: string, database?: string, schema?: string): void {
    if (!connectionId) {
      this.cache.clear();
      return;
    }
    const prefix = connectionPrefix(connectionId);
    for (const key of Array.from(this.cache.keys())) {
      if (!key.startsWith(prefix)) continue;
      if (database) {
        const parts = key.split("::");
        const matchesDatabase = parts[1] === (database || "__default__");
        const matchesSchema = schema ? parts[2] === schema : true;
        if (matchesDatabase && matchesSchema) {
          this.cache.delete(key);
        }
      } else {
        this.cache.delete(key);
      }
    }
  }

  private readKey(key: string): DBMLSchema | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU ordering.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.schema;
  }

  private writeKey(connectionId: string, key: string, value: DBMLSchema): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { schema: value, timestamp: Date.now() });
    this.evictIfOverCap(connectionId);
  }

  private evictIfOverCap(connectionId: string): void {
    const prefix = connectionPrefix(connectionId);
    const keysForConn: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) keysForConn.push(key);
    }
    while (keysForConn.length > MAX_ENTRIES_PER_CONNECTION) {
      const oldest = keysForConn.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }
}

export const erdCache = new ERDCache();
