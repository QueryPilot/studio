import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqlOperationExecutor } from '../SqlOperationExecutor';
import type { CrudCommand } from '@/types/crud';
import type { DatabaseAdapter } from '@/adapters/types';

const createMockAdapter = (): DatabaseAdapter => ({
  connectionId: 'test-conn',
  dbType: 'PostgreSQL',
  paradigm: 'sql',
  quoteIdentifier: (id: string) => `"${id}"`,
  quoteString: (val: string) => `'${val}'`,
  transaction: (statements: string[]) => `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
  formatValue: (v: unknown) => String(v),
} as unknown as DatabaseAdapter);

vi.mock('@/adapters', () => ({
  commandToSql: vi.fn((_adapter, cmd) => {
    switch (cmd.type) {
      case 'data.insert':
        return `INSERT INTO "${cmd.target.schema}"."${cmd.target.table}" VALUES (...)`;
      case 'data.update':
        return `UPDATE "${cmd.target.schema}"."${cmd.target.table}" SET ...`;
      case 'data.delete':
        return `DELETE FROM "${cmd.target.schema}"."${cmd.target.table}" WHERE ...`;
      default:
        return `-- ${cmd.type}`;
    }
  }),
  applyColumnRenames: vi.fn((cmd) => cmd),
  applyTableRenames: vi.fn((cmd) => cmd),
  trackColumnRename: vi.fn(),
  trackTableRename: vi.fn(),
}));

const createInsertCommand = (overrides: Partial<CrudCommand> = {}): CrudCommand => ({
  id: 'cmd-1',
  type: 'data.insert',
  target: {
    connectionId: 'test-conn',
    database: 'testdb',
    schema: 'public',
    table: 'users',
  },
  payload: {
    values: { name: 'Alice', email: 'alice@example.com' },
  },
  metadata: {
    description: 'Insert user',
    affectedRows: 1,
    timestamp: new Date().toISOString(),
  },
  state: 'staged',
  ...overrides,
});

describe('SqlOperationExecutor', () => {
  let executor: SqlOperationExecutor;
  let mockAdapter: DatabaseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    executor = new SqlOperationExecutor(mockAdapter, 'test-conn');
  });

  describe('paradigm', () => {
    it('should be sql', () => {
      expect(executor.paradigm).toBe('sql');
    });
  });

  describe('execute', () => {
    it('should return success for empty command list', async () => {
      const result = await executor.execute([]);

      expect(result).toEqual({
        success: true,
        affectedCount: 0,
        errors: [],
      });
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should execute commands and return success', async () => {
      const commands = [createInsertCommand()];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should handle execution failures', async () => {
      (mockAdapter.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection lost'));

      const commands = [createInsertCommand()];

      const result = await executor.execute(commands);

      expect(result.success).toBe(false);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('Connection lost');
    });
  });

  describe('preview', () => {
    it('should generate SQL preview', () => {
      const commands = [createInsertCommand()];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('sql');
      expect(preview.content).toContain('INSERT');
      expect(preview.operations).toHaveLength(1);
      expect(preview.operations[0]?.action).toBe('insert');
      expect(preview.operations[0]?.target).toBe('public.users');
    });

    it('should handle empty commands list', () => {
      const preview = executor.preview([]);

      expect(preview.type).toBe('sql');
      expect(preview.content).toBe('-- No SQL statements to execute');
      expect(preview.operations).toEqual([]);
    });
  });

  describe('validate', () => {
    it('should validate valid commands', () => {
      const command = createInsertCommand();

      const result = executor.validate(command);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
