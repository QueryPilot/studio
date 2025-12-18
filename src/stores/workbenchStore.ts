import { logger } from "@/lib/logger";
import { create } from "zustand";

import {
  type GridNode,
  type PanelContent,
  type TabMetadata,
  type SplitAction,
  type Direction,
  type DragDropContext,
} from "@/types/workbench";
import {
  splitPanel,
  closePanel,
  resizePanel,
  createLeafNode,
  getAllPanels,
  getAdjacentPanel,
  findNodePath,
} from "@/utils/workbenchTree";
// import { useTabStateStore } from "./tabStateStore";
import { clearTabCache } from "@/lib/cacheManager";

interface WorkbenchStore {
  layoutTree: GridNode | null;
  focusedPanelId: string | null;
  panelContents: Map<string, PanelContent>;
  layoutHistory: GridNode[];
  historyIndex: number;
  dragDropContext: DragDropContext;
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

  setDragContext: (context: Partial<DragDropContext>) => void;
  clearDragContext: () => void;

  saveLayout: () => void;
  restoreLayout: () => void;
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
}

const useWorkbenchStore = create<WorkbenchStore>()(
  // TEMPORARILY DISABLED PERSIST DUE TO ID MISMATCH ISSUES
  // persist(
  (set, get) => ({
    layoutTree: null,
    focusedPanelId: null,
    panelContents: new Map(),
    layoutHistory: [],
    historyIndex: -1,
    preventAutoInit: false,
    activeConnectionId: null,
    dragDropContext: {
      draggedTab: null,
      draggedPanel: null,
      dropTarget: null,
      dropPosition: null,
    },

    setConnectionId: (connectionId) => {
      const oldConnectionId = get().activeConnectionId;

      // If switching connections, clear old layout
      if (oldConnectionId && oldConnectionId !== connectionId) {
        logger.info(
          `[WorkbenchStore] Switching from ${oldConnectionId} to ${connectionId}`,
        );
        // Save current layout before switching
        get().saveLayout();
      }

      set({ activeConnectionId: connectionId });

      // Initialize layout for new connection
      if (connectionId) {
        logger.info(
          `[WorkbenchStore] Initializing layout for connection: ${connectionId}`,
        );
        get().initializeLayout();
      }
    },

    initializeLayout: () => {
      const { activeConnectionId } = get();
      const layoutKey = activeConnectionId
        ? `workbench-layout-${activeConnectionId}`
        : "workbench-layout";
      const backupKey = activeConnectionId
        ? `workbench-layout-backup-${activeConnectionId}`
        : "workbench-layout-backup";

      // Clear any corrupted state for this connection
      localStorage.removeItem(layoutKey);
      localStorage.removeItem(backupKey);

      const defaultPanel = createLeafNode({
        type: "editor",
        tabIds: [],
        activeTabId: "",
      });

      logger.info("🔄 Initializing fresh layout with panel:", defaultPanel.id);
      logger.info("Panel content ID:", defaultPanel.content?.id);

      // Ensure consistency
      if (defaultPanel.id !== defaultPanel.content?.id) {
        logger.error("❌ ID MISMATCH in createLeafNode!", {
          nodeId: defaultPanel.id,
          contentId: defaultPanel.content?.id,
        });
      }

      if (defaultPanel.content) {
        set({
          layoutTree: defaultPanel,
          focusedPanelId: defaultPanel.id,
          panelContents: new Map([[defaultPanel.id, defaultPanel.content]]),
          layoutHistory: [defaultPanel],
          historyIndex: 0,
        });
      }
    },

    splitPanelAction: (action) => {
      const { layoutTree, layoutHistory, historyIndex } = get();
      if (!layoutTree) {
        logger.error("❌ splitPanelAction: No layout tree");
        return;
      }

      logger.info("🔧 splitPanelAction called:", action);
      const result = splitPanel(
        layoutTree,
        action.targetPanelId,
        action.direction,
        action.newPanelContent,
        action.splitRatio,
      );

      if (result) {
        logger.info("✅ Split successful, new tree created");
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
          focusedPanelId: newPanelId, // Focus the newly created panel
        });
      } else {
        logger.error("❌ splitPanel returned null - split failed!", {
          targetPanelId: action.targetPanelId,
          direction: action.direction,
          layoutTree,
        });
      }
    },

    closePanelAction: (panelId, preventAutoInit = false) => {
      // Note: tabStateStore can be used here for clearing tab state if needed
      // const tabStateStore = useTabStateStore.getState();
      const panel = get().panelContents.get(panelId);
      const tabsToClear = panel ? [...panel.tabIds] : [];

      logger.info("🗑️ [STORE DEBUG] closePanelAction called:", {
        panelId,
        preventAutoInit,
        currentPreventAutoInit: get().preventAutoInit,
      });

      const { layoutTree, layoutHistory, historyIndex } = get();
      if (!layoutTree) {
        logger.info("❌ [STORE DEBUG] No layoutTree, returning early");
        return;
      }

      if (preventAutoInit) {
        logger.info("🚫 [STORE DEBUG] Setting preventAutoInit to true");
        set({ preventAutoInit: true });
      }

      const newTree = closePanel(layoutTree, panelId);
      logger.info("🌳 [STORE DEBUG] closePanel result:", {
        newTreeExists: !!newTree,
        originalPanelCount: get().panelContents.size,
      });

      if (newTree) {
        const newHistory = layoutHistory.slice(0, historyIndex + 1);
        newHistory.push(newTree);

        const panels = getAllPanels(newTree);
        const currentContents = get().panelContents;
        // Preserve existing panel references to avoid unnecessary re-renders
        const newContents = new Map(
          panels.map((p) => [p.id, currentContents.get(p.id) ?? p]),
        );

        logger.info("✅ [STORE DEBUG] Setting new tree with panels:", {
          panelCount: panels.length,
          panelIds: panels.map((p) => p.id),
        });

        set({
          layoutTree: newTree,
          panelContents: newContents,
          layoutHistory: newHistory,
          historyIndex: newHistory.length - 1,
          focusedPanelId: panels[0]?.id || null,
        });
      } else {
        logger.info("🔥 [STORE DEBUG] newTree is null - last panel closed!");
        // Only auto-initialize if not preventing it
        const shouldPreventInit = get().preventAutoInit || preventAutoInit;
        logger.info("🤔 [STORE DEBUG] Should prevent auto-init?", {
          preventAutoInitParam: preventAutoInit,
          storePreventAutoInit: get().preventAutoInit,
          shouldPreventInit,
        });

        if (!shouldPreventInit) {
          logger.info("🔄 [STORE DEBUG] Auto-initializing layout");
          get().initializeLayout();
        } else {
          logger.info(
            "🗑️ [STORE DEBUG] Clearing layout completely (no auto-init)",
          );
          // Clear the layout completely when preventing auto-init
          set({
            layoutTree: null,
            panelContents: new Map(),
            focusedPanelId: null,
          });
        }
      }

      // Log final state
      const finalState = get();
      logger.info("📊 [STORE DEBUG] Final state after closePanelAction:", {
        layoutTreeExists: !!finalState.layoutTree,
        panelCount: finalState.panelContents.size,
        focusedPanelId: finalState.focusedPanelId,
        preventAutoInit: finalState.preventAutoInit,
      });

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

      const sourcePanel = panelContents.get(sourcePanelId);
      const targetPanel = panelContents.get(targetPanelId);

      if (!sourcePanel || !targetPanel) return;

      // Get the tab metadata from source panel
      const tabMetadata = sourcePanel.metadata?.[tabId];

      const newSourceTabs = sourcePanel.tabIds.filter((id) => id !== tabId);
      const newTargetTabs = [...targetPanel.tabIds, tabId];

      // Remove metadata from source panel
      const newSourceMetadata = { ...sourcePanel.metadata };
      Reflect.deleteProperty(newSourceMetadata, tabId);

      // Add metadata to target panel
      const newTargetMetadata = {
        ...targetPanel.metadata,
        ...(tabMetadata ? { [tabId]: tabMetadata } : {}),
      };

      const newContents = new Map(panelContents);
      newContents.set(sourcePanelId, {
        ...sourcePanel,
        tabIds: newSourceTabs,
        activeTabId: newSourceTabs[0] || "",
        metadata: newSourceMetadata,
      });
      newContents.set(targetPanelId, {
        ...targetPanel,
        tabIds: newTargetTabs,
        activeTabId: tabId,
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
      // Verify the panel exists in the tree
      if (layoutTree && findNodePath(layoutTree, panelId) !== null) {
        set({ focusedPanelId: panelId });
      } else {
        logger.warn(
          `❌ Cannot focus panel ${panelId} - not found in tree. Tree ID: ${layoutTree?.id}`,
        );
        // If we can't find the panel, focus the tree root if it's a leaf
        if (layoutTree?.type === "leaf") {
          logger.info(`🔄 Auto-focusing root panel: ${layoutTree.id}`);
          set({ focusedPanelId: layoutTree.id });
        }
      }
    },

    focusAdjacentPanel: (direction) => {
      const { layoutTree, focusedPanelId } = get();
      if (!layoutTree || !focusedPanelId) return;

      const adjacentId = getAdjacentPanel(
        layoutTree,
        focusedPanelId,
        direction,
      );
      if (adjacentId) {
        set({ focusedPanelId: adjacentId });
      }
    },

    setDragContext: (context) => {
      set((state) => ({
        dragDropContext: { ...state.dragDropContext, ...context },
      }));
    },

    clearDragContext: () => {
      set({
        dragDropContext: {
          draggedTab: null,
          draggedPanel: null,
          dropTarget: null,
          dropPosition: null,
        },
      });
    },

    saveLayout: () => {
      const { layoutTree, activeConnectionId } = get();
      if (layoutTree) {
        const backupKey = activeConnectionId
          ? `workbench-layout-backup-${activeConnectionId}`
          : "workbench-layout-backup";
        localStorage.setItem(backupKey, JSON.stringify(layoutTree));
      }
    },

    restoreLayout: () => {
      const { activeConnectionId } = get();
      const backupKey = activeConnectionId
        ? `workbench-layout-backup-${activeConnectionId}`
        : "workbench-layout-backup";
      const saved = localStorage.getItem(backupKey);
      if (saved) {
        try {
          const tree = JSON.parse(saved) as GridNode;
          const panels = getAllPanels(tree);
          const contents = new Map(panels.map((p) => [p.id, p]));

          set({
            layoutTree: tree,
            panelContents: contents,
            focusedPanelId: panels[0]?.id || null,
          });
        } catch (e) {
          logger.error("Failed to restore layout:", e);
          get().initializeLayout();
        }
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
        }
      }
    },

    addTab: (panelId, tabId, tabData) => {
      const { panelContents, layoutTree } = get();
      if (!layoutTree) return;

      const panel = panelContents.get(panelId);
      if (!panel) return;

      // Check if tab already exists
      if (panel.tabIds.includes(tabId)) {
        const newContents = new Map(panelContents);
        newContents.set(panelId, {
          ...panel,
          activeTabId: tabId,
          metadata: { ...panel.metadata, [tabId]: tabData },
        });

        const updatedTree = updatePanelContents(layoutTree, newContents);
        set({
          layoutTree: updatedTree,
          panelContents: newContents,
        });
        return;
      }

      const newContents = new Map(panelContents);
      newContents.set(panelId, {
        ...panel,
        tabIds: [...panel.tabIds, tabId],
        activeTabId: tabId,
        metadata: { ...panel.metadata, [tabId]: tabData },
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
      newContents.set(panelId, {
        ...panel,
        metadata: panelMetadata,
      });

      const updatedTree = updatePanelContents(layoutTree, newContents);

      set({
        layoutTree: updatedTree,
        panelContents: newContents,
      });
    },
  }),
  // PERSIST DISABLED - REMOVE COMMENTS TO RE-ENABLE
  // ,{
  //   name: "workbench-layout",
  //   storage: createJSONStorage(() => localStorage),
  //   partialize: (state) => ({
  //     layoutTree: state.layoutTree,
  //     panelContents: Array.from(state.panelContents.entries()),
  //   }),
  //   onRehydrateStorage: () => (state) => {
  //     if (state) {
  //       // Convert array back to Map if needed
  //       if (Array.isArray(state.panelContents)) {
  //         state.panelContents = new Map(state.panelContents);
  //       }
  //
  //       // CRITICAL: Ensure panelContents is synced with layoutTree
  //       if (state.layoutTree) {
  //         const panels = getAllPanels(state.layoutTree);
  //         const syncedContents = new Map(panels.map(p => [p.id, p]));
  //
  //         // Check for mismatches
  //         const treeIds = panels.map(p => p.id).sort();
  //         const mapIds = Array.from(state.panelContents.keys()).sort();
  //
  //         if (JSON.stringify(treeIds) !== JSON.stringify(mapIds)) {
  //           logger.error('❌ CRITICAL: Panel ID mismatch detected!', {
  //             treeIds,
  //             mapIds
  //           });
  //
  //           // Force complete reset on mismatch
  //           logger.info('🔄 Forcing fresh initialization due to ID mismatch');
  //           localStorage.removeItem('workbench-layout');
  //           localStorage.removeItem('workbench-layout-backup');
  //
  //           // Create fresh panel
  //           const freshPanel = createLeafNode({
  //             type: "editor",
  //             tabIds: [],
  //             activeTabId: "",
  //           });
  //
  //           state.layoutTree = freshPanel;
  //           state.panelContents = new Map([[freshPanel.id, freshPanel.content!]]);
  //           state.focusedPanelId = freshPanel.id;
  //           state.layoutHistory = [freshPanel];
  //           state.historyIndex = 0;
  //
  //           logger.info('✅ Fresh state initialized with panel:', freshPanel.id);
  //           return;
  //         }
  //
  //         // Update focusedPanelId if it's invalid
  //         if (state.focusedPanelId && !syncedContents.has(state.focusedPanelId)) {
  //           state.focusedPanelId = panels[0]?.id || null;
  //           logger.info('🔄 Reset focusedPanelId to:', state.focusedPanelId);
  //         }
  //       }
  //     }
  //   },
  // },
  // ),
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
