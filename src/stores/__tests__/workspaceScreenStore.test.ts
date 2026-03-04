import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceScreenStore } from "../workspaceScreenStore";

describe("workspaceScreenStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useWorkspaceScreenStore.setState({
      workspaces: new Map(),
      activeConnectionId: null,
      activeWorkspaceId: null,
      windows: new Map(),
    });
  });

  describe("Connection Management", () => {
    it("should set active connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const state = useWorkspaceScreenStore.getState();
      expect(state.activeConnectionId).toBe("conn-1");
    });

    it("should initialize workspace when setting new connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const state = useWorkspaceScreenStore.getState();
      expect(state.workspaces.has("conn-1")).toBe(true);

      const workspace = state.workspaces.get("conn-1");
      expect(workspace).toBeTruthy();
      expect(workspace?.panels.size).toBe(1);
      expect(workspace?.activePanelId).toBeTruthy();
      expect(workspace?.splitMode).toBe("none");
    });

    it("should not reinitialize existing workspace", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      const workspace1 = useWorkspaceScreenStore.getState().workspaces.get("conn-1");

      store.setActiveConnection("conn-1");
      const workspace2 = useWorkspaceScreenStore.getState().workspaces.get("conn-1");

      expect(workspace1).toBe(workspace2);
    });

    it("should clear workspace for connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      expect(useWorkspaceScreenStore.getState().workspaces.has("conn-1")).toBe(true);

      store.clearWorkspace("conn-1");

      const state = useWorkspaceScreenStore.getState();
      expect(state.workspaces.has("conn-1")).toBe(false);
    });

    it("should support multiple connections", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      store.setActiveConnection("conn-2");

      const state = useWorkspaceScreenStore.getState();
      expect(state.workspaces.size).toBe(2);
      expect(state.activeConnectionId).toBe("conn-2");
    });
  });

  describe("Workspace Initialization", () => {
    it("should create default workspace with primary panel", () => {
      const store = useWorkspaceScreenStore.getState();

      store.initWorkspace("conn-1");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace).toBeTruthy();
      expect(workspace?.panels.size).toBe(1);

      const primaryPanel = Array.from(workspace!.panels.values())[0];
      expect(primaryPanel?.type).toBe("primary");
      expect(primaryPanel?.tabs.size).toBe(1); // Default query tab
      expect(primaryPanel?.activeTabId).toBeTruthy();
    });

    it("should create default query tab", () => {
      const store = useWorkspaceScreenStore.getState();

      store.initWorkspace("conn-1");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const primaryPanel = Array.from(workspace!.panels.values())[0];
      const defaultTab = Array.from(primaryPanel!.tabs.values())[0];

      expect(defaultTab).toBeTruthy();
      expect(defaultTab?.type).toBe("query");
      expect(defaultTab?.title).toBe("New Query");
      expect(defaultTab?.connectionId).toBe("conn-1");
      expect(defaultTab?.isDirty).toBe(false);
      expect(defaultTab?.isLoading).toBe(false);
    });

    it("should initialize with sidebars config", () => {
      const store = useWorkspaceScreenStore.getState();

      store.initWorkspace("conn-1");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace?.sidebars.left).toBe(true);
      expect(workspace?.sidebars.right).toBe(false);
    });
  });

  describe("Panel Operations", () => {
    beforeEach(() => {
      const store = useWorkspaceScreenStore.getState();
      store.setActiveConnection("conn-1");
    });

    it("should split panel horizontally", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace?.panels.size).toBe(2);
      expect(workspace?.splitMode).toBe("horizontal");

      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );
      expect(secondaryPanel).toBeTruthy();
    });

    it("should split panel vertically", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("vertical");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace?.splitMode).toBe("vertical");
    });

    it("should move active tab to secondary panel on split", () => {
      const store = useWorkspaceScreenStore.getState();

      const primaryPanelId = store.getPanels().values().next().value?.id!;

      // Add another tab to primary panel
      store.addTab(primaryPanelId, { title: "Test Tab" });

      // Add another tab ensures we have tabs to move to secondary panel

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );

      // Secondary panel should have the tab that was active
      expect(secondaryPanel?.tabs.size).toBe(1);
      expect(secondaryPanel?.activeTabId).toBeTruthy();
    });

    it("should not split if no active tab", () => {
      const store = useWorkspaceScreenStore.getState();

      // Clear default tab
      const primaryPanelId = store.getPanels().values().next().value?.id!;
      const defaultTabId = store.getPanels().get(primaryPanelId)?.activeTabId;
      if (defaultTabId) {
        store.closeTab(defaultTabId, primaryPanelId);
      }

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace?.splitMode).toBe("none");
      expect(workspace?.panels.size).toBe(1);
    });

    it("should unsplit panel", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");
      expect(useWorkspaceScreenStore.getState().workspaces.get("conn-1")?.panels.size).toBe(2);

      store.unsplitPanel();

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(workspace?.panels.size).toBe(1);
      expect(workspace?.splitMode).toBe("none");
    });

    it("should merge secondary tabs to primary on unsplit", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );

      // Add tab to secondary panel
      store.addTab(secondaryPanel!.id, { title: "Secondary Tab" });

      store.unsplitPanel();

      const finalWorkspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const primaryPanel = Array.from(finalWorkspace!.panels.values())[0];

      // Primary panel should have all tabs now
      expect(primaryPanel?.tabs.size).toBeGreaterThan(1);
    });

    it("should set active panel", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const primaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "primary",
      );

      store.setActivePanel(primaryPanel!.id);

      const updatedWorkspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(updatedWorkspace?.activePanelId).toBe(primaryPanel!.id);
    });
  });

  describe("Tab Operations", () => {
    beforeEach(() => {
      const store = useWorkspaceScreenStore.getState();
      store.setActiveConnection("conn-1");
    });

    it("should add tab to panel", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tabId = store.addTab(panelId, { title: "New Tab", type: "table" });

      expect(tabId).toBeTruthy();

      const panel = store.getPanels().get(panelId);
      expect(panel?.tabs.has(tabId)).toBe(true);
      expect(panel?.activeTabId).toBe(tabId);
    });

    it("should add tab with custom data", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tabId = store.addTab(panelId, {
        title: "Custom Tab",
        type: "erd",
        payload: { schema: "public" },
      });

      const panel = store.getPanels().get(panelId);
      const tab = panel?.tabs.get(tabId);

      expect(tab?.title).toBe("Custom Tab");
      expect(tab?.type).toBe("erd");
      expect(tab?.payload).toEqual({ schema: "public" });
    });

    it("should set added tab as active", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      store.addTab(panelId, { title: "Tab 1" });
      const tab2 = store.addTab(panelId, { title: "Tab 2" });

      const panel = store.getPanels().get(panelId);
      expect(panel?.activeTabId).toBe(tab2);
    });

    it("should close tab", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tabId = store.addTab(panelId, { title: "Tab to Close" });

      store.closeTab(tabId, panelId);

      const panel = store.getPanels().get(panelId);
      expect(panel?.tabs.has(tabId)).toBe(false);
    });

    it("should update active tab when closing current active", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;

      // Close the default tab first so we have a clean slate
      const defaultTabId = store.getPanels().get(panelId)?.activeTabId;
      if (defaultTabId) {
        store.closeTab(defaultTabId, panelId);
      }

      const tab1 = store.addTab(panelId, { title: "Tab 1" });
      const tab2 = store.addTab(panelId, { title: "Tab 2" });

      // tab2 is now active, close it
      store.closeTab(tab2, panelId);

      const panel = store.getPanels().get(panelId);
      // Active tab should be tab1 (first in tabOrder after closing tab2)
      expect(panel?.activeTabId).toBe(tab1);
    });

    it("should unsplit when closing last tab in secondary panel", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );

      const tabId = secondaryPanel!.activeTabId!;

      store.closeTab(tabId, secondaryPanel!.id);

      const finalWorkspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      expect(finalWorkspace?.splitMode).toBe("none");
      expect(finalWorkspace?.panels.size).toBe(1);
    });

    it("should move tab between panels", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const primaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "primary",
      );
      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );

      const tabId = store.addTab(primaryPanel!.id, { title: "Moving Tab" });

      store.moveTab(tabId, primaryPanel!.id, secondaryPanel!.id);

      const updatedWorkspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const updatedPrimary = updatedWorkspace!.panels.get(primaryPanel!.id);
      const updatedSecondary = updatedWorkspace!.panels.get(secondaryPanel!.id);

      expect(updatedPrimary?.tabs.has(tabId)).toBe(false);
      expect(updatedSecondary?.tabs.has(tabId)).toBe(true);
      expect(updatedSecondary?.activeTabId).toBe(tabId);
    });

    it("should update tab panel reference when moving", () => {
      const store = useWorkspaceScreenStore.getState();

      store.splitPanel("horizontal");

      const workspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const primaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "primary",
      );
      const secondaryPanel = Array.from(workspace!.panels.values()).find(
        (p) => p.type === "secondary",
      );

      const tabId = store.addTab(primaryPanel!.id, { title: "Moving Tab" });

      store.moveTab(tabId, primaryPanel!.id, secondaryPanel!.id);

      const updatedWorkspace = useWorkspaceScreenStore.getState().workspaces.get("conn-1");
      const updatedSecondary = updatedWorkspace!.panels.get(secondaryPanel!.id);
      const movedTab = updatedSecondary?.tabs.get(tabId);

      expect(movedTab?.panelId).toBe(secondaryPanel!.id);
    });

    it("should set active tab", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tab1 = store.addTab(panelId, { title: "Tab 1" });
      store.addTab(panelId, { title: "Tab 2" });

      store.setActiveTab(panelId, tab1);

      const panel = store.getPanels().get(panelId);
      expect(panel?.activeTabId).toBe(tab1);
    });

    it("should not set active tab if tab does not exist", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const currentActive = store.getPanels().get(panelId)?.activeTabId;

      store.setActiveTab(panelId, "non-existent");

      const panel = store.getPanels().get(panelId);
      expect(panel?.activeTabId).toBe(currentActive);
    });

    it("should update tab", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tabId = store.addTab(panelId, { title: "Original Title" });

      store.updateTab(panelId, tabId, {
        title: "Updated Title",
        isDirty: true,
      });

      const panel = store.getPanels().get(panelId);
      const tab = panel?.tabs.get(tabId);

      expect(tab?.title).toBe("Updated Title");
      expect(tab?.isDirty).toBe(true);
    });

    it("should update lastAccessedAt when updating tab", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const tabId = store.addTab(panelId, { title: "Test Tab" });

      const beforeUpdate = store.getPanels().get(panelId)?.tabs.get(tabId)?.lastAccessedAt;

      // Small delay to ensure timestamp difference
      setTimeout(() => {
        store.updateTab(panelId, tabId, { title: "Updated" });

        const afterUpdate = store.getPanels().get(panelId)?.tabs.get(tabId)?.lastAccessedAt;
        expect(afterUpdate).not.toBe(beforeUpdate);
      }, 10);
    });

    it("should handle updating non-existent tab", () => {
      const store = useWorkspaceScreenStore.getState();

      const panelId = store.getPanels().values().next().value?.id!;
      const panelBefore = store.getPanels().get(panelId);

      store.updateTab(panelId, "non-existent", { title: "Updated" });

      const panelAfter = store.getPanels().get(panelId);
      expect(panelAfter?.tabs.size).toBe(panelBefore?.tabs.size);
    });
  });

  describe("Sidebar Toggles", () => {
    beforeEach(() => {
      const store = useWorkspaceScreenStore.getState();
      store.setActiveConnection("conn-1");
    });

    it("should toggle left sidebar", () => {
      const store = useWorkspaceScreenStore.getState();

      const initialState = store.getSidebars().left;

      store.toggleSidebar("left");

      expect(store.getSidebars().left).toBe(!initialState);
    });

    it("should toggle right sidebar", () => {
      const store = useWorkspaceScreenStore.getState();

      const initialState = store.getSidebars().right;

      store.toggleSidebar("right");

      expect(store.getSidebars().right).toBe(!initialState);
    });

    it("should not affect other sidebar when toggling", () => {
      const store = useWorkspaceScreenStore.getState();

      const initialLeftState = store.getSidebars().left;

      store.toggleSidebar("right");

      expect(store.getSidebars().left).toBe(initialLeftState);
    });

    it("preserves sidebar visibility when switching connections", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      store.toggleSidebar("right");
      expect(store.getSidebars().right).toBe(true);

      store.setActiveConnection("conn-2");
      expect(store.getSidebars().right).toBe(true);

      store.toggleSidebar("right");
      expect(store.getSidebars().right).toBe(false);

      store.setActiveConnection("conn-1");
      expect(store.getSidebars().right).toBe(false);
    });

    it("keeps right sidebar open when activating a new connection after null focus", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      store.toggleSidebar("right");
      expect(store.getSidebars().right).toBe(true);

      store.setActiveConnection(null);
      store.setActiveConnection("conn-2");

      expect(store.getSidebars().right).toBe(true);
    });
  });

  describe("Window Management", () => {
    it("should register window", () => {
      const store = useWorkspaceScreenStore.getState();

      store.registerWindow("conn-1", "main-window");

      const state = useWorkspaceScreenStore.getState();
      expect(state.windows.get("conn-1")).toBe("main-window");
    });

    it("should unregister window", () => {
      const store = useWorkspaceScreenStore.getState();

      store.registerWindow("conn-1", "main-window");
      store.unregisterWindow("conn-1");

      const state = useWorkspaceScreenStore.getState();
      expect(state.windows.has("conn-1")).toBe(false);
    });

    it("should support multiple windows", () => {
      const store = useWorkspaceScreenStore.getState();

      store.registerWindow("conn-1", "window-1");
      store.registerWindow("conn-2", "window-2");

      const state = useWorkspaceScreenStore.getState();
      expect(state.windows.size).toBe(2);
      expect(state.windows.get("conn-1")).toBe("window-1");
      expect(state.windows.get("conn-2")).toBe("window-2");
    });
  });

  describe("Getters (Connection-Aware)", () => {
    it("should return empty panels when no active connection", () => {
      const store = useWorkspaceScreenStore.getState();

      const panels = store.getPanels();

      expect(panels.size).toBe(0);
    });

    it("should return panels for active connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const panels = store.getPanels();

      expect(panels.size).toBeGreaterThan(0);
    });

    it("should return empty string for active panel when no connection", () => {
      const store = useWorkspaceScreenStore.getState();

      const activePanelId = store.getActivePanelId();

      expect(activePanelId).toBe("");
    });

    it("should return active panel id for connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const activePanelId = store.getActivePanelId();

      expect(activePanelId).toBeTruthy();
    });

    it("should return split mode for connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      store.splitPanel("horizontal");

      const splitMode = store.getSplitMode();

      expect(splitMode).toBe("horizontal");
    });

    it("should return default split position", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const splitPosition = store.getSplitPosition();

      expect(splitPosition).toBe(0.5);
    });

    it("should return sidebars config for connection", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");

      const sidebars = store.getSidebars();

      expect(sidebars.left).toBe(true);
      expect(sidebars.right).toBe(false);
    });

    it("should return different data for different connections", () => {
      const store = useWorkspaceScreenStore.getState();

      store.setActiveConnection("conn-1");
      store.splitPanel("horizontal");
      const conn1PanelCount = store.getPanels().size;

      store.setActiveConnection("conn-2");
      const conn2PanelCount = store.getPanels().size;

      expect(conn1PanelCount).toBe(2);
      expect(conn2PanelCount).toBe(1);
    });
  });
});
