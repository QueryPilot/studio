import { isTauri } from "@/utils/tauri";

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
    if (!isTauri()) {
      // In browser mode, just navigate to the workspace
      window.location.href = `/workspace/${connectionId}`;
      return `workspace-${connectionId}`;
    }

    // Dynamic imports for Tauri APIs
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

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
    // Create window options with traffic light position
    // TypeScript types for trafficLightPosition might not be updated yet
    const windowOptions: Record<string, unknown> = {
      url: `/workspace/${connectionId}`,
      title: `${connectionName} - Query Pilot`,
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
      // Traffic light position for macOS (available in Tauri v2.8+)
      // This will be ignored on other platforms
      trafficLightPosition: { x: 16, y: 22 },
    };

    const webview = new WebviewWindow(
      label,
      windowOptions as ConstructorParameters<typeof WebviewWindow>[1],
    );

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
    if (!isTauri()) {
      // In browser mode, just navigate back
      globalThis.window.location.href = "/";
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    const workspaceWindow = this.getWindowByConnectionId(connectionId);
    if (workspaceWindow) {
      const webview = await WebviewWindow.getByLabel(workspaceWindow.label);
      if (webview) {
        await webview.close();
      }
      this.windows.delete(workspaceWindow.label);
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
    if (!isTauri()) {
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

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
    if (!isTauri()) {
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    for (const [label] of this.windows) {
      const webview = await WebviewWindow.getByLabel(label);
      if (webview) {
        await webview.emit(event, data);
      }
    }
  }

  async closeCurrentWindow(): Promise<void> {
    console.log("🪟 [WINDOW DEBUG] closeCurrentWindow called");

    if (!isTauri()) {
      console.log("🌐 [WINDOW DEBUG] Browser mode - calling window.close()");
      // In browser mode, close the tab/window
      window.close();
      return;
    }

    console.log("🖥️ [WINDOW DEBUG] Tauri mode - getting current window");
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      console.log("🔗 [WINDOW DEBUG] Current window obtained, calling close()");
      await currentWindow.close();
      console.log("✅ [WINDOW DEBUG] Window close completed successfully");
    } catch (error) {
      console.error("❌ [WINDOW DEBUG] Error closing window:", error);
      throw error;
    }
  }

  async openNewMainWindow(): Promise<void> {
    if (!isTauri()) {
      // In browser mode, open in new tab
      window.open("/", "_blank");
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    // Create a unique label for the new window
    const timestamp = Date.now();
    const label = `main-${timestamp}`;

    // Create new main window with same style as original
    const windowOptions: Record<string, unknown> = {
      url: "/",
      title: "Query Pilot",
      width: 900,
      height: 650,
      minWidth: 900,
      minHeight: 650,
      center: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      closable: true,
      decorations: true,
      transparent: false,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      skipTaskbar: false,
    };

    new WebviewWindow(
      label,
      windowOptions as ConstructorParameters<typeof WebviewWindow>[1],
    );
  }
}

export const windowManager = WindowManager.getInstance();
