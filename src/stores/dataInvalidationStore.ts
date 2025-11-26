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
   * Invalidate a specific table, triggering all subscribers to refetch
   */
  invalidateTable: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    table: string,
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
   * Internal: Notify all listeners for a table
   */
  _notifyListeners: (tableKey: string) => void;
}

export const useDataInvalidationStore = create<DataInvalidationState>(
  (set, get) => ({
    invalidations: new Map<string, number>(),

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

    getLastModified: (connectionId, database, schema, table) => {
      const tableKey = createTableKey(connectionId, database, schema, table);
      return get().invalidations.get(tableKey) ?? 0;
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
