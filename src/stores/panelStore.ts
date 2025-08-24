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
  updateTabInPanel: (panelId: string, tabId: string, updates: Partial<TabState>) => void;
  moveTabBetweenPanels: (tabId: string, fromPanelId: string, toPanelId: string) => void;
  reorderTabInPanel: (panelId: string, tabId: string, newIndex: number) => void;
  
  // Getters
  getPrimaryPanel: () => PanelState | undefined;
  getSecondaryPanel: () => PanelState | undefined;
  getPanel: (panelId: string) => PanelState | undefined;
  
  // Initialize
  initialize: (connectionId: string) => void;
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  panels: new Map(),
  activePanelId: "",
  splitMode: "none",
  splitPosition: 0.5,

  createPanel: (type) => {
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

  setActivePanel: (panelId) => set({ activePanelId: panelId }),
  
  setSplitMode: (mode) => set({ splitMode: mode }),
  
  setSplitPosition: (position) => set({ splitPosition: Math.max(0.2, Math.min(0.8, position)) }),

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

    panel.tabs.set(tabId, newTab);
    panel.tabOrder.push(tabId);
    panel.activeTabId = tabId;

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      return { panels: newPanels };
    });

    return tabId;
  },

  removeTabFromPanel: (panelId, tabId) => {
    const panel = get().panels.get(panelId);
    if (!panel) return;

    panel.tabs.delete(tabId);
    panel.tabOrder = panel.tabOrder.filter(id => id !== tabId);
    
    if (panel.activeTabId === tabId) {
      panel.activeTabId = panel.tabOrder[0] || null;
    }

    // If this is a secondary panel and it has no more tabs, remove it
    if (panel.type === "secondary" && panel.tabOrder.length === 0) {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.delete(panelId);
        return { 
          panels: newPanels,
          splitMode: "none",
        };
      });
    } else {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.set(panelId, panel);
        return { panels: newPanels };
      });
    }
  },

  setActiveTabInPanel: (panelId, tabId) => {
    const panel = get().panels.get(panelId);
    if (!panel || !panel.tabs.has(tabId)) return;

    panel.activeTabId = tabId;

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      return { panels: newPanels };
    });
  },

  updateTabInPanel: (panelId, tabId, updates) => {
    const panel = get().panels.get(panelId);
    if (!panel) return;

    const tab = panel.tabs.get(tabId);
    if (!tab) return;

    const updatedTab = { ...tab, ...updates, lastAccessedAt: new Date() };
    panel.tabs.set(tabId, updatedTab);

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      return { panels: newPanels };
    });
  },

  moveTabBetweenPanels: (tabId, fromPanelId, toPanelId) => {
    const fromPanel = get().panels.get(fromPanelId);
    const toPanel = get().panels.get(toPanelId);
    
    if (!fromPanel || !toPanel) return;

    const tab = fromPanel.tabs.get(tabId);
    if (!tab) return;

    // Update tab's panel reference
    const movedTab = { ...tab, panelId: toPanelId };
    
    // Remove from source panel
    fromPanel.tabs.delete(tabId);
    fromPanel.tabOrder = fromPanel.tabOrder.filter(id => id !== tabId);
    if (fromPanel.activeTabId === tabId) {
      fromPanel.activeTabId = fromPanel.tabOrder[0] || null;
    }

    // Add to target panel
    toPanel.tabs.set(tabId, movedTab);
    toPanel.tabOrder.push(tabId);
    toPanel.activeTabId = tabId;

    // Check if source panel is empty and is secondary
    if (fromPanel.type === "secondary" && fromPanel.tabOrder.length === 0) {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.delete(fromPanelId);
        newPanels.set(toPanelId, toPanel);
        return { 
          panels: newPanels, 
          activePanelId: toPanelId,
          splitMode: "none",
        };
      });
    } else {
      set((state) => {
        const newPanels = new Map(state.panels);
        newPanels.set(fromPanelId, fromPanel);
        newPanels.set(toPanelId, toPanel);
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

    // Remove from old position
    panel.tabOrder.splice(oldIndex, 1);
    // Insert at new position
    panel.tabOrder.splice(newIndex, 0, tabId);

    set((state) => {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      return { panels: newPanels };
    });
  },

  getPrimaryPanel: () => {
    return Array.from(get().panels.values()).find(p => p.type === "primary");
  },

  getSecondaryPanel: () => {
    return Array.from(get().panels.values()).find(p => p.type === "secondary");
  },

  getPanel: (panelId) => {
    return get().panels.get(panelId);
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