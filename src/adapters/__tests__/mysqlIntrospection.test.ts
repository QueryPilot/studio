import { MySQLAdapter } from "../dialects/MySQLAdapter";

describe("MySQLAdapter introspection", () => {
  test("getConstraintsQuery includes definition for pk/fk parsing", () => {
    const adapter = new MySQLAdapter();
    const sql = adapter.getConstraintsQuery("test_schema", "test_table");

    expect(sql).toContain(" as definition");
    expect(sql).toContain("FOREIGN KEY");
    expect(sql).toContain("REFERENCES");
    expect(sql).toContain("GROUP_CONCAT");
  });

  test("getIndexesQuery returns columns in JSON array format", () => {
    const adapter = new MySQLAdapter();
    const sql = adapter.getIndexesQuery("test_schema", "test_table");

    // Should format columns as JSON array: ["col1","col2"]
    expect(sql).toContain("CONCAT('[', GROUP_CONCAT(");
    expect(sql).toContain('REPLACE(COLUMN_NAME, \'"\', \'\\\\"\')');
    expect(sql).toContain("SEPARATOR ','), ']')");
    
    // Should include all required columns for introspection
    expect(sql).toContain("INDEX_NAME as index_name");
    expect(sql).toContain("TABLE_NAME as table_name");
    expect(sql).toContain("NOT NON_UNIQUE as is_unique");
    expect(sql).toContain("INDEX_NAME = 'PRIMARY' as is_primary");
    expect(sql).toContain("is_partial");
    expect(sql).toContain("definition");
    expect(sql).toContain("is_foreign_key");
    
    // Should order columns by SEQ_IN_INDEX to maintain correct order
    expect(sql).toContain("ORDER BY SEQ_IN_INDEX");
  });
});
