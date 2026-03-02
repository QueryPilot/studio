import { useEffect, useRef } from "react";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";

/**
 * Subscribe to data invalidation events for a specific table.
 * Fires the callback when the table is invalidated (e.g., Cmd+S commit, Cmd+R refresh).
 *
 * Uses a ref for the callback so subscriptions are stable across re-renders —
 * callers don't need useCallback.
 */
export function useTableInvalidation(
  connectionId: string | undefined,
  database: string | undefined,
  schema: string | undefined,
  table: string | undefined,
  callback: () => void,
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!connectionId || !database || !table) return;

    const unsubscribe = useDataInvalidationStore
      .getState()
      .subscribe(connectionId, database, schema, table, () => {
        callbackRef.current();
      });
    return unsubscribe;
  }, [connectionId, database, schema, table]);
}
