import { logger } from "@/lib/logger";
import { contextService } from "@/services/contextService";
import { type Command } from "@/types/command";

import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { tabGroupRegistry } from "@/services/tabGroupRegistry";
import { dataGridRegistry } from "@/services/dataGridRegistry";
import { clearAllCaches } from "@/lib/cacheManager";
import { useCrudStore } from "@/stores/crudStore";
import { toast } from "sonner";
import React from "react";
import { ConfirmationToast } from "@/components/ConfirmationToast";
import { eventBus } from "@/services/eventBus";
import { queryActionDispatcher } from "@/services/queryActionDispatcher";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { windowManager } from "@/services/windowManager";
import {
  openQueryWithSql,
  openQueryWithTemplate,
  openTableDesigner,
  getCreateDatabaseTemplate,
  getCreateSchemaTemplate,
  openErdView,
} from "@/utils/workbench/openers";
import { DbType, getParadigm } from "@/types/connection";

const commandPaletteStore = useCommandPaletteStore.getState();
const dialogStore = useDialogStore.getState();

export const defaultCommands: Command[] = [
  {
    id: "quickOpen.show",
    label: "Quick Open…",
    category: "Navigation",
    handler: () => {
      const state = useCommandPaletteStore.getState();

      if (state.isOpen) {
        commandPaletteStore.closePalette();
        contextService.setValue("inQuickOpen", false);
        contextService.setValue("inCommandPalette", false);
        return;
      }

      commandPaletteStore.openPalette();
      contextService.setValue("inQuickOpen", true);
      contextService.setValue("inCommandPalette", true);
    },
  },
  {
    id: "quickOpen.close",
    label: "Close Quick Open",
    category: "Navigation",
    handler: () => {
      contextService.setValue("inQuickOpen", false);
      contextService.setValue("inCommandPalette", false);
      commandPaletteStore.closePalette();
    },
    when: "inQuickOpen",
  },
  {
    id: "quickOpen.showCommands",
    label: "Show All Commands",
    category: "Navigation",
    handler: () => {
      const state = useCommandPaletteStore.getState();

      if (state.isOpen) {
        // If already open, just set the query to ">"
        state.setQuery(">");
        return;
      }

      commandPaletteStore.openPalette(">");
      contextService.setValue("inQuickOpen", true);
      contextService.setValue("inCommandPalette", true);
    },
  },
  {
    id: "preferences.open",
    label: "Open Preferences",
    category: "Preferences",
    handler: () => {
      usePreferencesStore.getState().openPreferences();
    },
  },
  {
    id: "preferences.close",
    label: "Close Preferences",
    category: "Preferences",
    handler: () => {
      usePreferencesStore.getState().closePreferences();
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
    id: "help.action.openDocs",
    label: "Open Documentation",
    category: "Help",
    handler: () => {
      window.open("https://querypilot.dev/docs", "_blank");
    },
  },
  {
    id: "help.action.reportIssue",
    label: "Report Issue",
    category: "Help",
    handler: () => {
      window.open(
        "https://github.com/querypilot/querypilot/issues/new",
        "_blank",
      );
    },
  },
  {
    id: "editor.action.find",
    label: "Find in Editor",
    category: "Editor",
    handler: () => {
      eventBus.emit("query-editor:find", {});
    },
  },
  {
    id: "editor.action.replace",
    label: "Replace in Editor",
    category: "Editor",
    handler: () => {
      eventBus.emit("query-editor:replace", {});
    },
  },
  {
    id: "window.action.newMainWindow",
    label: "New Main Window",
    category: "Window",
    handler: () => {
      void windowManager.openNewMainWindow();
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
    id: "ai.action.openWithContext",
    label: "Open AI With Focused Context",
    category: "AI",
    handler: () => {
      const workspaceStore = useWorkspaceScreenStore.getState();
      const sidebars = workspaceStore.getSidebars();
      const emitAttach = () => {
        eventBus.emit("ai:open-with-context", { source: "command" });
      };
      if (!sidebars.right) {
        workspaceStore.toggleSidebar("right");
        // Allow time for the sidebar and AIPanel to mount before focusing
        setTimeout(emitAttach, 150);
        return;
      }
      emitAttach();
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
      const currentId = usePanelFocusStore.getState().focusedPanelId ?? firstId;
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
      const currentId = usePanelFocusStore.getState().focusedPanelId ?? firstId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel) return;

      const activeTabId = panel.activeTabId || panel.tabIds[0];
      const totalPanels = store.panelContents.size;

      // Last tab in the only panel → close the window
      if (totalPanels <= 1 && (!activeTabId || panel.tabIds.length <= 1)) {
        void windowManager.closeCurrentWindow();
        return;
      }

      // Last tab in a multi-panel layout → close the panel
      if (totalPanels > 1 && panel.tabIds.length <= 1) {
        const tabStateStore = useTabStateStore.getState();
        for (const tabId of panel.tabIds) {
          tabStateStore.clearQueryState(tabId);
        }
        store.closePanelAction(panelId);
        return;
      }

      // Otherwise just close the active tab
      if (activeTabId) {
        useTabStateStore.getState().clearQueryState(activeTabId);
        store.removeTab(panelId, activeTabId);
      }
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
    id: "workbench.action.closeCurrentTab",
    label: "Close Current Tab",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = usePanelFocusStore.getState().focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel) return;
      const activeTabId = panel.activeTabId || panel.tabIds[0];
      if (!activeTabId) return;
      // Last tab in the only panel — close the window
      if (store.panelContents.size === 1 && panel.tabIds.length <= 1) {
        void windowManager.closeCurrentWindow();
        return;
      }
      store.removeTab(panelId, activeTabId);
    },
  },
  {
    id: "workbench.action.closeOtherTabs",
    label: "Close Other Tabs in Current Panel",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = usePanelFocusStore.getState().focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel) return;
      const activeTabId = panel.activeTabId || panel.tabIds[0];
      if (!activeTabId) return;
      for (const tabId of [...panel.tabIds]) {
        if (tabId !== activeTabId) {
          store.removeTab(panelId, tabId);
        }
      }
    },
  },
  {
    id: "workbench.action.closeOtherTabsAll",
    label: "Close All Other Tabs",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = usePanelFocusStore.getState().focusedPanelId;
      if (!panelId) return;
      const panel = store.panelContents.get(panelId);
      if (!panel) return;
      const activeTabId = panel.activeTabId || panel.tabIds[0];
      if (!activeTabId) return;
      // Close all tabs in other panels
      for (const [otherPanelId, otherPanel] of store.panelContents.entries()) {
        if (otherPanelId === panelId) continue;
        for (const tabId of [...otherPanel.tabIds]) {
          store.removeTab(otherPanelId, tabId);
        }
      }
      // Close other tabs in the current panel
      for (const tabId of [...panel.tabIds]) {
        if (tabId !== activeTabId) {
          store.removeTab(panelId, tabId);
        }
      }
    },
  },
  {
    id: "workbench.action.closePanel",
    label: "Close This Panel",
    category: "Workbench",
    when: "activeEditor && hasMultipleEditors",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const panelId = usePanelFocusStore.getState().focusedPanelId;
      if (!panelId) return;
      const tabStateStore = useTabStateStore.getState();
      const panel = store.panelContents.get(panelId);
      if (panel) {
        for (const tabId of panel.tabIds) {
          tabStateStore.clearQueryState(tabId);
        }
      }
      store.closePanelAction(panelId);
    },
  },
  {
    id: "workbench.action.mergeAllPanels",
    label: "Bring All Tabs to Single Panel",
    category: "Workbench",
    when: "activeEditor && hasMultipleEditors",
    handler: () => {
      const store = useWorkbenchStore.getState();
      const focusedPanelId = usePanelFocusStore.getState().focusedPanelId;
      const panelIds = Array.from(store.panelContents.keys());
      const targetPanelId = focusedPanelId ?? panelIds[0];
      if (!targetPanelId) return;
      for (const panelId of panelIds) {
        if (panelId === targetPanelId) continue;
        const panel = store.panelContents.get(panelId);
        if (!panel) continue;
        for (const tabId of [...panel.tabIds]) {
          store.moveTab(tabId, panelId, targetPanelId);
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
        // Check for pending changes (query text is auto-persisted to tab metadata,
        // so only pending data edits need a warning)
        const hasPendingEdits = crudStore.stagedCommands.size > 0;

        logger.info("[RefreshAll] Pending edits:", hasPendingEdits);

        if (hasPendingEdits) {
          const totalChanges = Array.from(crudStore.stagedCommands.values())
            .reduce((sum, cmds) => sum + cmds.length, 0);
          const description = `${totalChanges} pending data ${totalChanges === 1 ? 'edit' : 'edits'}`;

          logger.info("[RefreshAll] Showing confirmation dialog");

          const confirmed = await useDialogStore.getState().confirm({
            title: "Unsaved changes will be lost",
            description: `You have ${description}. This action cannot be undone.`,
            confirmLabel: "Refresh Anyway",
            cancelLabel: "Cancel",
            variant: "destructive",
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const panelId = usePanelFocusStore.getState().focusedPanelId;
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
      const connectionStore = useConnectionStore.getState();
      const workspaceBundleStore = useWorkspaceBundleStore.getState();

      // Get connected connections from the active workspace
      const activeWorkspace = workspaceBundleStore.activeWorkspace;
      const connectedConnections = activeWorkspace
        ? Array.from(activeWorkspace.connections.values())
            .filter(c => c.status === "connected")
        : [];

      // If multiple connections, show picker
      if (connectedConnections.length > 1) {
        const paletteStore = useCommandPaletteStore.getState();
        paletteStore.openPalette();
        paletteStore.setNestedMode({ type: "new-query-connection" });
        return;
      }

      // Single or no connection - use current behavior
      const workbench = useWorkbenchStore.getState();
      const panels = workbench.panelContents;
      const focusedPanelId =
        usePanelFocusStore.getState().focusedPanelId ?? panels.keys().next().value;
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

      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const selectedSchema = workspaceSelection.schema;

      const activeConnectionId: string = workspaceSelection.connectionId ?? "";
      const connection = activeConnectionId
        ? connectionStore.getConnection(activeConnectionId)
        : null;

      const dbType = connection?.profile.db_type;
      const paradigm = dbType ? getParadigm(dbType) : "sql";

      const tabTypePrefix = paradigm === "document"
        ? "mongo-query"
        : paradigm === "keyvalue"
        ? "redis-cli"
        : "query";

      const tabId = `${tabTypePrefix}-${uuid}`;

      const matchingTabTypes = [tabTypePrefix];

      const totalQueryCount = Array.from(panels.values()).reduce(
        (count, panelContent) => {
          return (
            count +
            panelContent.tabIds.filter((id: string) => {
              const metadata = panelContent.metadata?.[id];
              return matchingTabTypes.some(
                (t) => metadata?.type === t || id.startsWith(`${t}-`)
              );
            }).length
          );
        },
        0,
      );

      const getTitle = () => {
        const num = totalQueryCount > 0 ? ` ${totalQueryCount + 1}` : "";
        switch (paradigm) {
          case "document":
            return `Mongo Shell${num}`;
          case "keyvalue":
            return `Redis CLI${num}`;
          default:
            return totalQueryCount > 0 ? `Query ${totalQueryCount + 1}` : "New Query";
        }
      };

      workbench.addTab(focusedPanelId, tabId, {
        type: tabTypePrefix,
        title: getTitle(),
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
    id: "workbench.action.openErd",
    label: "Open ERD",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const workspaceBundleStore = useWorkspaceBundleStore.getState();
      const connectionStore = useConnectionStore.getState();
      const activeWorkspace = workspaceBundleStore.activeWorkspace;

      if (!activeWorkspace) return;

      // Get connected SQL connections
      const sqlConnections = Array.from(activeWorkspace.connections.values())
        .filter(
          (c) =>
            c.status === "connected" &&
            getParadigm(c.profile.db_type) === "sql",
        );

      if (sqlConnections.length === 0) return;

      // Single non-schema DB connection → open ERD directly (skip picker)
      // Schema-supporting DBs (Postgres, MSSQL) always show picker for schema selection
      if (sqlConnections.length === 1) {
        const conn = sqlConnections[0];
        if (!conn) return;
        const dbType = conn.profile.db_type;
        if (dbType !== DbType.PostgreSQL && dbType !== DbType.SQLServer) {
          const stored = connectionStore.getConnection(conn.id);
          const name = stored?.profile.name ?? conn.profile.name;
          openErdView({
            connectionId: conn.id,
            connectionName: name,
            database: conn.database || conn.profile.database,
          });
          return;
        }
      }

      // Multiple connections or schema-supporting DB → show picker
      const paletteStore = useCommandPaletteStore.getState();
      paletteStore.openPalette();
      paletteStore.setNestedMode({ type: "open-erd" });
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
  // Open Database/Schema Commands
  {
    id: "workspace.openDatabase",
    label: "Open Database",
    category: "Workspace",
    description: "Open a different database on this server",
    handler: () => {
      const store = useCommandPaletteStore.getState();
      store.setNestedMode({ type: "switch-database" });
    },
  },
  {
    id: "workspace.openSchema",
    label: "Open Schema",
    category: "Workspace",
    description: "Open a different schema",
    handler: () => {
      const store = useCommandPaletteStore.getState();
      store.setNestedMode({ type: "switch-schema" });
    },
  },
  // Create Database/Schema Commands
  {
    id: "workspace.createDatabase",
    label: "Create Database",
    category: "Workspace",
    description: "Create a new database",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionStore = useConnectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      const connection = connectionStore.getConnection(connectionId);
      const dbType = connection?.profile.db_type ?? null;
      const sql = getCreateDatabaseTemplate(dbType, "new_database");
      openQueryWithSql({
        connectionId,
        database: workspaceSelection.database,
        schema: null,
        sql,
        title: "Create Database",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createSchema",
    label: "New Schema",
    category: "Workspace",
    description: "Create a new schema",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionStore = useConnectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      const connection = connectionStore.getConnection(connectionId);
      const dbType = connection?.profile.db_type ?? null;
      const sql = getCreateSchemaTemplate(dbType, "new_schema");
      openQueryWithSql({
        connectionId,
        database: workspaceSelection.database,
        schema: null,
        sql,
        title: "Create Schema",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createTable",
    label: "New Table",
    category: "Workspace",
    description: "Create a new table",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openTableDesigner({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createView",
    label: "New View",
    category: "Workspace",
    description: "Create a new view",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openQueryWithTemplate({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
        objectType: "view",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createMaterializedView",
    label: "New Materialized View",
    category: "Workspace",
    description: "Create a new materialized view",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openQueryWithTemplate({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
        objectType: "materializedView",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createFunction",
    label: "New Function",
    category: "Workspace",
    description: "Create a new function",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openQueryWithTemplate({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
        objectType: "function",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createProcedure",
    label: "New Procedure",
    category: "Workspace",
    description: "Create a new procedure",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openQueryWithTemplate({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
        objectType: "procedure",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "workspace.createTrigger",
    label: "New Trigger",
    category: "Workspace",
    description: "Create a new trigger",
    handler: () => {
      const workspaceSelection = useWorkspaceSelectionStore.getState();
      const connectionId = workspaceSelection.connectionId;
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }
      openQueryWithTemplate({
        connectionId,
        database: workspaceSelection.database,
        schema: workspaceSelection.schema,
        objectType: "trigger",
      });
      commandPaletteStore.closePalette();
    },
  },
  {
    id: "connection.open",
    label: "Open Connection",
    category: "Connection",
    description: "Open a saved database connection",
    handler: () => {
      const store = useCommandPaletteStore.getState();
      store.setNestedMode({ type: "open-connection" });
    },
  },
  {
    id: "connection.setSafeMode",
    label: "Set Safe Mode",
    category: "Connection",
    description: "Restrict allowed operations on this connection",
    handler: () => {
      const store = useCommandPaletteStore.getState();
      store.setNestedMode({ type: "set-safe-mode" });
    },
  },
  {
    id: "workspace.switch",
    label: "Switch Workspace",
    category: "Workspace",
    description: "Switch to a different saved workspace",
    handler: () => {
      const store = useCommandPaletteStore.getState();
      store.setNestedMode({ type: "switch-workspace" });
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
  // Data Grid Commands (routed to focused grid instance)
  {
    id: "dataGrid.action.focusFilter",
    label: "Focus Grid Filter",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.focusFilter?.();
    },
  },
  {
    id: "dataGrid.action.copySelection",
    label: "Copy Selection",
    category: "Data Grid",
    when: "dataGridFocus && !selectionEmpty && !editingCell",
    handler: () => {
      void dataGridRegistry.getFocused()?.copySelection?.();
    },
  },
  {
    id: "dataGrid.action.copyAsJson",
    label: "Copy Selection as JSON",
    category: "Data Grid",
    when: "dataGridFocus && !selectionEmpty && !editingCell",
    handler: () => {
      void dataGridRegistry.getFocused()?.copySelectionAsJson?.();
    },
  },
  {
    id: "dataGrid.action.fillDown",
    label: "Fill Down",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.fillDown?.();
    },
  },
  {
    id: "dataGrid.action.fillRight",
    label: "Fill Right",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.fillRight?.();
    },
  },
  {
    id: "dataGrid.action.duplicateRows",
    label: "Duplicate Rows",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.duplicateRows?.();
    },
  },
  {
    id: "dataGrid.action.deleteRows",
    label: "Delete Rows",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell && dataGridEditable",
    handler: () => {
      dataGridRegistry.getFocused()?.deleteRows?.();
    },
  },
  {
    id: "dataGrid.action.showContextMenu",
    label: "Show Context Menu",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.showContextMenu?.();
    },
  },
  {
    id: "dataGrid.action.clearSelection",
    label: "Clear Selection",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.clearSelection?.();
    },
  },
  {
    id: "dataGrid.action.toggleInspector",
    label: "Toggle Inspector",
    category: "Data Grid",
    when: "dataGridFocus && !editingCell",
    handler: () => {
      dataGridRegistry.getFocused()?.toggleInspector?.();
    },
  },
  // Query Editor Commands (Event-Driven)
  {
    id: "editor.action.formatQuery",
    label: "Format Query",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("format");
    },
  },
  {
    id: "editor.action.executeQuery",
    label: "Execute Query",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("execute");
    },
  },
  {
    id: "editor.action.executeAll",
    label: "Execute All Statements",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("executeAll");
    },
  },
  {
    id: "editor.action.executeQueryInBackground",
    label: "Execute Query in Background",
    category: "Editor",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("execute");
    },
  },
  // Query History Commands
  {
    id: "query.history.show",
    label: "Show Query History",
    category: "Query History",
    handler: () => {
      // Open sidebar if closed, then switch to queries view
      const screenStore = useWorkspaceScreenStore.getState();
      if (!screenStore.getSidebars().left) {
        screenStore.toggleSidebar("left");
      }
      eventBus.emit("sidebar:switch-view", { view: "queries" });
      useQueryHistoryStore.getState().setActiveTab("history");
    },
  },
  {
    id: "query.saved.show",
    label: "Show Saved Queries",
    category: "Query History",
    handler: () => {
      // Open sidebar if closed, then switch to queries view
      const screenStore = useWorkspaceScreenStore.getState();
      if (!screenStore.getSidebars().left) {
        screenStore.toggleSidebar("left");
      }
      eventBus.emit("sidebar:switch-view", { view: "queries" });
      useQueryHistoryStore.getState().setActiveTab("saved");
    },
  },
  {
    id: "query.history.search",
    label: "Search Query History",
    category: "Query History",
    handler: () => {
      // Open sidebar if closed, then switch to queries view
      const screenStore = useWorkspaceScreenStore.getState();
      if (!screenStore.getSidebars().left) {
        screenStore.toggleSidebar("left");
      }
      eventBus.emit("sidebar:switch-view", { view: "queries" });
      useQueryHistoryStore.getState().setActiveTab("history");
      // Focus the search input after a brief delay for view to render
      setTimeout(() => {
        eventBus.emit("query-history:focus-search", undefined);
      }, 100);
    },
  },
  {
    id: "query.history.clear",
    label: "Clear Query History",
    category: "Query History",
    handler: async () => {
      const confirmed = await new Promise<boolean>((resolve) => {
        let resolved = false;

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

        const toastId = toast(
          React.createElement(ConfirmationToast, {
            title: "Clear query history?",
            description: "This action cannot be undone.",
            confirmLabel: "Clear History",
            cancelLabel: "Cancel",
            onConfirm: handleConfirm,
            onCancel: handleCancel,
          }),
          {
            duration: 12000,
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
          },
        );
      });

      if (!confirmed) return;
      await useQueryHistoryStore.getState().clearHistory();
      toast.success("Query history cleared");
    },
  },
  {
    id: "query.saved.create",
    label: "Save Current Query",
    category: "Query History",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:save", {});
    },
  },
  {
    id: "query.saved.search",
    label: "Search Saved Queries",
    category: "Query History",
    handler: () => {
      const paletteStore = useCommandPaletteStore.getState();
      paletteStore.setNestedMode({ type: "search-saved-queries" });
      paletteStore.openPalette();
    },
  },
];
