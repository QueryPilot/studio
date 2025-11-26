import { logger } from "@/lib/logger";
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { PanelState, TabState } from "@/types/workspaceScreen";

interface PanelStore {
  panels: Map<string, PanelState>;
  activePanelId: string;
  splitMode: "none" | "horizontal" | "vertical";
  splitPosition: number;

  // Panel operations
  createPanel: (type: "primary" | "secondary") => string;
  removePanel: (panelId: string) => void;
  setActivePanel: (panelId: string) => void;
  setSplitMode: (mode: "none" | "horizontal" | "vertical") => void;
  setSplitPosition: (position: number) => void;

  // Tab operations within panels
  addTabToPanel: (panelId: string, tab: Partial<TabState>) => string;
  removeTabFromPanel: (panelId: string, tabId: string) => void;
  setActiveTabInPanel: (panelId: string, tabId: string) => void;
  updateTabInPanel: (
    panelId: string,
    tabId: string,
    updates: Partial<TabState>,
  ) => void;
  moveTabBetweenPanels: (
    tabId: string,
    fromPanelId: string,
    toPanelId: string,
  ) => void;
  reorderTabInPanel: (panelId: string, tabId: string, newIndex: number) => void;

  // Getters
  getPrimaryPanel: () => PanelState | undefined;
  getSecondaryPanel: () => PanelState | undefined;
  getPanel: (panelId: string) => PanelState | undefined;
  getCurrentTab: () => TabState | undefined;
  updateTabUI: (tabId: string, uiUpdates: Partial<TabState["ui"]>) => void;

  // Initialize
  initialize: (connectionId: string) => void;
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  panels: new Map(),
  activePanelId: "",
  splitMode: "none",
  splitPosition: 0.5,

  createPanel: (type) => {
    logger.info("🆕 Creating new panel of type:", type);
    const panelId = uuidv4();
    const panel: PanelState = {
      id: panelId,
      type,
      tabs: new Map(),
      tabOrder: [],
      activeTabId: null,
    };

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      logger.info("✅ Panel created with ID:", panelId);
      logger.info("📊 Total panels now:", newPanels.size);
      return { panels: newPanels };
    });

    return panelId;
  },

  removePanel: (panelId) => {
    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.delete(panelId);

      // If removing active panel, set another as active
      if (state.activePanelId === panelId && newPanels.size > 0) {
        const firstPanel = Array.from(newPanels.values())[0];
        return {
          panels: newPanels,
          activePanelId: firstPanel?.id || "",
        };
      }

      return { panels: newPanels };
    });
  },

  setActivePanel: (panelId) => {
    set({ activePanelId: panelId });
  },

  setSplitMode: (mode) => {
    set({ splitMode: mode });
  },

  setSplitPosition: (position) => {
    set({ splitPosition: Math.max(0.2, Math.min(0.8, position)) });
  },

  addTabToPanel: (panelId, tabData) => {
    const panel = get().panels.get(panelId);
    if (!panel) return "";

    const tabId = uuidv4();
    const newTab: TabState = {
      id: tabId,
      type: "query",
      connectionId: "",
      panelId,
      title: "New Tab",
      payload: {},
      ui: {
        scrollTop: 0,
        scrollLeft: 0,
        columnWidths: {},
        selectedRows: new Set(),
        expandedRows: new Set(),
        hiddenColumns: new Set(),
        columnOrder: [],
      },
      isDirty: false,
      isLoading: false,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      ...tabData,
    };

    // Create new panel to avoid mutations
    const newPanel = {
      ...panel,
      tabs: new Map(panel.tabs),
      tabOrder: [...panel.tabOrder, tabId],
      activeTabId: tabId,
    };
    newPanel.tabs.set(tabId, newTab);

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, newPanel);
      return { panels: newPanels };
    });

    return tabId;
  },

  removeTabFromPanel: (panelId, tabId) => {
    const panel = get().panels.get(panelId);
    if (!panel) return;

    const newTabs = new Map(panel.tabs);
    newTabs.delete(tabId);
    const newTabOrder = panel.tabOrder.filter((id) => id !== tabId);
    const newActiveTabId = panel.activeTabId === tabId ? (newTabOrder[0] || null) : panel.activeTabId;

    // If this is a secondary panel and it has no more tabs, remove it
    if (panel.type === "secondary" && newTabOrder.length === 0) {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.delete(panelId);
        return {
          panels: newPanels,
          splitMode: "none",
        };
      });
    } else {
      const newPanel = {
        ...panel,
        tabs: newTabs,
        tabOrder: newTabOrder,
        activeTabId: newActiveTabId,
      };

      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.set(panelId, newPanel);
        return { panels: newPanels };
      });
    }
  },

  setActiveTabInPanel: (panelId, tabId) => {
    const panel = get().panels.get(panelId);
    if (!panel || !panel.tabs.has(tabId)) return;

    const newPanel = {
      ...panel,
      activeTabId: tabId,
    };

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, newPanel);
      return { panels: newPanels };
    });
  },

  updateTabInPanel: (panelId, tabId, updates) => {
    const panel = get().panels.get(panelId);
    if (!panel) return;

    const tab = panel.tabs.get(tabId);
    if (!tab) return;

    const updatedTab = { ...tab, ...updates, lastAccessedAt: new Date() };
    
    // Create new panel with updated tab to avoid mutations
    const newPanel = {
      ...panel,
      tabs: new Map(panel.tabs),
    };
    newPanel.tabs.set(tabId, updatedTab);

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, newPanel);
      return { panels: newPanels };
    });
  },

  moveTabBetweenPanels: (tabId, fromPanelId, toPanelId) => {
    logger.info("🔄 moveTabBetweenPanels called:", {
      tabId,
      fromPanelId,
      toPanelId,
    });

    const fromPanel = get().panels.get(fromPanelId);
    const toPanel = get().panels.get(toPanelId);

    logger.info("📋 Panels found:", {
      fromPanel: fromPanel?.id,
      toPanel: toPanel?.id,
      fromPanelTabs: fromPanel ? Array.from(fromPanel.tabs.keys()) : [],
      toPanelTabs: toPanel ? Array.from(toPanel.tabs.keys()) : [],
    });

    if (!fromPanel || !toPanel) {
      logger.info("❌ Missing panels for move operation");
      return;
    }

    const tab = fromPanel.tabs.get(tabId);
    if (!tab) {
      logger.info("❌ Tab not found in source panel:", tabId);
      return;
    }

    logger.info("✅ Moving tab:", tab.title);

    // Update tab's panel reference
    const movedTab = { ...tab, panelId: toPanelId };

    // Create new panels to avoid mutations
    const newFromPanelTabs = new Map(fromPanel.tabs);
    newFromPanelTabs.delete(tabId);
    const newFromPanelTabOrder = fromPanel.tabOrder.filter((id) => id !== tabId);
    const newFromPanel = {
      ...fromPanel,
      tabs: newFromPanelTabs,
      tabOrder: newFromPanelTabOrder,
      activeTabId: fromPanel.activeTabId === tabId ? (newFromPanelTabOrder[0] || null) : fromPanel.activeTabId,
    };

    const newToPanelTabs = new Map(toPanel.tabs);
    newToPanelTabs.set(tabId, movedTab);
    const newToPanel = {
      ...toPanel,
      tabs: newToPanelTabs,
      tabOrder: [...toPanel.tabOrder, tabId],
      activeTabId: tabId,
    };

    // Check if source panel is empty and is secondary
    if (fromPanel.type === "secondary" && newFromPanelTabOrder.length === 0) {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.delete(fromPanelId);
        newPanels.set(toPanelId, newToPanel);
        return {
          panels: newPanels,
          activePanelId: toPanelId,
          splitMode: "none",
        };
      });
    } else {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.set(fromPanelId, newFromPanel);
        newPanels.set(toPanelId, newToPanel);
        return {
          panels: newPanels,
          activePanelId: toPanelId,
        };
      });
    }
  },

  reorderTabInPanel: (panelId, tabId, newIndex) => {
    const panel = get().panels.get(panelId);
    if (!panel) return;

    const oldIndex = panel.tabOrder.indexOf(tabId);
    if (oldIndex === -1) return;

    // Create new tab order array to avoid mutations
    const newTabOrder = [...panel.tabOrder];
    // Remove from old position
    newTabOrder.splice(oldIndex, 1);
    // Insert at new position
    newTabOrder.splice(newIndex, 0, tabId);

    const newPanel = {
      ...panel,
      tabOrder: newTabOrder,
    };

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, newPanel);
      return { panels: newPanels };
    });
  },

  getPrimaryPanel: () => {
    return Array.from(get().panels.values()).find((p) => p.type === "primary");
  },

  getSecondaryPanel: () => {
    return Array.from(get().panels.values()).find(
      (p) => p.type === "secondary",
    );
  },

  getPanel: (panelId) => {
    return get().panels.get(panelId);
  },

  getCurrentTab: () => {
    const { panels, activePanelId } = get();
    const activePanel = panels.get(activePanelId);
    if (!activePanel || !activePanel.activeTabId) return undefined;
    return activePanel.tabs.get(activePanel.activeTabId);
  },

  updateTabUI: (tabId, uiUpdates) => {
    const { panels } = get();

    // Find the panel containing this tab
    for (const [panelId, panel] of panels) {
      const tab = panel.tabs.get(tabId);
      if (tab) {
        const updatedTab = {
          ...tab,
          ui: { ...tab.ui, ...uiUpdates },
          lastAccessedAt: new Date()
        };

        const newPanel = {
          ...panel,
          tabs: new Map(panel.tabs)
        };
        newPanel.tabs.set(tabId, updatedTab);

        set((state) => {
          const newPanels = new Map(state.panels);
          newPanels.set(panelId, newPanel);
          return { panels: newPanels };
        });
        break;
      }
    }
  },

  initialize: (connectionId) => {
    const primaryPanelId = get().createPanel("primary");

    // Create a default query tab
    get().addTabToPanel(primaryPanelId, {
      type: "query",
      connectionId,
      title: "New Query",
      payload: { sql: "" },
    });

    set({
      activePanelId: primaryPanelId,
      splitMode: "none",
    });
  },
}));
