import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import {
  type WorkspaceStore,
  type WorkspaceState,
  type TabState,
  type SerializableWorkspaceStore,
  type SerializableWorkspaceState,
  type SerializableTabState,
} from "@/types/workspace";

// Enable MapSet plugin for Immer to handle Map objects
enableMapSet();

// Legacy interface for backward compatibility
export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
  connectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    immer((set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: null,

      // Workspace actions
      addWorkspace: (workspace) => {
        const id = crypto.randomUUID();
        const now = new Date();

        set((state) => {
          state.workspaces.set(id, {
            id,
            name: workspace.name,
            path: workspace.path,
            connectionIds: workspace.connectionIds || [],
            activeConnectionId: null,
            tabs: new Map(),
            tabOrder: [],
            activeTabId: null,
            settings: {
              defaultPageSize: 100,
              autoSave: true,
              confirmOnClose: true,
              theme: "system",
              maxTabsOpen: 20,
            },
            createdAt: now,
            updatedAt: now,
            lastOpened: now,
          });
          state.activeWorkspaceId = id;
        });

        return id;
      },

      removeWorkspace: (id) => {
        // Don't allow removing the Uncategorized workspace
        if (id === "uncategorized") return;

        set((state) => {
          state.workspaces.delete(id);
          if (state.activeWorkspaceId === id) {
            state.activeWorkspaceId = null;
          }
        });
      },

      updateWorkspace: (id, updates) => {
        set((state) => {
          const workspace = state.workspaces.get(id);
          if (workspace) {
            Object.assign(workspace, updates);
            workspace.updatedAt = new Date();
          }
        });
      },

      setActiveWorkspace: (id) => {
        set((state) => {
          state.activeWorkspaceId = id;
        });
        if (id) {
          get().updateLastOpened(id);
        }
      },

      // Connection actions
      addConnectionToWorkspace: (workspaceId, connectionId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (workspace && !workspace.connectionIds.includes(connectionId)) {
            workspace.connectionIds.push(connectionId);
            workspace.updatedAt = new Date();

            // Set as active connection if none is active
            if (!workspace.activeConnectionId) {
              workspace.activeConnectionId = connectionId;
            }
          }
        });
      },

      removeConnectionFromWorkspace: (workspaceId, connectionId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (workspace) {
            workspace.connectionIds = workspace.connectionIds.filter(
              (id) => id !== connectionId,
            );
            workspace.updatedAt = new Date();

            // Clear active connection if removed
            if (workspace.activeConnectionId === connectionId) {
              workspace.activeConnectionId = workspace.connectionIds[0] || null;
            }

            // Close all tabs for this connection
            const tabsToClose = [...workspace.tabs.entries()]
              .filter(([, tab]) => tab.connectionId === connectionId)
              .map(([tabId]) => tabId);

            tabsToClose.forEach((tabId) => {
              workspace.tabs.delete(tabId);
              workspace.tabOrder = workspace.tabOrder.filter(
                (id) => id !== tabId,
              );
            });

            // Update active tab if it was closed
            if (
              workspace.activeTabId &&
              tabsToClose.includes(workspace.activeTabId)
            ) {
              workspace.activeTabId = workspace.tabOrder[0] || null;
            }
          }
        });
      },

      setActiveConnection: (workspaceId, connectionId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (workspace && workspace.connectionIds.includes(connectionId)) {
            workspace.activeConnectionId = connectionId;
            workspace.updatedAt = new Date();
          }
        });
      },

      // Tab actions
      addTab: (workspaceId, tab) => {
        const tabId = crypto.randomUUID();
        const now = new Date();

        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;

          // Ensure tab has a connection
          const connectionId = tab.connectionId || workspace.activeConnectionId;
          if (!connectionId) {
            throw new Error("Tab must have a connection");
          }

          // Check max tabs limit
          if (workspace.tabs.size >= workspace.settings.maxTabsOpen) {
            // Close the oldest tab
            const oldestTabId = workspace.tabOrder[0];
            if (oldestTabId) {
              workspace.tabs.delete(oldestTabId);
              workspace.tabOrder = workspace.tabOrder.filter(
                (id) => id !== oldestTabId,
              );
            }
          }

          const newTab: TabState = {
            id: tabId,
            type: tab.type || "query",
            connectionId,
            title: tab.title || "New Query",
            icon: tab.icon,
            payload: tab.payload || {},
            ui: {
              scrollTop: 0,
              scrollLeft: 0,
              columnWidths: {},
              selectedRows: new Set(),
              expandedRows: new Set(),
              hiddenColumns: new Set(),
              columnOrder: [],
              ...tab.ui,
            },
            isDirty: false,
            isLoading: false,
            error: undefined,
            createdAt: now,
            lastAccessedAt: now,
          };

          workspace.tabs.set(tabId, newTab);
          workspace.tabOrder.push(tabId);
          workspace.activeTabId = tabId;
          workspace.updatedAt = now;

          // Sync active connection with tab's connection
          workspace.activeConnectionId = connectionId;
        });

        return tabId;
      },

      updateTab: (workspaceId, tabId, updates) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            Object.assign(tab, updates);
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      closeTab: (workspaceId, tabId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;

          workspace.tabs.delete(tabId);
          workspace.tabOrder = workspace.tabOrder.filter((id) => id !== tabId);

          // Update active tab if closed
          if (workspace.activeTabId === tabId) {
            const currentIndex = workspace.tabOrder.indexOf(tabId);
            const nextIndex = Math.max(0, currentIndex - 1);
            workspace.activeTabId = workspace.tabOrder[nextIndex] || null;
          }

          workspace.updatedAt = new Date();
        });
      },

      setActiveTab: (workspaceId, tabId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            workspace.activeTabId = tabId;
            workspace.activeConnectionId = tab.connectionId;
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      reorderTabs: (workspaceId, newOrder) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (workspace) {
            workspace.tabOrder = newOrder;
            workspace.updatedAt = new Date();
          }
        });
      },

      duplicateTab: (workspaceId, tabId) => {
        const originalTab = get().workspaces.get(workspaceId)?.tabs.get(tabId);
        if (!originalTab) return "";

        return get().addTab(workspaceId, {
          ...originalTab,
          title: `${originalTab.title} (Copy)`,
          id: crypto.randomUUID(),
        });
      },

      closeOtherTabs: (workspaceId, tabId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;

          // Keep only the specified tab
          const keepTab = workspace.tabs.get(tabId);
          if (keepTab) {
            workspace.tabs.clear();
            workspace.tabs.set(tabId, keepTab);
            workspace.tabOrder = [tabId];
            workspace.activeTabId = tabId;
            workspace.updatedAt = new Date();
          }
        });
      },

      closeTabsToRight: (workspaceId, tabId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;

          const tabIndex = workspace.tabOrder.indexOf(tabId);
          if (tabIndex === -1) return;

          // Remove tabs to the right
          const tabsToRemove = workspace.tabOrder.slice(tabIndex + 1);
          tabsToRemove.forEach((id) => workspace.tabs.delete(id));
          workspace.tabOrder = workspace.tabOrder.slice(0, tabIndex + 1);

          // Update active tab if it was removed
          if (
            workspace.activeTabId &&
            tabsToRemove.includes(workspace.activeTabId)
          ) {
            workspace.activeTabId = tabId;
          }

          workspace.updatedAt = new Date();
        });
      },

      // Tab state actions
      updateTabUI: (workspaceId, tabId, ui) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            Object.assign(tab.ui, ui);
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      setTabDirty: (workspaceId, tabId, isDirty) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            tab.isDirty = isDirty;
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      setTabLoading: (workspaceId, tabId, isLoading) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            tab.isLoading = isLoading;
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      setTabError: (workspaceId, tabId, error) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            tab.error = error;
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      updateTabPayload: (workspaceId, tabId, payload) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);

          if (workspace && tab) {
            Object.assign(tab.payload, payload);
            tab.lastAccessedAt = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      // Getters
      getActiveWorkspace: () => {
        const state = get();
        return state.activeWorkspaceId
          ? state.workspaces.get(state.activeWorkspaceId) || null
          : null;
      },

      getWorkspace: (workspaceId: string) => {
        return get().workspaces.get(workspaceId) || null;
      },

      removeTab: (workspaceId: string, tabId: string) => {
        get().closeTab(workspaceId, tabId);
      },

      getActiveTab: () => {
        const workspace = get().getActiveWorkspace();
        return workspace?.activeTabId
          ? workspace.tabs.get(workspace.activeTabId) || null
          : null;
      },

      getTabsByConnection: (connectionId) => {
        const tabs: TabState[] = [];
        const workspaces = get().workspaces;

        for (const workspace of workspaces.values()) {
          for (const tab of workspace.tabs.values()) {
            if (tab.connectionId === connectionId) {
              tabs.push(tab);
            }
          }
        }

        return tabs;
      },

      getWorkspaceByConnectionId: (connectionId) => {
        const workspaces = get().workspaces;
        for (const workspace of workspaces.values()) {
          if (workspace.connectionIds.includes(connectionId)) {
            return workspace;
          }
        }
        return undefined;
      },

      getDirtyTabs: (workspaceId) => {
        const workspace = get().workspaces.get(workspaceId);
        if (!workspace) return [];

        return Array.from(workspace.tabs.values()).filter((tab) => tab.isDirty);
      },

      // Utility actions
      updateLastOpened: (id) => {
        set((state) => {
          const workspace = state.workspaces.get(id);
          if (workspace) {
            workspace.lastOpened = new Date();
            workspace.updatedAt = new Date();
          }
        });
      },

      cleanupClosedTabs: (workspaceId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;

          // Remove tabs that are no longer in tabOrder
          const validTabIds = new Set(workspace.tabOrder);
          for (const [tabId] of workspace.tabs) {
            if (!validTabIds.has(tabId)) {
              workspace.tabs.delete(tabId);
            }
          }

          // Ensure active tab is valid
          if (
            workspace.activeTabId &&
            !workspace.tabs.has(workspace.activeTabId)
          ) {
            workspace.activeTabId = workspace.tabOrder[0] || null;
          }

          workspace.updatedAt = new Date();
        });
      },

      ensureUncategorizedWorkspace: () => {
        const workspaces = get().workspaces;
        if (!workspaces.has("uncategorized")) {
          const now = new Date();
          set((state) => {
            state.workspaces.set("uncategorized", {
              id: "uncategorized",
              name: "Uncategorized",
              path: "~/",
              connectionIds: [],
              activeConnectionId: null,
              tabs: new Map(),
              tabOrder: [],
              activeTabId: null,
              settings: {
                defaultPageSize: 100,
                autoSave: true,
                confirmOnClose: true,
                theme: "system",
                maxTabsOpen: 20,
              },
              createdAt: now,
              updatedAt: now,
              lastOpened: now,
            });
          });
        }
      },
    })),
    {
      name: "workspace-storage-v2",
      storage: createJSONStorage(() => localStorage),
      // Custom serialization to handle Maps and Sets
      partialize: (state): SerializableWorkspaceStore => ({
        workspaces: Array.from(state.workspaces.entries()).map(
          ([id, ws]): [string, SerializableWorkspaceState] => [
            id,
            {
              ...ws,
              tabs: Array.from(ws.tabs.entries()).map(
                ([tabId, tab]): [string, SerializableTabState] => [
                  tabId,
                  {
                    ...tab,
                    ui: {
                      ...tab.ui,
                      selectedRows: Array.from(tab.ui.selectedRows),
                      expandedRows: Array.from(tab.ui.expandedRows),
                      hiddenColumns: Array.from(tab.ui.hiddenColumns),
                      columnOrder: tab.ui.columnOrder,
                    },
                    createdAt: tab.createdAt.toISOString(),
                    lastAccessedAt: tab.lastAccessedAt.toISOString(),
                  },
                ],
              ),
              createdAt: ws.createdAt.toISOString(),
              updatedAt: ws.updatedAt.toISOString(),
              lastOpened: ws.lastOpened.toISOString(),
            },
          ],
        ),
        activeWorkspaceId: state.activeWorkspaceId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Restore Maps and Sets from arrays
        const workspaces = new Map<string, WorkspaceState>();

        // state.workspaces is actually an array of [key, value] pairs during rehydration
        (state.workspaces as any).forEach(([id, ws]: [string, any]) => {
          const tabs = new Map<string, TabState>();

          ws.tabs.forEach(([tabId, tab]: [string, any]) => {
            tabs.set(tabId, {
              ...tab,
              ui: {
                ...tab.ui,
                selectedRows: new Set(tab.ui.selectedRows),
                expandedRows: new Set(tab.ui.expandedRows),
                hiddenColumns: new Set(tab.ui.hiddenColumns),
              },
              createdAt: new Date(tab.createdAt),
              lastAccessedAt: new Date(tab.lastAccessedAt),
            });
          });

          workspaces.set(id, {
            ...ws,
            tabs,
            createdAt: new Date(ws.createdAt),
            updatedAt: new Date(ws.updatedAt),
            lastOpened: new Date(ws.lastOpened),
          });
        });

        state.workspaces = workspaces;

        // Ensure Uncategorized workspace exists
        state.ensureUncategorizedWorkspace();
      },
    },
  ),
);
