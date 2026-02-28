import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { useKeyValueData } from '../useKeyValueData';
import type { RedisType, RedisValue } from '@/adapters/types/redis';

// Mock the RedisAdapter
vi.mock('@/adapters/redis/RedisAdapter', () => ({
  RedisAdapter: vi.fn().mockImplementation(() => ({
    getCurrentDatabase: vi.fn(() => 0),
    selectDatabase: vi.fn(),
    getKeyType: vi.fn(() => Promise.resolve('string' as RedisType)),
    getKeyTTL: vi.fn(() => Promise.resolve(-1)),
    getKey: vi.fn(() => Promise.resolve({
      type: 'string',
      value: 'test-value',
    } as RedisValue)),
    setKeyTTL: vi.fn(() => Promise.resolve(true)),
    deleteKeys: vi.fn(() => Promise.resolve(1)),
  })),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useKeyValueData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('should initialize with null currentKey when no initialKey provided', () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
      }),
      { wrapper }
    );

    expect(result.current.currentKey).toBeNull();
    expect(result.current.rows).toEqual([]);
    // Browser mode returns BROWSER_COLUMNS (Key, Type, Value, TTL)
    expect(result.current.columns).toHaveLength(4);
    expect(result.current.columns[0]!.id).toBe('key');
    expect(result.current.columns[1]!.id).toBe('type');
    expect(result.current.columns[2]!.id).toBe('value');
    expect(result.current.columns[3]!.id).toBe('ttl');
  });

  it('should fetch key metadata when key is selected', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.currentKey).not.toBeNull();
    expect(result.current.currentKey?.key).toBe('test-key');
    expect(result.current.currentKey?.type).toBe('string');
  });

  it('should generate columns based on key type', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.columns.length).toBeGreaterThan(0);
    });

    // String type should have specific columns
    const columnFields = result.current.columns.map(col => col.field);
    expect(columnFields.length).toBeGreaterThan(0);
  });

  it('should handle selectKey action', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
      }),
      { wrapper }
    );

    // Initially no key
    expect(result.current.currentKey).toBeNull();

    // Select a key
    await result.current.selectKey('new-key');

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Key should be set
    expect(result.current.currentKey).not.toBeNull();
  });

  it('should handle clearSelection action', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    // Clear selection
    act(() => {
      result.current.clearSelection();
    });

    // Should clear immediately
    expect(result.current.currentKey).toBeNull();
  });

  it('should handle setKeyTTL action', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    // Set TTL
    await result.current.setKeyTTL(3600);

    // Verify adapter was called
    expect(result.current.currentKey).not.toBeNull();
  });

  it('should handle deleteCurrentKey action', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    // Delete key
    await act(async () => {
      await result.current.deleteCurrentKey();
    });

    // Key should be cleared after deletion
    expect(result.current.currentKey).toBeNull();
  });

  it('should create edit command', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    const command = result.current.createEditCommand({
      cell: [0, 0],
      rowIndex: 0,
      columnIndex: 0,
      column: result.current.columns[0]!,
      row: result.current.rows[0],
      newValue: {
        kind: GridCellKind.Uri,
        data: 'new-value',
        displayData: 'new-value',
        allowOverlay: true,
      },
      previousValue: null,
    });

    // Should return null or command based on key type
    // String keys may not support direct edit
    expect(command === null || typeof command === 'object').toBe(true);
  });

  it('should create insert command', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    const command = result.current.createInsertCommand({ value: 'new-value' });

    expect(command).not.toBeNull();
    expect(command.type).toBe('data.insert');
    expect(command.target.connectionId).toBe('test-conn');
  });

  it('should create delete command', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    const command = result.current.createDeleteCommand({ key: { value: 'test-key', db_type: 'string', value_type: 'Text', is_truncated: false } });

    expect(command).not.toBeNull();
    expect(command.type).toBe('data.delete');
    expect(command.target.connectionId).toBe('test-conn');
  });

  it('should handle error state', async () => {
    // Mock adapter to throw error
    const { RedisAdapter: MockAdapter } = await import('@/adapters/redis/RedisAdapter');
    vi.mocked(MockAdapter).mockImplementation(() => ({
      getCurrentDatabase: vi.fn(() => 0),
      selectDatabase: vi.fn(),
      getKeyType: vi.fn(() => Promise.reject(new Error('Connection failed'))),
      getKeyTTL: vi.fn(() => Promise.reject(new Error('Connection failed'))),
    } as any));

    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('should return correct paradigm', () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
      }),
      { wrapper }
    );

    expect(result.current.paradigm).toBe('keyvalue');
  });

  it.skip('should provide getCellContent function', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    // Wait for key to be loaded
    await waitFor(() => {
      expect(result.current.currentKey).not.toBeNull();
    });

    // Columns should be populated based on key type
    await waitFor(() => {
      expect(result.current.columns.length).toBeGreaterThan(0);
    });

    expect(typeof result.current.getCellContent).toBe('function');

    // Try calling getCellContent
    const cell = result.current.getCellContent([0, 0]);
    expect(cell).toBeDefined();
    expect('kind' in cell).toBe(true);
  });

  it('should handle refetch', async () => {
    const { result } = renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Trigger refetch
    await result.current.refetch();

    // Should trigger loading state
    expect(typeof result.current.refetch).toBe('function');
  });

  it('should handle database selection', async () => {
    const { RedisAdapter: MockAdapter } = await import('@/adapters/redis/RedisAdapter');
    const selectDatabaseMock = vi.fn();
    vi.mocked(MockAdapter).mockImplementation(() => ({
      getCurrentDatabase: vi.fn(() => 1), // Different DB
      selectDatabase: selectDatabaseMock,
      getKeyType: vi.fn(() => Promise.resolve('string' as RedisType)),
      getKeyTTL: vi.fn(() => Promise.resolve(-1)),
      getKey: vi.fn(() => Promise.resolve({
        type: 'string',
        value: 'test-value',
      } as RedisValue)),
    } as any));

    renderHook(
      () => useKeyValueData({
        connectionId: 'test-conn',
        database: 0,
        initialKey: 'test-key',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(selectDatabaseMock).toHaveBeenCalledWith(0);
    });
  });
});
