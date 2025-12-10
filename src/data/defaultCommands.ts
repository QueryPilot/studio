import { logger } from "@/lib/logger";
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
import { useCrudStore } from "@/stores/crudStore";
import { toast } from "sonner";
import React from "react";
import { ConfirmationToast } from "@/components/ConfirmationToast";
import { eventBus } from "@/services/eventBus";
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
      try {
        logger.info("[RefreshAll] Handler started");

        // Get store states
        const crudStore = useCrudStore.getState();
        const tabStateStore = useTabStateStore.getState();

        // Check for pending changes
        const hasPendingEdits = crudStore.stagedCommands.size > 0;
        const hasUnsavedQueryChanges = tabStateStore.hasAnyUnsavedChanges();

        logger.info("[RefreshAll] Pending edits:", hasPendingEdits);
        logger.info("[RefreshAll] Unsaved queries:", hasUnsavedQueryChanges);

        if (hasPendingEdits || hasUnsavedQueryChanges) {
          // Build description of changes
          let description = "";
          if (hasPendingEdits) {
            const totalChanges = Array.from(crudStore.stagedCommands.values())
              .reduce((sum, cmds) => sum + cmds.length, 0);
            description += `${totalChanges} pending data ${totalChanges === 1 ? 'edit' : 'edits'}`;
          }
          if (hasUnsavedQueryChanges) {
            if (description) description += " and ";
            description += "unsaved query changes";
          }

          logger.info("[RefreshAll] Showing confirmation toast");

          // Show a promise-based toast that waits for user confirmation
          const confirmed = await new Promise<boolean>((resolve) => {
            let resolved = false;
            let toastId: string | number;

            const handleConfirm = () => {
              resolved = true;
              toast.dismiss(toastId);
              resolve(true);
            };

            const handleCancel = () => {
              resolved = true;
              toast.dismiss(toastId);
              resolve(false);
            };

            toastId = toast(
              React.createElement(ConfirmationToast, {
                title: "Unsaved changes will be lost",
                description: `You have ${description}. This action cannot be undone.`,
                confirmLabel: "Refresh Anyway",
                cancelLabel: "Cancel",
                onConfirm: handleConfirm,
                onCancel: handleCancel,
              }),
              {
                duration: 15000, // 15 seconds to decide
                onDismiss: () => {
                  if (!resolved) {
                    resolve(false);
                  }
                },
                onAutoClose: () => {
                  if (!resolved) {
                    resolve(false);
                  }
                },
              }
            );
          });

          logger.info("[RefreshAll] User confirmed:", confirmed);

          if (!confirmed) {
            logger.info("[RefreshAll] User cancelled");
            return;
          }
        }

        // Discard all pending edits
        if (hasPendingEdits) {
          logger.info("[RefreshAll] Discarding pending edits");
          crudStore.discardAll();
        }

        // Reset all caches and trigger refetch for active queries
        logger.info("[RefreshAll] Resetting all caches and refetching");
        await clearAllCaches();

        // Show success toast
        logger.info("[RefreshAll] Showing success toast");
        toast.success("Refreshed", {
          description: "All caches cleared and data reloaded",
        });
      } catch (error) {
        logger.error("[RefreshAll] Error:", error);
        toast.error("Refresh failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  },
  {
    id: "workbench.action.discardAllChanges",
    label: "Discard All Changes and Refresh",
    category: "Workbench",
    handler: async () => {
      try {
        logger.info("[DiscardAllChanges] Handler started");

        // Get store states
        const crudStore = useCrudStore.getState();

        // Discard all pending edits without confirmation
        logger.info("[DiscardAllChanges] Discarding all changes");
        crudStore.discardAll();

        // Reset all caches and trigger refetch for active queries
        logger.info("[DiscardAllChanges] Resetting all caches and refetching");
        await clearAllCaches();

        // Show success toast
        logger.info("[DiscardAllChanges] Showing success toast");
        toast.success("Changes discarded and refreshed", {
          description: "All pending changes discarded and data reloaded",
        });
      } catch (error) {
        logger.error("[DiscardAllChanges] Error:", error);
        toast.error("Operation failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
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
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const selectedSchema = workspaceSelection.schema;

      const activeConnectionId: string = workspaceSelection.connectionId ?? "";
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
  // Data Grid Commands (registered dynamically by component via useCommand)
  {
    id: "dataGrid.action.copyAsJson",
    label: "Copy Selection as JSON",
    category: "Data Grid",
    when: "dataGridFocus && !selectionEmpty && !editingCell",
    handler: () => {
      // Actual handler registered in TableDataGridV2 component
    },
  },
  // Query Editor Commands (Event-Driven)
  {
    id: "editor.action.formatQuery",
    label: "Format Query",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:format", {});
    },
  },
  {
    id: "query.action.toggleHistory",
    label: "Toggle History",
    category: "Query",
    handler: () => {
      eventBus.emit("query-editor:toggle-history", {});
    },
  },
  {
    id: "editor.action.executeQuery",
    label: "Execute Query",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:execute", {});
    },
  },
];
