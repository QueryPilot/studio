import { describe, it, expect } from 'vitest';
import { applyColumnRenames, trackColumnRename } from '../index';
import type { CrudCommand } from '@/types/crud';

/**
 * Test suite for column rename tracking functionality.
 *
 * This tests the edge cases where a column is renamed and subsequent
 * commands need to use the new column name in the generated SQL.
 */

// Helper to create a base command target
const createTarget = (table = 'users', schema = 'public') => ({
  connectionId: 'conn-1',
  database: 'testdb',
  schema,
  table,
});

describe('applyColumnRenames', () => {
  describe('column.modify', () => {
    it('should rename columnName when column was previously renamed', () => {
      const renames = new Map([['old_name', 'new_name']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.modify',
        target: createTarget(),
        payload: {
          columnName: 'old_name',
          newDefinition: { name: 'old_name', dataType: 'text', nullable: true },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result.payload).toEqual({
        columnName: 'new_name',
        newDefinition: { name: 'old_name', dataType: 'text', nullable: true },
      });
    });

    it('should not modify columnName when no rename exists', () => {
      const renames = new Map([['other_column', 'renamed_column']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.modify',
        target: createTarget(),
        payload: {
          columnName: 'unchanged_column',
          newDefinition: { name: 'unchanged_column', dataType: 'text', nullable: true },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result.payload).toEqual(command.payload);
    });
  });

  describe('column.drop', () => {
    it('should rename columnName when column was previously renamed', () => {
      const renames = new Map([['to_drop', 'renamed_to_drop']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.drop',
        target: createTarget(),
        payload: {
          columnName: 'to_drop',
          cascade: true,
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result.payload).toEqual({
        columnName: 'renamed_to_drop',
        cascade: true,
      });
    });
  });

  describe('column.rename (chained)', () => {
    it('should apply previous rename to chained rename command', () => {
      // Scenario: A was renamed to B, now trying to rename A to C
      // Should become: rename B to C
      const renames = new Map([['A', 'B']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.rename',
        target: createTarget(),
        payload: {
          columnName: 'A',
          newName: 'C',
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result.payload).toEqual({
        columnName: 'B', // A was already renamed to B
        newName: 'C',
      });
    });
  });

  describe('fk.add', () => {
    it('should rename columns in FK definition', () => {
      const renames = new Map([['user_id', 'account_id']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'fk.add',
        target: createTarget('orders'),
        payload: {
          definition: {
            name: 'fk_orders_users',
            columns: ['user_id'],
            referenceTable: 'users',
            referenceColumns: ['id'],
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.columns).toEqual(['account_id']);
      expect((result.payload as any).definition.referenceColumns).toEqual(['id']);
    });

    it('should rename multiple columns in FK definition', () => {
      const renames = new Map([
        ['col_a', 'new_col_a'],
        ['col_b', 'new_col_b'],
      ]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'fk.add',
        target: createTarget(),
        payload: {
          definition: {
            name: 'fk_composite',
            columns: ['col_a', 'col_b'],
            referenceTable: 'other_table',
            referenceColumns: ['ref_a', 'ref_b'],
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.columns).toEqual(['new_col_a', 'new_col_b']);
    });

    it('should rename reference columns for self-referencing FK', () => {
      const renames = new Map([['parent_id', 'manager_id']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'fk.add',
        target: createTarget('employees'),
        payload: {
          definition: {
            name: 'fk_self_ref',
            columns: ['parent_id'],
            referenceTable: 'employees',
            referenceColumns: ['parent_id'], // Self-referencing
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.columns).toEqual(['manager_id']);
      expect((result.payload as any).definition.referenceColumns).toEqual(['manager_id']);
    });
  });

  describe('index.create', () => {
    it('should rename columns in index definition', () => {
      const renames = new Map([['email', 'email_address']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'index.create',
        target: createTarget(),
        payload: {
          definition: {
            name: 'idx_users_email',
            columns: ['email'],
            unique: true,
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.columns).toEqual(['email_address']);
    });

    it('should rename multiple columns in composite index', () => {
      const renames = new Map([
        ['first_name', 'given_name'],
        ['last_name', 'family_name'],
      ]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'index.create',
        target: createTarget(),
        payload: {
          definition: {
            name: 'idx_users_name',
            columns: ['first_name', 'last_name'],
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.columns).toEqual(['given_name', 'family_name']);
    });

    it('should rename includeColumns in covering index', () => {
      const renames = new Map([['status', 'order_status']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'index.create',
        target: createTarget('orders'),
        payload: {
          definition: {
            name: 'idx_orders_covering',
            columns: ['id'],
            includeColumns: ['status', 'created_at'],
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).definition.includeColumns).toEqual(['order_status', 'created_at']);
    });
  });

  describe('data.insert', () => {
    it('should rename column keys in values', () => {
      const renames = new Map([['name', 'full_name']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.insert',
        target: createTarget(),
        payload: {
          values: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).values).toEqual({
        full_name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should rename multiple column keys in values', () => {
      const renames = new Map([
        ['first_name', 'given_name'],
        ['last_name', 'family_name'],
      ]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.insert',
        target: createTarget(),
        payload: {
          values: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
          },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).values).toEqual({
        given_name: 'John',
        family_name: 'Doe',
        email: 'john@example.com',
      });
    });
  });

  describe('data.update', () => {
    it('should rename column field', () => {
      const renames = new Map([['status', 'order_status']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.update',
        target: createTarget('orders'),
        payload: {
          column: 'status',
          newValue: 'completed',
          primaryKeys: { id: 1 },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect((result.payload as any).column).toBe('order_status');
      expect((result.payload as any).newValue).toBe('completed');
    });
  });

  describe('no-op cases', () => {
    it('should return original command when renames map is empty', () => {
      const renames = new Map<string, string>();
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.modify',
        target: createTarget(),
        payload: {
          columnName: 'some_column',
          newDefinition: { name: 'some_column', dataType: 'text', nullable: true },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result).toBe(command); // Same reference
    });

    it('should return original command for unhandled command types', () => {
      const renames = new Map([['col', 'new_col']]);
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.delete',
        target: createTarget(),
        payload: {
          primaryKeys: { id: 1 },
        },
        metadata: { timestamp: new Date().toISOString() },
      };

      const result = applyColumnRenames(command, renames);

      expect(result).toBe(command);
    });
  });
});

describe('trackColumnRename', () => {
  describe('basic tracking', () => {
    it('should track a simple rename', () => {
      const renames = new Map<string, string>();
      const originalCmd: CrudCommand = {
        id: 'cmd-1',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'old_name', newName: 'new_name' },
        metadata: { timestamp: new Date().toISOString() },
      };
      const adjustedCmd = originalCmd; // No prior renames

      trackColumnRename(renames, originalCmd, adjustedCmd);

      expect(renames.get('old_name')).toBe('new_name');
    });

    it('should not track non-rename commands', () => {
      const renames = new Map<string, string>();
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'column.modify',
        target: createTarget(),
        payload: { columnName: 'col', newDefinition: { name: 'col', dataType: 'text', nullable: true } },
        metadata: { timestamp: new Date().toISOString() },
      };

      trackColumnRename(renames, command, command);

      expect(renames.size).toBe(0);
    });
  });

  describe('chained renames', () => {
    it('should handle A -> B -> C chain correctly', () => {
      const renames = new Map<string, string>();

      // Step 1: Rename A to B
      const cmd1: CrudCommand = {
        id: 'cmd-1',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'A', newName: 'B' },
        metadata: { timestamp: new Date().toISOString() },
      };
      trackColumnRename(renames, cmd1, cmd1);

      expect(renames.get('A')).toBe('B');

      // Step 2: User wants to rename what was originally A (now B) to C
      // Original command references B (the current name)
      const cmd2Original: CrudCommand = {
        id: 'cmd-2',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'B', newName: 'C' },
        metadata: { timestamp: new Date().toISOString() },
      };
      // After applyColumnRenames, B stays B (not in map as key)
      const cmd2Adjusted = cmd2Original;
      trackColumnRename(renames, cmd2Original, cmd2Adjusted);

      // Now both A and B should map to C
      expect(renames.get('A')).toBe('C'); // Chain updated
      expect(renames.get('B')).toBe('C'); // New rename tracked
    });

    it('should handle rename of originally named column after it was renamed', () => {
      const renames = new Map<string, string>();

      // Step 1: Rename A to B
      const cmd1: CrudCommand = {
        id: 'cmd-1',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'A', newName: 'B' },
        metadata: { timestamp: new Date().toISOString() },
      };
      trackColumnRename(renames, cmd1, cmd1);

      // Step 2: User's original command says rename A to C (referencing original name)
      // But after applyColumnRenames, it becomes rename B to C
      const cmd2Original: CrudCommand = {
        id: 'cmd-2',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'A', newName: 'C' },
        metadata: { timestamp: new Date().toISOString() },
      };
      const cmd2Adjusted: CrudCommand = {
        ...cmd2Original,
        payload: { columnName: 'B', newName: 'C' }, // After applying A->B
      };
      trackColumnRename(renames, cmd2Original, cmd2Adjusted);

      // A should map to C (via the chain update)
      // B should map to C (direct tracking)
      expect(renames.get('A')).toBe('C');
      expect(renames.get('B')).toBe('C');
    });
  });

  describe('multiple columns', () => {
    it('should track multiple independent renames', () => {
      const renames = new Map<string, string>();

      const cmd1: CrudCommand = {
        id: 'cmd-1',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'col_a', newName: 'new_col_a' },
        metadata: { timestamp: new Date().toISOString() },
      };
      trackColumnRename(renames, cmd1, cmd1);

      const cmd2: CrudCommand = {
        id: 'cmd-2',
        type: 'column.rename',
        target: createTarget(),
        payload: { columnName: 'col_b', newName: 'new_col_b' },
        metadata: { timestamp: new Date().toISOString() },
      };
      trackColumnRename(renames, cmd2, cmd2);

      expect(renames.get('col_a')).toBe('new_col_a');
      expect(renames.get('col_b')).toBe('new_col_b');
    });
  });
});

describe('Integration: applyColumnRenames + trackColumnRename', () => {
  it('should correctly handle rename then modify sequence', () => {
    const renames = new Map<string, string>();

    // Step 1: Rename column
    const renameCmd: CrudCommand = {
      id: 'cmd-1',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'old_col', newName: 'new_col' },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedRename = applyColumnRenames(renameCmd, renames);
    trackColumnRename(renames, renameCmd, adjustedRename);

    // Step 2: Modify the column (using old name in original command)
    const modifyCmd: CrudCommand = {
      id: 'cmd-2',
      type: 'column.modify',
      target: createTarget(),
      payload: {
        columnName: 'old_col', // User's command still references old name
        newDefinition: { name: 'new_col', dataType: 'varchar', nullable: false },
      },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedModify = applyColumnRenames(modifyCmd, renames);

    // The modify should now reference the new column name
    expect((adjustedModify.payload as any).columnName).toBe('new_col');
  });

  it('should correctly handle rename then insert sequence', () => {
    const renames = new Map<string, string>();

    // Step 1: Rename column
    const renameCmd: CrudCommand = {
      id: 'cmd-1',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'name', newName: 'full_name' },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedRename = applyColumnRenames(renameCmd, renames);
    trackColumnRename(renames, renameCmd, adjustedRename);

    // Step 2: Insert data (using old column name in values)
    const insertCmd: CrudCommand = {
      id: 'cmd-2',
      type: 'data.insert',
      target: createTarget(),
      payload: {
        values: { name: 'John Doe', email: 'john@example.com' },
      },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedInsert = applyColumnRenames(insertCmd, renames);

    // The insert should now use the new column name
    expect((adjustedInsert.payload as any).values).toEqual({
      full_name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should correctly handle rename then create index sequence', () => {
    const renames = new Map<string, string>();

    // Step 1: Rename column
    const renameCmd: CrudCommand = {
      id: 'cmd-1',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'email', newName: 'email_address' },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedRename = applyColumnRenames(renameCmd, renames);
    trackColumnRename(renames, renameCmd, adjustedRename);

    // Step 2: Create index on the renamed column
    const indexCmd: CrudCommand = {
      id: 'cmd-2',
      type: 'index.create',
      target: createTarget(),
      payload: {
        definition: {
          name: 'idx_users_email',
          columns: ['email'], // Using old name
          unique: true,
        },
      },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedIndex = applyColumnRenames(indexCmd, renames);

    // The index should now reference the new column name
    expect((adjustedIndex.payload as any).definition.columns).toEqual(['email_address']);
  });

  it('should correctly handle rename then add FK sequence', () => {
    const renames = new Map<string, string>();

    // Step 1: Rename column
    const renameCmd: CrudCommand = {
      id: 'cmd-1',
      type: 'column.rename',
      target: createTarget('orders'),
      payload: { columnName: 'user_id', newName: 'customer_id' },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedRename = applyColumnRenames(renameCmd, renames);
    trackColumnRename(renames, renameCmd, adjustedRename);

    // Step 2: Add FK on the renamed column
    const fkCmd: CrudCommand = {
      id: 'cmd-2',
      type: 'fk.add',
      target: createTarget('orders'),
      payload: {
        definition: {
          name: 'fk_orders_customers',
          columns: ['user_id'], // Using old name
          referenceTable: 'customers',
          referenceColumns: ['id'],
        },
      },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedFK = applyColumnRenames(fkCmd, renames);

    // The FK should now reference the new column name
    expect((adjustedFK.payload as any).definition.columns).toEqual(['customer_id']);
  });

  it('should correctly handle triple chain rename A -> B -> C -> D', () => {
    const renames = new Map<string, string>();

    // Rename A to B
    const cmd1: CrudCommand = {
      id: 'cmd-1',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'A', newName: 'B' },
      metadata: { timestamp: new Date().toISOString() },
    };
    let adjusted = applyColumnRenames(cmd1, renames);
    trackColumnRename(renames, cmd1, adjusted);

    // Rename B to C
    const cmd2: CrudCommand = {
      id: 'cmd-2',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'B', newName: 'C' },
      metadata: { timestamp: new Date().toISOString() },
    };
    adjusted = applyColumnRenames(cmd2, renames);
    trackColumnRename(renames, cmd2, adjusted);

    // Rename C to D
    const cmd3: CrudCommand = {
      id: 'cmd-3',
      type: 'column.rename',
      target: createTarget(),
      payload: { columnName: 'C', newName: 'D' },
      metadata: { timestamp: new Date().toISOString() },
    };
    adjusted = applyColumnRenames(cmd3, renames);
    trackColumnRename(renames, cmd3, adjusted);

    // All original names should map to D
    expect(renames.get('A')).toBe('D');
    expect(renames.get('B')).toBe('D');
    expect(renames.get('C')).toBe('D');

    // A modify command using any of the old names should resolve to D
    const modifyCmd: CrudCommand = {
      id: 'cmd-4',
      type: 'column.modify',
      target: createTarget(),
      payload: {
        columnName: 'A', // Original name
        newDefinition: { name: 'D', dataType: 'text', nullable: true },
      },
      metadata: { timestamp: new Date().toISOString() },
    };
    const adjustedModify = applyColumnRenames(modifyCmd, renames);
    expect((adjustedModify.payload as any).columnName).toBe('D');
  });
});
