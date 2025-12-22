import { describe, it, expect } from "vitest";
import { applyClientSideFilter } from "./clientSideFilter";
import type { FilterConfig, FilterGroup } from "@/types";

describe("clientSideFilter", () => {
  const sampleRows = [
    { id: "1", name: "Alice", age: "30", email: "alice@test.com" },
    { id: "2", name: "Bob", age: "25", email: "bob@test.com" },
    { id: "3", name: "Charlie", age: "35", email: "charlie@example.com" },
    { id: "4", name: "David", age: "30", email: null },
    { id: "5", name: null, age: "28", email: "nobody@test.com" },
  ];
  const columns = ["id", "name", "age", "email"];

  describe("simple search (rawWhereClause)", () => {
    it("filters rows matching search term in any column", () => {
      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "alice",
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Alice");
    });

    it("is case insensitive", () => {
      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "ALICE",
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1);
    });

    it("matches partial values", () => {
      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "@test.com",
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Alice, Bob, nobody
    });

    it("returns all rows for empty search", () => {
      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "  ",
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(5);
    });
  });

  describe("structured filters", () => {
    it("filters with = operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: "=", value: "30" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Alice and David
    });

    it("filters with != operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: "!=", value: "30" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Bob, Charlie, nobody
    });

    it("filters with CONTAINS operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "email", operator: "CONTAINS", value: "test" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Alice, Bob, nobody
    });

    it("filters with NOT CONTAINS operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "email", operator: "NOT CONTAINS", value: "test" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Charlie
    });

    it("filters with STARTS WITH operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "STARTS WITH", value: "a" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Alice
    });

    it("filters with ENDS WITH operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "ENDS WITH", value: "ie" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Charlie
    });

    it("filters with LIKE operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "LIKE", value: "%li%" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Alice, Charlie
    });

    it("filters with > operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: ">", value: "30" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Charlie (35)
    });

    it("filters with >= operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: ">=", value: "30" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Alice, Charlie, David
    });

    it("filters with IS NULL operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "email", operator: "IS NULL", value: "" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // David
    });

    it("filters with IS NOT NULL operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "email", operator: "IS NOT NULL", value: "" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(4);
    });

    it("filters with IN operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: "IN", value: ["25", "35"] }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Bob, Charlie
    });

    it("filters with BETWEEN operator", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: "BETWEEN", value: [26, 31] }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Alice (30), David (30), nobody (28)
    });
  });

  describe("logical operators", () => {
    it("handles AND logic with multiple conditions", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [
            { id: "c1", column: "age", operator: "=", value: "30" },
            { id: "c2", column: "email", operator: "IS NOT NULL", value: "" },
          ],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Only Alice (David has null email)
    });

    it("handles OR logic with multiple conditions", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "OR",
          conditions: [
            { id: "c1", column: "name", operator: "=", value: "Alice" },
            { id: "c2", column: "name", operator: "=", value: "Bob" },
          ],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Alice and Bob
    });

    it("handles nested groups", () => {
      const nestedGroup: FilterGroup = {
        id: "nested",
        type: "group",
        logical: "OR",
        conditions: [
          { id: "c2", column: "name", operator: "=", value: "Alice" },
          { id: "c3", column: "name", operator: "=", value: "Bob" },
        ],
      };

      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "age", operator: "<=", value: "30" }, nestedGroup],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Alice (30) and Bob (25)
    });
  });

  describe("edge cases", () => {
    it("returns all rows when filter is undefined", () => {
      const result = applyClientSideFilter(sampleRows, undefined, columns);

      expect(result).toHaveLength(5);
    });

    it("returns all rows when conditions are empty", () => {
      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(5);
    });

    it("handles objects in cell values", () => {
      const rowsWithObjects = [
        { id: "1", data: { nested: "value" } },
        { id: "2", data: { nested: "other" } },
      ];

      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "value",
      };

      const result = applyClientSideFilter(rowsWithObjects, filter, ["id", "data"]);

      expect(result).toHaveLength(1);
    });
  });

  describe("ILIKE and REGEX operators", () => {
    it("filters with ILIKE operator (case insensitive)", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "ILIKE", value: "%ALICE%" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Alice (case insensitive match)
    });

    it("filters with REGEX operator (case sensitive)", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "REGEX", value: "^A.*e$" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(1); // Alice
    });

    it("filters with REGEX_I operator (case insensitive)", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "REGEX_I", value: "li" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Alice, Charlie (both contain "li")
    });

    it("handles invalid regex gracefully", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "REGEX", value: "[invalid" }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(0); // Invalid regex returns false
    });
  });

  describe("negated conditions", () => {
    it("handles negated CONTAINS condition", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "email", operator: "CONTAINS", value: "test", negated: true }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(2); // Charlie (example.com) + David (null)
    });

    it("handles negated ILIKE condition", () => {
      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "name", operator: "ILIKE", value: "%li%", negated: true }],
        },
      };

      const result = applyClientSideFilter(sampleRows, filter, columns);

      expect(result).toHaveLength(3); // Bob, David, nobody (not Alice, Charlie)
    });
  });

  describe("query mode (index-based keys with wrapped values)", () => {
    // Simulate query mode row structure: col_N keys with {value: ...} wrapper
    const queryModeRows = [
      { col_0: { value: "1" }, col_1: { value: "Alice" }, col_2: { value: "pending" } },
      { col_0: { value: "2" }, col_1: { value: "Bob" }, col_2: { value: "completed" } },
      { col_0: { value: "3" }, col_1: { value: "Charlie" }, col_2: { value: "pending" } },
      { col_0: { value: "4" }, col_1: { value: "David" }, col_2: { value: null } },
    ];
    const queryModeColumns = ["id", "name", "status"];

    it("filters with column key map and wrapped values", () => {
      const columnKeyMap = new Map([
        ["id", "col_0"],
        ["name", "col_1"],
        ["status", "col_2"],
      ]);

      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "status", operator: "ILIKE", value: "%pending%" }],
        },
      };

      const result = applyClientSideFilter(queryModeRows, filter, queryModeColumns, {
        columnKeyMap,
        wrappedValues: true,
      });

      expect(result).toHaveLength(2); // Alice and Charlie have status "pending"
    });

    it("simple search with wrapped values", () => {
      const columnKeyMap = new Map([
        ["id", "col_0"],
        ["name", "col_1"],
        ["status", "col_2"],
      ]);

      const filter: FilterConfig = {
        root: { id: "root", type: "group", logical: "AND", conditions: [] },
        rawWhereClause: "alice",
      };

      const result = applyClientSideFilter(queryModeRows, filter, queryModeColumns, {
        columnKeyMap,
        wrappedValues: true,
      });

      expect(result).toHaveLength(1); // Only Alice
    });

    it("handles IS NULL with wrapped values", () => {
      const columnKeyMap = new Map([
        ["id", "col_0"],
        ["name", "col_1"],
        ["status", "col_2"],
      ]);

      const filter: FilterConfig = {
        root: {
          id: "root",
          type: "group",
          logical: "AND",
          conditions: [{ id: "c1", column: "status", operator: "IS NULL", value: "" }],
        },
      };

      const result = applyClientSideFilter(queryModeRows, filter, queryModeColumns, {
        columnKeyMap,
        wrappedValues: true,
      });

      expect(result).toHaveLength(1); // David has null status
    });
  });
});
