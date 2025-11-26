import { logger } from "@/lib/logger";
import { create } from "zustand";
import {
  windowChannelTracker,
  type ConnectionStatus,
} from "@/services/windowChannelTracker";

interface ConnectionWindowStore {
  // Map of connectionId -> ConnectionStatus
  connectionStatuses: Map<string, ConnectionStatus>;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  getConnectionStatus: (connectionId: string) => ConnectionStatus | undefined;
  hasOpenWindows: (connectionId: string) => boolean;
  getWindowCount: (connectionId: string) => number;
  refreshAllStatuses: () => void;
  initialize: () => void;
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

    refreshAllStatuses: () => {
      const statuses = windowChannelTracker.getAllConnectionStatuses();
      set(() => {
        const newStatuses = new Map<string, ConnectionStatus>();
        statuses.forEach((status) => {
          newStatuses.set(status.connection_id, status);
        });
        return { connectionStatuses: newStatuses };
      });
    },

    initialize: () => {
      // Subscribe to status changes from BroadcastChannel
      const unsubscribe = windowChannelTracker.onStatusChange((statuses) => {
        logger.info(
          "[ConnectionWindowStore] Status update received:",
          statuses.length,
          "connection(s)",
        );

        set(() => {
          const newStatuses = new Map<string, ConnectionStatus>();
          statuses.forEach((status) => {
            if (status.window_count > 0) {
              newStatuses.set(status.connection_id, status);
            }
          });
          return { connectionStatuses: newStatuses };
        });
      });

      logger.info(
        "[ConnectionWindowStore] Initialized with BroadcastChannel tracking",
      );

      // Store unsubscribe function for cleanup (if needed)
      // Note: For now we don't clean up since this is a singleton store
      return unsubscribe;
    },
  }),
);

