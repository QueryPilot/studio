import { create } from "zustand";

interface WorkspaceSelectionState {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  // Per-connection state to handle multiple windows
  workspaceStates: Map<
    string,
    { connectionId: string; database: string | null; schema: string | null }
  >;
  setActiveConnection: (connectionId: string | null) => void;
  setSelectedDatabase: (database: string) => void;
  setSchema: (schema: string) => void;
  // Get state for a specific connection (for multi-window support)
  getConnectionState: (connectionId: string) => {
    database: string | null;
    schema: string | null;
  };
}

export const useWorkspaceSelectionStore = create<WorkspaceSelectionState>(
  (set, get) => ({
    connectionId: null,
    database: null,
    schema: null,
    workspaceStates: new Map(),
    setActiveConnection: (connectionId) => {
      set({ connectionId: connectionId ?? null });
    },
    setSelectedDatabase: (database: string) => {
      const { connectionId, workspaceStates } = get();
      set({ database: database });

      // Also update per-connection state
      if (connectionId) {
        const newStates = new Map(workspaceStates);
        const existing = newStates.get(connectionId);
        newStates.set(connectionId, {
          connectionId,
          database,
          schema: existing?.schema ?? null,
        });
        set({ workspaceStates: newStates });
      }
    },
    setSchema: (schema: string) => {
      const { connectionId, workspaceStates } = get();
      set({ schema });

      // Also update per-connection state
      if (connectionId) {
        const newStates = new Map(workspaceStates);
        const existing = newStates.get(connectionId);
        newStates.set(connectionId, {
          connectionId,
          database: existing?.database ?? null,
          schema,
        });
        set({ workspaceStates: newStates });
      }
    },
    getConnectionState: (connectionId: string) => {
      const state = get().workspaceStates.get(connectionId);
      return {
        database: state?.database ?? null,
        schema: state?.schema ?? null,
      };
    },
  }),
);
