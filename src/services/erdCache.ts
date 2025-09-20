import type { DBMLSchema } from "@/services/dbmlService";

interface CacheEntry {
  schema: DBMLSchema;
  timestamp: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

function createKey(connectionId: string, database: string, schema: string): string {
  const safeDatabase = database || "__default__";
  return `${connectionId}::${safeDatabase}::${schema}`;
}

class ERDCache {
  private cache = new Map<string, CacheEntry>();

  get(connectionId: string, database: string, schema: string): DBMLSchema | null {
    const key = createKey(connectionId, database, schema);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.schema;
  }

  set(connectionId: string, database: string, schema: string, value: DBMLSchema): void {
    const key = createKey(connectionId, database, schema);
    this.cache.set(key, { schema: value, timestamp: Date.now() });
  }

  clear(connectionId?: string, database?: string, schema?: string): void {
    if (!connectionId) {
      this.cache.clear();
      return;
    }

    const prefix = `${connectionId}::`;
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
}

export const erdCache = new ERDCache();
