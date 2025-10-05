import { type DatabaseConnection } from "@/types/database";
import { type ConnectionProfile } from "@/types/connection";
import { vaultStorage } from "./vaultStorage";

class SecureConnectionService {
  private static instance: SecureConnectionService;
  private connectionsCache: Map<string, DatabaseConnection> = new Map();

  private constructor() {
    // Initialize vault on construction
    this.initializeStorage();
  }

  private async initializeStorage() {
    try {
      await vaultStorage.initialize();
      // Load connections into cache
      await this.refreshCache();
    } catch (error) {
      console.error("Failed to initialize vault storage:", error);
    }
  }

  static getInstance(): SecureConnectionService {
    if (!SecureConnectionService.instance) {
      SecureConnectionService.instance = new SecureConnectionService();
    }
    return SecureConnectionService.instance;
  }

  /**
   * Refresh connections cache from vault
   */
  async refreshCache(): Promise<void> {
    this.connectionsCache.clear();
    await this.getAllConnections(); // This will reload from vault
  }

  /**
   * Convert vault ConnectionProfile to DatabaseConnection
   */
  private toDatabaseConnection(profile: ConnectionProfile): DatabaseConnection {
    return {
      id: profile.id,
      name: profile.name,
      type: profile.db_type.toLowerCase() as any,
      host: profile.host,
      port: profile.port,
      database: profile.database,
      username: profile.username,
      password: profile.password,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: "default",
      order: 0,
      tags: [],
    };
  }

  /**
   * Convert DatabaseConnection to vault ConnectionProfile
   */
  private toConnectionProfile(conn: DatabaseConnection): ConnectionProfile {
    return {
      id: conn.id,
      name: conn.name,
      db_type:
        conn.type === "postgresql"
          ? "PostgreSQL"
          : conn.type === "mysql"
          ? "MySQL"
          : conn.type === "sqlite"
          ? "SQLite"
          : conn.type === "mssql"
          ? "SQLServer"
          : "PostgreSQL",
      host: conn.host || "localhost",
      port: conn.port || 5432,
      database: conn.database || "",
      username: conn.username || "",
      password: conn.password,
      options: {},
    };
  }

  /**
   * Save a connection to vault
   */
  async saveConnection(connection: DatabaseConnection): Promise<void> {
    try {
      const profile = this.toConnectionProfile(connection);

      // Save to vault
      await vaultStorage.storeConnection(profile);

      // Update cache
      this.connectionsCache.set(connection.id, connection);
    } catch (error) {
      console.error("Failed to save connection:", error);
      throw error;
    }
  }

  /**
   * Save multiple connections
   */
  async saveConnections(connections: DatabaseConnection[]): Promise<void> {
    const promises = connections.map((conn) => this.saveConnection(conn));
    await Promise.all(promises);
  }

  /**
   * Get all connections from vault
   */
  async getAllConnections(): Promise<DatabaseConnection[]> {
    try {
      const stored = await vaultStorage.listConnections();

      // Convert and populate cache
      const connections = stored.map((s) => {
        const conn = this.toDatabaseConnection(s.profile);
        this.connectionsCache.set(conn.id, conn);
        return conn;
      });

      return connections;
    } catch (error) {
      console.error("Failed to load connections from vault:", error);
      return [];
    }
  }

  /**
   * Get a single connection by ID
   */
  async getConnection(id: string): Promise<DatabaseConnection | undefined> {
    // Try cache first
    if (this.connectionsCache.has(id)) {
      return this.connectionsCache.get(id);
    }

    // Load from vault
    try {
      const stored = await vaultStorage.getConnection(id);
      if (stored) {
        const conn = this.toDatabaseConnection(stored.profile);
        this.connectionsCache.set(id, conn);
        return conn;
      }
    } catch (error) {
      console.error(`Failed to get connection ${id}:`, error);
    }

    return undefined;
  }

  /**
   * Delete a connection from vault
   */
  async deleteConnection(id: string): Promise<void> {
    try {
      // Remove from cache
      this.connectionsCache.delete(id);

      // Delete from vault
      await vaultStorage.deleteConnection(id);
    } catch (error) {
      console.error("Failed to delete connection:", error);
      throw error;
    }
  }
}

export const secureConnectionService = SecureConnectionService.getInstance();
