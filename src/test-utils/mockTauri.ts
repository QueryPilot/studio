/**
 * Tauri Mock Utilities using Official @tauri-apps/api/mocks
 *
 * This file provides helpers for mocking Tauri commands, events, and windows
 * using the official Tauri v2 mocking API.
 *
 * Usage:
 * ```ts
 * import { mockTauriCommands, mockTauriEvents } from '@/test-utils/mockTauri';
 *
 * test('my test', () => {
 *   mockTauriCommands((cmd, args) => {
 *     if (cmd === 'get_databases') {
 *       return ['postgres', 'testdb'];
 *     }
 *   });
 *
 *   // Your test code here
 * });
 * ```
 */

import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { InvokeArgs } from '@tauri-apps/api/core';

export type TauriCommandHandler = (cmd: string, args?: InvokeArgs) => any;

/**
 * Default mock responses for common Tauri commands
 */
export const defaultCommandMocks: Record<string, (args?: InvokeArgs) => any> = {
  // Connection commands
  connect_to_database: () => ({
    id: 'test-connection-id',
    success: true,
  }),
  disconnect_from_database: () => ({ success: true }),
  test_connection: () => ({
    success: true,
    message: 'Connection successful',
    version: 'PostgreSQL 15.0',
    warnings: [],
  }),

  // Database introspection
  get_databases: () => ['postgres', 'testdb'],
  get_schemas: () => ['public', 'private'],
  get_tables: () => [
    { name: 'users', schema: 'public', kind: 'Regular', row_count: 100 },
    { name: 'posts', schema: 'public', kind: 'Regular', row_count: 500 },
  ],
  get_table_columns: () => [
    {
      name: 'id',
      data_type: { Integer: null },
      nullable: false,
      primary_key: true,
      db_type: 'integer',
    },
    {
      name: 'email',
      data_type: { Text: null },
      nullable: false,
      primary_key: false,
      db_type: 'varchar',
    },
  ],
  get_table_indexes: () => [
    {
      name: 'users_pkey',
      table_name: 'users',
      columns: ['id'],
      is_unique: true,
      is_primary: true,
      definition: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)',
    },
  ],
  get_table_constraints: () => [
    {
      name: 'users_pkey',
      table_name: 'users',
      constraint_type: 'PrimaryKey',
      definition: 'PRIMARY KEY (id)',
    },
  ],

  // Query execution
  stream_query: () => ({
    success: true,
    data: new Uint8Array([0x81, 0xa7, 0x73, 0x75, 0x63, 0x63, 0x65, 0x73, 0x73, 0xc3]),
  }),
  execute_sql: () => ({
    success: true,
    rows_affected: 1,
  }),

  // Vault operations
  save_connection_profile: () => ({ success: true }),
  load_connection_profiles: () => [],
  delete_connection_profile: () => ({ success: true }),

  // AI commands
  get_ai_api_key: () => null,
  set_ai_api_key: () => ({ success: true }),
  get_sidecar_status: () => ({
    running: true,
    port: 3001,
  }),
};

/**
 * Mock Tauri IPC commands using the official mockIPC API
 *
 * @param handler - Custom command handler function
 * @param useDefaults - Whether to fallback to default mocks (default: true)
 *
 * @example
 * ```ts
 * mockTauriCommands((cmd, args) => {
 *   if (cmd === 'get_databases') {
 *     return ['mydb'];
 *   }
 *   // Return undefined to use default mock
 * });
 * ```
 */
export function mockTauriCommands(
  handler?: TauriCommandHandler,
  useDefaults: boolean = true
) {
  mockIPC((cmd, args) => {
    // Try custom handler first
    if (handler) {
      const result = handler(cmd, args);
      if (result !== undefined) {
        return result;
      }
    }

    // Fallback to default mocks
    if (useDefaults && cmd in defaultCommandMocks) {
      const mockFn = defaultCommandMocks[cmd];
      if (mockFn) {
        return mockFn(args);
      }
    }

    // Command not found
    throw new Error(`Mock not implemented for command: ${cmd}`);
  });
}

/**
 * Mock Tauri events using the official mockIPC API with event support
 *
 * @example
 * ```ts
 * import { listen, emit } from '@tauri-apps/api/event';
 *
 * test('event handling', () => {
 *   mockTauriEvents();
 *
 *   const handler = vi.fn();
 *   listen('my-event', handler);
 *   emit('my-event', { foo: 'bar' });
 *
 *   expect(handler).toHaveBeenCalledWith({
 *     event: 'my-event',
 *     payload: { foo: 'bar' },
 *   });
 * });
 * ```
 */
export function mockTauriEvents() {
  mockIPC(() => {}, { shouldMockEvents: true });
}

/**
 * Mock Tauri windows for multi-window testing
 *
 * @example
 * ```ts
 * import { getCurrent, getAll } from '@tauri-apps/api/webviewWindow';
 *
 * test('windows', () => {
 *   mockTauriWindows('main', 'editor', 'preview');
 *
 *   expect(getCurrent()).toHaveProperty('label', 'main');
 *   expect(getAll().map(w => w.label)).toEqual(['main', 'editor', 'preview']);
 * });
 * ```
 */
export function mockTauriWindows(...labels: string[]) {
  // Call mockWindows with the first label as current, rest as additional
  if (labels.length > 0) {
    mockWindows(labels[0] as string, ...labels.slice(1));
  }
}

/**
 * Helper to create a streaming query response with MessagePack data
 */
export function createStreamQueryResponse(data: any) {
  // Simple MessagePack encoding for testing (real encoding would use @msgpack/msgpack)
  const jsonStr = JSON.stringify(data);
  const bytes = new TextEncoder().encode(jsonStr);

  return {
    success: true,
    data: bytes,
  };
}

/**
 * Helper to simulate a failed command
 */
export function mockCommandError(message: string) {
  throw new Error(message);
}

/**
 * Helper to create a connection profile mock
 */
export function createMockConnectionProfile(overrides?: any) {
  return {
    id: 'test-connection',
    name: 'Test Database',
    db_type: 'Postgres',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    database: 'testdb',
    color: '#3b82f6',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to create a table metadata mock
 */
export function createMockTable(overrides?: any) {
  return {
    name: 'users',
    schema: 'public',
    kind: 'Regular',
    row_count: 100,
    ...overrides,
  };
}

/**
 * Helper to create a column metadata mock
 */
export function createMockColumn(overrides?: any) {
  return {
    name: 'id',
    data_type: { Integer: null },
    nullable: false,
    primary_key: true,
    db_type: 'integer',
    ...overrides,
  };
}
