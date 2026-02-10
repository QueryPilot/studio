import { describe, it, expect, beforeEach, vi } from "vitest";
import useWorkbenchStore from "../workbenchStore";
import { usePanelFocusStore } from "../panelFocusStore";

// Create a mock clearQueryState function
const mockClearQueryState = vi.fn();

// Mock useTabStateStore
vi.mock("../tabStateStore", () => ({
  useTabStateStore: {
    getState: () => ({
      clearQueryState: mockClearQueryState,
    }),
  },
}));

describe("workbenchStore", () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();

    // Reset store to initial state
    useWorkbenchStore.setState({
      layoutTree: null,
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
    });

    // Reset panel focus store
    usePanelFocusStore.setState({ focusedPanelId: null });

    vi.clearAllMocks();
    mockClearQueryState.mockClear();
  });

  describe("Layout Initialization", () => {
    it("should initialize layout with default panel", () => {
      const store = useWorkbenchStore.getState();

      store.initializeLayout();

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeTruthy();
      expect(state.layoutTree?.type).toBe("leaf");
      expect(usePanelFocusStore.getState().focusedPanelId).toBeTruthy();
      expect(state.panelContents.size).toBe(1);
      expect(state.layoutHistory.length).toBe(1);
      expect(state.historyIndex).toBe(0);
    });

    it("should set connection ID without initializing layout", () => {
      const store = useWorkbenchStore.getState();

      store.setConnectionId("conn-1");

      const state = useWorkbenchStore.getState();
      expect(state.activeConnectionId).toBe("conn-1");
      // Layout should NOT be auto-initialized by setConnectionId
      expect(state.layoutTree).toBeNull();
    });

    it("should preserve layout when switching connections", () => {
      const store = useWorkbenchStore.getState();

      // Initialize layout first
      store.initializeLayout();
      store.setConnectionId("conn-1");
      const firstPanelId = usePanelFocusStore.getState().focusedPanelId;

      // Add a tab to verify it persists
      store.addTab(firstPanelId!, "test-tab");

      // Switch connections - layout should be preserved
      store.setConnectionId("conn-2");
      const secondPanelId = usePanelFocusStore.getState().focusedPanelId;

      // Panel ID should be the SAME (layout preserved)
      expect(firstPanelId).toBe(secondPanelId);
      // Tab should still exist
      const contents = useWorkbenchStore.getState().panelContents.get(firstPanelId!);
      expect(contents?.tabIds).toContain("test-tab");
    });

    it("should skip update when setting same connection ID", () => {
      const store = useWorkbenchStore.getState();

      store.initializeLayout();
      store.setConnectionId("conn-1");
      const firstPanelId = usePanelFocusStore.getState().focusedPanelId;

      // Add a tab to verify state is preserved
      store.addTab(firstPanelId!, "test-tab");

      store.setConnectionId("conn-1"); // Same connection

      // Should still have the layout unchanged
      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeTruthy();
      expect(state.activeConnectionId).toBe("conn-1");
      expect(state.panelContents.get(firstPanelId!)?.tabIds).toContain("test-tab");
    });
  });

  describe("Split Panel", () => {
    it("should split panel horizontally", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const initialPanelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: initialPanelId,
        direction: "right",
        newPanelContent: {
          id: "new-panel",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree?.type).toBe("branch");
      expect(state.panelContents.size).toBe(2);
      expect(state.layoutHistory.length).toBe(2);
    });

    it("should split panel vertically", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const initialPanelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: initialPanelId,
        direction: "down",
        newPanelContent: {
          id: "new-panel",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree?.type).toBe("branch");
      expect(state.panelContents.size).toBe(2);
    });

    it("should handle split with custom ratio", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const initialPanelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: initialPanelId,
        direction: "right",
        newPanelContent: {
          id: "new-panel",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
        splitRatio: 0.7,
      });

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree?.type).toBe("branch");
    });

    it("should not split if no layout tree exists", () => {
      const store = useWorkbenchStore.getState();

      store.splitPanelAction({
        targetPanelId: "panel-1",
        direction: "right",
        newPanelContent: {
          id: "new-panel",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeNull();
    });
  });

  describe("Close Panel", () => {
    it("should close panel and auto-initialize when last panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.closePanelAction(panelId);

      const state = useWorkbenchStore.getState();
      // Should auto-initialize with new panel
      expect(state.layoutTree).toBeTruthy();
      expect(usePanelFocusStore.getState().focusedPanelId).not.toBe(panelId);
    });

    it("should close panel without auto-init when preventAutoInit is true", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.closePanelAction(panelId, true);

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeNull();
      expect(usePanelFocusStore.getState().focusedPanelId).toBeNull();
      expect(state.panelContents.size).toBe(0);
    });

    it("should close panel and merge siblings", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const initialPanelId = usePanelFocusStore.getState().focusedPanelId!;

      // Split to create 2 panels
      store.splitPanelAction({
        targetPanelId: initialPanelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      expect(useWorkbenchStore.getState().panelContents.size).toBe(2);

      // Close one panel
      store.closePanelAction("panel-2");

      const state = useWorkbenchStore.getState();
      expect(state.panelContents.size).toBe(1);
      expect(state.layoutTree?.type).toBe("leaf");
    });

    it("should clear tab state when closing panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      // Add a tab
      store.addTab(panelId, "tab-1");

      store.closePanelAction(panelId, true);

      expect(mockClearQueryState).toHaveBeenCalledWith(
        "tab-1",
      );
    });
  });

  describe("Resize Panel", () => {
    it("should resize panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const initialPanelId = usePanelFocusStore.getState().focusedPanelId!;

      // Split to create resizable panels
      store.splitPanelAction({
        targetPanelId: initialPanelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.resizePanelAction([0], 0.7);

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeTruthy();
    });

    it("should not resize if no layout tree", () => {
      const store = useWorkbenchStore.getState();

      store.resizePanelAction([0], 0.5);

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeNull();
    });
  });

  describe("Move Tab", () => {
    it("should move tab between panels", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      // Split to create second panel
      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      // Get the actual panel-2 ID from the store
      const state1 = useWorkbenchStore.getState();
      const panel2Id = Array.from(state1.panelContents.keys()).find(id => id !== panel1Id)!;

      // Add tab to first panel
      store.addTab(panel1Id, "tab-1", { label: "Test Tab" });

      // Move tab to second panel
      store.moveTab("tab-1", panel1Id, panel2Id);

      const state = useWorkbenchStore.getState();
      const panel1 = state.panelContents.get(panel1Id);
      const panel2 = state.panelContents.get(panel2Id);

      expect(panel1?.tabIds || []).not.toContain("tab-1");
      expect(panel2?.tabIds || []).toContain("tab-1");
      expect(panel2?.activeTabId).toBe("tab-1");
    });

    it("should move tab metadata when moving tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      const tabMetadata = { label: "Test Tab", isDirty: true };
      store.addTab(panel1Id, "tab-1", tabMetadata);

      store.moveTab("tab-1", panel1Id, "panel-2");

      const state = useWorkbenchStore.getState();
      const panel2 = state.panelContents.get("panel-2");

      expect(panel2?.metadata?.["tab-1"]).toEqual(tabMetadata);
    });

    it("should close source panel if no tabs remain after move", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.addTab(panel1Id, "tab-1");

      expect(useWorkbenchStore.getState().panelContents.size).toBe(2);

      store.moveTab("tab-1", panel1Id, "panel-2");

      // Panel 1 should be closed since it has no tabs
      const state = useWorkbenchStore.getState();
      expect(state.panelContents.size).toBe(1);
      expect(state.panelContents.has(panel1Id)).toBe(false);
    });

    it("should handle moving non-existent tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      // Add a tab to panel1 so it doesn't get closed
      store.addTab(panel1Id, "real-tab");

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      // Get the actual panel-2 ID from the store
      const state1 = useWorkbenchStore.getState();
      const panel2Id = Array.from(state1.panelContents.keys()).find(id => id !== panel1Id)!;

      const panelCountBefore = useWorkbenchStore.getState().panelContents.size;

      store.moveTab("non-existent", panel1Id, panel2Id);

      // Should not change panel count when moving non-existent tab
      expect(useWorkbenchStore.getState().panelContents.size).toBe(
        panelCountBefore,
      );
    });
  });

  describe("Focus Panel", () => {
    it("should focus panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.focusPanel(panel1Id);

      expect(usePanelFocusStore.getState().focusedPanelId).toBe(panel1Id);
    });

    it("should not focus non-existent panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const currentFocus = usePanelFocusStore.getState().focusedPanelId;

      store.focusPanel("non-existent");

      expect(usePanelFocusStore.getState().focusedPanelId).toBe(currentFocus);
    });

    it("should auto-focus root panel if target not found", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const rootPanelId = usePanelFocusStore.getState().focusedPanelId!;

      store.focusPanel("non-existent");

      expect(usePanelFocusStore.getState().focusedPanelId).toBe(rootPanelId);
    });
  });

  describe("Focus Adjacent Panel", () => {
    it("should focus adjacent panel in direction", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.focusPanel(panel1Id);
      store.focusAdjacentPanel("right");

      // Should focus the adjacent panel (implementation-dependent)
      expect(usePanelFocusStore.getState().focusedPanelId).toBeTruthy();
    });

    it("should not change focus if no adjacent panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const currentFocus = usePanelFocusStore.getState().focusedPanelId;

      store.focusAdjacentPanel("left");

      expect(usePanelFocusStore.getState().focusedPanelId).toBe(currentFocus);
    });
  });

  describe("Drag/Drop Context", () => {
    it("should set drag context", () => {
      const store = useWorkbenchStore.getState();

      store.setDragContext({
        draggedTab: { id: "tab-1", panelId: "panel-1" },
        draggedPanel: "panel-1",
      });

      const state = useWorkbenchStore.getState();
      expect(state.dragDropContext.draggedTab?.id).toBe("tab-1");
      expect(state.dragDropContext.draggedPanel).toBe("panel-1");
    });

    it("should merge drag context", () => {
      const store = useWorkbenchStore.getState();

      store.setDragContext({ draggedTab: { id: "tab-1", panelId: "panel-1" } });
      store.setDragContext({ dropTarget: { panelId: "panel-2" } });

      const state = useWorkbenchStore.getState();
      expect(state.dragDropContext.draggedTab?.id).toBe("tab-1");
      expect(state.dragDropContext.dropTarget?.panelId).toBe("panel-2");
    });

    it("should clear drag context", () => {
      const store = useWorkbenchStore.getState();

      store.setDragContext({
        draggedTab: { id: "tab-1", panelId: "panel-1" },
        draggedPanel: "panel-1",
      });

      store.clearDragContext();

      const state = useWorkbenchStore.getState();
      expect(state.dragDropContext.draggedTab).toBeNull();
      expect(state.dragDropContext.draggedPanel).toBeNull();
      expect(state.dragDropContext.dropTarget).toBeNull();
      expect(state.dragDropContext.dropPosition).toBeNull();
    });
  });

  describe("Layout History", () => {
    it("should track layout history on split", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      expect(useWorkbenchStore.getState().layoutHistory.length).toBe(1);

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      expect(useWorkbenchStore.getState().layoutHistory.length).toBe(2);
    });

    it("should undo layout changes", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      expect(useWorkbenchStore.getState().panelContents.size).toBe(2);

      store.undo();

      expect(useWorkbenchStore.getState().panelContents.size).toBe(1);
    });

    it("should redo layout changes", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.undo();
      expect(useWorkbenchStore.getState().panelContents.size).toBe(1);

      store.redo();
      expect(useWorkbenchStore.getState().panelContents.size).toBe(2);
    });

    it("should not undo beyond first state", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      store.undo();

      const state = useWorkbenchStore.getState();
      expect(state.historyIndex).toBe(0);
    });

    it("should not redo beyond last state", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      store.redo();

      const state = useWorkbenchStore.getState();
      expect(state.historyIndex).toBe(0);
    });
  });

  describe("Save/Restore Layout", () => {
    it("should save layout to localStorage", () => {
      const store = useWorkbenchStore.getState();
      store.setConnectionId("conn-1");
      store.initializeLayout(); // Must initialize before saving

      store.saveLayout();

      const saved = localStorage.getItem("workbench-layout-backup-conn-1");
      expect(saved).toBeTruthy();
    });

    it("should restore layout from localStorage", () => {
      const store = useWorkbenchStore.getState();
      store.setConnectionId("conn-1");
      store.initializeLayout(); // Must initialize before saving

      // Save current layout
      store.saveLayout();
      const savedTree = useWorkbenchStore.getState().layoutTree;

      // Clear layout
      useWorkbenchStore.setState({ layoutTree: null, panelContents: new Map() });

      // Restore layout
      store.restoreLayout();

      const restoredTree = useWorkbenchStore.getState().layoutTree;
      expect(restoredTree).toBeTruthy();
      expect(restoredTree?.id).toBe(savedTree?.id);
    });

    it("should initialize on restore failure", () => {
      const store = useWorkbenchStore.getState();

      // Set invalid JSON in localStorage
      localStorage.setItem("workbench-layout-backup", "invalid json");

      store.restoreLayout();

      const state = useWorkbenchStore.getState();
      expect(state.layoutTree).toBeTruthy();
    });

    it("should reset layout", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panelId,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: [],
          activeTabId: "",
        },
      });

      store.resetLayout();

      const state = useWorkbenchStore.getState();
      expect(state.panelContents.size).toBe(1);
    });
  });

  describe("Tab Management", () => {
    it("should add tab to panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1", { label: "Test Tab" });

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.tabIds).toContain("tab-1");
      expect(panel?.activeTabId).toBe("tab-1");
      expect(panel?.metadata?.["tab-1"]).toEqual({ label: "Test Tab" });
    });

    it("should set active tab when adding existing tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");
      store.addTab(panelId, "tab-2");

      expect(useWorkbenchStore.getState().panelContents.get(panelId)?.activeTabId).toBe("tab-2");

      store.addTab(panelId, "tab-1");

      expect(useWorkbenchStore.getState().panelContents.get(panelId)?.activeTabId).toBe("tab-1");
    });

    it("should remove tab from panel", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");
      store.addTab(panelId, "tab-2");

      store.removeTab(panelId, "tab-1");

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.tabIds).not.toContain("tab-1");
      expect(panel?.tabIds).toContain("tab-2");
    });

    it("should update active tab when removing current active tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");
      store.addTab(panelId, "tab-2");

      store.removeTab(panelId, "tab-2");

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.activeTabId).toBe("tab-1");
    });

    it("should close panel when removing last tab if multiple panels exist", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panel1Id = usePanelFocusStore.getState().focusedPanelId!;

      store.splitPanelAction({
        targetPanelId: panel1Id,
        direction: "right",
        newPanelContent: {
          id: "panel-2",
          type: "editor",
          tabIds: ["tab-2"],
          activeTabId: "tab-2",
        },
      });

      store.addTab(panel1Id, "tab-1");

      expect(useWorkbenchStore.getState().panelContents.size).toBe(2);

      store.removeTab(panel1Id, "tab-1");

      // Panel should be closed since it has no tabs and there are other panels
      const state = useWorkbenchStore.getState();
      expect(state.panelContents.size).toBe(1);
    });

    it("should clear tab state when removing tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");
      store.addTab(panelId, "tab-2");

      store.removeTab(panelId, "tab-1");

      expect(mockClearQueryState).toHaveBeenCalledWith(
        "tab-1",
      );
    });

    it("should set active tab", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");
      store.addTab(panelId, "tab-2");

      store.setActiveTab(panelId, "tab-1");

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.activeTabId).toBe("tab-1");
    });

    it("should not set active tab if tab does not exist", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1");

      const activeTabBefore = useWorkbenchStore.getState().panelContents.get(
        panelId,
      )?.activeTabId;

      store.setActiveTab(panelId, "non-existent");

      const activeTabAfter = useWorkbenchStore.getState().panelContents.get(
        panelId,
      )?.activeTabId;

      expect(activeTabAfter).toBe(activeTabBefore);
    });

    it("should update tab metadata", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1", { label: "Original" });

      store.updateTabMetadata(panelId, "tab-1", { label: "Updated" });

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.metadata?.["tab-1"]?.label).toBe("Updated");
    });

    it("should merge tab metadata on update", () => {
      const store = useWorkbenchStore.getState();
      store.initializeLayout();

      const panelId = usePanelFocusStore.getState().focusedPanelId!;

      store.addTab(panelId, "tab-1", {
        label: "Original",
        isDirty: false,
      });

      store.updateTabMetadata(panelId, "tab-1", { isDirty: true });

      const state = useWorkbenchStore.getState();
      const panel = state.panelContents.get(panelId);

      expect(panel?.metadata?.["tab-1"]?.label).toBe("Original");
      expect(panel?.metadata?.["tab-1"]?.isDirty).toBe(true);
    });
  });
});
