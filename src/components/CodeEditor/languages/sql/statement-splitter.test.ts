import { describe, it, expect } from 'vitest';
import { splitStatements, getStatementAt } from './statement-splitter';

describe('splitStatements', () => {
  it('should split simple statements', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]!.text).toBe('SELECT 1');
    expect(statements[1]!.text).toBe('SELECT 2');
  });

  it('should handle strings with semicolons', () => {
    const sql = "SELECT 'a;b'; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]!.text).toBe("SELECT 'a;b'");
  });

  it('should handle dollar quotes (PostgreSQL)', () => {
    const sql = "SELECT $$ a;b $$; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should handle comments', () => {
    const sql = "SELECT 1; -- comment; \nSELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should handle escaped quotes in strings', () => {
    const sql = "SELECT 'it''s a test'; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]!.text).toBe("SELECT 'it''s a test'");
  });

  it('should handle double-quoted identifiers', () => {
    const sql = 'SELECT "col;name"; SELECT 2;';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]!.text).toBe('SELECT "col;name"');
  });

  it('should handle block comments with semicolons', () => {
    const sql = 'SELECT 1 /* comment; with semicolon */; SELECT 2;';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should handle named dollar quotes', () => {
    const sql = "SELECT $tag$ a;b $tag$; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should handle statement without trailing semicolon', () => {
    const sql = 'SELECT 1; SELECT 2';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[1]!.text).toBe('SELECT 2');
  });

  it('should handle empty input', () => {
    const statements = splitStatements('');
    expect(statements).toHaveLength(0);
  });

  it('should handle whitespace-only input', () => {
    const statements = splitStatements('   \n\t  ');
    expect(statements).toHaveLength(0);
  });

  it('should handle multiple semicolons', () => {
    const sql = 'SELECT 1;;; SELECT 2;';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should preserve correct positions', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    const statements = splitStatements(sql);
    expect(statements[0]!.from).toBe(0);
    expect(statements[0]!.to).toBe(8);
    expect(statements[1]!.from).toBe(10);
    expect(statements[1]!.to).toBe(18);
  });
});

describe('getStatementAt', () => {
  it('should return statement containing position', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    const stmt = getStatementAt(sql, 12); // Position in "SELECT 2"
    expect(stmt?.text).toBe('SELECT 2');
  });

  it('should return null for position outside statements', () => {
    const sql = 'SELECT 1;';
    const stmt = getStatementAt(sql, 100);
    expect(stmt).toBeNull();
  });

  it('should return first statement at position 0', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const stmt = getStatementAt(sql, 0);
    expect(stmt?.text).toBe('SELECT 1');
  });

  it('should return statement at semicolon position', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const stmt = getStatementAt(sql, 8); // At the semicolon
    expect(stmt?.text).toBe('SELECT 1');
  });

  it('should handle position in whitespace between statements', () => {
    const sql = 'SELECT 1;   SELECT 2;';
    const stmt = getStatementAt(sql, 10); // In whitespace
    expect(stmt).toBeNull();
  });
});
