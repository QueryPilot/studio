/**
 * Workspace Selection Store - Backwards Compatibility Wrapper
 *
 * This store provides backwards compatibility with existing code that relies
 * on the old single-connection API. It syncs with workspaceBundleStore.
 */

import { create } from "zustand";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";

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

    setActiveConnection: (connectionId: string | null) => {
      const bundleStore = useWorkspaceBundleStore.getState();
      if (connectionId && bundleStore.activeWorkspace) {
        bundleStore.setFocusedConnection(connectionId);
      }
      set({ connectionId: connectionId ?? null });
    },

    setSelectedDatabase: (database: string) => {
      const { connectionId, workspaceStates, schema } = get();

      // Sync to workspaceBundleStore if active
      const bundleStore = useWorkspaceBundleStore.getState();
      const focused = bundleStore.getFocusedConnection();
      if (focused && focused.id === connectionId) {
        bundleStore.updateConnectionState(focused.id, database, focused.schema);
      }

      // Update local state
      set({ database });

      // Also update per-connection state
      if (connectionId) {
        const newStates = new Map(workspaceStates);
        const existing = newStates.get(connectionId);
        newStates.set(connectionId, {
          connectionId,
          database,
          schema: existing?.schema ?? schema ?? null,
        });
        set({ workspaceStates: newStates });
      }
    },

    setSchema: (schema: string) => {
      const { connectionId, workspaceStates, database } = get();

      // Sync to workspaceBundleStore if active
      const bundleStore = useWorkspaceBundleStore.getState();
      const focused = bundleStore.getFocusedConnection();
      if (focused && focused.id === connectionId) {
        bundleStore.updateConnectionState(focused.id, focused.database, schema);
      }

      // Update local state
      set({ schema });

      // Also update per-connection state
      if (connectionId) {
        const newStates = new Map(workspaceStates);
        const existing = newStates.get(connectionId);
        newStates.set(connectionId, {
          connectionId,
          database: existing?.database ?? database ?? null,
          schema,
        });
        set({ workspaceStates: newStates });
      }
    },

    getConnectionState: (connectionId: string) => {
      // First try workspaceBundleStore
      const bundleStore = useWorkspaceBundleStore.getState();
      const conn = bundleStore.getConnectionById(connectionId);
      if (conn) {
        return {
          database: conn.database,
          schema: conn.schema,
        };
      }

      // Fall back to legacy state
      const state = get().workspaceStates.get(connectionId);
      return {
        database: state?.database ?? null,
        schema: state?.schema ?? null,
      };
    },
  }),
);

// Subscribe to workspaceBundleStore changes to sync focused connection
useWorkspaceBundleStore.subscribe((state) => {
  const focused = state.getFocusedConnection();
  if (focused) {
    const currentStore = useWorkspaceSelectionStore.getState();
    if (
      currentStore.connectionId !== focused.id ||
      currentStore.database !== focused.database ||
      currentStore.schema !== focused.schema
    ) {
      useWorkspaceSelectionStore.setState({
        connectionId: focused.id,
        database: focused.database,
        schema: focused.schema,
      });
    }
  }
});
