import { logger } from "@/lib/logger";
import { queryClient } from "./react-query-client";
import { useTabStateStore } from "@/stores/tabStateStore";

/**
 * Detects if a SQL query is a mutation (INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE)
 */
export function isMutationQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  const mutationKeywords = [
    "insert",
    "update",
    "delete",
    "truncate",
    "drop",
    "alter",
    "create",
  ];

  return mutationKeywords.some((keyword) => trimmed.startsWith(keyword));
}

/**
 * Detects if a SQL query is a SELECT query
 */
export function isSelectQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  return trimmed.startsWith("select") || trimmed.startsWith("with");
}

/**
 * Clear all query caches for a specific connection
 */
export function clearConnectionCache(connectionId: string): void {
  // Invalidate all React Query caches for this connection
  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey;
      return Array.isArray(queryKey) && queryKey[1] === connectionId;
    },
  });
}

/**
 * Clear all query caches globally (used for Cmd+R refresh)
 */
export function clearAllCaches(): void {
  // Clear React Query cache
  queryClient.clear();

  // Clear all Zustand tab state
  const tabStateStore = useTabStateStore.getState();
  const allTabIds = Array.from(tabStateStore.queryStates.keys());
  allTabIds.forEach((tabId) => {
    tabStateStore.clearQueryState(tabId);
  });
}

/**
 * Clear cache for a specific tab
 */
export function clearTabCache(tabId: string, connectionId?: string): void {
  // Clear Zustand state for this tab
  useTabStateStore.getState().clearQueryState(tabId);

  // Disconnect tab-specific database connection for transaction isolation
  if (connectionId) {
    // Use composite key to disconnect the tab's dedicated connection
    const compositeKey = `${connectionId}:${tabId}`;
    import("@tauri-apps/api/core")
      .then((tauri) => tauri.invoke("disconnect", { connId: compositeKey }))
      .catch((err) => {
        logger.warn(
          `Failed to disconnect tab connection ${compositeKey}:`,
          err,
        );
      });

    // Also invalidate related React Query caches
    clearConnectionCache(connectionId);
  }
}

/**
 * Clear cache after a mutation query
 */
export function handleMutationCache(
  sql: string,
  connectionId: string,
): boolean {
  if (isMutationQuery(sql)) {
    clearConnectionCache(connectionId);
    return true;
  }
  return false;
}
