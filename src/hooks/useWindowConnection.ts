import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { type ConnectionChangedEvent } from '@/types/connection';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowConnection() {
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current window's active connection on mount
  useEffect(() => {
    const fetchActiveConnection = async () => {
      try {
        setLoading(true);
        const connectionId = await invoke<string | null>('get_active_connection');
        setActiveConnectionId(connectionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get active connection');
      } finally {
        setLoading(false);
      }
    };

    fetchActiveConnection();
  }, []);

  // Listen for connection changes
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      const currentWindow = getCurrentWindow();
      const windowLabel = currentWindow.label;

      unlisten = await listen<ConnectionChangedEvent>('active_connection_changed', (event) => {
        // Only update if this window is affected
        if (event.payload.window === windowLabel) {
          setActiveConnectionId(event.payload.connection_id);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Set active connection for this window
  const setActiveConnection = useCallback(async (connectionId: string) => {
    try {
      setError(null);
      await invoke('set_active_connection', { connectionId });
      setActiveConnectionId(connectionId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to set active connection';
      setError(errorMsg);
      throw new Error(errorMsg);
    }
  }, []);

  // Clear active connection for this window
  const clearActiveConnection = useCallback(async () => {
    try {
      setError(null);
      await invoke('remove_window_connection');
      setActiveConnectionId(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to clear active connection';
      setError(errorMsg);
      throw new Error(errorMsg);
    }
  }, []);

  // Switch to window with specific connection
  const switchToConnectionWindow = useCallback(async (connectionId: string) => {
    try {
      setError(null);
      await invoke('switch_to_connection_window', { connectionId });
    } catch (err) {
      // If no window found with this connection, set it in current window
      await setActiveConnection(connectionId);
    }
  }, [setActiveConnection]);

  return {
    activeConnectionId,
    loading,
    error,
    setActiveConnection,
    clearActiveConnection,
    switchToConnectionWindow,
  };
}