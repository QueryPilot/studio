import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { 
  WorkspaceScreenState, 
  PanelState, 
  TabState 
} from "@/types/workspaceScreen";

interface WorkspaceScreenStore extends WorkspaceScreenState {
  // Panel operations
  splitPanel: (direction: "horizontal" | "vertical") => void;
  unsplitPanel: () => void;
  setActivePanel: (panelId: string) => void;
  
  // Tab operations (panel-aware)
  addTab: (panelId: string, tab: Partial<TabState>) => string;
  closeTab: (tabId: string, panelId: string) => void;
  moveTab: (tabId: string, fromPanelId: string, toPanelId: string) => void;
  
  // Tab state within panel
  setActiveTab: (panelId: string, tabId: string) => void;
  updateTab: (panelId: string, tabId: string, updates: Partial<TabState>) => void;
  
  // Sidebar toggles
  toggleSidebar: (side: "left" | "right") => void;
  
  // Window management
  registerWindow: (connectionId: string, windowLabel: string) => void;
  unregisterWindow: (connectionId: string) => void;
  
  // Initialize workspace
  initWorkspace: (connectionId: string) => void;
}

export const useWorkspaceScreenStore = create<WorkspaceScreenStore>((set, get) => ({
  // Initial state
  activeWorkspaceId: "",
  windows: new Map(),
  panels: new Map(),
  activePanelId: "",
  splitMode: "none",
  splitPosition: 0.5,
  sidebars: {
    left: true,
    right: false,
  },

  // Initialize workspace
  initWorkspace: (connectionId) => {
    const primaryPanelId = uuidv4();
    const primaryPanel: PanelState = {
      id: primaryPanelId,
      type: "primary",
      tabs: new Map(),
      tabOrder: [],
      activeTabId: null,
    };

    // Create a default query tab
    const defaultTabId = uuidv4();
    const defaultTab: TabState = {
      id: defaultTabId,
      type: "query",
      connectionId,
      panelId: primaryPanelId,
      title: "New Query",
      payload: { sql: "" },
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
    };

    primaryPanel.tabs.set(defaultTabId, defaultTab);
    primaryPanel.tabOrder.push(defaultTabId);
    primaryPanel.activeTabId = defaultTabId;

    set({
      panels: new Map([[primaryPanelId, primaryPanel]]),
      activePanelId: primaryPanelId,
    });
  },

  // Panel operations
  splitPanel: (direction) => {
    const state = get();
    const primaryPanel = Array.from(state.panels.values()).find(p => p.type === "primary");
    
    if (!primaryPanel || !primaryPanel.activeTabId) return;

    const secondaryPanelId = uuidv4();
    const secondaryPanel: PanelState = {
      id: secondaryPanelId,
      type: "secondary",
      tabs: new Map(),
      tabOrder: [],
      activeTabId: null,
    };

    // Move active tab to secondary panel
    const activeTab = primaryPanel.tabs.get(primaryPanel.activeTabId);
    if (activeTab) {
      const movedTab = { ...activeTab, panelId: secondaryPanelId };
      secondaryPanel.tabs.set(activeTab.id, movedTab);
      secondaryPanel.tabOrder.push(activeTab.id);
      secondaryPanel.activeTabId = activeTab.id;

      // Remove from primary panel
      primaryPanel.tabs.delete(activeTab.id);
      primaryPanel.tabOrder = primaryPanel.tabOrder.filter(id => id !== activeTab.id);
      primaryPanel.activeTabId = primaryPanel.tabOrder[0] || null;
    }

    const newPanels = new Map(state.panels);
    newPanels.set(primaryPanel.id, primaryPanel);
    newPanels.set(secondaryPanelId, secondaryPanel);

    set({
      panels: newPanels,
      splitMode: direction,
      activePanelId: secondaryPanelId,
    });
  },

  unsplitPanel: () => {
    const state = get();
    const primaryPanel = Array.from(state.panels.values()).find(p => p.type === "primary");
    const secondaryPanel = Array.from(state.panels.values()).find(p => p.type === "secondary");

    if (!primaryPanel || !secondaryPanel) return;

    // Move all tabs from secondary to primary
    secondaryPanel.tabs.forEach((tab) => {
      const movedTab = { ...tab, panelId: primaryPanel.id };
      primaryPanel.tabs.set(tab.id, movedTab);
      primaryPanel.tabOrder.push(tab.id);
    });

    const newPanels = new Map();
    newPanels.set(primaryPanel.id, primaryPanel);

    set({
      panels: newPanels,
      splitMode: "none",
      activePanelId: primaryPanel.id,
    });
  },

  setActivePanel: (panelId) => set({ activePanelId: panelId }),

  // Tab operations
  addTab: (panelId, tabData) => {
    const state = get();
    const panel = state.panels.get(panelId);
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

    const newPanels = new Map(state.panels);
    newPanels.set(panelId, panel);
    
    set({ panels: newPanels });
    return tabId;
  },

  closeTab: (tabId, panelId) => {
    const state = get();
    const panel = state.panels.get(panelId);
    if (!panel) return;

    panel.tabs.delete(tabId);
    panel.tabOrder = panel.tabOrder.filter(id => id !== tabId);
    
    if (panel.activeTabId === tabId) {
      panel.activeTabId = panel.tabOrder[0] || null;
    }

    // If secondary panel has no tabs, unsplit
    if (panel.type === "secondary" && panel.tabs.size === 0) {
      get().unsplitPanel();
    } else {
      const newPanels = new Map(state.panels);
      newPanels.set(panelId, panel);
      set({ panels: newPanels });
    }
  },

  moveTab: (tabId, fromPanelId, toPanelId) => {
    const state = get();
    const fromPanel = state.panels.get(fromPanelId);
    const toPanel = state.panels.get(toPanelId);
    
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

    const newPanels = new Map(state.panels);
    newPanels.set(fromPanelId, fromPanel);
    newPanels.set(toPanelId, toPanel);
    
    set({ panels: newPanels, activePanelId: toPanelId });
  },

  setActiveTab: (panelId, tabId) => {
    const state = get();
    const panel = state.panels.get(panelId);
    if (!panel || !panel.tabs.has(tabId)) return;

    panel.activeTabId = tabId;
    const newPanels = new Map(state.panels);
    newPanels.set(panelId, panel);
    
    set({ panels: newPanels });
  },

  updateTab: (panelId, tabId, updates) => {
    const state = get();
    const panel = state.panels.get(panelId);
    if (!panel) return;

    const tab = panel.tabs.get(tabId);
    if (!tab) return;

    const updatedTab = { ...tab, ...updates, lastAccessedAt: new Date() };
    panel.tabs.set(tabId, updatedTab);

    const newPanels = new Map(state.panels);
    newPanels.set(panelId, panel);
    
    set({ panels: newPanels });
  },

  // Sidebar toggles
  toggleSidebar: (side) => set((state) => ({
    sidebars: {
      ...state.sidebars,
      [side]: !state.sidebars[side],
    },
  })),

  // Window management
  registerWindow: (connectionId, windowLabel) => set((state) => {
    const newWindows = new Map(state.windows);
    newWindows.set(connectionId, windowLabel);
    return { windows: newWindows };
  }),

  unregisterWindow: (connectionId) => set((state) => {
    const newWindows = new Map(state.windows);
    newWindows.delete(connectionId);
    return { windows: newWindows };
  }),
}));