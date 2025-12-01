/**
 * Debug utilities for the Data Invalidation System
 *
 * Usage in browser console:
 * ```
 * import { debugInvalidation } from '@/utils/dataInvalidationDebug';
 * debugInvalidation.logStatus();
 * debugInvalidation.testInvalidation('conn1', 'mydb', 'public', 'users');
 * ```
 */

import { logger } from "@/lib/logger";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "./sqlParser";

// Type for internal store state that includes listeners (not in public interface)
interface InternalStoreState {
  invalidations: Map<string, number>;
  listeners?: Map<string, Set<() => void>>;
}

export const debugInvalidation = {
  /**
   * Get current state of the invalidation store
   */
  getStatus() {
    const store = useDataInvalidationStore.getState() as unknown as InternalStoreState;
    const listenersMap = store.listeners;
    return {
      invalidations: Array.from(store.invalidations.entries()).map(
        ([key, timestamp]) => ({
          tableKey: key,
          timestamp,
          timeSinceInvalidation: Date.now() - timestamp,
        }),
      ),
      listeners: listenersMap
        ? Array.from(listenersMap.entries()).map(([key, set]) => ({
            tableKey: key,
            listenerCount: set.size,
          }))
        : [],
      totalInvalidations: store.invalidations.size,
      totalListeners: listenersMap?.size ?? 0,
    };
  },

  /**
   * Log current status to console
   */
  logStatus() {
    const status = this.getStatus();
    logger.group("invalidation-debug", "📊 Data Invalidation Status");
    logger.info("Total Invalidations:", status.totalInvalidations);
    logger.info("Total Listeners:", status.totalListeners);
    logger.info("\nInvalidations:");
    logger.table("invalidation-debug", status.invalidations);
    logger.info("\nListeners:");
    logger.table("invalidation-debug", status.listeners);
    logger.groupEnd();
    return status;
  },

  /**
   * Test invalidation for a specific table
   */
  testInvalidation(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
  ) {
    logger.info(
      `🧪 Testing invalidation for: ${connectionId}:${database}:${schema}:${table}`,
    );

    const store = useDataInvalidationStore.getState();

    // Check if there are any listeners
    const beforeListeners = this.getStatus().listeners;
    const matchingListener = beforeListeners.find(
      (l) =>
        l.tableKey === `${connectionId}:${database}:${schema}:${table}`,
    );

    if (matchingListener) {
      logger.info(
        `✓ Found ${matchingListener.listenerCount} listener(s) for this table`,
      );
    } else {
      logger.warn(
        "⚠️  No listeners found for this table. DataGridV2 may not be open for this table.",
      );
    }

    // Trigger invalidation
    logger.info("Triggering invalidation...");
    store.invalidateTable(connectionId, database, schema, table);

    // Check if invalidation was recorded
    const afterInvalidations = this.getStatus().invalidations;
    const matchingInvalidation = afterInvalidations.find(
      (i) =>
        i.tableKey === `${connectionId}:${database}:${schema}:${table}`,
    );

    if (matchingInvalidation) {
      logger.info(
        `✓ Invalidation recorded at timestamp: ${matchingInvalidation.timestamp}`,
      );
    } else {
      logger.error("✗ Invalidation was not recorded");
    }

    return {
      success: !!matchingInvalidation,
      listenerCount: matchingListener?.listenerCount ?? 0,
      timestamp: matchingInvalidation?.timestamp,
    };
  },

  /**
   * Test SQL parser
   */
  testSqlParser(sql: string) {
    logger.group("invalidation-debug", "🔍 Testing SQL Parser");
    logger.info("Input SQL:", sql);

    const tables = parseMutationTables(sql);

    logger.info(`Parsed ${tables.length} table(s):`);
    logger.table("invalidation-debug", tables);

    if (tables.length === 0) {
      logger.warn(
        "⚠️  No tables found. This might be a SELECT query or the parser failed.",
      );
    } else {
      logger.info("✓ Successfully parsed tables");
    }

    logger.groupEnd();
    return tables;
  },

  /**
   * Clear all invalidations (useful for testing)
   */
  clearInvalidations() {
    logger.warn("⚠️  Clearing all invalidations");
    // Note: This requires adding a clearAll method to the store
    // For now, just log a warning
    logger.info(
      "This functionality requires adding a clearAll() method to the store",
    );
  },

  /**
   * Monitor invalidations in real-time
   */
  monitor(duration = 30000) {
    logger.info(`👁️  Monitoring invalidations for ${duration / 1000} seconds...`);
    logger.info("Any invalidations will be logged below:");

    const store = useDataInvalidationStore.getState();
    const originalInvalidate = store.invalidateTable;

    let eventCount = 0;

    // Wrap the invalidateTable method to log all calls
    store.invalidateTable = (connectionId, database, schema, table) => {
      eventCount++;
      logger.info(`[${new Date().toISOString()}] Invalidation #${eventCount}:`, {
        connectionId,
        database,
        schema,
        table,
      });
      originalInvalidate(connectionId, database, schema, table);
    };

    // Restore original after duration
    setTimeout(() => {
      store.invalidateTable = originalInvalidate;
      logger.info(`✓ Monitoring complete. Captured ${eventCount} invalidation(s)`);
    }, duration);

    return () => {
      // Allow early stop
      store.invalidateTable = originalInvalidate;
      logger.info(`✓ Monitoring stopped. Captured ${eventCount} invalidation(s)`);
    };
  },

  /**
   * Run comprehensive system test
   */
  runSystemTest() {
    logger.group("invalidation-debug", "🧪 Running System Test");

    const tests = [
      {
        name: "Store initialized",
        test: () => {
          const store = useDataInvalidationStore.getState();
          return store !== undefined;
        },
      },
      {
        name: "SQL Parser works",
        test: () => {
          const tables = parseMutationTables("UPDATE users SET name = 'test'");
          return tables.length > 0;
        },
      },
      {
        name: "Invalidation broadcasts",
        test: () => {
          const store = useDataInvalidationStore.getState();
          store.invalidateTable("test", "test", "public", "test");
          const status = this.getStatus();
          return status.invalidations.some((i) =>
            i.tableKey.includes("test:test:public:test"),
          );
        },
      },
    ];

    let passed = 0;
    let failed = 0;

    tests.forEach((test) => {
      try {
        const result = test.test();
        if (result) {
          logger.info(`✓ ${test.name} - PASSED`);
          passed++;
        } else {
          logger.error(`✗ ${test.name} - FAILED`);
          failed++;
        }
      } catch (error) {
        logger.error(`✗ ${test.name} - ERROR:`, error);
        failed++;
      }
    });

    logger.info(`\nResults: ${passed} passed, ${failed} failed`);
    logger.groupEnd();

    return { passed, failed, total: tests.length };
  },
};

// Export to window for easy console access
if (typeof window !== "undefined") {
  (window as any).debugInvalidation = debugInvalidation;
  logger.info(
    "💡 Debug utilities available via window.debugInvalidation or import",
  );
}
