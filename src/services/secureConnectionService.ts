import { type DatabaseConnection } from "@/types/database";
import { isTauri, safeInvoke } from "@/utils/tauri";

interface SecureConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  connection_type: string;
  created_at?: string;
  updated_at?: string;
}

class SecureConnectionService {
  private static instance: SecureConnectionService;
  private connectionsCache: Map<string, DatabaseConnection> = new Map();

  private constructor() {}

  static getInstance(): SecureConnectionService {
    if (!SecureConnectionService.instance) {
      SecureConnectionService.instance = new SecureConnectionService();
    }
    return SecureConnectionService.instance;
  }

  /**
   * Save a connection to secure storage
   */
  async saveConnection(connection: DatabaseConnection): Promise<void> {
    try {
      // Save to in-memory cache
      this.connectionsCache.set(connection.id, connection);
      
      // Save to backend secure storage if in Tauri
      if (isTauri()) {
        const profile = {
          id: connection.id,
          name: connection.name,
          db_type: connection.type === 'postgresql' ? 'PostgreSQL' : 
                   connection.type === 'mysql' ? 'MySQL' : 
                   connection.type === 'sqlite' ? 'SQLite' : 
                   connection.type === 'mssql' ? 'SQLServer' : 'PostgreSQL',
          host: connection.host || 'localhost',
          port: connection.port || 5432,
          database: connection.database || '',
          username: connection.username || '',
          password: connection.password,
          ssl_mode: undefined,
          options: {},
        };
        
        await safeInvoke("store_connection", { connection: profile });
      }
    } catch (error) {
      console.error("Failed to save connection:", error);
      throw error;
    }
  }

  /**
   * Save multiple connections to secure storage
   */
  async saveConnections(connections: DatabaseConnection[]): Promise<void> {
    const promises = connections.map((conn) => this.saveConnection(conn));
    await Promise.all(promises);
  }

  /**
   * Get all connections from secure storage
   */
  async getAllConnections(): Promise<DatabaseConnection[]> {
    // Return connections from in-memory cache
    return Array.from(this.connectionsCache.values());
  }

  /**
   * Get a single connection by ID
   */
  async getConnection(id: string): Promise<DatabaseConnection | undefined> {
    return this.connectionsCache.get(id);
  }

  /**
   * Delete a connection from secure storage
   */
  async deleteConnection(id: string): Promise<void> {
    try {
      // Remove from in-memory cache
      this.connectionsCache.delete(id);
      
      // Delete from backend if in Tauri
      if (isTauri()) {
        await safeInvoke("delete_connection", { connectionId: id });
      }
    } catch (error) {
      console.error("Failed to delete connection:", error);
      throw error;
    }
  }
}

export const secureConnectionService = SecureConnectionService.getInstance();