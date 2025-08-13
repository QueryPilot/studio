import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export const windowManager = {
  async openWorkspace(workspaceId: string, connectionId?: string) {
    console.log("Opening workspace:", workspaceId, "with connection:", connectionId);
    
    if (!workspaceId) {
      throw new Error("Workspace ID is required");
    }
    
    try {
      const label = `workspace-${workspaceId}`;
      
      // Check if window already exists
      try {
        const existingWindow = await WebviewWindow.getByLabel(label);
        if (existingWindow) {
          console.log("Found existing window, focusing...");
          await existingWindow.setFocus();
          await existingWindow.show();
          return;
        }
      } catch (e) {
        console.log("No existing window found, creating new...");
      }
      
      // Create new workspace window
      console.log("Creating new workspace window with label:", label);
      const workspaceWindow = new WebviewWindow(label, {
        url: connectionId ? `/workspace/${workspaceId}?connection=${connectionId}` : `/workspace/${workspaceId}`,
        title: "DevDB Studio - Workspace",
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        center: true,
        resizable: true,
        decorations: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        visible: false,
      });
      
      // Listen for window creation
      workspaceWindow.once("tauri://created", async () => {
        console.log("Workspace window created successfully");
        try {
          // Show the window after it's fully created
          await workspaceWindow.show();
          console.log("Workspace window shown");
          
          // Close main window after workspace is created and shown
          const currentWindow = getCurrentWebviewWindow();
          if (currentWindow.label === "main") {
            console.log("Closing main window");
            await currentWindow.close();
          }
        } catch (e) {
          console.error("Error showing/closing windows:", e);
        }
      });
      
      // Listen for error
      workspaceWindow.once("tauri://error", (e) => {
        console.error("Error creating workspace window:", e);
      });
      
    } catch (error) {
      console.error("Failed to open workspace window:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error details:", errorMessage);
      alert(`Failed to open workspace: ${errorMessage}`);
      throw error;
    }
  },

  async closeWorkspace(workspaceId: string) {
    try {
      // Close current workspace window
      const currentWindow = getCurrentWebviewWindow();
      if (currentWindow.label === `workspace-${workspaceId}`) {
        // Open main window first
        await this.openMain();
        // Then close workspace window
        setTimeout(() => {
          currentWindow.close();
        }, 100);
      }
    } catch (error) {
      console.error("Failed to close workspace window:", error);
    }
  },

  async openMain() {
    try {
      // Check if main window already exists
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.setFocus();
        await mainWindow.show();
        return;
      }
      
      // Create main window
      const newMainWindow = new WebviewWindow("main", {
        url: "/",
        title: "DevDB Studio",
        width: 800,
        height: 600,
        minWidth: 800,
        minHeight: 600,
        center: true,
        resizable: false,
        decorations: true,
        transparent: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
      });
      
      newMainWindow.once("tauri://created", () => {
        console.log("Main window created");
      });
      
      newMainWindow.once("tauri://error", (e) => {
        console.error("Error creating main window:", e);
      });
      
    } catch (error) {
      console.error("Failed to open main window:", error);
    }
  },
};