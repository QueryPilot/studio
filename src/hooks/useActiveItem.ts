/**
 * Hooks for setting active table/collection/key with automatic recent item tracking
 *
 * These hooks wrap the store setters and automatically track recent items for AI context.
 * Components should use these instead of calling store setters directly.
 */

import { useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useMongoStore } from "@/stores/mongoStore";
import { useRedisStore } from "@/stores/redisStore";
import { useRecentItemsStore } from "@/stores/recentItemsStore";

/**
 * Hook for setting active SQL table with tracking
 */
export function useActiveTable(connectionId: string | null) {
  const setCurrentTableName = useUIStore((state) => state.setCurrentTableName);
  const addItem = useRecentItemsStore((state) => state.addItem);

  return useCallback(
    (tableName: string | null) => {
      setCurrentTableName(tableName);

      // Track in recent items if valid
      if (connectionId && tableName) {
        addItem({
          connectionId,
          type: "table",
          name: tableName,
        });
      }
    },
    [connectionId, setCurrentTableName, addItem]
  );
}

/**
 * Hook for setting active MongoDB collection with tracking
 */
export function useActiveCollection(connectionId: string | null) {
  const setCurrentCollection = useMongoStore((state) => state.setCurrentCollection);
  const addItem = useRecentItemsStore((state) => state.addItem);

  return useCallback(
    (collectionName: string | null) => {
      setCurrentCollection(collectionName);

      // Track in recent items if valid
      if (connectionId && collectionName) {
        addItem({
          connectionId,
          type: "collection",
          name: collectionName,
        });
      }
    },
    [connectionId, setCurrentCollection, addItem]
  );
}

/**
 * Hook for setting active Redis key with tracking
 */
export function useActiveKey(connectionId: string | null) {
  const selectKey = useRedisStore((state) => state.selectKey);
  const addItem = useRecentItemsStore((state) => state.addItem);

  return useCallback(
    (keyName: string | null) => {
      selectKey(keyName);

      // Track in recent items if valid
      if (connectionId && keyName) {
        addItem({
          connectionId,
          type: "key",
          name: keyName,
        });
      }
    },
    [connectionId, selectKey, addItem]
  );
}

/**
 * Combined hook for convenience
 */
export function useActiveItems(connectionId: string | null) {
  const setActiveTable = useActiveTable(connectionId);
  const setActiveCollection = useActiveCollection(connectionId);
  const setActiveKey = useActiveKey(connectionId);

  return {
    setActiveTable,
    setActiveCollection,
    setActiveKey,
  };
}
