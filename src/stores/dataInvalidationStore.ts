import { create } from "zustand";

/**
 * Creates a unique key for a table across connection, database, schema, and table name
 */
const createTableKey = (
  connectionId: string,
  database: string,
  schema: string | undefined,
  table: string,
): string => {
  return [connectionId, database, schema ?? "public", table].join(":");
};

/**
 * Creates a unique key for a schema across connection, database, and schema
 */
const createSchemaKey = (
  connectionId: string,
  database: string,
  schema: string | undefined,
): string => {
  return [connectionId, database, schema ?? "public"].join(":");
};

/**
 * Listener callback type
 */
type InvalidationListener = () => void;

/**
 * Listeners are stored outside Zustand state to avoid triggering
 * re-renders on subscribe/unsubscribe. Only invalidations (timestamps)
 * need to be reactive state.
 */
const listenersMap = new Map<string, Set<InvalidationListener>>();

interface DataInvalidationState {
  /**
   * Map of tableKey → last modified timestamp (ms)
   * Used to track when table data was last changed
   */
  invalidations: Map<string, number>;

  /**
   * Map of schemaKey → last modified timestamp (ms)
   * Used to track when schema structure was last changed (tables added/removed)
   */
  schemaInvalidations: Map<string, number>;

  /**
   * Invalidate a specific table, triggering all subscribers to refetch
   */
  invalidateTable: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    table: string,
  ) => void;

  /**
   * Invalidate an entire schema, triggering schema list refresh
   * Use this when tables are created/dropped/duplicated
   */
  invalidateSchema: (
    connectionId: string,
    database: string,
    schema: string | undefined,
  ) => void;

  /**
   * Get the last modified timestamp for a table
   * Returns 0 if table has never been invalidated
   */
  getLastModified: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    table: string,
  ) => number;

  /**
   * Get the last modified timestamp for a schema
   * Returns 0 if schema has never been invalidated
   */
  getSchemaLastModified: (
    connectionId: string,
    database: string,
    schema: string | undefined,
  ) => number;

  /**
   * Subscribe to invalidation events for a specific table
   * Returns an unsubscribe function
   */
  subscribe: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    table: string,
    callback: InvalidationListener,
  ) => () => void;

  /**
   * Subscribe to schema invalidation events
   * Returns an unsubscribe function
   */
  subscribeSchema: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    callback: InvalidationListener,
  ) => () => void;

  /**
   * Internal: Notify all listeners for a table
   */
  _notifyListeners: (tableKey: string) => void;
}

export const useDataInvalidationStore = create<DataInvalidationState>(
  (set, get) => ({
    invalidations: new Map<string, number>(),
    schemaInvalidations: new Map<string, number>(),

    invalidateTable: (connectionId, database, schema, table) => {
      if (!connectionId || !database || !table) {
        return;
      }

      const tableKey = createTableKey(connectionId, database, schema, table);
      const timestamp = Date.now();

      set((state) => {
        const invalidations = new Map(state.invalidations);
        invalidations.set(tableKey, timestamp);
        return { invalidations };
      });

      // Notify listeners outside of set() to avoid blocking
      get()._notifyListeners(tableKey);
    },

    invalidateSchema: (connectionId, database, schema) => {
      if (!connectionId || !database) {
        return;
      }

      const schemaKey = createSchemaKey(connectionId, database, schema);
      const timestamp = Date.now();

      set((state) => {
        const schemaInvalidations = new Map(state.schemaInvalidations);
        schemaInvalidations.set(schemaKey, timestamp);
        return { schemaInvalidations };
      });

      // Notify schema listeners
      get()._notifyListeners(schemaKey);
    },

    getLastModified: (connectionId, database, schema, table) => {
      const tableKey = createTableKey(connectionId, database, schema, table);
      return get().invalidations.get(tableKey) ?? 0;
    },

    getSchemaLastModified: (connectionId, database, schema) => {
      const schemaKey = createSchemaKey(connectionId, database, schema);
      return get().schemaInvalidations.get(schemaKey) ?? 0;
    },

    subscribe: (connectionId, database, schema, table, callback) => {
      const tableKey = createTableKey(connectionId, database, schema, table);

      // Direct mutation of external map - no state update needed
      if (!listenersMap.has(tableKey)) {
        listenersMap.set(tableKey, new Set());
      }
      listenersMap.get(tableKey)!.add(callback);

      // Return unsubscribe function
      return () => {
        const tableListeners = listenersMap.get(tableKey);
        if (tableListeners) {
          tableListeners.delete(callback);
          if (tableListeners.size === 0) {
            listenersMap.delete(tableKey);
          }
        }
      };
    },

    subscribeSchema: (connectionId, database, schema, callback) => {
      const schemaKey = createSchemaKey(connectionId, database, schema);

      // Direct mutation of external map - no state update needed
      if (!listenersMap.has(schemaKey)) {
        listenersMap.set(schemaKey, new Set());
      }
      listenersMap.get(schemaKey)!.add(callback);

      // Return unsubscribe function
      return () => {
        const schemaListeners = listenersMap.get(schemaKey);
        if (schemaListeners) {
          schemaListeners.delete(callback);
          if (schemaListeners.size === 0) {
            listenersMap.delete(schemaKey);
          }
        }
      };
    },

    _notifyListeners: (tableKey) => {
      const listeners = listenersMap.get(tableKey);
      if (listeners && listeners.size > 0) {
        // Use queueMicrotask to avoid blocking the main thread
        queueMicrotask(() => {
          listeners.forEach((callback) => {
            try {
              callback();
            } catch {
              // Silently handle listener errors
            }
          });
        });
      }
    },
  }),
);

/**
 * Helper to create table keys (exported for use in other modules)
 */
export const buildTableKey = createTableKey;
