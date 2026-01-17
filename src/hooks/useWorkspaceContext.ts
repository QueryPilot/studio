/**
 * Hook for building workspace context for AI
 *
 * Gathers current workspace state from multiple stores to provide
 * context-aware AI assistance.
 */

import { useMemo } from "react";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useUIStore } from "@/stores/uiStore";
import { useMongoStore } from "@/stores/mongoStore";
import { useRedisStore } from "@/stores/redisStore";
import { useRecentItemsStore } from "@/stores/recentItemsStore";
import type { WorkspaceContext } from "@/types/ai";

export function useWorkspaceContext(connectionId: string | null): WorkspaceContext {
  const { getPanels, getActivePanelId } = useWorkspaceScreenStore();
  const { database, schema } = useWorkspaceSelectionStore();
  const queryStates = useTabStateStore((state) => state.queryStates);

  // Paradigm-specific stores
  const currentTableName = useUIStore((state) => state.currentTableName);
  const selectedSchema = useUIStore((state) => state.selectedSchema);
  const currentCollection = useMongoStore((state) => state.currentCollection);
  const selectedKey = useRedisStore((state) => state.selectedKey);

  // Recent items tracking
  const getRecentTables = useRecentItemsStore((state) => state.getRecentTables);
  const getRecentCollections = useRecentItemsStore(
    (state) => state.getRecentCollections
  );
  const getRecentKeys = useRecentItemsStore((state) => state.getRecentKeys);

  return useMemo(() => {
    const context: WorkspaceContext = {
      connectionId,
      database: database || null,
      schema: schema || selectedSchema || null,
      activeTable: currentTableName || null,
      activeCollection: currentCollection || null,
      activeKey: selectedKey || null,
      activeQuery: null,
      recentTables: connectionId ? getRecentTables(connectionId) : [],
      recentCollections: connectionId ? getRecentCollections(connectionId) : [],
      recentKeys: connectionId ? getRecentKeys(connectionId) : [],
      lastAction: null,
    };

    if (!connectionId) {
      return context;
    }

    // Get active panel and tab
    const panels = getPanels();
    const activePanelId = getActivePanelId();
    const activePanel = panels.get(activePanelId);

    if (activePanel?.activeTabId) {
      const queryState = queryStates.get(activePanel.activeTabId);

      if (queryState) {
        // Capture the active query
        context.activeQuery = queryState.query || null;

        // Detect last action
        if (queryState.isExecuting) {
          context.lastAction = "query";
        } else if (queryState.result) {
          context.lastAction = "browse";
        }
      }
    }

    return context;
  }, [
    connectionId,
    database,
    schema,
    selectedSchema,
    currentTableName,
    currentCollection,
    selectedKey,
    getRecentTables,
    getRecentCollections,
    getRecentKeys,
    getPanels,
    getActivePanelId,
    queryStates,
  ]);
}
