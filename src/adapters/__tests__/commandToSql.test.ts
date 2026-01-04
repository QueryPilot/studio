/**
 * Tests for commandToSql function - verifies SQL generation for all CRUD operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { commandToSql } from '../index';
import { PostgreSQLAdapter } from '../dialects/PostgreSQLAdapter';
import { MySQLAdapter } from '../dialects/MySQLAdapter';
import { SQLiteAdapter } from '../dialects/SQLiteAdapter';
import { MSSQLAdapter } from '../dialects/MSSQLAdapter';
import type { CrudCommand } from '@/types/crud';
import type { DatabaseAdapter } from '../types';

describe('commandToSql - PostgreSQL', () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = new PostgreSQLAdapter('test-connection');
  });

  describe('DML Operations', () => {
    it('should generate INSERT statement', () => {
      const command: CrudCommand = {
        id: 'test-1',
        type: 'data.insert',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          values: { name: 'John Doe', email: 'john@example.com', age: 30 },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('"users"');
      expect(sql).toContain('John Doe');
    });

    it('should generate UPDATE statement', () => {
      const command: CrudCommand = {
        id: 'test-2',
        type: 'data.update',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          column: 'email',
          newValue: 'newemail@example.com',
          oldValue: 'old@example.com',
          primaryKeys: { id: 1 },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('UPDATE');
      expect(sql).toContain('"users"');
      expect(sql).toContain('newemail@example.com');
    });

    it('should generate DELETE statement', () => {
      const command: CrudCommand = {
        id: 'test-3',
        type: 'data.delete',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          primaryKeys: { id: 1 },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DELETE FROM');
      expect(sql).toContain('"users"');
    });
  });

  describe('Column Operations', () => {
    it('should generate ADD COLUMN statement', () => {
      const command: CrudCommand = {
        id: 'test-4',
        type: 'column.add',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          column: {
            name: 'phone',
            dataType: 'VARCHAR(20)',
            nullable: true,
            defaultValue: null,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('ADD COLUMN');
      expect(sql).toContain('"phone"');
    });

    it('should generate DROP COLUMN statement', () => {
      const command: CrudCommand = {
        id: 'test-5',
        type: 'column.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          columnName: 'phone',
          cascade: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('DROP COLUMN');
      expect(sql).toContain('CASCADE');
    });

    it('should generate RENAME COLUMN statement', () => {
      const command: CrudCommand = {
        id: 'test-6',
        type: 'column.rename',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          columnName: 'email',
          newName: 'email_address',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('RENAME COLUMN');
    });
  });

  describe('Index Operations', () => {
    it('should generate CREATE INDEX statement', () => {
      const command: CrudCommand = {
        id: 'test-7',
        type: 'index.create',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          definition: {
            name: 'idx_users_email',
            columns: ['email'],
            unique: true,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE UNIQUE INDEX');
      expect(sql).toContain('"idx_users_email"');
    });

    it('should generate DROP INDEX statement', () => {
      const command: CrudCommand = {
        id: 'test-8',
        type: 'index.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          indexName: 'idx_users_email',
          ifExists: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP INDEX');
      expect(sql).toContain('IF EXISTS');
    });
  });

  describe('View Operations', () => {
    it('should generate CREATE VIEW statement', () => {
      const command: CrudCommand = {
        id: 'test-9',
        type: 'view.create',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          definition: {
            name: 'active_users',
            definition: 'SELECT * FROM users WHERE active = true',
            isMaterialized: false,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE VIEW');
      expect(sql).toContain('"active_users"');
    });

    it('should generate CREATE MATERIALIZED VIEW statement', () => {
      const command: CrudCommand = {
        id: 'test-10',
        type: 'view.create',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          definition: {
            name: 'user_stats',
            definition: 'SELECT count(*) FROM users',
            isMaterialized: true,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE MATERIALIZED VIEW');
    });

    it('should generate DROP VIEW statement', () => {
      const command: CrudCommand = {
        id: 'test-11',
        type: 'view.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          viewName: 'active_users',
          ifExists: true,
          cascade: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP VIEW');
      expect(sql).toContain('IF EXISTS');
      expect(sql).toContain('CASCADE');
    });

    it('should generate REPLACE VIEW statement', () => {
      const command: CrudCommand = {
        id: 'test-12',
        type: 'view.replace',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          viewName: 'active_users',
          definition: 'SELECT * FROM users WHERE active = true AND deleted_at IS NULL',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE OR REPLACE VIEW');
    });

    it('should generate RENAME VIEW statement', () => {
      const command: CrudCommand = {
        id: 'test-13',
        type: 'view.rename',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          viewName: 'active_users',
          newName: 'enabled_users',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER VIEW');
      expect(sql).toContain('RENAME TO');
    });
  });

  describe('Constraint Operations', () => {
    it('should generate ADD PRIMARY KEY statement', () => {
      const command: CrudCommand = {
        id: 'test-14',
        type: 'constraint.addPrimaryKey',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          definition: {
            name: 'users_pkey',
            type: 'primary_key',
            columns: ['id'],
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('ADD CONSTRAINT');
      expect(sql).toContain('PRIMARY KEY');
    });

    it('should generate ADD UNIQUE constraint statement', () => {
      const command: CrudCommand = {
        id: 'test-15',
        type: 'constraint.addUnique',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          definition: {
            name: 'users_email_unique',
            type: 'unique',
            columns: ['email'],
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ADD CONSTRAINT');
      expect(sql).toContain('UNIQUE');
    });

    it('should generate ADD CHECK constraint statement', () => {
      const command: CrudCommand = {
        id: 'test-16',
        type: 'constraint.addCheck',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          definition: {
            name: 'users_age_check',
            type: 'check',
            expression: 'age >= 18',
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ADD CONSTRAINT');
      expect(sql).toContain('CHECK');
    });

    it('should generate DROP CONSTRAINT statement', () => {
      const command: CrudCommand = {
        id: 'test-17',
        type: 'constraint.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          constraintName: 'users_age_check',
          cascade: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP CONSTRAINT');
      expect(sql).toContain('CASCADE');
    });

    it('should generate RENAME CONSTRAINT statement', () => {
      const command: CrudCommand = {
        id: 'test-18',
        type: 'constraint.rename',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          constraintName: 'users_pkey',
          newName: 'users_pk',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('RENAME CONSTRAINT');
    });
  });

  describe('Sequence Operations', () => {
    it('should generate CREATE SEQUENCE statement', () => {
      const command: CrudCommand = {
        id: 'test-19',
        type: 'sequence.create',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          definition: {
            name: 'user_id_seq',
            increment: 1,
            startValue: 1000,
            minValue: 1,
            maxValue: 999999999,
            cache: 10,
            cycle: false,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE SEQUENCE');
      expect(sql).toContain('"user_id_seq"');
      expect(sql).toContain('START WITH 1000');
    });

    it('should generate ALTER SEQUENCE statement', () => {
      const command: CrudCommand = {
        id: 'test-20',
        type: 'sequence.alter',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          sequenceName: 'user_id_seq',
          changes: {
            increment: 2,
            cache: 20,
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER SEQUENCE');
      expect(sql).toContain('INCREMENT BY 2');
    });

    it('should generate DROP SEQUENCE statement', () => {
      const command: CrudCommand = {
        id: 'test-21',
        type: 'sequence.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          sequenceName: 'user_id_seq',
          ifExists: true,
          cascade: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP SEQUENCE');
      expect(sql).toContain('IF EXISTS');
      expect(sql).toContain('CASCADE');
    });

    it('should generate RENAME SEQUENCE statement', () => {
      const command: CrudCommand = {
        id: 'test-22',
        type: 'sequence.rename',
        target: { connectionId: 'test', database: 'testdb', schema: 'public' },
        payload: {
          sequenceName: 'user_id_seq',
          newName: 'users_id_sequence',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER SEQUENCE');
      expect(sql).toContain('RENAME TO');
    });
  });

  describe('Trigger Operations', () => {
    it('should generate CREATE TRIGGER statement', () => {
      const command: CrudCommand = {
        id: 'test-23',
        type: 'trigger.create',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          definition: {
            name: 'update_timestamp',
            timing: 'BEFORE',
            events: ['UPDATE'],
            functionName: 'set_updated_at',
            level: 'ROW',
          },
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('CREATE TRIGGER');
      expect(sql).toContain('BEFORE UPDATE');
    });

    it('should generate DROP TRIGGER statement', () => {
      const command: CrudCommand = {
        id: 'test-24',
        type: 'trigger.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          triggerName: 'update_timestamp',
          ifExists: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP TRIGGER');
      expect(sql).toContain('IF EXISTS');
    });

    it('should generate RENAME TRIGGER statement', () => {
      const command: CrudCommand = {
        id: 'test-25',
        type: 'trigger.rename',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          triggerName: 'update_timestamp',
          newName: 'update_modified_at',
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('ALTER TRIGGER');
      expect(sql).toContain('RENAME TO');
    });
  });

  describe('Table Operations', () => {
    it('should generate DROP TABLE statement', () => {
      const command: CrudCommand = {
        id: 'test-26',
        type: 'table.drop',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'old_table' },
        payload: {
          tableName: 'old_table',
          cascade: true,
          ifExists: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('DROP TABLE');
      expect(sql).toContain('IF EXISTS');
      expect(sql).toContain('CASCADE');
    });

    it('should generate TRUNCATE TABLE statement', () => {
      const command: CrudCommand = {
        id: 'test-27',
        type: 'table.truncate',
        target: { connectionId: 'test', database: 'testdb', schema: 'public', table: 'users' },
        payload: {
          tableName: 'users',
          restartIdentity: true,
          cascade: true,
        },
        metadata: { timestamp: '2024-01-01T00:00:00Z' },
        state: 'staged',
      };

      const sql = commandToSql(adapter, command);
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('TRUNCATE TABLE');
      expect(sql).toContain('RESTART IDENTITY');
      expect(sql).toContain('CASCADE');
    });
  });
});

describe('commandToSql - MySQL', () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = new MySQLAdapter('test-connection');
  });

  it('should generate MySQL-compatible view statement', () => {
    const command: CrudCommand = {
      id: 'test-mysql-1',
      type: 'view.create',
      target: { connectionId: 'test', database: 'testdb', schema: 'public' },
      payload: {
        definition: {
          name: 'active_users',
          definition: 'SELECT * FROM users WHERE active = 1',
          isMaterialized: false,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    const sql = commandToSql(adapter, command);
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('CREATE VIEW');
    // MySQL uses backticks
    expect(sql).toContain('`active_users`');
  });

  it('should throw error for materialized view in MySQL', () => {
    const command: CrudCommand = {
      id: 'test-mysql-2',
      type: 'view.create',
      target: { connectionId: 'test', database: 'testdb', schema: 'public' },
      payload: {
        definition: {
          name: 'user_stats',
          definition: 'SELECT count(*) FROM users',
          isMaterialized: true,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    // MySQL doesn't support materialized views - should throw error
    expect(() => commandToSql(adapter, command)).toThrowErrorMatchingSnapshot();
  });

  it('should throw error for sequence in MySQL', () => {
    const command: CrudCommand = {
      id: 'test-mysql-3',
      type: 'sequence.create',
      target: { connectionId: 'test', database: 'testdb', schema: 'public' },
      payload: {
        definition: {
          name: 'user_id_seq',
          increment: 1,
          startValue: 1000,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    // MySQL doesn't support sequences - should throw error
    expect(() => commandToSql(adapter, command)).toThrowErrorMatchingSnapshot();
  });
});

describe('commandToSql - SQLite', () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = new SQLiteAdapter('test-connection');
  });

  it('should generate SQLite-compatible INSERT statement', () => {
    const command: CrudCommand = {
      id: 'test-sqlite-1',
      type: 'data.insert',
      target: { connectionId: 'test', database: 'main', table: 'users' },
      payload: {
        values: { name: 'John Doe', email: 'john@example.com' },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    const sql = commandToSql(adapter, command);
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('INSERT INTO');
    // SQLite uses double quotes
    expect(sql).toContain('"users"');
  });

  it('should throw error for sequence in SQLite', () => {
    const command: CrudCommand = {
      id: 'test-sqlite-2',
      type: 'sequence.create',
      target: { connectionId: 'test', database: 'main' },
      payload: {
        definition: {
          name: 'user_id_seq',
          increment: 1,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    // SQLite doesn't support sequences - should throw error
    expect(() => commandToSql(adapter, command)).toThrowErrorMatchingSnapshot();
  });
});

describe('commandToSql - SQL Server', () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = new MSSQLAdapter('test-connection');
  });

  it('should generate SQL Server-compatible view statement', () => {
    const command: CrudCommand = {
      id: 'test-mssql-1',
      type: 'view.create',
      target: { connectionId: 'test', database: 'testdb', schema: 'dbo' },
      payload: {
        definition: {
          name: 'active_users',
          definition: 'SELECT * FROM users WHERE active = 1',
          isMaterialized: false,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    const sql = commandToSql(adapter, command);
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('CREATE VIEW');
    // SQL Server uses square brackets
    expect(sql).toContain('[active_users]');
  });

  it('should generate sequence statement for SQL Server', () => {
    const command: CrudCommand = {
      id: 'test-mssql-2',
      type: 'sequence.create',
      target: { connectionId: 'test', database: 'testdb', schema: 'dbo' },
      payload: {
        definition: {
          name: 'user_id_seq',
          increment: 1,
          startValue: 1000,
        },
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    const sql = commandToSql(adapter, command);
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('CREATE SEQUENCE');
  });

  it('should use sp_rename for trigger rename', () => {
    const command: CrudCommand = {
      id: 'test-mssql-3',
      type: 'trigger.rename',
      target: { connectionId: 'test', database: 'testdb', schema: 'dbo', table: 'users' },
      payload: {
        triggerName: 'old_trigger',
        newName: 'new_trigger',
      },
      metadata: { timestamp: '2024-01-01T00:00:00Z' },
      state: 'staged',
    };

    const sql = commandToSql(adapter, command);
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('sp_rename');
  });
});

