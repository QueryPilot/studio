import { invoke } from "@tauri-apps/api/core";

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
      const activeConnections = await invoke<string[]>("db_list_connections");
      console.log("Active database connections:", activeConnections);
      
      // Disconnect each active connection
      for (const connId of activeConnections) {
        try {
          await invoke("db_disconnect", { connectionId: connId });
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

      // Call backend to clear secure storage
      // Note: The backend command expects "CONFIRM_DELETE_ALL" as confirmation
      await invoke("clear_all_storage", {
        confirmation: "CONFIRM_DELETE_ALL"
      });

    } catch (error) {
      console.error("Failed to clear all data:", error);
      // Even if backend fails, we've cleared browser storage
      // For now, we'll just log the error since the backend command is not fully implemented
    }
  }

  /**
   * Clear only connections from secure storage
   */
  async clearConnections(): Promise<void> {
    try {
      // First disconnect all active database connections
      await this.disconnectAllDatabaseConnections();
      
      // Then delete all stored connections
      const deletedCount = await invoke<number>("delete_all_connections");
      console.log(`Successfully deleted ${deletedCount} stored connections`);
    } catch (error) {
      console.error("Failed to delete all connections:", error);
      throw error;
    }
  }
}

export const clearAllService = ClearAllService.getInstance();