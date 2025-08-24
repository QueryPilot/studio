import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/window";

interface WindowInfo {
  label: string;
  connectionId: string;
  connectionName: string;
  createdAt: Date;
}

let instance: WindowManager | null = null;

class WindowManager {
  private windows: Map<string, WindowInfo> = new Map();

  private constructor() {}

  static getInstance(): WindowManager {
    if (!instance) {
      instance = new WindowManager();
    }

    return instance;
  }

  async openWorkspace(
    connectionId: string,
    connectionName: string,
  ): Promise<string> {
    // Check if window already exists for this connection
    const existingWindow = this.getWindowByConnectionId(connectionId);
    if (existingWindow) {
      // Focus existing window
      const webview = await WebviewWindow.getByLabel(existingWindow.label);
      if (webview) {
        await webview.setFocus();
        return existingWindow.label;
      }
    }

    // Close the main window
    try {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.hide();
      }
    } catch (error) {
      console.error("Failed to hide main window:", error);
    }

    // Create new window with transparent title bar
    const label = `workspace-${connectionId}`;
    const webview = new WebviewWindow(label, {
      url: `/workspace/${connectionId}`,
      title: `${connectionName} - DevDB Studio`,
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      center: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      closable: true,
      decorations: true,
      transparent: true,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      skipTaskbar: false,
      // Set traffic light position for macOS
      trafficLightPosition: new LogicalPosition(12, 18),
    });

    // Register window
    this.windows.set(label, {
      label,
      connectionId,
      connectionName,
      createdAt: new Date(),
    });

    // Handle window close - show main window again
    await webview.once("tauri://destroyed", async () => {
      this.windows.delete(label);
      // Show main window when workspace closes
      try {
        const mainWindow = await WebviewWindow.getByLabel("main");
        if (mainWindow) {
          await mainWindow.show();
          await mainWindow.setFocus();
        }
      } catch (error) {
        console.error("Failed to show main window:", error);
      }
    });

    return label;
  }

  async closeWorkspace(connectionId: string): Promise<void> {
    const window = this.getWindowByConnectionId(connectionId);
    if (window) {
      const webview = await WebviewWindow.getByLabel(window.label);
      if (webview) {
        await webview.close();
      }
      this.windows.delete(window.label);
    }

    // Show main window when closing workspace
    try {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
    } catch (error) {
      console.error("Failed to show main window:", error);
    }
  }

  async focusWorkspace(connectionId: string): Promise<void> {
    const window = this.getWindowByConnectionId(connectionId);
    if (window) {
      const webview = await WebviewWindow.getByLabel(window.label);
      if (webview) {
        await webview.setFocus();
      }
    }
  }

  getWindowByConnectionId(connectionId: string): WindowInfo | undefined {
    for (const [, info] of this.windows) {
      if (info.connectionId === connectionId) {
        return info;
      }
    }
    return undefined;
  }

  isWorkspaceOpen(connectionId: string): boolean {
    return this.getWindowByConnectionId(connectionId) !== undefined;
  }

  getActiveWindows(): Map<string, WindowInfo> {
    return new Map(this.windows);
  }

  async broadcastToWorkspaces(event: string, data: unknown): Promise<void> {
    for (const [label] of this.windows) {
      const webview = await WebviewWindow.getByLabel(label);
      if (webview) {
        await webview.emit(event, data);
      }
    }
  }
}

export const windowManager = WindowManager.getInstance();
