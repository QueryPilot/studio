import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
  connectionIds: string[]; // Array of connection IDs
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceStore {
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  
  addWorkspace: (workspace: Omit<Workspace, "id" | "createdAt" | "updatedAt">) => string;
  removeWorkspace: (id: string) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
  setActiveWorkspace: (id: string | null) => void;
  addConnectionToWorkspace: (workspaceId: string, connectionId: string) => void;
  removeConnectionFromWorkspace: (workspaceId: string, connectionId: string) => void;
  updateLastOpened: (id: string) => void;
  getWorkspaceByConnectionId: (connectionId: string) => Workspace | undefined;
  ensureUncategorizedWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: null,

      addWorkspace: (workspace) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const newWorkspace: Workspace = {
          ...workspace,
          id,
          createdAt: now,
          updatedAt: now,
          connectionIds: workspace.connectionIds || [],
        };
        
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          newWorkspaces.set(id, newWorkspace);
          return { workspaces: newWorkspaces };
        });
        
        return id;
      },

      removeWorkspace: (id) => {
        // Don't allow removing the Uncategorized workspace
        if (id === "uncategorized") return;
        
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          newWorkspaces.delete(id);
          return {
            workspaces: newWorkspaces,
            activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
          };
        });
      },

      updateWorkspace: (id, updates) => {
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          const workspace = newWorkspaces.get(id);
          if (workspace) {
            newWorkspaces.set(id, {
              ...workspace,
              ...updates,
              updatedAt: new Date().toISOString(),
            });
          }
          return { workspaces: newWorkspaces };
        });
      },

      setActiveWorkspace: (id) => {
        set({ activeWorkspaceId: id });
        if (id) {
          get().updateLastOpened(id);
        }
      },

      addConnectionToWorkspace: (workspaceId, connectionId) => {
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          const workspace = newWorkspaces.get(workspaceId);
          if (workspace && !workspace.connectionIds.includes(connectionId)) {
            newWorkspaces.set(workspaceId, {
              ...workspace,
              connectionIds: [...workspace.connectionIds, connectionId],
              updatedAt: new Date().toISOString(),
            });
          }
          return { workspaces: newWorkspaces };
        });
      },

      removeConnectionFromWorkspace: (workspaceId, connectionId) => {
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          const workspace = newWorkspaces.get(workspaceId);
          if (workspace) {
            newWorkspaces.set(workspaceId, {
              ...workspace,
              connectionIds: workspace.connectionIds.filter(id => id !== connectionId),
              updatedAt: new Date().toISOString(),
            });
          }
          return { workspaces: newWorkspaces };
        });
      },

      updateLastOpened: (id) => {
        set((state) => {
          const newWorkspaces = new Map(state.workspaces);
          const workspace = newWorkspaces.get(id);
          if (workspace) {
            newWorkspaces.set(id, {
              ...workspace,
              lastOpened: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
          return { workspaces: newWorkspaces };
        });
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

      ensureUncategorizedWorkspace: () => {
        const workspaces = get().workspaces;
        if (!workspaces.has("uncategorized")) {
          const now = new Date().toISOString();
          set((state) => {
            const newWorkspaces = new Map(state.workspaces);
            newWorkspaces.set("uncategorized", {
              id: "uncategorized",
              name: "Uncategorized",
              path: "~/",
              lastOpened: now,
              connectionIds: [],
              createdAt: now,
              updatedAt: now,
            });
            return { workspaces: newWorkspaces };
          });
        }
      },
    }),
    {
      name: "workspace-storage",
      // Custom serialization to handle Map
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              workspaces: new Map(state.workspaces),
            },
          };
        },
        setItem: (name, value) => {
          const { state } = value as { state: WorkspaceStore };
          const serialized = {
            state: {
              ...state,
              workspaces: Array.from(state.workspaces.entries()),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      onRehydrateStorage: () => (state) => {
        // Ensure Uncategorized workspace exists after rehydration
        state?.ensureUncategorizedWorkspace();
      },
    },
  ),
);