import { beforeEach, describe, expect, it } from "vitest";
import { DbType } from "@/types/connection";
import { useVersionStore } from "@/stores/versionStore";
import { PostgreSQLAdapter } from "../dialects/PostgreSQLAdapter";
import { MySQLAdapter } from "../dialects/MySQLAdapter";
import { MSSQLAdapter } from "../dialects/MSSQLAdapter";
import { SQLiteAdapter } from "../dialects/SQLiteAdapter";

describe("index usage stats query generation", () => {
  beforeEach(() => {
    useVersionStore.getState().clearAll();
  });

  it("uses last_idx_scan for PostgreSQL 16+ only", () => {
    const connectionId = "pg-index-stats";
    const adapter = new PostgreSQLAdapter(connectionId);

    const defaultSql = adapter.getIndexUsageStatsQuery("public", "users");
    expect(defaultSql).toContain("NULL::timestamp AS last_used");

    useVersionStore
      .getState()
      .setVersion(connectionId, "PostgreSQL 16.1", DbType.PostgreSQL);

    const pg16Sql = adapter.getIndexUsageStatsQuery("public", "users");
    expect(pg16Sql).toContain("s.last_idx_scan AS last_used");
  });

  it("falls back to empty result when MySQL version lacks performance schema index stats", () => {
    const adapter = new MySQLAdapter("mysql-legacy");
    useVersionStore
      .getState()
      .setVersion("mysql-legacy", "5.6.51", DbType.MySQL);

    const sql = adapter.getIndexUsageStatsQuery("app", "orders");
    expect(sql).toContain("WHERE 0");
  });

  it("uses performance_schema counters for MySQL 5.7+/8+", () => {
    const connectionId = "mysql-modern";
    const adapter = new MySQLAdapter(connectionId);
    useVersionStore
      .getState()
      .setVersion(connectionId, "8.0.36", DbType.MySQL);

    const sql = adapter.getIndexUsageStatsQuery("app", "orders");
    expect(sql).toContain(
      "performance_schema.table_io_waits_summary_by_index_usage",
    );
    expect(sql).toContain("COALESCE(ps.COUNT_READ, 0) as rows_read");
    expect(sql).not.toContain("SUM_NUMBER_OF_BYTES_READ");
  });

  it("enables performance schema stats for MariaDB 10+", () => {
    const connectionId = "mariadb-modern";
    const adapter = new MySQLAdapter(connectionId);
    useVersionStore
      .getState()
      .setVersion(connectionId, "10.11.2-MariaDB", DbType.MariaDB);

    const sql = adapter.getIndexUsageStatsQuery("app", "orders");
    expect(sql).toContain(
      "performance_schema.table_io_waits_summary_by_index_usage",
    );
  });

  it("returns neutral fallback metrics for MySQL index stats fallback query", () => {
    const adapter = new MySQLAdapter("mysql-fallback");
    const fallbackSql = adapter.getIndexUsageStatsFallbackQuery(
      "app",
      "orders",
    );

    expect(fallbackSql).toContain("0 as scan_count");
    expect(fallbackSql).toContain("0 as is_unused");
  });

  it("provides MSSQL fallback query for restricted DMV access", () => {
    const adapter = new MSSQLAdapter("mssql-fallback");
    const fallbackSql = adapter.getIndexUsageStatsFallbackQuery("dbo", "users");

    expect(fallbackSql).toContain("FROM sys.indexes i");
    expect(fallbackSql).toContain("0 as scan_count");
  });

  it("returns typed empty result for SQLite index usage stats", () => {
    const adapter = new SQLiteAdapter("sqlite");
    const sql = adapter.getIndexUsageStatsQuery("main", "users");

    expect(sql).toContain("NULL as index_name");
    expect(sql).toContain("WHERE 0");
  });
});
