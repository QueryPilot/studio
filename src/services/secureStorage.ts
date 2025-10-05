import { safeInvoke } from "@/utils/tauri";

export interface SecureConnectionConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  ssh_private_key?: string;
  api_key?: string;
  connection_type: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Secure Storage Service - vault Backend
 * All sensitive data is encrypted in Tauri vault vault
 * Vault auto-unlocks on app start using keychain-stored password
 * No user prompts needed - completely seamless
 */
class SecureStorageService {
  /**
   * Lock vault manually (advanced feature)
   */
  async lock(): Promise<void> {
    try {
      await safeInvoke("vault_lock");
    } catch (error) {
      console.error("Failed to lock vault:", error);
      throw new Error(`Failed to lock vault: ${error}`);
    }
  }

  /**
   * Reset vault completely (delete all data)
   */
  async resetVault(): Promise<void> {
    try {
      await safeInvoke("vault_reset");
    } catch (error) {
      console.error("Failed to reset vault:", error);
      throw new Error(`Failed to reset vault: ${error}`);
    }
  }

  /**
   * Store a connection configuration securely
   * @param connection The connection configuration to store
   * @param connectionId Optional connection ID to use (for test connections)
   */
  async storeConnection(
    connection: SecureConnectionConfig,
    connectionId?: string,
  ): Promise<string> {
    try {
      // If connectionId is provided, add it to the connection object
      const connectionToStore = connectionId
        ? { ...connection, id: connectionId }
        : connection;

      const resultId = await safeInvoke<string>("store_connection", {
        connection: connectionToStore,
      });
      return resultId;
    } catch (error) {
      console.error("Failed to store connection:", error);
      throw new Error(`Failed to store connection: ${error}`);
    }
  }

  /**
   * Retrieve a connection configuration
   */
  async getConnection(connectionId: string): Promise<SecureConnectionConfig> {
    try {
      const connection = await safeInvoke<SecureConnectionConfig>(
        "get_connection",
        {
          connectionId,
        },
      );
      return connection;
    } catch (error) {
      console.error("Failed to get connection:", error);
      throw new Error(`Failed to get connection: ${error}`);
    }
  }

  /**
   * List all connections (without sensitive data)
   */
  async listConnections(): Promise<SecureConnectionConfig[]> {
    try {
      const connections = await safeInvoke<SecureConnectionConfig[]>(
        "list_connections",
      );
      return connections;
    } catch (error) {
      console.error("Failed to list connections:", error);
      throw new Error(`Failed to list connections: ${error}`);
    }
  }

  /**
   * Update a connection configuration
   */
  async updateConnection(
    connectionId: string,
    connection: SecureConnectionConfig,
  ): Promise<void> {
    try {
      await safeInvoke("update_connection", {
        connectionId,
        connection,
      });
    } catch (error: any) {
      console.error("Failed to update connection:", error);
      throw new Error(`Failed to update connection: ${error}`);
    }
  }

  /**
   * Delete a connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    try {
      await safeInvoke("delete_connection", {
        connectionId,
      });
    } catch (error) {
      console.error("Failed to delete connection:", error);
      throw new Error(`Failed to delete connection: ${error}`);
    }
  }

  /**
   * Store arbitrary secure data
   */
  async setSecure(key: string, value: string): Promise<void> {
    try {
      await safeInvoke("secure_set", {
        key,
        value,
      });
    } catch (error) {
      console.error("Failed to store secure data:", error);
      throw new Error(`Failed to store secure data: ${error}`);
    }
  }

  /**
   * Retrieve secure data
   */
  async getSecure(key: string): Promise<string | null> {
    try {
      const value = await safeInvoke<string | null>("secure_get", {
        key,
      });
      return value;
    } catch (error) {
      console.error("Failed to get secure data:", error);
      throw new Error(`Failed to get secure data: ${error}`);
    }
  }
}

// Export singleton instance
export const secureStorage = new SecureStorageService();
