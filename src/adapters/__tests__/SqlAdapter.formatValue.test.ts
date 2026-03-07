import { describe, it, expect } from "vitest";
import { PostgreSQLAdapter } from "../dialects/PostgreSQLAdapter";

describe("SqlAdapter columnType propagation", () => {
  it("should pass dbType to formatValue in UPDATE statements", () => {
    const adapter = new PostgreSQLAdapter("test-conn");
    const sql = adapter.update(
      { schema: "public", table: "users" },
      { metadata: '{"key": "value"}' },
      { id: 1 },
      { columnInfos: [{ name: "metadata", dbType: "jsonb" }] }
    );
    expect(sql).toContain("::jsonb");
  });

  it("should pass dbType to formatValue in INSERT statements", () => {
    const adapter = new PostgreSQLAdapter("test-conn");
    const sql = adapter.insert(
      { schema: "public", table: "users" },
      { id: "550e8400-e29b-41d4-a716-446655440000", data: '{"a":1}' },
      { columnInfos: [
        { name: "id", dbType: "uuid" },
        { name: "data", dbType: "jsonb" },
      ]}
    );
    expect(sql).toContain("::uuid");
    expect(sql).toContain("::jsonb");
  });

  it("should pass dbType to formatValue in WHERE clauses for DELETE", () => {
    const adapter = new PostgreSQLAdapter("test-conn");
    const sql = adapter.delete(
      { schema: "public", table: "users" },
      { id: "550e8400-e29b-41d4-a716-446655440000" },
      { columnInfos: [{ name: "id", dbType: "uuid" }] }
    );
    expect(sql).toContain("::uuid");
  });
});
