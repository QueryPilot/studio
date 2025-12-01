import { logger } from "@/lib/logger";
/**
 * Window tracking using BroadcastChannel API for cross-window communication
 * Replaces Tauri-based window tracking with native web API
 */

export interface ConnectionStatus {
  connection_id: string;
  window_labels: string[];
  window_count: number;
}

interface WindowMessage {
  type: "WINDOW_OPENED" | "WINDOW_CLOSED" | "WINDOW_HEARTBEAT" | "REQUEST_STATUS" | "STATUS_RESPONSE";
  windowLabel: string;
  connectionId?: string;
  timestamp: number;
  allStatuses?: ConnectionStatus[];
}

class WindowChannelTracker {
  private channel: BroadcastChannel | null = null;
  private currentWindowLabel: string;
  private currentConnectionId: string | null = null;
  private openWindows: Map<string, Set<string>> = new Map(); // connectionId -> Set<windowLabels>
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statusCallbacks: Set<(statuses: ConnectionStatus[]) => void> = new Set();
  private readonly HEARTBEAT_INTERVAL = 3000; // 3 seconds
  private readonly HEARTBEAT_TIMEOUT = 10000; // 10 seconds - consider window dead if no heartbeat
  private lastHeartbeats: Map<string, number> = new Map(); // windowLabel -> timestamp

  constructor() {
    // Window label will be set when we get it from Tauri
    // For now, use a temporary label until registerWindow is called
    this.currentWindowLabel = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.initialize();
  }

  private initialize(): void {
    // Create broadcast channel for cross-window communication
    this.channel = new BroadcastChannel("devdb-window-tracker");

    // Listen for messages from other windows
    this.channel.onmessage = (event: MessageEvent<WindowMessage>) => {
      this.handleMessage(event.data);
    };

    // Start heartbeat to let other windows know we're alive
    this.startHeartbeat();

    // Clean up dead windows periodically
    setInterval(() => {
      this.cleanupDeadWindows();
    }, this.HEARTBEAT_TIMEOUT);

    // Request current status from other windows on startup
    this.broadcastMessage({
      type: "REQUEST_STATUS",
      windowLabel: this.currentWindowLabel,
    });
  }

  private handleMessage(message: WindowMessage): void {
    // Ignore messages from self
    if (message.windowLabel === this.currentWindowLabel) {
      return;
    }

    // Update heartbeat timestamp
    this.lastHeartbeats.set(message.windowLabel, message.timestamp);

    switch (message.type) {
      case "WINDOW_OPENED":
        if (message.connectionId) {
          this.addWindow(message.connectionId, message.windowLabel);
          this.notifyStatusChange();
        }
        break;

      case "WINDOW_CLOSED":
        if (message.connectionId) {
          this.removeWindow(message.connectionId, message.windowLabel);
          this.notifyStatusChange();
        }
        break;

      case "WINDOW_HEARTBEAT":
        if (message.connectionId) {
          // Ensure window is still registered
          this.addWindow(message.connectionId, message.windowLabel);
        }
        break;

      case "REQUEST_STATUS":
        // Another window is asking for current status, respond with ours
        if (this.currentConnectionId) {
          this.broadcastMessage({
            type: "WINDOW_OPENED",
            windowLabel: this.currentWindowLabel,
            connectionId: this.currentConnectionId,
          });
        }
        break;

      case "STATUS_RESPONSE":
        // Received status from another window
        if (message.allStatuses) {
          message.allStatuses.forEach((status) => {
            status.window_labels.forEach((label) => {
              this.addWindow(status.connection_id, label);
            });
          });
          this.notifyStatusChange();
        }
        break;
    }
  }

  private broadcastMessage(message: Omit<WindowMessage, "timestamp">): void {
    if (!this.channel) return;

    const fullMessage: WindowMessage = {
      ...message,
      timestamp: Date.now(),
    };

    try {
      this.channel.postMessage(fullMessage);
    } catch (error) {
      logger.error("[WindowChannelTracker] Failed to broadcast message:", error);
    }
  }

  private addWindow(connectionId: string, windowLabel: string): void {
    if (!this.openWindows.has(connectionId)) {
      this.openWindows.set(connectionId, new Set());
    }
    this.openWindows.get(connectionId)!.add(windowLabel);

    logger.info(
      `[WindowChannelTracker] Window ${windowLabel} registered for connection ${connectionId}`,
    );
  }

  private removeWindow(connectionId: string, windowLabel: string): void {
    const windows = this.openWindows.get(connectionId);
    if (windows) {
      windows.delete(windowLabel);
      if (windows.size === 0) {
        this.openWindows.delete(connectionId);
      }

      logger.info(
        `[WindowChannelTracker] Window ${windowLabel} unregistered from connection ${connectionId}`,
      );
    }

    // Also remove from heartbeat tracking
    this.lastHeartbeats.delete(windowLabel);
  }

  private cleanupDeadWindows(): void {
    const now = Date.now();
    const deadWindows: { connectionId: string; windowLabel: string }[] = [];

    // Find windows that haven't sent heartbeat recently
    this.lastHeartbeats.forEach((timestamp, windowLabel) => {
      if (now - timestamp > this.HEARTBEAT_TIMEOUT) {
        // Window is dead, find which connection it belonged to
        this.openWindows.forEach((windows, connectionId) => {
          if (windows.has(windowLabel)) {
            deadWindows.push({ connectionId, windowLabel });
          }
        });
      }
    });

    // Remove dead windows
    deadWindows.forEach(({ connectionId, windowLabel }) => {
      this.removeWindow(connectionId, windowLabel);
    });

    if (deadWindows.length > 0) {
      logger.info(
        `[WindowChannelTracker] Cleaned up ${deadWindows.length} dead window(s)`,
      );
      this.notifyStatusChange();
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.currentConnectionId) {
        this.broadcastMessage({
          type: "WINDOW_HEARTBEAT",
          windowLabel: this.currentWindowLabel,
          connectionId: this.currentConnectionId,
        });
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private notifyStatusChange(): void {
    const statuses = this.getAllConnectionStatuses();
    this.statusCallbacks.forEach((callback) => {
      try {
        callback(statuses);
      } catch (error) {
        logger.error("[WindowChannelTracker] Status callback error:", error);
      }
    });
  }

  /**
   * Register the current window with a connection
   * Gets the actual window label from Tauri if available
   */
  async registerWindow(connectionId: string): Promise<void> {
    // Get actual window label from Tauri if in Tauri environment
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      this.currentWindowLabel = currentWindow.label;
    } catch {
      // Not in Tauri or import failed, use generated label
      // This is fine for browser development
    }

    logger.info(
      `[WindowChannelTracker] Registering window ${this.currentWindowLabel} for connection ${connectionId}`,
    );

    this.currentConnectionId = connectionId;

    // Add to local tracking
    this.addWindow(connectionId, this.currentWindowLabel);

    // Broadcast to other windows
    this.broadcastMessage({
      type: "WINDOW_OPENED",
      windowLabel: this.currentWindowLabel,
      connectionId,
    });

    this.notifyStatusChange();
  }

  /**
   * Unregister the current window
   */
  unregisterWindow(): void {
    if (!this.currentConnectionId) return;

    logger.info(
      `[WindowChannelTracker] Unregistering window ${this.currentWindowLabel}`,
    );

    const connectionId = this.currentConnectionId;

    // Remove from local tracking
    this.removeWindow(connectionId, this.currentWindowLabel);

    // Broadcast to other windows
    this.broadcastMessage({
      type: "WINDOW_CLOSED",
      windowLabel: this.currentWindowLabel,
      connectionId,
    });

    this.currentConnectionId = null;
    this.notifyStatusChange();
  }

  /**
   * Get connection status (how many windows are open)
   */
  getConnectionStatus(connectionId: string): ConnectionStatus {
    const windows = this.openWindows.get(connectionId);
    const windowLabels = windows ? Array.from(windows) : [];

    return {
      connection_id: connectionId,
      window_labels: windowLabels,
      window_count: windowLabels.length,
    };
  }

  /**
   * Get all connection statuses
   */
  getAllConnectionStatuses(): ConnectionStatus[] {
    const statuses: ConnectionStatus[] = [];

    this.openWindows.forEach((windows, connectionId) => {
      statuses.push({
        connection_id: connectionId,
        window_labels: Array.from(windows),
        window_count: windows.size,
      });
    });

    return statuses;
  }

  /**
   * Get all window labels for a specific connection
   */
  getWindowsForConnection(connectionId: string): string[] {
    const windows = this.openWindows.get(connectionId);
    return windows ? Array.from(windows) : [];
  }

  /**
   * Check if a connection has any open windows
   */
  hasOpenWindows(connectionId: string): boolean {
    const windows = this.openWindows.get(connectionId);
    return windows ? windows.size > 0 : false;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (statuses: ConnectionStatus[]) => void): () => void {
    this.statusCallbacks.add(callback);

    // Immediately call with current status
    callback(this.getAllConnectionStatuses());

    // Return unsubscribe function
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopHeartbeat();
    this.unregisterWindow();

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.statusCallbacks.clear();
    this.openWindows.clear();
    this.lastHeartbeats.clear();
  }
}

// Export singleton instance
export const windowChannelTracker = new WindowChannelTracker();

