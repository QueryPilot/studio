import { isTauri, safeInvoke } from "@/utils/tauri";

class ClearAllService {
  private static instance: ClearAllService;

  private constructor() {}

  static getInstance(): ClearAllService {
    if (!ClearAllService.instance) {
      ClearAllService.instance = new ClearAllService();
    }
    return ClearAllService.instance;
  }

  /**
   * Disconnect all active database connections
   */
  private async disconnectAllDatabaseConnections(): Promise<void> {
    try {
      // Get list of active database connections
      // TODO: Implement getting active connections from ConnectionManager
      const activeConnections: string[] = [];
      console.log("Active database connections:", activeConnections);
      
      // Disconnect each active connection
      for (const connId of activeConnections) {
        try {
          await safeInvoke("disconnect", { connId });
          console.log(`Disconnected database connection: ${connId}`);
        } catch (error) {
          console.error(`Failed to disconnect database connection ${connId}:`, error);
        }
      }
    } catch (error) {
      console.error("Failed to get active database connections:", error);
      // Continue with clearing even if we can't disconnect
    }
  }

  /**
   * Clear all data - connections, credentials, and browser storage
   */
  async clearAllData(): Promise<void> {
    try {
      // Clear browser localStorage
      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
      }

      // Clear IndexedDB if exists
      if ('indexedDB' in window) {
        const databases = await indexedDB.databases?.() || [];
        for (const db of databases) {
          if (db.name) {
            await indexedDB.deleteDatabase(db.name);
          }
        }
      }

      // TODO: Implement clear_all_storage command in backend
      // await safeInvoke("clear_all_storage", {
      //   confirmation: "CONFIRM_DELETE_ALL"
      // });

    } catch (error) {
      console.error("Failed to clear all data:", error);
      // Even if backend fails, we've cleared browser storage
      // For now, we'll just log the error since the backend command is not fully implemented
    }
  }

  /**
   * Clear only connections from secure storage
   * TODO: Re-enable when secure storage is implemented in backend
   */
  async clearConnections(): Promise<void> {
    // Temporarily disabled - will use new API when ready
    console.log("Clear connections - temporarily using local storage only");
    
    // Clear local storage for now
    if (typeof window !== 'undefined') {
      localStorage.removeItem("connections");
      localStorage.removeItem("connectionMetadata");
    }
    
    // When backend is ready, uncomment:
    // if (!isTauri()) {
    //   console.warn("Cannot clear connections - not running in Tauri context");
    //   return;
    // }
    // await this.disconnectAllDatabaseConnections();
    // await safeInvoke("clear_connections");
  }
}

export const clearAllService = ClearAllService.getInstance();