import { isTauri } from "@/utils/tauri";
import { windowChannelTracker } from "./windowChannelTracker";

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

  private buildWorkspaceUrl(
    connectionId: string,
    database?: string,
    schema?: string,
  ): string {
    const params = new URLSearchParams();
    if (database) {
      params.set("dbname", database);
      if (schema) {
        params.set("schema", schema);
      } else {
        params.delete("schema");
      }
    }

    const query = params.toString();
    return query
      ? `/workspace/${connectionId}?${query}`
      : `/workspace/${connectionId}`;
  }

  async openWorkspace(
    connectionId: string,
    connectionName: string,
    options: { database?: string; schema?: string } = {},
  ): Promise<string> {
    const targetUrl = this.buildWorkspaceUrl(
      connectionId,
      options.database,
      options.schema,
    );

    if (!isTauri()) {
      // In browser mode, just navigate to the workspace
      window.location.href = targetUrl;
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

    // Only hide main window if we're currently in the main window
    try {
      const currentWindow = WebviewWindow.getCurrent();
      const currentLabel = currentWindow.label;

      if (currentLabel === "main") {
        const mainWindow = await WebviewWindow.getByLabel("main");
        if (mainWindow) {
          await mainWindow.hide();
        }
      }
    } catch (error) {
      console.error("Failed to check/hide main window:", error);
    }

    // Create new window with transparent title bar
    const label = `workspace-${connectionId}`;
    // Create window options with traffic light position
    // TypeScript types for trafficLightPosition might not be updated yet
    const windowOptions: Record<string, unknown> = {
      url: targetUrl,
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
      transparent: false,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      skipTaskbar: false,
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

    // Handle window close cleanup
    // Note: Don't await this - it sets up a listener for future destruction
    void webview.once("tauri://destroyed", async () => {
      this.windows.delete(label);
      console.log(
        `[WindowManager] Window ${label} destroyed, ${this.windows.size} windows remaining`,
      );

      // Only show main window if ALL workspace windows are closed
      // This allows users to have multiple workspace windows open
      if (this.windows.size === 0) {
        console.log(
          `[WindowManager] All workspace windows closed, showing main window`,
        );
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

    // Only show main window if ALL workspace windows are closed
    if (this.windows.size === 0) {
      console.log(
        `[WindowManager] All workspace windows closed, showing main window`,
      );
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
  }

  async focusWorkspace(connectionId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    // Use windowChannelTracker which syncs across all windows via BroadcastChannel
    const windowLabels =
      windowChannelTracker.getWindowsForConnection(connectionId);

    if (windowLabels.length === 0) {
      console.error(
        `[WindowManager] No windows found for connection ${connectionId}`,
      );
      return;
    }

    // Use the first window (should only be one window per connection)
    const windowLabel = windowLabels[0];

    if (!windowLabel) {
      console.error(
        `[WindowManager] Window label is undefined for connection ${connectionId}`,
      );
      return;
    }

    console.log(
      `[WindowManager] Attempting to focus window ${windowLabel} for connection ${connectionId}`,
    );

    const webview = await WebviewWindow.getByLabel(windowLabel);
    if (webview) {
      try {
        // On macOS, we need to unminimize and show the window first
        const isMinimized = await webview.isMinimized();
        if (isMinimized) {
          console.log(`[WindowManager] Window is minimized, unminimizing...`);
          await webview.unminimize();
        }

        // Ensure window is visible
        const isVisible = await webview.isVisible();
        if (!isVisible) {
          console.log(`[WindowManager] Window is hidden, showing...`);
          await webview.show();
        }

        // Set focus
        await webview.setFocus();

        // On macOS, also request attention if focus didn't work
        // This will bounce the dock icon
        try {
          await webview.requestUserAttention(1); // 1 = Critical (bounce until focused)
        } catch {
          // requestUserAttention might not be available, ignore
        }

        console.log(
          `[WindowManager] Successfully focused window ${windowLabel}`,
        );
      } catch (error) {
        console.error(`[WindowManager] Failed to focus window:`, error);
      }
    } else {
      console.error(
        `[WindowManager] Could not find webview for label ${windowLabel}`,
      );
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
    // Use BroadcastChannel tracker for accurate cross-window status
    return windowChannelTracker.hasOpenWindows(connectionId);
  }

  getActiveWindows(): Map<string, WindowInfo> {
    return new Map(this.windows);
  }

  async updateWorkspaceUrl(
    connectionId: string,
    database: string,
    schema?: string,
  ): Promise<void> {
    const targetUrl = this.buildWorkspaceUrl(connectionId, database, schema);

    if (!isTauri()) {
      if (window.location.pathname === `/workspace/${connectionId}`) {
        window.history.replaceState(null, "", targetUrl);
      }
      return;
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const windowInfo = this.getWindowByConnectionId(connectionId);
    if (!windowInfo) {
      return;
    }

    const webview = await WebviewWindow.getByLabel(windowInfo.label);
    if (!webview) {
      return;
    }

    const webviewWithNavigate = webview as unknown as {
      navigate?: (url: string) => Promise<void>;
      setUrl?: (url: string) => Promise<void>;
      emit: (event: string, payload: unknown) => Promise<void>;
    };

    if (typeof webviewWithNavigate.navigate === "function") {
      await webviewWithNavigate.navigate(targetUrl);
      return;
    }

    if (typeof webviewWithNavigate.setUrl === "function") {
      await webviewWithNavigate.setUrl(targetUrl);
      return;
    }

    await webviewWithNavigate.emit("workspace:update-url", { url: targetUrl });
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
