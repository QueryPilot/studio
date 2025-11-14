import { create } from "zustand";
import {
  connectionWindowTracker,
  type ConnectionStatus,
} from "@/services/connectionWindowTracker";
import { safeListen } from "@/utils/tauri";

interface ConnectionWindowStore {
  // Map of connectionId -> ConnectionStatus
  connectionStatuses: Map<string, ConnectionStatus>;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  getConnectionStatus: (connectionId: string) => ConnectionStatus | undefined;
  hasOpenWindows: (connectionId: string) => boolean;
  getWindowCount: (connectionId: string) => number;
  refreshAllStatuses: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useConnectionWindowStore = create<ConnectionWindowStore>(
  (set, get) => ({
    connectionStatuses: new Map(),

    setConnectionStatus: (status: ConnectionStatus) => {
      set((state) => {
        const newStatuses = new Map(state.connectionStatuses);
        if (status.window_count === 0) {
          // Remove if no windows
          newStatuses.delete(status.connection_id);
        } else {
          newStatuses.set(status.connection_id, status);
        }
        return { connectionStatuses: newStatuses };
      });
    },

    getConnectionStatus: (connectionId: string) => {
      return get().connectionStatuses.get(connectionId);
    },

    hasOpenWindows: (connectionId: string) => {
      const status = get().connectionStatuses.get(connectionId);
      return (status?.window_count ?? 0) > 0;
    },

    getWindowCount: (connectionId: string) => {
      const status = get().connectionStatuses.get(connectionId);
      return status?.window_count ?? 0;
    },

    refreshAllStatuses: async () => {
      const statuses = await connectionWindowTracker.getAllConnectionStatuses();
      set(() => {
        const newStatuses = new Map<string, ConnectionStatus>();
        statuses.forEach((status) => {
          newStatuses.set(status.connection_id, status);
        });
        return { connectionStatuses: newStatuses };
      });
    },

    initialize: async () => {
      // Load initial statuses
      await get().refreshAllStatuses();

      // Listen for window open events
      await safeListen<ConnectionStatus>(
        "connection-window-opened",
        (event) => {
          console.log(
            "[ConnectionWindowStore] Window opened:",
            event.payload.connection_id,
            "windows:",
            event.payload.window_count,
          );
          get().setConnectionStatus(event.payload);
        },
      );

      // Listen for window close events
      await safeListen<ConnectionStatus>(
        "connection-window-closed",
        (event) => {
          console.log(
            "[ConnectionWindowStore] Window closed:",
            event.payload.connection_id,
            "windows:",
            event.payload.window_count,
          );
          get().setConnectionStatus(event.payload);
        },
      );

      console.log("[ConnectionWindowStore] Initialized and listening to events");
    },
  }),
);

