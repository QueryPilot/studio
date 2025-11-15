import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConnectionStore } from '../connectionStoreNew';
import { vaultStorage } from '@/services/vaultStorage';
import type { StoredConnection, ConnectionProfile } from '@/types/connection';

// Mock vaultStorage
vi.mock('@/services/vaultStorage', () => ({
  vaultStorage: {
    listConnections: vi.fn(),
    storeConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    toggleFavorite: vi.fn(),
    updateTags: vi.fn(),
    markAsUsed: vi.fn(),
  },
}));

describe('connectionStoreNew', () => {
  const mockConnections: StoredConnection[] = [
    {
      id: 'conn-1',
      profile: {
        id: 'conn-1',
        name: 'Production DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5432,
        database: 'prod',
        username: 'admin',
        color: '#3b82f6',
      },
      metadata: {
        is_favorite: true,
        tags: ['production', 'critical'],
        last_used: '2025-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        usage_count: 100,
      },
    },
    {
      id: 'conn-2',
      profile: {
        id: 'conn-2',
        name: 'Development DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5433,
        database: 'dev',
        username: 'dev',
        color: '#10b981',
      },
      metadata: {
        is_favorite: false,
        tags: ['development'],
        last_used: '2024-12-01T00:00:00Z',
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-12-01T00:00:00Z',
        usage_count: 50,
      },
    },
  ];

  beforeEach(() => {
    // Reset store state
    useConnectionStore.setState({
      connections: [],
      loading: false,
      error: null,
      activeConnectionId: null,
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('fetchConnections', () => {
    it('should fetch and set connections', async () => {
      vi.mocked(vaultStorage.listConnections).mockResolvedValue(mockConnections);

      const store = useConnectionStore.getState();
      await store.fetchConnections();

      const state = useConnectionStore.getState();
      expect(state.connections).toEqual(mockConnections);
      expect(state.loading).toBe(false);
      expect(state.error).toBe(null);
    });

    it('should set loading state during fetch', async () => {
      vi.mocked(vaultStorage.listConnections).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => { resolve(mockConnections); }, 100);
          })
      );

      const store = useConnectionStore.getState();
      const promise = store.fetchConnections();

      // Check loading state
      expect(useConnectionStore.getState().loading).toBe(true);

      await promise;
      expect(useConnectionStore.getState().loading).toBe(false);
    });

    it('should handle fetch errors', async () => {
      const errorMessage = 'Failed to load connections';
      vi.mocked(vaultStorage.listConnections).mockRejectedValue(
        new Error(errorMessage)
      );

      const store = useConnectionStore.getState();

      await expect(store.fetchConnections()).rejects.toThrow(errorMessage);

      const state = useConnectionStore.getState();
      expect(state.error).toBe(errorMessage);
      expect(state.loading).toBe(false);
    });
  });

  describe('saveConnection', () => {
    it('should save connection and refetch', async () => {
      const newProfile: ConnectionProfile = {
        id: 'new-conn',
        name: 'Test DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5434,
        database: 'test',
        username: 'test',
        color: '#f59e0b',
      };

      vi.mocked(vaultStorage.storeConnection).mockResolvedValue('new-conn');
      vi.mocked(vaultStorage.listConnections).mockResolvedValue([
        ...mockConnections,
        {
          id: 'new-conn',
          profile: newProfile,
          metadata: {
            isFavorite: false,
            tags: [],
            lastUsed: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            usageCount: 0,
          },
        },
      ]);

      const store = useConnectionStore.getState();
      const id = await store.saveConnection(newProfile);

      expect(id).toBe('new-conn');
      expect(vaultStorage.storeConnection).toHaveBeenCalledWith(newProfile);
      expect(vaultStorage.listConnections).toHaveBeenCalled();
      expect(useConnectionStore.getState().connections).toHaveLength(3);
    });

    it('should save connection with tags', async () => {
      const newProfile: ConnectionProfile = {
        id: 'new-conn',
        name: 'Test DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5434,
        database: 'test',
        username: 'test',
        color: '#f59e0b',
      };

      vi.mocked(vaultStorage.storeConnection).mockResolvedValue('new-conn');
      vi.mocked(vaultStorage.updateTags).mockResolvedValue();
      vi.mocked(vaultStorage.listConnections).mockResolvedValue([]);

      const store = useConnectionStore.getState();
      await store.saveConnection(newProfile, ['staging', 'test']);

      expect(vaultStorage.updateTags).toHaveBeenCalledWith('new-conn', [
        'staging',
        'test',
      ]);
    });

    it('should deduplicate tags', async () => {
      const newProfile: ConnectionProfile = {
        id: 'new-conn',
        name: 'Test DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5434,
        database: 'test',
        username: 'test',
        color: '#f59e0b',
      };

      vi.mocked(vaultStorage.storeConnection).mockResolvedValue('new-conn');
      vi.mocked(vaultStorage.updateTags).mockResolvedValue();
      vi.mocked(vaultStorage.listConnections).mockResolvedValue([]);

      const store = useConnectionStore.getState();
      await store.saveConnection(newProfile, ['test', 'test', 'staging', ' test ']);

      expect(vaultStorage.updateTags).toHaveBeenCalledWith('new-conn', [
        'test',
        'staging',
      ]);
    });

    it('should handle save errors', async () => {
      const newProfile: ConnectionProfile = {
        id: 'new-conn',
        name: 'Test DB',
        db_type: 'Postgres',
        host: 'localhost',
        port: 5434,
        database: 'test',
        username: 'test',
        color: '#f59e0b',
      };

      const errorMessage = 'Failed to save connection';
      vi.mocked(vaultStorage.storeConnection).mockRejectedValue(
        new Error(errorMessage)
      );

      const store = useConnectionStore.getState();

      await expect(store.saveConnection(newProfile)).rejects.toThrow(errorMessage);
      expect(useConnectionStore.getState().error).toBe(errorMessage);
    });
  });

  describe('deleteConnection', () => {
    it('should delete connection and refetch', async () => {
      vi.mocked(vaultStorage.deleteConnection).mockResolvedValue();
      vi.mocked(vaultStorage.listConnections).mockResolvedValue([mockConnections[0]]);

      const store = useConnectionStore.getState();
      await store.deleteConnection('conn-2');

      expect(vaultStorage.deleteConnection).toHaveBeenCalledWith('conn-2');
      expect(vaultStorage.listConnections).toHaveBeenCalled();
    });

    it('should handle delete errors', async () => {
      const errorMessage = 'Failed to delete connection';
      vi.mocked(vaultStorage.deleteConnection).mockRejectedValue(
        new Error(errorMessage)
      );

      const store = useConnectionStore.getState();

      await expect(store.deleteConnection('conn-1')).rejects.toThrow(errorMessage);
      expect(useConnectionStore.getState().error).toBe(errorMessage);
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle favorite status', async () => {
      vi.mocked(vaultStorage.toggleFavorite).mockResolvedValue(true);
      vi.mocked(vaultStorage.listConnections).mockResolvedValue(mockConnections);

      const store = useConnectionStore.getState();
      const isFavorite = await store.toggleFavorite('conn-2');

      expect(isFavorite).toBe(true);
      expect(vaultStorage.toggleFavorite).toHaveBeenCalledWith('conn-2');
      expect(vaultStorage.listConnections).toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      useConnectionStore.setState({ connections: mockConnections });
    });

    it('should get connection by id', () => {
      const store = useConnectionStore.getState();
      const conn = store.getConnection('conn-1');

      expect(conn).toEqual(mockConnections[0]);
    });

    it('should return undefined for non-existent connection', () => {
      const store = useConnectionStore.getState();
      const conn = store.getConnection('non-existent');

      expect(conn).toBeUndefined();
    });

    it('should get favorite connections', () => {
      const store = useConnectionStore.getState();
      const favorites = store.getFavoriteConnections();

      expect(favorites).toHaveLength(1);
      expect(favorites[0].id).toBe('conn-1');
    });

    it('should get recent connections sorted by lastUsed', () => {
      const store = useConnectionStore.getState();
      const recent = store.getRecentConnections();

      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('conn-1'); // Most recent
      expect(recent[1].id).toBe('conn-2');
    });

    it('should limit recent connections', () => {
      const store = useConnectionStore.getState();
      const recent = store.getRecentConnections(1);

      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe('conn-1');
    });
  });

  describe('searchConnections', () => {
    beforeEach(() => {
      useConnectionStore.setState({ connections: mockConnections });
    });

    it('should search by connection name', () => {
      const store = useConnectionStore.getState();
      const results = store.searchConnections('Production');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('conn-1');
    });

    it('should search case-insensitively', () => {
      const store = useConnectionStore.getState();
      const results = store.searchConnections('development');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('conn-2');
    });

    it('should search by database name', () => {
      const store = useConnectionStore.getState();
      const results = store.searchConnections('prod');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('conn-1');
    });

    it('should search by tags', () => {
      const store = useConnectionStore.getState();
      const results = store.searchConnections('critical');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('conn-1');
    });

    it('should return empty array when no matches', () => {
      const store = useConnectionStore.getState();
      const results = store.searchConnections('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('activeConnection', () => {
    it('should set active connection', () => {
      const store = useConnectionStore.getState();
      store.setActiveConnection('conn-1');

      expect(useConnectionStore.getState().activeConnectionId).toBe('conn-1');
    });

    it('should clear active connection', () => {
      useConnectionStore.setState({ activeConnectionId: 'conn-1' });

      const store = useConnectionStore.getState();
      store.setActiveConnection(null);

      expect(useConnectionStore.getState().activeConnectionId).toBe(null);
    });

    it('should get active connection', () => {
      useConnectionStore.setState({ activeConnectionId: 'conn-1' });

      const store = useConnectionStore.getState();
      const active = store.getActiveConnection();

      expect(active).toEqual({ id: 'conn-1' });
    });

    it('should return null when no active connection', () => {
      const store = useConnectionStore.getState();
      const active = store.getActiveConnection();

      expect(active).toBe(null);
    });
  });
});
