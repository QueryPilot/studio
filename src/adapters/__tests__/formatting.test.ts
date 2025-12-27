import { describe, it, expect } from 'vitest';
import { DbType } from '@/types/connection';
import {
  toDbType,
  quoteIdentifier,
  formatTableName,
  escapeString,
  quoteString,
  formatValue,
  getDialectQuoting,
} from '../formatting';

describe('formatting utilities', () => {
  describe('toDbType', () => {
    it('should pass through DbType enum values', () => {
      expect(toDbType(DbType.PostgreSQL)).toBe(DbType.PostgreSQL);
      expect(toDbType(DbType.MySQL)).toBe(DbType.MySQL);
      expect(toDbType(DbType.SQLite)).toBe(DbType.SQLite);
      expect(toDbType(DbType.SQLServer)).toBe(DbType.SQLServer);
    });

    it('should convert string types to DbType enum', () => {
      expect(toDbType('postgresql')).toBe(DbType.PostgreSQL);
      expect(toDbType('postgres')).toBe(DbType.PostgreSQL);
      expect(toDbType('mysql')).toBe(DbType.MySQL);
      expect(toDbType('mariadb')).toBe(DbType.MySQL);
      expect(toDbType('sqlite')).toBe(DbType.SQLite);
      expect(toDbType('mssql')).toBe(DbType.SQLServer);
      expect(toDbType('sqlserver')).toBe(DbType.SQLServer);
    });

    it('should be case insensitive', () => {
      expect(toDbType('POSTGRESQL')).toBe(DbType.PostgreSQL);
      expect(toDbType('MySQL')).toBe(DbType.MySQL);
      expect(toDbType('SQLite')).toBe(DbType.SQLite);
      expect(toDbType('MSSQL')).toBe(DbType.SQLServer);
    });

    it('should default to PostgreSQL for unknown types', () => {
      expect(toDbType('unknown')).toBe(DbType.PostgreSQL);
      expect(toDbType('')).toBe(DbType.PostgreSQL);
    });
  });

  describe('quoteIdentifier', () => {
    describe('PostgreSQL', () => {
      it('should use double quotes', () => {
        expect(quoteIdentifier('column', DbType.PostgreSQL)).toBe('"column"');
        expect(quoteIdentifier('table_name', DbType.PostgreSQL)).toBe('"table_name"');
      });

      it('should escape embedded double quotes', () => {
        expect(quoteIdentifier('col"name', DbType.PostgreSQL)).toBe('"col""name"');
        expect(quoteIdentifier('a"b"c', DbType.PostgreSQL)).toBe('"a""b""c"');
      });
    });

    describe('MySQL', () => {
      it('should use backticks', () => {
        expect(quoteIdentifier('column', DbType.MySQL)).toBe('`column`');
        expect(quoteIdentifier('table_name', DbType.MySQL)).toBe('`table_name`');
      });

      it('should escape embedded backticks', () => {
        expect(quoteIdentifier('col`name', DbType.MySQL)).toBe('`col``name`');
        expect(quoteIdentifier('a`b`c', DbType.MySQL)).toBe('`a``b``c`');
      });
    });

    describe('SQLite', () => {
      it('should use double quotes', () => {
        expect(quoteIdentifier('column', DbType.SQLite)).toBe('"column"');
      });

      it('should escape embedded double quotes', () => {
        expect(quoteIdentifier('col"name', DbType.SQLite)).toBe('"col""name"');
      });
    });

    describe('SQL Server', () => {
      it('should use square brackets', () => {
        expect(quoteIdentifier('column', DbType.SQLServer)).toBe('[column]');
        expect(quoteIdentifier('table_name', DbType.SQLServer)).toBe('[table_name]');
      });

      it('should escape embedded closing brackets', () => {
        expect(quoteIdentifier('col]name', DbType.SQLServer)).toBe('[col]]name]');
        expect(quoteIdentifier('a]b]c', DbType.SQLServer)).toBe('[a]]b]]c]');
      });
    });

    it('should work with string type arguments', () => {
      expect(quoteIdentifier('column', 'postgresql')).toBe('"column"');
      expect(quoteIdentifier('column', 'mysql')).toBe('`column`');
      expect(quoteIdentifier('column', 'mssql')).toBe('[column]');
    });
  });

  describe('formatTableName', () => {
    it('should format table name without schema', () => {
      expect(formatTableName(undefined, 'users', DbType.PostgreSQL)).toBe('"users"');
      expect(formatTableName(undefined, 'users', DbType.MySQL)).toBe('`users`');
      expect(formatTableName(undefined, 'users', DbType.SQLServer)).toBe('[users]');
    });

    it('should format fully qualified table name with schema', () => {
      expect(formatTableName('public', 'users', DbType.PostgreSQL)).toBe('"public"."users"');
      expect(formatTableName('mydb', 'users', DbType.MySQL)).toBe('`mydb`.`users`');
      expect(formatTableName('dbo', 'users', DbType.SQLServer)).toBe('[dbo].[users]');
    });

    it('should handle schema with special characters', () => {
      expect(formatTableName('my"schema', 'table', DbType.PostgreSQL)).toBe('"my""schema"."table"');
      expect(formatTableName('my`schema', 'table', DbType.MySQL)).toBe('`my``schema`.`table`');
    });
  });

  describe('escapeString', () => {
    describe('PostgreSQL/SQLite/MSSQL (standard SQL escaping)', () => {
      it('should double single quotes', () => {
        expect(escapeString("it's", DbType.PostgreSQL)).toBe("it''s");
        expect(escapeString("a'b'c", DbType.PostgreSQL)).toBe("a''b''c");
      });

      it('should not escape backslashes', () => {
        expect(escapeString('path\\to\\file', DbType.PostgreSQL)).toBe('path\\to\\file');
      });
    });

    describe('MySQL (backslash escaping)', () => {
      it('should escape backslashes first', () => {
        expect(escapeString('path\\to', DbType.MySQL)).toBe('path\\\\to');
      });

      it('should escape single quotes with backslash', () => {
        expect(escapeString("it's", DbType.MySQL)).toBe("it\\'s");
      });

      it('should escape newlines and special characters', () => {
        expect(escapeString("line1\nline2", DbType.MySQL)).toBe("line1\\nline2");
        expect(escapeString("col1\tcol2", DbType.MySQL)).toBe("col1\tcol2"); // tab not escaped
        expect(escapeString("a\rb", DbType.MySQL)).toBe("a\\rb");
        expect(escapeString("a\0b", DbType.MySQL)).toBe("a\\0b");
      });
    });
  });

  describe('quoteString', () => {
    it('should quote and escape strings for PostgreSQL', () => {
      expect(quoteString('hello', DbType.PostgreSQL)).toBe("'hello'");
      expect(quoteString("it's", DbType.PostgreSQL)).toBe("'it''s'");
    });

    it('should quote and escape strings for MySQL', () => {
      expect(quoteString('hello', DbType.MySQL)).toBe("'hello'");
      expect(quoteString("it's", DbType.MySQL)).toBe("'it\\'s'");
    });

    it('should use N prefix for SQL Server', () => {
      expect(quoteString('hello', DbType.SQLServer)).toBe("N'hello'");
      expect(quoteString("it's", DbType.SQLServer)).toBe("N'it''s'");
    });
  });

  describe('formatValue', () => {
    describe('NULL handling', () => {
      it('should format null as NULL', () => {
        expect(formatValue(null, DbType.PostgreSQL)).toBe('NULL');
        expect(formatValue(undefined, DbType.PostgreSQL)).toBe('NULL');
      });
    });

    describe('boolean handling', () => {
      it('should use TRUE/FALSE for PostgreSQL', () => {
        expect(formatValue(true, DbType.PostgreSQL)).toBe('TRUE');
        expect(formatValue(false, DbType.PostgreSQL)).toBe('FALSE');
      });

      it('should use 1/0 for MySQL, SQLite, MSSQL', () => {
        expect(formatValue(true, DbType.MySQL)).toBe('1');
        expect(formatValue(false, DbType.MySQL)).toBe('0');
        expect(formatValue(true, DbType.SQLite)).toBe('1');
        expect(formatValue(false, DbType.SQLServer)).toBe('0');
      });
    });

    describe('number handling', () => {
      it('should format integers', () => {
        expect(formatValue(42, DbType.PostgreSQL)).toBe('42');
        expect(formatValue(-100, DbType.PostgreSQL)).toBe('-100');
        expect(formatValue(0, DbType.PostgreSQL)).toBe('0');
      });

      it('should format floats', () => {
        expect(formatValue(3.14, DbType.PostgreSQL)).toBe('3.14');
        expect(formatValue(-0.5, DbType.PostgreSQL)).toBe('-0.5');
      });

      it('should return NULL for non-finite numbers', () => {
        expect(formatValue(Infinity, DbType.PostgreSQL)).toBe('NULL');
        expect(formatValue(-Infinity, DbType.PostgreSQL)).toBe('NULL');
        expect(formatValue(NaN, DbType.PostgreSQL)).toBe('NULL');
      });
    });

    describe('bigint handling', () => {
      it('should format bigints as strings', () => {
        expect(formatValue(BigInt('9007199254740993'), DbType.PostgreSQL)).toBe('9007199254740993');
        expect(formatValue(BigInt(123), DbType.PostgreSQL)).toBe('123');
      });
    });

    describe('string handling', () => {
      it('should quote strings', () => {
        expect(formatValue('hello', DbType.PostgreSQL)).toBe("'hello'");
        expect(formatValue('hello', DbType.MySQL)).toBe("'hello'");
        expect(formatValue('hello', DbType.SQLServer)).toBe("N'hello'");
      });

      it('should escape special characters', () => {
        expect(formatValue("it's", DbType.PostgreSQL)).toBe("'it''s'");
        expect(formatValue("it's", DbType.MySQL)).toBe("'it\\'s'");
      });
    });

    describe('Date handling', () => {
      it('should format dates as ISO strings', () => {
        const date = new Date('2024-01-15T10:30:00.000Z');
        expect(formatValue(date, DbType.PostgreSQL)).toBe("'2024-01-15T10:30:00.000Z'");
      });

      it('should return NULL for invalid dates', () => {
        expect(formatValue(new Date('invalid'), DbType.PostgreSQL)).toBe('NULL');
      });
    });

    describe('object/array handling', () => {
      it('should format objects as JSON strings', () => {
        expect(formatValue({ foo: 'bar' }, DbType.PostgreSQL)).toBe("'{\"foo\":\"bar\"}'");
      });

      it('should format arrays as JSON strings', () => {
        expect(formatValue([1, 2, 3], DbType.PostgreSQL)).toBe("'[1,2,3]'");
      });
    });

    describe('binary handling', () => {
      it('should format Uint8Array as hex for PostgreSQL', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(formatValue(bytes, DbType.PostgreSQL)).toBe("'\\xdeadbeef'::bytea");
      });

      it('should format Uint8Array as hex for MySQL', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(formatValue(bytes, DbType.MySQL)).toBe("X'deadbeef'");
      });

      it('should format Uint8Array as hex for SQL Server', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(formatValue(bytes, DbType.SQLServer)).toBe("0xdeadbeef");
      });
    });
  });

  describe('getDialectQuoting', () => {
    it('should return all formatting functions for a dialect', () => {
      const pg = getDialectQuoting(DbType.PostgreSQL);

      expect(pg.quoteIdentifier('col')).toBe('"col"');
      expect(pg.formatTableName('public', 'users')).toBe('"public"."users"');
      expect(pg.formatValue('test')).toBe("'test'");
      expect(pg.quoteString('test')).toBe("'test'");
      expect(pg.escapeString("it's")).toBe("it''s");
    });

    it('should work with string type arguments', () => {
      const mysql = getDialectQuoting('mysql');

      expect(mysql.quoteIdentifier('col')).toBe('`col`');
      expect(mysql.formatTableName('db', 'users')).toBe('`db`.`users`');
    });
  });
});
