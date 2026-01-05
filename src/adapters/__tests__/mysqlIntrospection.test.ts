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
});
