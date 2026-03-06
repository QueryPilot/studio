import { describe, it, expect } from "vitest";
import {
  extractSqlStatements,
  inferSqlDialect,
  buildFallbackQueryRunCommands,
} from "../sqlFallbackActions";
import type { AIConnectionContext } from "@/types/aiContext";

const CONNECTIONS: AIConnectionContext[] = [
  {
    id: "mysql-1",
    name: "MariaDB",
    dbType: "MariaDB",
    database: "todoapp",
    paradigm: "sql",
    schemas: [],
  },
  {
    id: "pg-1",
    name: "PostgreSQL",
    dbType: "PostgreSQL",
    database: "postgres",
    paradigm: "sql",
    schemas: [],
  },
  {
    id: "mssql-1",
    name: "SQL Server",
    dbType: "SQL Server",
    database: "master",
    paradigm: "sql",
    schemas: [],
  },
  {
    id: "mongo-1",
    name: "Mongo",
    dbType: "MongoDB",
    database: "app",
    paradigm: "document",
    schemas: [],
  },
];

const LARGEST_TABLES_RESPONSE = `I'll help you find the largest tables across your databases. Let me query the table sizes for you.
SELECT
  table_name,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb,
  table_rows
FROM information_schema.tables
WHERE table_schema = 'todoapp'
ORDER BY (data_length + index_length) DESC
LIMIT 10;
SELECT
  schemaname || '.' || tablename AS table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
SELECT
  t.name AS table_name,
  SUM(a.total_pages) * 8 / 1024.0 AS total_size_mb,
  SUM(a.used_pages) * 8 / 1024.0 AS used_size_mb,
  SUM(p.rows) AS row_count
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name
ORDER BY SUM(a.total_pages) DESC;`;

const LARGEST_TABLES_NO_SEMICOLONS = `I'll check the largest tables across all your SQL connections by querying table sizes.
SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb, table_rows FROM information_schema.tables WHERE table_schema = 'todoapp' ORDER BY (data_length + index_length) DESC LIMIT 10
SELECT schemaname || '.' || tablename AS table_name, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size, pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10
SELECT t.name AS table_name, SUM(a.total_pages) * 8 / 1024.0 AS size_mb, SUM(p.rows) AS row_count FROM sys.tables t INNER JOIN sys.indexes i ON t.object_id = i.object_id INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id WHERE t.is_ms_shipped = 0 GROUP BY t.name ORDER BY size_mb DESC
I've queued queries to analyze table sizes across your connections.`;

describe("sqlFallbackActions", () => {
  it("extracts multiple SQL statements from plain assistant text", () => {
    const statements = extractSqlStatements(LARGEST_TABLES_RESPONSE);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("information_schema.tables");
    expect(statements[1]).toContain("pg_total_relation_size");
    expect(statements[2]).toContain("sys.tables");
  });

  it("infers SQL dialect from vendor-specific syntax", () => {
    expect(inferSqlDialect("SELECT * FROM information_schema.tables WHERE data_length > 0;"))
      .toBe("mysql");
    expect(inferSqlDialect("SELECT pg_total_relation_size('public.users');")).toBe("postgres");
    expect(inferSqlDialect("SELECT * FROM sys.tables t;"))
      .toBe("mssql");
    expect(inferSqlDialect("SELECT name FROM sqlite_master WHERE type='table';"))
      .toBe("sqlite");
  });

  it("builds one query.run fallback command per matched connection", () => {
    const commands = buildFallbackQueryRunCommands({
      text: LARGEST_TABLES_RESPONSE,
      connections: CONNECTIONS,
      commandIdPrefix: "test",
    });

    expect(commands).toHaveLength(3);
    expect(commands.map((cmd) => cmd.name)).toEqual([
      "query.run",
      "query.run",
      "query.run",
    ]);
    expect(commands.map((cmd) => cmd.params.connectionId).sort()).toEqual([
      "mssql-1",
      "mysql-1",
      "pg-1",
    ]);
    expect(commands.every((cmd) => cmd.approval === "auto")).toBe(true);
  });

  it("uses default connection for ambiguous SQL when dialect is unknown", () => {
    const commands = buildFallbackQueryRunCommands({
      text: "SELECT id, email FROM users LIMIT 10;",
      connections: CONNECTIONS,
      defaultConnectionId: "pg-1",
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.params.connectionId).toBe("pg-1");
  });

  it("skips ambiguous SQL when multiple SQL connections exist and no default is available", () => {
    const commands = buildFallbackQueryRunCommands({
      text: "SELECT id, email FROM users LIMIT 10;",
      connections: CONNECTIONS,
    });

    expect(commands).toHaveLength(0);
  });

  it("extracts fallback query.run commands from SQL without trailing semicolons", () => {
    const commands = buildFallbackQueryRunCommands({
      text: LARGEST_TABLES_NO_SEMICOLONS,
      connections: CONNECTIONS,
      commandIdPrefix: "nosemi",
    });

    expect(commands).toHaveLength(3);
    expect(commands.map((cmd) => cmd.params.connectionId).sort()).toEqual([
      "mssql-1",
      "mysql-1",
      "pg-1",
    ]);
    expect(commands.every((cmd) => cmd.confidence === "high")).toBe(true);
  });
});
