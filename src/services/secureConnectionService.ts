import { invoke } from "@tauri-apps/api/core";
import { type DatabaseConnection } from "@/types/database";

interface SecureConnection {
  id: string;
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

class SecureConnectionService {
  private static instance: SecureConnectionService;

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
      // For SQLite, use filepath as host
      const host = connection.type === 'sqlite' ? (connection.filepath || '') : (connection.host || 'localhost');
      const port = connection.type === 'sqlite' ? 0 : (connection.port || 5432);
      const username = connection.type === 'sqlite' ? 'sqlite' : (connection.username || '');
      
      const secureConnection: SecureConnection = {
        id: connection.id,
        name: connection.name,
        host: host,
        port: port,
        username: username,
        password: connection.password,
        database: connection.database,
        connection_type: connection.type.toLowerCase(),
        created_at: connection.createdAt.toISOString(),
        updated_at: connection.updatedAt.toISOString(),
      };

      await invoke("store_connection", {
        connection: secureConnection,
      });
    } catch (error) {
      console.error("Failed to save connection to secure storage:", error);
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
    try {
      const connections = await invoke<SecureConnection[]>("list_connections");
      
      return connections.map((conn) => {
        // Determine if it's SQLite based on connection_type
        const isSqlite = conn.connection_type === 'sqlite';
        
        return {
          id: conn.id,
          name: conn.name,
          workspace: 'default', // Backend doesn't store workspace, use default
          type: conn.connection_type as DatabaseConnection["type"],
          host: isSqlite ? undefined : conn.host,
          port: isSqlite ? undefined : conn.port,
          database: conn.database,
          username: isSqlite ? undefined : conn.username,
          password: conn.password,
          filepath: isSqlite ? conn.host : undefined, // SQLite uses host field for filepath
          sslMode: undefined,
          sslCa: undefined,
          sslCert: undefined,
          sslKey: undefined,
          instanceName: undefined,
          authType: undefined,
          encrypt: undefined,
          trustServerCertificate: undefined,
          tags: [],
          createdAt: conn.created_at ? new Date(conn.created_at) : new Date(),
          updatedAt: conn.updated_at ? new Date(conn.updated_at) : new Date(),
        };
      });
    } catch (error) {
      console.error("Failed to get connections from secure storage:", error);
      return [];
    }
  }

  /**
   * Delete a connection from secure storage
   */
  async deleteConnection(id: string): Promise<void> {
    try {
      await invoke("delete_connection", {
        connectionId: id,  // Use camelCase for Tauri conversion to snake_case
      });
    } catch (error) {
      console.error("Failed to delete connection from secure storage:", error);
      throw error;
    }
  }
}

export const secureConnectionService = SecureConnectionService.getInstance();