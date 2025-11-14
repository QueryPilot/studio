import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/utils/tauri";

export interface ConnectionStatus {
  connection_id: string;
  window_labels: string[];
  window_count: number;
}

class ConnectionWindowTracker {
  /**
   * Register the current window with a connection
   */
  async registerWindow(connectionId: string): Promise<void> {
    if (!isTauri()) return;

    try {
      const currentWindow = getCurrentWindow();
      const windowLabel = currentWindow.label;

      await invoke("register_connection_window", {
        connectionId,
        windowLabel,
      });

      console.log(
        `[ConnectionWindowTracker] Registered window ${windowLabel} for connection ${connectionId}`,
      );
    } catch (error) {
      console.error(
        "[ConnectionWindowTracker] Failed to register window:",
        error,
      );
    }
  }

  /**
   * Unregister the current window
   */
  async unregisterWindow(): Promise<void> {
    if (!isTauri()) return;

    try {
      const currentWindow = getCurrentWindow();
      const windowLabel = currentWindow.label;

      await invoke("unregister_connection_window", {
        windowLabel,
      });

      console.log(
        `[ConnectionWindowTracker] Unregistered window ${windowLabel}`,
      );
    } catch (error) {
      console.error(
        "[ConnectionWindowTracker] Failed to unregister window:",
        error,
      );
    }
  }

  /**
   * Get connection status (how many windows are open)
   */
  async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    if (!isTauri()) {
      return {
        connection_id: connectionId,
        window_labels: [],
        window_count: 0,
      };
    }

    try {
      return await invoke<ConnectionStatus>("get_connection_status", {
        connectionId,
      });
    } catch (error) {
      console.error(
        "[ConnectionWindowTracker] Failed to get connection status:",
        error,
      );
      return {
        connection_id: connectionId,
        window_labels: [],
        window_count: 0,
      };
    }
  }

  /**
   * Get all connection statuses
   */
  async getAllConnectionStatuses(): Promise<ConnectionStatus[]> {
    if (!isTauri()) return [];

    try {
      return await invoke<ConnectionStatus[]>("get_all_connection_statuses");
    } catch (error) {
      console.error(
        "[ConnectionWindowTracker] Failed to get all connection statuses:",
        error,
      );
      return [];
    }
  }

  /**
   * Get all window labels for a specific connection
   */
  async getWindowsForConnection(connectionId: string): Promise<string[]> {
    if (!isTauri()) return [];

    try {
      return await invoke<string[]>("get_windows_for_connection", {
        connectionId,
      });
    } catch (error) {
      console.error(
        "[ConnectionWindowTracker] Failed to get windows for connection:",
        error,
      );
      return [];
    }
  }

  /**
   * Check if a connection has any open windows
   */
  async hasOpenWindows(connectionId: string): Promise<boolean> {
    const status = await this.getConnectionStatus(connectionId);
    return status.window_count > 0;
  }
}

export const connectionWindowTracker = new ConnectionWindowTracker();

