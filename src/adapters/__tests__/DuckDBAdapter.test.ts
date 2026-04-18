import { describe, expect, it } from "vitest";
import { DuckDBAdapter } from "../dialects/DuckDBAdapter";

describe("DuckDBAdapter", () => {
  const adapter = new DuckDBAdapter("duckdb-conn");

  it("uses the global information_schema fallback for attached database tables", () => {
    const sql = adapter.getTablesQuery("test_attach.main");

    expect(sql).toContain("FROM information_schema.tables");
    expect(sql).toContain("table_catalog = 'test_attach'");
    expect(sql).not.toContain('FROM "test_attach".information_schema.tables');
  });

  it("uses the global information_schema fallback for attached database views", () => {
    const sql = adapter.getViewsQuery("test_attach.main");

    expect(sql).toContain("FROM information_schema.tables");
    expect(sql).toContain("FROM information_schema.views");
    expect(sql).toContain("table_catalog = 'test_attach'");
    expect(sql).not.toContain('FROM "test_attach".information_schema.tables');
  });
});
