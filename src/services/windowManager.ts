import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { navigationTransition } from "./navigationTransition";

export const windowManager = {
  async openWorkspace(workspaceId: string, connectionId?: string) {
    console.log("Opening workspace:", workspaceId, "with connection:", connectionId);
    
    if (!workspaceId) {
      throw new Error("Workspace ID is required");
    }
    
    try {
      // Navigate to workspace URL
      const url = connectionId 
        ? `/workspace/${workspaceId}?connection=${connectionId}` 
        : `/workspace/${workspaceId}`;
      
      // Add smooth transition
      await navigationTransition.fadeOut();
      
      // Change window properties for workspace view
      await this.configureForWorkspace();
      
      // Navigate using location.href
      window.location.href = url;
      
    } catch (error) {
      console.error("Failed to open workspace:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error details:", errorMessage);
      throw error;
    }
  },

  async closeWorkspace() {
    try {
      // Add smooth transition
      await navigationTransition.fadeOut();
      
      // Change window properties back to main screen settings
      await this.configureForMain();
      
      // Navigate back to main screen
      window.location.href = "/";
      
    } catch (error) {
      console.error("Failed to close workspace:", error);
    }
  },

  async openMain() {
    try {
      // Add smooth transition
      await navigationTransition.fadeOut();
      
      // Configure window for main screen
      await this.configureForMain();
      
      // Navigate to main screen
      window.location.href = "/";
      
    } catch (error) {
      console.error("Failed to return to main screen:", error);
    }
  },
  
  async configureForMain() {
    try {
      const window = getCurrentWindow();
      
      // Main screen: smaller, centered window
      console.log("Configuring window for main screen...");
      
      // Set window properties
      await window.setResizable(true);
      await window.setSize(new LogicalSize(900, 650));
      await window.setMinSize(new LogicalSize(900, 650));
      await window.setTitle("DevDB Studio");
      await window.center();
      
      console.log("Window configured for main screen");
    } catch (error) {
      console.error("Failed to configure window for main:", error);
    }
  },
  
  async configureForWorkspace() {
    try {
      const window = getCurrentWindow();
      
      // Workspace screen: larger, resizable window
      console.log("Configuring window for workspace...");
      
      // Set window properties
      await window.setResizable(true);
      await window.setSize(new LogicalSize(1400, 900));
      await window.setMinSize(new LogicalSize(1200, 700));
      await window.setTitle("DevDB Studio - Workspace");
      await window.center();
      
      console.log("Window configured for workspace");
    } catch (error) {
      console.error("Failed to configure window for workspace:", error);
    }
  },
  
  async getCurrentWindowSize() {
    try {
      const window = getCurrentWindow();
      const size = await window.innerSize();
      return {
        width: size.width,
        height: size.height
      };
    } catch (error) {
      console.error("Failed to get window size:", error);
      return null;
    }
  },
  
  async setWindowSize(width: number, height: number) {
    try {
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(width, height));
      await window.center();
    } catch (error) {
      console.error("Failed to set window size:", error);
    }
  }
};