/**
 * Service to manage connection metadata (order, workspace, tags) 
 * that isn't stored in the backend secure storage
 */

interface ConnectionMetadata {
  id: string;
  order: number;
  workspace: string;
  tags: Array<{ name: string; color: string }>;
}

class ConnectionMetadataService {
  private static instance: ConnectionMetadataService;
  private readonly STORAGE_KEY = 'connection_metadata';

  private constructor() {}

  static getInstance(): ConnectionMetadataService {
    if (!ConnectionMetadataService.instance) {
      ConnectionMetadataService.instance = new ConnectionMetadataService();
    }
    return ConnectionMetadataService.instance;
  }

  /**
   * Get all metadata
   */
  getAllMetadata(): Record<string, ConnectionMetadata> {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return {};
    try {
      return JSON.parse(stored);
    } catch {
      return {};
    }
  }

  /**
   * Get metadata for a specific connection
   */
  getMetadata(connectionId: string): ConnectionMetadata | undefined {
    const all = this.getAllMetadata();
    return all[connectionId];
  }

  /**
   * Save metadata for a connection
   */
  saveMetadata(connectionId: string, metadata: Partial<ConnectionMetadata>): void {
    const all = this.getAllMetadata();
    all[connectionId] = {
      id: connectionId,
      order: metadata.order ?? all[connectionId]?.order ?? 0,
      workspace: metadata.workspace ?? all[connectionId]?.workspace ?? 'default',
      tags: metadata.tags ?? all[connectionId]?.tags ?? [],
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
  }

  /**
   * Save metadata for multiple connections
   */
  saveMultipleMetadata(metadata: ConnectionMetadata[]): void {
    const all = this.getAllMetadata();
    metadata.forEach((meta) => {
      all[meta.id] = meta;
    });
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
  }

  /**
   * Delete metadata for a connection
   */
  deleteMetadata(connectionId: string): void {
    const all = this.getAllMetadata();
    delete all[connectionId];
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
  }

  /**
   * Clear all metadata
   */
  clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

export const connectionMetadataService = ConnectionMetadataService.getInstance();