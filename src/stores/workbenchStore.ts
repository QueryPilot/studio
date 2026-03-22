import { logger } from "@/lib/logger";
import { create } from "zustand";

import {
  type GridNode,
  type PanelContent,
  type TabMetadata,
  type SplitAction,
  type Direction,
} from "@/types/workbench";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import {
  splitPanel,
  closePanel,
  resizePanel,
  createLeafNode,
  getAllPanels,
  getAdjacentPanel,
  findNodePath,
} from "@/utils/workbenchTree";
import { clearTabCache } from "@/lib/cacheManager";
import { getSessionDatabase } from "@/lib/db/sessionDb";

interface WorkbenchStore {
  layoutTree: GridNode | null;
  panelContents: Map<string, PanelContent>;
  layoutHistory: GridNode[];
  historyIndex: number;
  preventAutoInit: boolean;
  activeConnectionId: string | null;

  setConnectionId: (connectionId: string | null) => void;
  initializeLayout: () => void;
  splitPanelAction: (action: SplitAction) => void;
  closePanelAction: (panelId: string, preventAutoInit?: boolean) => void;
  resizePanelAction: (path: number[], ratio: number) => void;
  moveTab: (
    tabId: string,
    sourcePanelId: string,
    targetPanelId: string,
  ) => void;
  focusPanel: (panelId: string) => void;
  focusAdjacentPanel: (direction: Direction) => void;

  resetLayout: () => void;

  undo: () => void;
  redo: () => void;

  addTab: (panelId: string, tabId: string, tabData?: TabMetadata) => void;
  removeTab: (panelId: string, tabId: string) => void;
  closeAllTabs: () => void;
  clearDatabaseTabs: (connectionId: string, database: string) => void;
  setActiveTab: (panelId: string, tabId: string) => void;
  updateTabMetadata: (
    panelId: string,
    tabId: string,
    updates: Partial<TabMetadata>,
  ) => void;
  
  // Workspace layout persistence
  setLayoutTree: (tree: GridNode) => void;
  restorePanelContents: (contents: Map<string, PanelContent>) => void;

  // IndexedDB layout persistence
  persistLayout: (workspaceId: string) => Promise<void>;
  loadLayout: (workspaceId: string) => Promise<boolean>;
  flushLayout: (workspaceId: string) => void;
}

const useWorkbenchStore = create<WorkbenchStore>()((set, get) => ({
    layoutTree: null,
    panelContents: new Map(),
    layoutHistory: [],
    historyIndex: -1,
    preventAutoInit: false,
    activeConnectionId: null,

    setConnectionId: (connectionId) => {
      const oldConnectionId = get().activeConnectionId;

      // Skip if no change
      if (oldConnectionId === connectionId) return;

      // Simply update the active connection ID - no layout swapping
      // Tabs from ALL connections remain visible; this just tracks focus
      set({ activeConnectionId: connectionId });

      logger.info(
        `[WorkbenchStore] Active connection changed: ${oldConnectionId ?? "none"} -> ${connectionId ?? "none"}`,
      );
    },

    initializeLayout: () => {
      const defaultPanel = createLeafNode({
        type: "editor",
        tabIds: [],
        activeTabId: "",
      });

      if (defaultPanel.content) {
        set({
          layoutTree: defaultPanel,
          panelContents: new Map([[defaultPanel.id, defaultPanel.content]]),
          layoutHistory: [defaultPanel],
          historyIndex: 0,
        });
        usePanelFocusStore.getState().focusPanel(defaultPanel.id);
      }
    },

    splitPanelAction: (action) => {
      const { layoutTree, layoutHistory, historyIndex } = get();
      if (!layoutTree) {
        logger.error("❌ splitPanelAction: No layout tree");
        return;
      }

      const result = splitPanel(
        layoutTree,
        action.targetPanelId,
        action.direction,
        action.newPanelContent,
        action.splitRatio,
      );

      if (result) {
        const { tree: newTree, newPanelId } = result;
        const newHistory = layoutHistory.slice(0, historyIndex + 1);
        newHistory.push(newTree);

        const panels = getAllPanels(newTree);
        const currentContents = get().panelContents;
        // Preserve existing panel references to avoid unnecessary re-renders
        // Only use new content for panels that don't exist yet
        const newContents = new Map(
          panels.map((p) => [p.id, currentContents.get(p.id) ?? p]),
        );

        set({
          layoutTree: newTree,
          panelContents: newContents,
          layoutHistory: newHistory,
          historyIndex: newHistory.length - 1,
        });
        usePanelFocusStore.getState().focusPanel(newPanelId); // Focus the newly created panel
      } else {
        logger.error("splitPanel returned null", {
          targetPanelId: action.targetPanelId,
          direction: action.direction,
        });
      }
    },

    closePanelAction: (panelId, preventAutoInit = false) => {
      const panel = get().panelContents.get(panelId);
      const tabsToClear = panel ? [...panel.tabIds] : [];

      const { layoutTree, layoutHistory, historyIndex } = get();
      if (!layoutTree) return;

      if (preventAutoInit) {
        set({ preventAutoInit: true });
      }

      const newTree = closePanel(layoutTree, panelId);

      if (newTree) {
        const newHistory = layoutHistory.slice(0, historyIndex + 1);
        newHistory.push(newTree);

        const panels = getAllPanels(newTree);
        const currentContents = get().panelContents;
        const newContents = new Map(
          panels.map((p) => [p.id, currentContents.get(p.id) ?? p]),
        );

        set({
          layoutTree: newTree,
          panelContents: newContents,
          layoutHistory: newHistory,
          historyIndex: newHistory.length - 1,
        });
        const nextFocusId = panels[0]?.id;
        if (nextFocusId) {
          usePanelFocusStore.getState().focusPanel(nextFocusId);
        } else {
          usePanelFocusStore.getState().clearFocus();
        }
      } else {
        const shouldPreventInit = get().preventAutoInit || preventAutoInit;

        if (!shouldPreventInit) {
          get().initializeLayout();
        } else {
          set({
            layoutTree: null,
            panelContents: new Map(),
          });
          usePanelFocusStore.getState().clearFocus();
        }
      }

      // Clear both Zustand and React Query cache for all tabs in closed panel
      if (tabsToClear.length > 0) {
        tabsToClear.forEach((tabId) => {
          const tabMetadata = panel?.metadata?.[tabId];
          const connectionId = tabMetadata?.connectionId;
          clearTabCache(tabId, connectionId);
        });
      }
    },

    resizePanelAction: (path, ratio) => {
      const { layoutTree } = get();
      if (!layoutTree) return;

      const newTree = resizePanel(layoutTree, path, ratio);
      set({ layoutTree: newTree });
    },

    moveTab: (tabId, sourcePanelId, targetPanelId) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;
      if (sourcePanelId === targetPanelId) return;

      const sourcePanel = panelContents.get(sourcePanelId);
      const targetPanel = panelContents.get(targetPanelId);

      if (!sourcePanel || !targetPanel) return;
      if (!sourcePanel.tabIds.includes(tabId)) return;

      // Get the tab metadata from source panel
      const tabMetadata = sourcePanel.metadata?.[tabId];

      // If target already has this tab/object, activate it and only remove from source.
      const existingTargetTabId =
        targetPanel.tabIds.includes(tabId)
          ? tabId
          : tabMetadata?.objectKey
            ? targetPanel.tabIds.find(
                (id) => targetPanel.metadata?.[id]?.objectKey === tabMetadata.objectKey,
              )
            : undefined;

      const newSourceTabs = sourcePanel.tabIds.filter((id) => id !== tabId);
      const newSourceActiveTab =
        sourcePanel.activeTabId === tabId
          ? newSourceTabs[0] || ""
          : sourcePanel.activeTabId;
      const newTargetTabs = existingTargetTabId
        ? targetPanel.tabIds
        : [...targetPanel.tabIds, tabId];

      // Remove metadata from source panel
      const newSourceMetadata = { ...sourcePanel.metadata };
      Reflect.deleteProperty(newSourceMetadata, tabId);

      // Add metadata to target panel
      const targetTabId = existingTargetTabId ?? tabId;
      const existingTargetMetadata = targetPanel.metadata?.[targetTabId];
      const mergedTargetMetadata =
        existingTargetMetadata || tabMetadata
          ? {
              ...(tabMetadata ?? {}),
              ...(existingTargetMetadata ?? {}),
            }
          : undefined;
      const newTargetMetadata = {
        ...targetPanel.metadata,
        ...(mergedTargetMetadata ? { [targetTabId]: mergedTargetMetadata } : {}),
      };

      const newContents = new Map(panelContents);
      newContents.set(sourcePanelId, {
        ...sourcePanel,
        tabIds: newSourceTabs,
        activeTabId: newSourceActiveTab,
        metadata: newSourceMetadata,
      });
      newContents.set(targetPanelId, {
        ...targetPanel,
        tabIds: newTargetTabs,
        activeTabId: targetTabId,
        metadata: newTargetMetadata,
      });

      const updatedTree = updatePanelContents(layoutTree, newContents);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });

      if (newSourceTabs.length === 0) {
        get().closePanelAction(sourcePanelId);
      }
    },

    focusPanel: (panelId) => {
      const { layoutTree } = get();
      const focusStore = usePanelFocusStore.getState();
      const current = focusStore.focusedPanelId;
      // Skip if already focused — avoids unnecessary re-renders of all panels
      if (current === panelId) return;
      // Verify the panel exists in the tree
      if (layoutTree && findNodePath(layoutTree, panelId) !== null) {
        focusStore.focusPanel(panelId);
      } else {
        logger.warn(`Cannot focus panel ${panelId} - not found in tree`);
        if (layoutTree?.type === "leaf" && current !== layoutTree.id) {
          focusStore.focusPanel(layoutTree.id);
        }
      }
    },

    focusAdjacentPanel: (direction) => {
      const { layoutTree } = get();
      const focusStore = usePanelFocusStore.getState();
      const focusedPanelId = focusStore.focusedPanelId;
      if (!layoutTree || !focusedPanelId) return;

      const adjacentId = getAdjacentPanel(
        layoutTree,
        focusedPanelId,
        direction,
      );
      if (adjacentId && adjacentId !== focusedPanelId) {
        focusStore.focusPanel(adjacentId);
      }
    },

    resetLayout: () => {
      get().initializeLayout();
    },

    undo: () => {
      const { layoutHistory, historyIndex, panelContents: currentContents } = get();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        const tree = layoutHistory[newIndex];
        if (tree) {
          const panels = getAllPanels(tree);
          // Preserve existing panel references to avoid unnecessary re-renders
          const contents = new Map(
            panels.map((p) => [p.id, currentContents.get(p.id) ?? p]),
          );

          set({
            layoutTree: tree,
            panelContents: contents,
            historyIndex: newIndex,
          });

          // Sync panelFocusStore: ensure focusedPanelId still exists in restored tree
          const focusStore = usePanelFocusStore.getState();
          if (!contents.has(focusStore.focusedPanelId ?? "")) {
            const firstPanelId = panels[0]?.id;
            if (firstPanelId) {
              focusStore.focusPanel(firstPanelId);
            } else {
              focusStore.clearFocus();
            }
          }
        }
      }
    },

    redo: () => {
      const { layoutHistory, historyIndex, panelContents: currentContents } = get();
      if (historyIndex < layoutHistory.length - 1) {
        const newIndex = historyIndex + 1;
        const tree = layoutHistory[newIndex];
        if (tree) {
          const panels = getAllPanels(tree);
          // Preserve existing panel references to avoid unnecessary re-renders
          const contents = new Map(
            panels.map((p) => [p.id, currentContents.get(p.id) ?? p]),
          );

          set({
            layoutTree: tree,
            panelContents: contents,
            historyIndex: newIndex,
          });

          // Sync panelFocusStore: ensure focusedPanelId still exists in restored tree
          const focusStore = usePanelFocusStore.getState();
          if (!contents.has(focusStore.focusedPanelId ?? "")) {
            const firstPanelId = panels[0]?.id;
            if (firstPanelId) {
              focusStore.focusPanel(firstPanelId);
            } else {
              focusStore.clearFocus();
            }
          }
        }
      }
    },

    addTab: (panelId, tabId, tabData) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      const panel = panelContents.get(panelId);
      if (!panel) return;

      // Check if tab already exists by tabId
      if (panel.tabIds.includes(tabId)) {
        const existingMetadata = panel.metadata?.[tabId];
        const mergedMetadata =
          existingMetadata || tabData
            ? {
                ...(existingMetadata ?? {}),
                ...(tabData ?? {}),
              }
            : undefined;

        const newContents = new Map(panelContents);
        newContents.set(panelId, {
          ...panel,
          activeTabId: tabId,
          metadata: {
            ...panel.metadata,
            ...(mergedMetadata ? { [tabId]: mergedMetadata } : {}),
          },
        });

        const updatedTree = updatePanelContents(layoutTree, newContents);
        set({
          layoutTree: updatedTree,
          panelContents: newContents,
        });
        return;
      }

      // Per-panel dedup by objectKey: reuse existing tab with same logical object
      const incomingObjectKey = tabData?.objectKey;
      if (incomingObjectKey) {
        const existingTabId = panel.tabIds.find((id) => {
          const meta = panel.metadata?.[id];
          return meta?.objectKey === incomingObjectKey;
        });
        if (existingTabId) {
          const existingMetadata = panel.metadata?.[existingTabId];
          const mergedMetadata =
            existingMetadata || tabData
              ? {
                  ...(existingMetadata ?? {}),
                  ...(tabData ?? {}),
                }
              : undefined;

          const newContents = new Map(panelContents);
          newContents.set(panelId, {
            ...panel,
            activeTabId: existingTabId,
            metadata: {
              ...panel.metadata,
              ...(mergedMetadata ? { [existingTabId]: mergedMetadata } : {}),
            },
          });

          const updatedTree = updatePanelContents(layoutTree, newContents);
          set({
            layoutTree: updatedTree,
            panelContents: newContents,
          });
          return;
        }
      }

      const newMetadata =
        tabData !== undefined
          ? {
              ...panel.metadata,
              [tabId]: tabData,
            }
          : panel.metadata;
      const newContents = new Map(panelContents);
      newContents.set(panelId, {
        ...panel,
        tabIds: [...panel.tabIds, tabId],
        activeTabId: tabId,
        metadata: newMetadata,
      });

      const updatedTree = updatePanelContents(layoutTree, newContents);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });
    },

    removeTab: (panelId, tabId) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      const panel = panelContents.get(panelId);
      if (!panel) return;

      const totalPanels = panelContents.size;
      const newTabIds = panel.tabIds.filter((id) => id !== tabId);
      const newActiveTab =
        panel.activeTabId === tabId ? newTabIds[0] || "" : panel.activeTabId;

      const newContents = new Map(panelContents);
      newContents.set(panelId, {
        ...panel,
        tabIds: newTabIds,
        activeTabId: newActiveTab,
      });

      const updatedTree = updatePanelContents(layoutTree, newContents);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });

      // Clear both Zustand and React Query cache for this tab
      const tabMetadata = panel.metadata?.[tabId];
      const connectionId = tabMetadata?.connectionId;
      clearTabCache(tabId, connectionId);

      if (newTabIds.length === 0 && totalPanels > 1) {
        get().closePanelAction(panelId);
      }
    },

    closeAllTabs: () => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      logger.info("[WorkbenchStore] Closing all tabs");

      // Clear cache for all tabs
      panelContents.forEach((panel) => {
        panel.tabIds.forEach((tabId) => {
          const tabMetadata = panel.metadata?.[tabId];
          const connectionId = tabMetadata?.connectionId;
          clearTabCache(tabId, connectionId);
        });
      });

      // Reset to single panel with no tabs
      get().resetLayout();
    },

  clearDatabaseTabs: (connectionId: string, database: string) => {
    const { panelContents, layoutTree } = get();
    if (!layoutTree) return;

    logger.info(`[WorkbenchStore] Clearing tabs for database: ${database}`);

    const newContents = new Map(panelContents);
    let hasChanges = false;

    panelContents.forEach((panel, panelId) => {
      // Find tabs that belong to this database
      const tabsToRemove: string[] = [];
      panel.tabIds.forEach((tabId) => {
        const meta = panel.metadata?.[tabId];
        if (meta?.connectionId === connectionId && meta?.database === database) {
          tabsToRemove.push(tabId);
        }
      });

      if (tabsToRemove.length > 0) {
        hasChanges = true;

        // Clear cache for these tabs
        tabsToRemove.forEach((tabId) => {
          clearTabCache(tabId, connectionId);
        });

        // Remove tabs from panel
        const newTabIds = panel.tabIds.filter((id) => !tabsToRemove.includes(id));
        const newActiveTab =
          tabsToRemove.includes(panel.activeTabId || "")
            ? newTabIds[0] || ""
            : panel.activeTabId;

        newContents.set(panelId, {
          ...panel,
          tabIds: newTabIds,
          activeTabId: newActiveTab,
        });
      }
    });

    if (hasChanges) {
      const updatedTree = updatePanelContents(layoutTree, newContents);
      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });
    }
  },

    setActiveTab: (panelId, tabId) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      const panel = panelContents.get(panelId);
      if (!panel || !panel.tabIds.includes(tabId)) return;

      // Skip update if activeTab is already set to this tab
      if (panel.activeTabId === tabId) return;

      // Create updated panel content
      const updatedPanel = { ...panel, activeTabId: tabId };

      // Update only the changed panel in the Map - reuse existing Map reference
      // by mutating then creating new ref only for the single changed entry
      const newContents = new Map(panelContents);
      newContents.set(panelId, updatedPanel);

      // Update only the affected leaf node in the tree, not full rebuild
      const updatedTree = updateSinglePanel(layoutTree, panelId, updatedPanel);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });

      // Bi-directional sync: Update sidebar focus to match tab's connection
      const tabMeta = panel.metadata?.[tabId];
      if (tabMeta?.connectionId) {
        const bundleStore = useWorkspaceBundleStore.getState();
        const { activeWorkspace, setFocusedConnection } = bundleStore;
        if (activeWorkspace?.connections.has(tabMeta.connectionId)) {
          // Only update if different to avoid loops
          if (activeWorkspace.focusedConnectionId !== tabMeta.connectionId) {
            setFocusedConnection(tabMeta.connectionId);
          }
        }
      }
    },

    updateTabMetadata: (panelId, tabId, updates) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      const panel = panelContents.get(panelId);
      if (!panel) return;

      const panelMetadata: Record<string, TabMetadata | undefined> = {
        ...(panel.metadata ?? {}),
      };

      const currentMetadata = panelMetadata[tabId] ?? {};
      panelMetadata[tabId] = { ...currentMetadata, ...updates };

      const newContents = new Map(panelContents);
      const updatedPanel = {
        ...panel,
        metadata: panelMetadata,
      };
      newContents.set(panelId, updatedPanel);

      // Avoid rebuilding the full tree for frequent metadata updates (e.g. query typing).
      const updatedTree = updateSinglePanel(layoutTree, panelId, updatedPanel);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });
    },

    // Workspace layout persistence methods
    setLayoutTree: (tree) => {
      set({ layoutTree: tree });
    },

    restorePanelContents: (contents) => {
      set({ panelContents: contents });
    },

    // IndexedDB layout persistence
    persistLayout: async (workspaceId) => {
      const { layoutTree, panelContents } = get();
      if (!layoutTree) return;
      try {
        const db = getSessionDatabase();
        await db.workspaceLayouts.put({
          workspaceId,
          layoutTree,
          panelContents: Array.from(panelContents.entries()),
          savedAt: Date.now(),
          lastActiveAt: Date.now(),
        });
      } catch (error) {
        console.error("[workbenchStore] Failed to persist layout:", error);
      }
    },

    loadLayout: async (workspaceId) => {
      try {
        const db = getSessionDatabase();
        const saved = await db.workspaceLayouts.get(workspaceId);
        if (!saved?.layoutTree) return false;

        const panelContentsMap = new Map(saved.panelContents);

        // Validate: collect leaf IDs from tree
        const leafIds = new Set<string>();
        const collectLeafIds = (node: GridNode) => {
          if (node.type === "leaf") leafIds.add(node.id);
          else node.children?.forEach(collectLeafIds);
        };
        collectLeafIds(saved.layoutTree);
        if (leafIds.size === 0) return false;

        set({
          layoutTree: saved.layoutTree,
          panelContents: panelContentsMap,
          layoutHistory: [saved.layoutTree],
          historyIndex: 0,
        });

        // Focus first panel
        const firstPanelId = Array.from(panelContentsMap.keys())[0];
        if (firstPanelId) {
          usePanelFocusStore.getState().focusPanel(firstPanelId);
        }

        return true;
      } catch (error) {
        console.error("[workbenchStore] Failed to load layout:", error);
        return false;
      }
    },

    flushLayout: (workspaceId) => {
      // Fire and forget — best effort on unmount
      get().persistLayout(workspaceId);
    },
  }),
);

function updatePanelContents(
  tree: GridNode,
  contents: Map<string, PanelContent>,
): GridNode {
  if (tree.type === "leaf" && tree.content) {
    const updatedContent = contents.get(tree.content.id);
    if (updatedContent) {
      return { ...tree, content: updatedContent };
    }
  }

  if (tree.type === "branch" && tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        updatePanelContents(child, contents),
      ),
    };
  }

  return tree;
}

// Optimized: Update only a single panel in the tree without rebuilding unchanged nodes
function updateSinglePanel(
  tree: GridNode,
  panelId: string,
  updatedContent: PanelContent,
): GridNode {
  if (tree.type === "leaf") {
    // Only create new object if this is the panel we're updating
    if (tree.content?.id === panelId) {
      return { ...tree, content: updatedContent };
    }
    // Return same reference if not the target panel
    return tree;
  }

  if (tree.type === "branch" && tree.children) {
    // Check if any child needs updating (avoid creating new array if unchanged)
    const updatedChildren = tree.children.map((child) =>
      updateSinglePanel(child, panelId, updatedContent),
    );

    // Only create new branch if children actually changed (reference comparison)
    const hasChanges = updatedChildren.some(
      (child, i) => child !== tree.children![i],
    );

    if (hasChanges) {
      return { ...tree, children: updatedChildren };
    }
  }

  return tree;
}

export default useWorkbenchStore;
