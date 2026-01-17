/**
 * Hook for tracking recently accessed items
 *
 * Components should call these functions when users interact with
 * tables, collections, or keys to populate AI context.
 */

import { useCallback } from "react";
import { useRecentItemsStore } from "@/stores/recentItemsStore";

export function useTrackRecentItems(connectionId: string | null) {
  const addItem = useRecentItemsStore((state) => state.addItem);

  const trackTable = useCallback(
    (tableName: string) => {
      if (!connectionId || !tableName) return;
      addItem({
        connectionId,
        type: "table",
        name: tableName,
      });
    },
    [connectionId, addItem]
  );

  const trackCollection = useCallback(
    (collectionName: string) => {
      if (!connectionId || !collectionName) return;
      addItem({
        connectionId,
        type: "collection",
        name: collectionName,
      });
    },
    [connectionId, addItem]
  );

  const trackKey = useCallback(
    (keyName: string) => {
      if (!connectionId || !keyName) return;
      addItem({
        connectionId,
        type: "key",
        name: keyName,
      });
    },
    [connectionId, addItem]
  );

  return {
    trackTable,
    trackCollection,
    trackKey,
  };
}
