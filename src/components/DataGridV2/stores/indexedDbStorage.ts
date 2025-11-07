import Dexie, { type Table } from "dexie";
import type { StateStorage } from "zustand/middleware";

interface KeyValueRecord {
  key: string;
  value: string;
}

class GridPreferencesDatabase extends Dexie {
  public kv!: Table<KeyValueRecord, string>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({ kv: "&key" });
  }
}

const isClient = typeof window !== "undefined" && typeof indexedDB !== "undefined";

let db: GridPreferencesDatabase | null = null;

const getDatabase = (): GridPreferencesDatabase | null => {
  if (!isClient) return null;
  if (!db) {
    db = new GridPreferencesDatabase("query-pilot-grid-preferences");
  }
  return db;
};

const memoryStore = new Map<string, string>();

export const createIndexedDbStorage = (storeName?: string): StateStorage => {
  const database = getDatabase();

  if (!database) {
    return {
      getItem: (name) => Promise.resolve(memoryStore.get(name) ?? null),
      setItem: (name, value) => {
        memoryStore.set(name, value);
        return Promise.resolve();
      },
      removeItem: (name) => {
        memoryStore.delete(name);
        return Promise.resolve();
      },
    } satisfies StateStorage;
  }

  const scopedKey = (name: string) => (storeName ? `${storeName}:${name}` : name);

  return {
    getItem: async (name) => {
      try {
        const record = await database.kv.get(scopedKey(name));
        return record?.value ?? null;
      } catch (error) {
        console.warn("grid preferences storage getItem failed", error);
        return null;
      }
    },
    setItem: async (name, value) => {
      try {
        await database.kv.put({ key: scopedKey(name), value });
      } catch (error) {
        console.warn("grid preferences storage setItem failed", error);
      }
    },
    removeItem: async (name) => {
      try {
        await database.kv.delete(scopedKey(name));
      } catch (error) {
        console.warn("grid preferences storage removeItem failed", error);
      }
    },
  } satisfies StateStorage;
};
