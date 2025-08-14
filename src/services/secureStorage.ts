import { invoke } from '@tauri-apps/api/core';

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
 * Secure Storage Service
 * All sensitive data is stored encrypted in the Rust backend
 * No sensitive data is ever stored in localStorage or sessionStorage
 */
class SecureStorageService {
  /**
   * Store a connection configuration securely
   * @param connection The connection configuration to store
   * @param connectionId Optional connection ID to use (for test connections)
   */
  async storeConnection(connection: SecureConnectionConfig, connectionId?: string): Promise<string> {
    try {
      // If connectionId is provided, add it to the connection object
      const connectionToStore = connectionId 
        ? { ...connection, id: connectionId } 
        : connection;
        
      const resultId = await invoke<string>('store_connection', {
        connection: connectionToStore
      });
      return resultId;
    } catch (error) {
      console.error('Failed to store connection:', error);
      throw new Error(`Failed to store connection: ${error}`);
    }
  }

  /**
   * Retrieve a connection configuration
   */
  async getConnection(connectionId: string): Promise<SecureConnectionConfig> {
    try {
      const connection = await invoke<SecureConnectionConfig>('get_connection', {
        connectionId
      });
      return connection;
    } catch (error) {
      console.error('Failed to get connection:', error);
      throw new Error(`Failed to get connection: ${error}`);
    }
  }

  /**
   * List all connections (without sensitive data)
   */
  async listConnections(): Promise<SecureConnectionConfig[]> {
    try {
      const connections = await invoke<SecureConnectionConfig[]>('list_connections');
      return connections;
    } catch (error) {
      console.error('Failed to list connections:', error);
      throw new Error(`Failed to list connections: ${error}`);
    }
  }

  /**
   * Update a connection configuration
   */
  async updateConnection(connectionId: string, connection: SecureConnectionConfig): Promise<void> {
    try {
      await invoke('update_connection', {
        connectionId,
        connection
      });
    } catch (error) {
      console.error('Failed to update connection:', error);
      throw new Error(`Failed to update connection: ${error}`);
    }
  }

  /**
   * Delete a connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    try {
      await invoke('delete_connection', {
        connectionId
      });
    } catch (error) {
      console.error('Failed to delete connection:', error);
      throw new Error(`Failed to delete connection: ${error}`);
    }
  }

  /**
   * Store arbitrary secure data
   */
  async setSecure(key: string, value: string): Promise<void> {
    try {
      await invoke('secure_set', {
        key,
        value
      });
    } catch (error) {
      console.error('Failed to store secure data:', error);
      throw new Error(`Failed to store secure data: ${error}`);
    }
  }

  /**
   * Retrieve secure data
   */
  async getSecure(key: string): Promise<string | null> {
    try {
      const value = await invoke<string | null>('secure_get', {
        key
      });
      return value;
    } catch (error) {
      console.error('Failed to get secure data:', error);
      throw new Error(`Failed to get secure data: ${error}`);
    }
  }

  /**
   * Delete secure data
   */
  async deleteSecure(key: string): Promise<void> {
    try {
      await invoke('secure_delete', {
        key
      });
    } catch (error) {
      console.error('Failed to delete secure data:', error);
      throw new Error(`Failed to delete secure data: ${error}`);
    }
  }

  /**
   * List all secure storage keys
   */
  async listSecureKeys(prefix?: string): Promise<string[]> {
    try {
      const keys = await invoke<string[]>('secure_list_keys', {
        prefix
      });
      return keys;
    } catch (error) {
      console.error('Failed to list secure keys:', error);
      throw new Error(`Failed to list secure keys: ${error}`);
    }
  }

  /**
   * Store query history securely
   */
  async storeQueryHistory(history: any[]): Promise<void> {
    try {
      const serialized = JSON.stringify(history);
      await this.setSecure('query_history', serialized);
    } catch (error) {
      console.error('Failed to store query history:', error);
      throw error;
    }
  }

  /**
   * Retrieve query history
   */
  async getQueryHistory(): Promise<any[]> {
    try {
      const serialized = await this.getSecure('query_history');
      if (!serialized) return [];
      return JSON.parse(serialized);
    } catch (error) {
      console.error('Failed to get query history:', error);
      return [];
    }
  }

  /**
   * Store saved queries securely
   */
  async storeSavedQueries(queries: any[]): Promise<void> {
    try {
      const serialized = JSON.stringify(queries);
      await this.setSecure('saved_queries', serialized);
    } catch (error) {
      console.error('Failed to store saved queries:', error);
      throw error;
    }
  }

  /**
   * Retrieve saved queries
   */
  async getSavedQueries(): Promise<any[]> {
    try {
      const serialized = await this.getSecure('saved_queries');
      if (!serialized) return [];
      return JSON.parse(serialized);
    } catch (error) {
      console.error('Failed to get saved queries:', error);
      return [];
    }
  }

  /**
   * Migrate from localStorage to secure storage
   */
  async migrateFromLocalStorage(): Promise<void> {
    try {
      // Migrate connection-storage
      const connectionData = localStorage.getItem('connection-storage');
      if (connectionData) {
        const parsed = JSON.parse(connectionData);
        if (parsed.state?.connections) {
          // Migrate each connection to secure storage
          for (const [id, connection] of parsed.state.connections) {
            await this.storeConnection({
              ...connection.config,
              id
            });
          }
          // Clear localStorage after successful migration
          localStorage.removeItem('connection-storage');
          console.log('Migrated connections to secure storage');
        }
      }

      // Migrate query-storage
      const queryData = localStorage.getItem('query-storage');
      if (queryData) {
        const parsed = JSON.parse(queryData);
        if (parsed.state?.history) {
          await this.storeQueryHistory(parsed.state.history);
        }
        if (parsed.state?.savedQueries) {
          await this.storeSavedQueries(parsed.state.savedQueries);
        }
        // Clear localStorage after successful migration
        localStorage.removeItem('query-storage');
        console.log('Migrated query data to secure storage');
      }
    } catch (error) {
      console.error('Failed to migrate from localStorage:', error);
      throw error;
    }
  }

  /**
   * Clear all secure storage (for testing/reset)
   */
  async clearAll(confirmation: string): Promise<void> {
    if (confirmation !== 'CONFIRM_DELETE_ALL') {
      throw new Error('Invalid confirmation');
    }
    try {
      await invoke('clear_all_storage', {
        confirmation
      });
    } catch (error) {
      console.error('Failed to clear all storage:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const secureStorage = new SecureStorageService();