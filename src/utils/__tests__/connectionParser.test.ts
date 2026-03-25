import { describe, it, expect } from 'vitest';
import { buildConnectionUri, parseConnectionUri } from '../connectionParser';
import { SslMode } from '@/types/connection';
import { DbType } from '@/types/connection';

describe('parseConnectionUri', () => {
  it('should parse MySQL URI with charset query parameter', () => {
    const uri = 'mysql://devuser:devpass123@localhost:13306/todoapp?charset=utf8mb4';
    const result = parseConnectionUri(uri);

    expect(result.dbType).toBe('mysql');
    expect(result.host).toBe('localhost');
    expect(result.port).toBe('13306');
    expect(result.username).toBe('devuser');
    expect(result.password).toBe('devpass123');
    expect(result.database).toBe('todoapp');
    expect(result.options).toEqual({ charset: 'utf8mb4' });
  });

  it('should parse MySQL URI with multiple query parameters', () => {
    const uri = 'mysql://user:pass@host:3306/db?charset=utf8mb4&timezone=UTC&connect_timeout=10';
    const result = parseConnectionUri(uri);

    expect(result.options).toEqual({
      charset: 'utf8mb4',
      timezone: 'UTC',
      connect_timeout: '10',
    });
  });

  it('should separate sslmode from other options', () => {
    const uri = 'postgresql://user:pass@host:5432/db?sslmode=require&application_name=MyApp';
    const result = parseConnectionUri(uri);

    expect(result.sslMode).toBe(SslMode.Require);
    expect(result.options).toEqual({
      application_name: 'MyApp',
    });
    expect(result.options).not.toHaveProperty('sslmode');
  });

  it('should parse prefer sslmode value', () => {
    const uri = 'postgresql://user:pass@host:5432/db?sslmode=prefer';
    const result = parseConnectionUri(uri);

    expect(result.sslMode).toBe(SslMode.Prefer);
  });

  it('should handle URI with no query parameters', () => {
    const uri = 'mysql://user:pass@host:3306/db';
    const result = parseConnectionUri(uri);

    expect(result.options).toBeUndefined();
  });

  it('should handle special characters in password', () => {
    const uri = 'mysql://user:p%40ss%23w0rd@host:3306/db?charset=utf8mb4';
    const result = parseConnectionUri(uri);

    expect(result.password).toBe('p@ss#w0rd');
    expect(result.options).toEqual({ charset: 'utf8mb4' });
  });

  it('should parse a standard Oracle service-name URI', () => {
    const uri = 'oracle://system:DevPass123@localhost:1521/FREEPDB1';
    const result = parseConnectionUri(uri);

    expect(result.dbType).toBe('oracle');
    expect(result.host).toBe('localhost');
    expect(result.port).toBe('1521');
    expect(result.username).toBe('system');
    expect(result.password).toBe('DevPass123');
    expect(result.database).toBe('FREEPDB1');
  });

  it('should parse a JDBC Oracle thin service-name URI', () => {
    const uri = 'jdbc:oracle:thin:@//db.internal:11521/XE';
    const result = parseConnectionUri(uri);

    expect(result.dbType).toBe('oracle');
    expect(result.host).toBe('db.internal');
    expect(result.port).toBe('11521');
    expect(result.database).toBe('XE');
  });
});

describe('buildConnectionUri', () => {
  it('should build an Oracle URI from a connection profile', () => {
    const uri = buildConnectionUri({
      id: 'oracle-dev',
      name: 'Oracle Dev',
      db_type: DbType.Oracle,
      host: 'localhost',
      port: 1521,
      database: 'FREEPDB1',
      username: 'system',
      password: 'DevPass123',
      options: {},
    });

    expect(uri).toBe('oracle://system@localhost:1521/FREEPDB1');
  });
});
