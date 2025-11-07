import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { type ConnectionDeletedEvent } from '@/types/connection';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useConnectionSync() {
  const { fetchConnections } = useConnectionStore();

  useEffect(() => {
    let unlistenConnectionsChanged: UnlistenFn | undefined;
    let unlistenConnectionDeleted: UnlistenFn | undefined;

    const setupListeners = async () => {
      // Listen for connection list changes
      unlistenConnectionsChanged = await listen('connections_changed', () => {
        // Re-fetch connections from backend
        void fetchConnections();
      });

      // Listen for connection deletions
      unlistenConnectionDeleted = await listen<ConnectionDeletedEvent>('connection_deleted', (event) => {
        const currentWindow = getCurrentWindow();
        const windowLabel = currentWindow.label;

        // Check if current window is affected
        if (event.payload.affected_windows.includes(windowLabel)) {
          // Clear active connection in UI
          // This will be handled by useWindowConnection hook
          console.log('Current window was using deleted connection:', event.payload.connection_id);
        }

        // Re-fetch connections to update the list
        void fetchConnections();
      });
    };

    void setupListeners();

    return () => {
      if (unlistenConnectionsChanged) {
        unlistenConnectionsChanged();
      }
      if (unlistenConnectionDeleted) {
        unlistenConnectionDeleted();
      }
    };
  }, [fetchConnections]);
}