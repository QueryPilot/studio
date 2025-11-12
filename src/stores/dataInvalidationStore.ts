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

interface DataInvalidationState {
  /**
   * Map of tableKey → last modified timestamp (ms)
   * Used to track when table data was last changed
   */
  invalidations: Map<string, number>;

  /**
   * Map of tableKey → Set of listener callbacks
   * Listeners are notified when their table is invalidated
   */
  listeners: Map<string, Set<InvalidationListener>>;

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
    listeners: new Map<string, Set<InvalidationListener>>(),

    invalidateTable: (connectionId, database, schema, table) => {
      try {
        if (!connectionId || !database || !table) {
          console.warn(
            `[DataInvalidation] Invalid parameters: connectionId=${connectionId}, database=${database}, table=${table}`,
          );
          return;
        }

        const tableKey = createTableKey(connectionId, database, schema, table);
        const timestamp = Date.now();

        console.log(
          `[DataInvalidation] Invalidating table: ${tableKey} at ${timestamp}`,
        );

        set((state) => {
          const invalidations = new Map(state.invalidations);
          invalidations.set(tableKey, timestamp);
          return { invalidations };
        });

        // Notify all listeners for this table
        get()._notifyListeners(tableKey);
      } catch (error) {
        console.error(
          `[DataInvalidation] Error invalidating table:`,
          error,
          { connectionId, database, schema, table },
        );
      }
    },

    getLastModified: (connectionId, database, schema, table) => {
      const tableKey = createTableKey(connectionId, database, schema, table);
      return get().invalidations.get(tableKey) ?? 0;
    },

    subscribe: (connectionId, database, schema, table, callback) => {
      const tableKey = createTableKey(connectionId, database, schema, table);

      console.log(`[DataInvalidation] New subscriber for table: ${tableKey}`);

      set((state) => {
        const listeners = new Map(state.listeners);
        if (!listeners.has(tableKey)) {
          listeners.set(tableKey, new Set());
        }
        listeners.get(tableKey)!.add(callback);
        return { listeners };
      });

      // Return unsubscribe function
      return () => {
        console.log(
          `[DataInvalidation] Unsubscribing from table: ${tableKey}`,
        );

        set((state) => {
          const listeners = new Map(state.listeners);
          const tableListeners = listeners.get(tableKey);
          if (tableListeners) {
            tableListeners.delete(callback);
            if (tableListeners.size === 0) {
              listeners.delete(tableKey);
            }
          }
          return { listeners };
        });
      };
    },

    _notifyListeners: (tableKey) => {
      const listeners = get().listeners.get(tableKey);
      if (listeners && listeners.size > 0) {
        console.log(
          `[DataInvalidation] Notifying ${listeners.size} listener(s) for table: ${tableKey}`,
        );
        listeners.forEach((callback) => {
          try {
            callback();
          } catch (error) {
            console.error(
              `[DataInvalidation] Error in listener callback:`,
              error,
            );
          }
        });
      } else {
        console.log(
          `[DataInvalidation] No listeners to notify for table: ${tableKey}`,
        );
      }
    },
  }),
);

/**
 * Helper to create table keys (exported for use in other modules)
 */
export const buildTableKey = createTableKey;
