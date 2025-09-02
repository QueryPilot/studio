import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
} from "@/utils/workbenchTree";

interface WorkbenchStore {
  layoutTree: GridNode | null;
  focusedPanelId: string | null;
  panelContents: Map<string, PanelContent>;
  layoutHistory: GridNode[];
  historyIndex: number;
  dragDropContext: DragDropContext;

  initializeLayout: () => void;
  splitPanelAction: (action: SplitAction) => void;
  closePanelAction: (panelId: string) => void;
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
  setActiveTab: (panelId: string, tabId: string) => void;
}

const useWorkbenchStore = create<WorkbenchStore>()(
  persist(
    (set, get) => ({
      layoutTree: null,
      focusedPanelId: null,
      panelContents: new Map(),
      layoutHistory: [],
      historyIndex: -1,
      dragDropContext: {
        draggedTab: null,
        draggedPanel: null,
        dropTarget: null,
        dropPosition: null,
      },

      initializeLayout: () => {
        const defaultPanel = createLeafNode({
          type: "editor",
          tabIds: [],
          activeTabId: "",
        });

        set({
          layoutTree: defaultPanel,
          focusedPanelId: defaultPanel.id,
          panelContents: new Map([[defaultPanel.id, defaultPanel.content!]]),
          layoutHistory: [defaultPanel],
          historyIndex: 0,
        });
      },

      splitPanelAction: (action) => {
        const { layoutTree, layoutHistory, historyIndex } = get();
        if (!layoutTree) return;

        const newTree = splitPanel(
          layoutTree,
          action.targetPanelId,
          action.direction,
          action.newPanelContent,
          action.splitRatio,
        );

        if (newTree) {
          const newHistory = layoutHistory.slice(0, historyIndex + 1);
          newHistory.push(newTree);

          const panels = getAllPanels(newTree);
          const newContents = new Map(panels.map((p) => [p.id, p]));

          set({
            layoutTree: newTree,
            panelContents: newContents,
            layoutHistory: newHistory,
            historyIndex: newHistory.length - 1,
          });
        }
      },

      closePanelAction: (panelId) => {
        const { layoutTree, layoutHistory, historyIndex } = get();
        if (!layoutTree) return;

        const newTree = closePanel(layoutTree, panelId);

        if (newTree) {
          const newHistory = layoutHistory.slice(0, historyIndex + 1);
          newHistory.push(newTree);

          const panels = getAllPanels(newTree);
          const newContents = new Map(panels.map((p) => [p.id, p]));

          set({
            layoutTree: newTree,
            panelContents: newContents,
            layoutHistory: newHistory,
            historyIndex: newHistory.length - 1,
            focusedPanelId: panels[0]?.id || null,
          });
        } else {
          get().initializeLayout();
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
        delete newSourceMetadata[tabId];

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
        set({ focusedPanelId: panelId });
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
        const { layoutTree } = get();
        if (layoutTree) {
          localStorage.setItem(
            "workbench-layout-backup",
            JSON.stringify(layoutTree),
          );
        }
      },

      restoreLayout: () => {
        const saved = localStorage.getItem("workbench-layout-backup");
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
            console.error("Failed to restore layout:", e);
            get().initializeLayout();
          }
        }
      },

      resetLayout: () => {
        get().initializeLayout();
      },

      undo: () => {
        const { layoutHistory, historyIndex } = get();
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          const tree = layoutHistory[newIndex];
          if (tree) {
            const panels = getAllPanels(tree);
            const contents = new Map(panels.map((p) => [p.id, p]));

            set({
              layoutTree: tree,
              panelContents: contents,
              historyIndex: newIndex,
            });
          }
        }
      },

      redo: () => {
        const { layoutHistory, historyIndex } = get();
        if (historyIndex < layoutHistory.length - 1) {
          const newIndex = historyIndex + 1;
          const tree = layoutHistory[newIndex];
          if (tree) {
            const panels = getAllPanels(tree);
            const contents = new Map(panels.map((p) => [p.id, p]));

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

        if (newTabIds.length === 0) {
          get().closePanelAction(panelId);
        }
      },

      setActiveTab: (panelId, tabId) => {
        const { panelContents, layoutTree } = get();
        if (!layoutTree) return;

        const panel = panelContents.get(panelId);
        if (!panel || !panel.tabIds.includes(tabId)) return;

        const newContents = new Map(panelContents);
        newContents.set(panelId, {
          ...panel,
          activeTabId: tabId,
        });

        const updatedTree = updatePanelContents(layoutTree, newContents);

        set({
          layoutTree: updatedTree,
          panelContents: newContents,
        });
      },
    }),
    {
      name: "workbench-layout",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        layoutTree: state.layoutTree,
        panelContents: Array.from(state.panelContents.entries()),
      }),
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.panelContents)) {
          state.panelContents = new Map(state.panelContents);
        }
      },
    },
  ),
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

export default useWorkbenchStore;
