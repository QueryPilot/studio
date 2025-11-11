import { contextService } from "@/services/contextService";
import { type Command } from "@/types/command";

import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { tabGroupRegistry } from "@/services/tabGroupRegistry";
import { clearAllCaches } from "@/lib/cacheManager";
//

const commandPaletteStore = useCommandPaletteStore.getState();
const dialogStore = useDialogStore.getState();

export const defaultCommands: Command[] = [
  {
    id: "quickOpen.show",
    label: "Quick Open…",
    category: "Navigation",
    handler: () => {
      const state = useCommandPaletteStore.getState();
      const isQuickOpenActive = state.isOpen && state.mode === "quickOpen";

      if (isQuickOpenActive) {
        commandPaletteStore.closePalette();
        contextService.setValue("inQuickOpen", false);
        contextService.setValue("inCommandPalette", false);
        return;
      }

      commandPaletteStore.openQuickOpen();
      contextService.setValue("inQuickOpen", true);
      contextService.setValue("inCommandPalette", false);
    },
  },
  {
    id: "commandPalette.open",
    label: "Show Command Palette",
    category: "Command Palette",
    handler: () => {
      contextService.setValue("inQuickOpen", true);
      contextService.setValue("inCommandPalette", true);
      commandPaletteStore.openCommandPalette();
    },
    when: "!inQuickOpen || !inCommandPalette",
  },
  {
    id: "commandPalette.close",
    label: "Close Command Palette",
    category: "Command Palette",
    handler: () => {
      contextService.setValue("inQuickOpen", false);
      contextService.setValue("inCommandPalette", false);
      commandPaletteStore.closePalette();
    },
    when: "inQuickOpen",
  },
  {
    id: "commandPalette.toggle",
    label: "Toggle Command Palette",
    category: "Command Palette",
    handler: () => {
      const state = useCommandPaletteStore.getState();
      const nextOpen = !(
        state.isOpen &&
        state.mode === "command" &&
        state.origin === "command"
      );
      contextService.setValue("inQuickOpen", nextOpen);
      contextService.setValue("inCommandPalette", nextOpen);
      if (nextOpen) {
        commandPaletteStore.openCommandPalette();
      } else {
        commandPaletteStore.closePalette();
      }
    },
  },
  {
    id: "preferences.open",
    label: "Open Preferences",
    category: "Preferences",
    handler: () => {
      dialogStore.openPreferences();
    },
  },
  {
    id: "preferences.close",
    label: "Close Preferences",
    category: "Preferences",
    handler: () => {
      dialogStore.closePreferences();
    },
  },
  {
    id: "preferences.openKeyboardShortcuts",
    label: "Open Keyboard Shortcuts",
    category: "Preferences",
    handler: () => {
      dialogStore.openKeyboardShortcuts();
    },
  },
  {
    id: "help.keyboardShortcuts",
    label: "Show Keyboard Shortcuts",
    category: "Help",
    handler: () => {
      dialogStore.openKeyboardShortcuts();
    },
  },
  {
    id: "workbench.action.toggleLeftSidebar",
    label: "Toggle Left Sidebar",
    category: "Workbench",
    handler: () => {
      useWorkspaceScreenStore.getState().toggleSidebar("left");
    },
  },
  {
    id: "workbench.action.toggleRightSidebar",
    label: "Toggle Right Sidebar",
    category: "Workbench",
    handler: () => {
      useWorkspaceScreenStore.getState().toggleSidebar("right");
    },
  },
  {
    id: "workbench.action.focusNextPanel",
    label: "Focus Next Panel",
    category: "Workbench",
    when: "hasMultipleEditors",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelIds = Array.from(store.panelContents.keys());
      if (panelIds.length <= 1) {
        return;
      }
      const firstId = panelIds[0] ?? "";
      const currentId = store.focusedPanelId ?? firstId;
      const currentIndex = panelIds.indexOf(currentId);
      const nextIndex =
        currentIndex >= 0 ? (currentIndex + 1) % panelIds.length : 0;
      const nextPanelId = panelIds[nextIndex];
      if (nextPanelId) {
        store.focusPanel(nextPanelId);
      }
    },
  },
  {
    id: "workbench.action.focusPreviousPanel",
    label: "Focus Previous Panel",
    category: "Workbench",
    when: "hasMultipleEditors",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelIds = Array.from(store.panelContents.keys());
      if (panelIds.length <= 1) {
        return;
      }
      const firstId = panelIds[0] ?? "";
      const currentId = store.focusedPanelId ?? firstId;
      const currentIndex = panelIds.indexOf(currentId);
      const prevIndex =
        currentIndex >= 0
          ? (currentIndex - 1 + panelIds.length) % panelIds.length
          : panelIds.length - 1;
      const prevPanelId = panelIds[prevIndex];
      if (prevPanelId) {
        store.focusPanel(prevPanelId);
      }
    },
  },
  {
    id: "workbench.action.closeActiveTab",
    label: "Close Active Tab",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel) return;

      const totalPanels = store.panelContents.size;

      if (totalPanels > 1) {
        const tabStateStore = useTabStateStore.getState();
        for (const tabId of panel.tabIds) {
          tabStateStore.clearQueryState(tabId);
        }
        store.closePanelAction(panelId);
        return;
      }

      const activeTabId = panel.activeTabId || panel.tabIds[0];
      if (!activeTabId) return;
      store.removeTab(panelId, activeTabId);
    },
  },
  {
    id: "workbench.action.closeAllTabs",
    label: "Close All Tabs",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      for (const [panelId, panel] of store.panelContents.entries()) {
        for (const tabId of [...panel.tabIds]) {
          store.removeTab(panelId, tabId);
        }
      }
    },
  },
  {
    id: "workbench.action.refreshAll",
    label: "Refresh All",
    category: "Workbench",
    handler: async () => {
      // Check for unsaved changes and show confirmation dialog
      const tabStateStore = useTabStateStore.getState();
      const hasUnsavedChanges = tabStateStore.hasAnyUnsavedChanges();

      if (hasUnsavedChanges) {
        const confirmed = window.confirm(
          "You have unsaved changes in your query tabs. Refreshing will discard these changes. Do you want to continue?",
        );
        if (!confirmed) {
          return; // User cancelled
        }
      }

      // Clear all query caches (React Query + Zustand)
      clearAllCaches();

      // Force a reload of the window to refresh all data
      window.location.reload();
    },
  },
  {
    id: "workbench.action.nextTab",
    label: "Next Tab",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel || panel.tabIds.length <= 1) return;
      const currentId = panel.activeTabId;
      const index = panel.tabIds.indexOf(currentId || "");
      const nextIndex = index >= 0 ? (index + 1) % panel.tabIds.length : 0;
      const nextTabId = panel.tabIds[nextIndex];
      if (!nextTabId) return;
      store.setActiveTab(panelId, nextTabId);
      store.focusPanel(panelId);
    },
  },
  {
    id: "workbench.action.previousTab",
    label: "Previous Tab",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel || panel.tabIds.length <= 1) return;
      const currentId = panel.activeTabId;
      const index = panel.tabIds.indexOf(currentId || "");
      const prevIndex =
        index >= 0
          ? (index - 1 + panel.tabIds.length) % panel.tabIds.length
          : panel.tabIds.length - 1;
      const prevTabId = panel.tabIds[prevIndex];
      if (!prevTabId) return;
      store.setActiveTab(panelId, prevTabId);
      store.focusPanel(panelId);
    },
  },
  {
    id: "workbench.action.splitPanelRight",
    label: "Split Panel Right",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      store.splitPanelAction({ targetPanelId: panelId, direction: "right" });
    },
  },
  {
    id: "workbench.action.splitPanelDown",
    label: "Split Panel Down",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      store.splitPanelAction({ targetPanelId: panelId, direction: "down" });
    },
  },
  {
    id: "workbench.action.splitPanelLeft",
    label: "Split Panel Left",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      store.splitPanelAction({ targetPanelId: panelId, direction: "left" });
    },
  },
  {
    id: "workbench.action.splitPanelUp",
    label: "Split Panel Up",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = store.focusedPanelId;
      if (!panelId) return;
      store.splitPanelAction({ targetPanelId: panelId, direction: "up" });
    },
  },
  {
    id: "workbench.action.newQueryTab",
    label: "New Query Tab",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const workbench = useWorkbenchStore.getState();
      const panels = workbench.panelContents;
      const focusedPanelId =
        workbench.focusedPanelId ?? panels.keys().next().value;
      if (!focusedPanelId) {
        return;
      }

      const panel = panels.get(focusedPanelId);
      if (!panel) {
        return;
      }

      const uuid =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 8)}`;
      const tabId = `query-${uuid}`;

      const connectionStore = useConnectionStore.getState();
      const selectedSchema = useWorkspaceSelectionStore.getState().schema;

      const activeConnectionId: string =
        connectionStore.activeConnectionId ??
        connectionStore.getActiveConnection()?.id ??
        "";
      const connection = activeConnectionId
        ? connectionStore.getConnection(activeConnectionId)
        : null;

      const totalQueryCount = Array.from(panels.values()).reduce(
        (count, panelContent) => {
          return (
            count +
            panelContent.tabIds.filter((id: string) => {
              const metadata = panelContent.metadata?.[id];
              return metadata?.type === "query" || id.startsWith("query-");
            }).length
          );
        },
        0,
      );

      const title =
        totalQueryCount > 0 ? `Query ${totalQueryCount + 1}` : "New Query";

      workbench.addTab(focusedPanelId, tabId, {
        type: "query",
        title,
        connectionId: activeConnectionId,
        database: connection?.profile.database || "",
        schema: selectedSchema || "",
        sql: "",
      });
      workbench.setActiveTab(focusedPanelId, tabId);
      workbench.focusPanel(focusedPanelId);
    },
  },
  {
    id: "workbench.action.reloadWindow",
    label: "Reload Window",
    category: "Workbench",
    handler: () => {
      window.location.reload();
    },
  },
  // Tab Group Navigation Commands (Cmd/Ctrl + 1-9)
  {
    id: "tabs.switchToTab1",
    label: "Switch to Tab 1",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(0);
    },
  },
  {
    id: "tabs.switchToTab2",
    label: "Switch to Tab 2",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(1);
    },
  },
  {
    id: "tabs.switchToTab3",
    label: "Switch to Tab 3",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(2);
    },
  },
  {
    id: "tabs.switchToTab4",
    label: "Switch to Tab 4",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(3);
    },
  },
  {
    id: "tabs.switchToTab5",
    label: "Switch to Tab 5",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(4);
    },
  },
  {
    id: "tabs.switchToTab6",
    label: "Switch to Tab 6",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(5);
    },
  },
  {
    id: "tabs.switchToTab7",
    label: "Switch to Tab 7",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(6);
    },
  },
  {
    id: "tabs.switchToTab8",
    label: "Switch to Tab 8",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(7);
    },
  },
  {
    id: "tabs.switchToTab9",
    label: "Switch to Tab 9",
    category: "Tabs",
    when: "tabGroupFocused",
    handler: () => {
      tabGroupRegistry.switchToTab(8);
    },
  },
];
