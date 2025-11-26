import { logger } from "@/lib/logger";
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type {
  PanelState,
  TabState,
} from "@/types/workspaceScreen";

// Per-connection workspace state
interface ConnectionWorkspace {
  panels: Map<string, PanelState>;
  activePanelId: string;
  splitMode: "none" | "horizontal" | "vertical";
  splitPosition: number;
  sidebars: {
    left: boolean;
    right: boolean;
  };
}

interface WorkspaceScreenStore {
  // NEW: Connection-scoped workspaces
  workspaces: Map<string, ConnectionWorkspace>;
  activeConnectionId: string | null;

  // Legacy for backward compatibility
  activeWorkspaceId: string | null;
  windows: Map<string, string>;

  // Connection management
  setActiveConnection: (connectionId: string | null) => void;
  clearWorkspace: (connectionId: string) => void;

  // Panel operations (connection-aware)
  splitPanel: (direction: "horizontal" | "vertical") => void;
  unsplitPanel: () => void;
  setActivePanel: (panelId: string) => void;

  // Tab operations (connection-aware, panel-aware)
  addTab: (panelId: string, tab: Partial<TabState>) => string;
  closeTab: (tabId: string, panelId: string) => void;
  moveTab: (tabId: string, fromPanelId: string, toPanelId: string) => void;

  // Tab state within panel
  setActiveTab: (panelId: string, tabId: string) => void;
  updateTab: (
    panelId: string,
    tabId: string,
    updates: Partial<TabState>,
  ) => void;

  // Sidebar toggles
  toggleSidebar: (side: "left" | "right") => void;

  // Window management
  registerWindow: (connectionId: string, windowLabel: string) => void;
  unregisterWindow: (connectionId: string) => void;

  // Initialize workspace
  initWorkspace: (connectionId: string) => void;

  // Getters (connection-aware)
  getPanels: () => Map<string, PanelState>;
  getActivePanelId: () => string;
  getSplitMode: () => "none" | "horizontal" | "vertical";
  getSplitPosition: () => number;
  getSidebars: () => { left: boolean; right: boolean };
}

function createDefaultWorkspace(connectionId: string): ConnectionWorkspace {
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

  return {
    panels: new Map([[primaryPanelId, primaryPanel]]),
    activePanelId: primaryPanelId,
    splitMode: "none",
    splitPosition: 0.5,
    sidebars: {
      left: true,
      right: false,
    },
  };
}

export const useWorkspaceScreenStore = create<WorkspaceScreenStore>(
  (set, get) => ({
    // Initial state
    workspaces: new Map(),
    activeConnectionId: null,
    activeWorkspaceId: null,
    windows: new Map(),

    // Connection management
    setActiveConnection: (connectionId) => {
      logger.info(`[WorkspaceStore] Switching to connection: ${connectionId}`);
      set({ activeConnectionId: connectionId });

      // Initialize workspace if it doesn't exist
      if (connectionId && !get().workspaces.has(connectionId)) {
        logger.info(`[WorkspaceStore] Initializing workspace for: ${connectionId}`);
        get().initWorkspace(connectionId);
      }
    },

    clearWorkspace: (connectionId) => {
      logger.info(`[WorkspaceStore] Clearing workspace for: ${connectionId}`);
      set((state) => {
        const newWorkspaces = new Map(state.workspaces);
        newWorkspaces.delete(connectionId);
        return { workspaces: newWorkspaces };
      });
    },

    // Initialize workspace
    initWorkspace: (connectionId) => {
      logger.info(`[WorkspaceStore] Creating new workspace for: ${connectionId}`);
      set((state) => {
        const newWorkspaces = new Map(state.workspaces);
        newWorkspaces.set(connectionId, createDefaultWorkspace(connectionId));
        return { workspaces: newWorkspaces };
      });
    },

    // Getters (connection-aware)
    getPanels: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return new Map();
      const workspace = workspaces.get(activeConnectionId);
      return workspace?.panels || new Map();
    },

    getActivePanelId: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return "";
      const workspace = workspaces.get(activeConnectionId);
      return workspace?.activePanelId || "";
    },

    getSplitMode: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return "none";
      const workspace = workspaces.get(activeConnectionId);
      return workspace?.splitMode || "none";
    },

    getSplitPosition: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return 0.5;
      const workspace = workspaces.get(activeConnectionId);
      return workspace?.splitPosition || 0.5;
    },

    getSidebars: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return { left: true, right: false };
      const workspace = workspaces.get(activeConnectionId);
      return workspace?.sidebars || { left: true, right: false };
    },

    // Panel operations (connection-aware)
    splitPanel: (direction) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const primaryPanel = Array.from(workspace.panels.values()).find(
        (p) => p.type === "primary",
      );

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
        primaryPanel.tabOrder = primaryPanel.tabOrder.filter(
          (id) => id !== activeTab.id,
        );
        primaryPanel.activeTabId = primaryPanel.tabOrder[0] || null;
      }

      const newPanels = new Map(workspace.panels);
      newPanels.set(primaryPanel.id, primaryPanel);
      newPanels.set(secondaryPanelId, secondaryPanel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
        splitMode: direction,
        activePanelId: secondaryPanelId,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    unsplitPanel: () => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const primaryPanel = Array.from(workspace.panels.values()).find(
        (p) => p.type === "primary",
      );
      const secondaryPanel = Array.from(workspace.panels.values()).find(
        (p) => p.type === "secondary",
      );

      if (!primaryPanel || !secondaryPanel) return;

      // Move all tabs from secondary to primary
      secondaryPanel.tabs.forEach((tab) => {
        const movedTab = { ...tab, panelId: primaryPanel.id };
        primaryPanel.tabs.set(tab.id, movedTab);
        primaryPanel.tabOrder.push(tab.id);
      });

      const newPanels = new Map();
      newPanels.set(primaryPanel.id, primaryPanel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
        splitMode: "none",
        activePanelId: primaryPanel.id,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    setActivePanel: (panelId) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        activePanelId: panelId,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    // Tab operations (connection-aware)
    addTab: (panelId, tabData) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return "";

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return "";

      const panel = workspace.panels.get(panelId);
      if (!panel) return "";

      const tabId = uuidv4();
      const newTab: TabState = {
        id: tabId,
        type: "query",
        connectionId: activeConnectionId,
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

      const newPanels = new Map(workspace.panels);
      newPanels.set(panelId, panel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });

      return tabId;
    },

    closeTab: (tabId, panelId) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const panel = workspace.panels.get(panelId);
      if (!panel) return;

      panel.tabs.delete(tabId);
      panel.tabOrder = panel.tabOrder.filter((id) => id !== tabId);

      if (panel.activeTabId === tabId) {
        panel.activeTabId = panel.tabOrder[0] || null;
      }

      // If secondary panel has no tabs, unsplit
      if (panel.type === "secondary" && panel.tabs.size === 0) {
        get().unsplitPanel();
      } else {
        const newPanels = new Map(workspace.panels);
        newPanels.set(panelId, panel);

        const updatedWorkspace: ConnectionWorkspace = {
          ...workspace,
          panels: newPanels,
        };

        const newWorkspaces = new Map(workspaces);
        newWorkspaces.set(activeConnectionId, updatedWorkspace);
        set({ workspaces: newWorkspaces });
      }
    },

    moveTab: (tabId, fromPanelId, toPanelId) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const fromPanel = workspace.panels.get(fromPanelId);
      const toPanel = workspace.panels.get(toPanelId);

      if (!fromPanel || !toPanel) return;

      const tab = fromPanel.tabs.get(tabId);
      if (!tab) return;

      // Update tab's panel reference
      const movedTab = { ...tab, panelId: toPanelId };

      // Remove from source panel
      fromPanel.tabs.delete(tabId);
      fromPanel.tabOrder = fromPanel.tabOrder.filter((id) => id !== tabId);
      if (fromPanel.activeTabId === tabId) {
        fromPanel.activeTabId = fromPanel.tabOrder[0] || null;
      }

      // Add to target panel
      toPanel.tabs.set(tabId, movedTab);
      toPanel.tabOrder.push(tabId);
      toPanel.activeTabId = tabId;

      const newPanels = new Map(workspace.panels);
      newPanels.set(fromPanelId, fromPanel);
      newPanels.set(toPanelId, toPanel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
        activePanelId: toPanelId,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    setActiveTab: (panelId, tabId) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const panel = workspace.panels.get(panelId);
      if (!panel || !panel.tabs.has(tabId)) return;

      panel.activeTabId = tabId;
      const newPanels = new Map(workspace.panels);
      newPanels.set(panelId, panel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    updateTab: (panelId, tabId, updates) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const panel = workspace.panels.get(panelId);
      if (!panel) return;

      const tab = panel.tabs.get(tabId);
      if (!tab) return;

      const updatedTab = { ...tab, ...updates, lastAccessedAt: new Date() };
      panel.tabs.set(tabId, updatedTab);

      const newPanels = new Map(workspace.panels);
      newPanels.set(panelId, panel);

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        panels: newPanels,
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    // Sidebar toggles (connection-aware)
    toggleSidebar: (side) => {
      const { activeConnectionId, workspaces } = get();
      if (!activeConnectionId) return;

      const workspace = workspaces.get(activeConnectionId);
      if (!workspace) return;

      const updatedWorkspace: ConnectionWorkspace = {
        ...workspace,
        sidebars: {
          ...workspace.sidebars,
          [side]: !workspace.sidebars[side],
        },
      };

      const newWorkspaces = new Map(workspaces);
      newWorkspaces.set(activeConnectionId, updatedWorkspace);
      set({ workspaces: newWorkspaces });
    },

    // Window management
    registerWindow: (connectionId, windowLabel) => {
      set((state) => {
        const newWindows = new Map(state.windows);
        newWindows.set(connectionId, windowLabel);
        return { windows: newWindows };
      });
    },

    unregisterWindow: (connectionId) => {
      set((state) => {
        const newWindows = new Map(state.windows);
        newWindows.delete(connectionId);
        return { windows: newWindows };
      });
    },
  }),
);
