import { describe, expect, it, vi } from "vitest";
import { TrinoAdapter } from "../dialects/TrinoAdapter";

vi.mock("@/services/queryStreamClient", () => ({
  queryStreamClient: {
    streamWithCallbacks: vi.fn(),
  },
}));

describe("TrinoAdapter", () => {
  const adapter = new TrinoAdapter("trino-conn");

  it("emits column metadata in the generic introspection shape", () => {
    const sql = adapter.getColumnsQuery("tiny", "nation");

    expect(sql).toContain("NULL AS type_oid");
    expect(sql).toContain("false AS is_primary_key");
    expect(sql).toContain("column_default AS default_value");
    expect(sql).not.toContain("ordinal_position,");
  });

  it("uses SHOW STATS for estimated table counts and COUNT(*) for exact counts", () => {
    expect(adapter.getTableCountQuery("tiny", "nation", false)).toBe(
      'SHOW STATS FOR "tiny"."nation"',
    );
    expect(adapter.getTableCountQuery("tiny", "nation", true)).toBe(
      'SELECT count(*) AS count FROM "tiny"."nation"',
    );
  });

  it("uses native OFFSET/LIMIT pagination (OFFSET before LIMIT) instead of ROW_NUMBER wrappers", () => {
    const sql = adapter.select(
      { schema: "tiny", table: "nation" },
      { columns: ["nationkey"], limit: 25, offset: 50 },
    );

    // Trino requires OFFSET before LIMIT
    expect(sql).toContain('ORDER BY "nationkey" ASC OFFSET 50 LIMIT 25');
    expect(sql).not.toContain("ROW_NUMBER()");
    expect(sql).not.toMatch(/LIMIT \d+ OFFSET/); // must not have wrong order
  });
});
