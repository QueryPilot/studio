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

import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "./sqlParser";

export const debugInvalidation = {
  /**
   * Get current state of the invalidation store
   */
  getStatus() {
    const store = useDataInvalidationStore.getState();
    return {
      invalidations: Array.from(store.invalidations.entries()).map(
        ([key, timestamp]) => ({
          tableKey: key,
          timestamp,
          timeSinceInvalidation: Date.now() - timestamp,
        }),
      ),
      listeners: Array.from(store.listeners.entries()).map(([key, set]) => ({
        tableKey: key,
        listenerCount: set.size,
      })),
      totalInvalidations: store.invalidations.size,
      totalListeners: store.listeners.size,
    };
  },

  /**
   * Log current status to console
   */
  logStatus() {
    const status = this.getStatus();
    console.group("📊 Data Invalidation Status");
    console.log("Total Invalidations:", status.totalInvalidations);
    console.log("Total Listeners:", status.totalListeners);
    console.log("\nInvalidations:");
    console.table(status.invalidations);
    console.log("\nListeners:");
    console.table(status.listeners);
    console.groupEnd();
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
    console.log(
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
      console.log(
        `✓ Found ${matchingListener.listenerCount} listener(s) for this table`,
      );
    } else {
      console.warn(
        "⚠️  No listeners found for this table. DataGridV2 may not be open for this table.",
      );
    }

    // Trigger invalidation
    console.log("Triggering invalidation...");
    store.invalidateTable(connectionId, database, schema, table);

    // Check if invalidation was recorded
    const afterInvalidations = this.getStatus().invalidations;
    const matchingInvalidation = afterInvalidations.find(
      (i) =>
        i.tableKey === `${connectionId}:${database}:${schema}:${table}`,
    );

    if (matchingInvalidation) {
      console.log(
        `✓ Invalidation recorded at timestamp: ${matchingInvalidation.timestamp}`,
      );
    } else {
      console.error("✗ Invalidation was not recorded");
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
    console.group("🔍 Testing SQL Parser");
    console.log("Input SQL:", sql);

    const tables = parseMutationTables(sql);

    console.log(`Parsed ${tables.length} table(s):`);
    console.table(tables);

    if (tables.length === 0) {
      console.warn(
        "⚠️  No tables found. This might be a SELECT query or the parser failed.",
      );
    } else {
      console.log("✓ Successfully parsed tables");
    }

    console.groupEnd();
    return tables;
  },

  /**
   * Clear all invalidations (useful for testing)
   */
  clearInvalidations() {
    console.warn("⚠️  Clearing all invalidations");
    // Note: This requires adding a clearAll method to the store
    // For now, just log a warning
    console.log(
      "This functionality requires adding a clearAll() method to the store",
    );
  },

  /**
   * Monitor invalidations in real-time
   */
  monitor(duration = 30000) {
    console.log(`👁️  Monitoring invalidations for ${duration / 1000} seconds...`);
    console.log("Any invalidations will be logged below:");

    const store = useDataInvalidationStore.getState();
    const originalInvalidate = store.invalidateTable;

    let eventCount = 0;

    // Wrap the invalidateTable method to log all calls
    store.invalidateTable = (connectionId, database, schema, table) => {
      eventCount++;
      console.log(`[${new Date().toISOString()}] Invalidation #${eventCount}:`, {
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
      console.log(`✓ Monitoring complete. Captured ${eventCount} invalidation(s)`);
    }, duration);

    return () => {
      // Allow early stop
      store.invalidateTable = originalInvalidate;
      console.log(`✓ Monitoring stopped. Captured ${eventCount} invalidation(s)`);
    };
  },

  /**
   * Run comprehensive system test
   */
  runSystemTest() {
    console.group("🧪 Running System Test");

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
          console.log(`✓ ${test.name} - PASSED`);
          passed++;
        } else {
          console.error(`✗ ${test.name} - FAILED`);
          failed++;
        }
      } catch (error) {
        console.error(`✗ ${test.name} - ERROR:`, error);
        failed++;
      }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    console.groupEnd();

    return { passed, failed, total: tests.length };
  },
};

// Export to window for easy console access
if (typeof window !== "undefined") {
  (window as any).debugInvalidation = debugInvalidation;
  console.log(
    "💡 Debug utilities available via window.debugInvalidation or import",
  );
}
