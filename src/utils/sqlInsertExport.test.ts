import { describe, it, expect } from "vitest";
import { generateInsertStatements } from "./sqlInsertExport";

describe("sqlInsertExport", () => {
  describe("generateInsertStatements", () => {
    const columns = ["id", "name", "email", "active"];
    const rows = [
      [1, "John", "john@example.com", true],
      [2, "Jane", null, false],
      [3, "Bob's Place", "bob@test.com", true],
    ];

    it("should generate individual INSERT statements by default", () => {
      const sql = generateInsertStatements(rows, columns);

      expect(sql).toContain('INSERT INTO "table_name"');
      expect(sql).toContain('"id", "name", "email", "active"');
      expect(sql).toContain("VALUES (1, 'John', 'john@example.com', TRUE);");
      expect(sql).toContain("VALUES (2, 'Jane', NULL, FALSE);");
      expect(sql.split("\n")).toHaveLength(3);
    });

    it("should generate batch INSERT statement when batchMode is true", () => {
      const sql = generateInsertStatements(rows, columns, { batchMode: true });

      expect(sql).toContain('INSERT INTO "table_name"');
      expect(sql).toContain("VALUES");
      expect(sql).toContain("(1, 'John', 'john@example.com', TRUE)");
      expect(sql).toContain("(2, 'Jane', NULL, FALSE)");
      expect(sql).toMatch(/VALUES.*\(.*\),.*\(.*\),.*\(.*\);/s);
    });

    it("should escape single quotes in strings", () => {
      const sql = generateInsertStatements(rows, columns);

      expect(sql).toContain("'Bob''s Place'");
    });

    it("should handle NULL values", () => {
      const sql = generateInsertStatements(rows, columns);

      expect(sql).toContain("NULL");
    });

    it("should use custom table name", () => {
      const sql = generateInsertStatements(rows, columns, {
        tableName: "users",
      });

      expect(sql).toContain('"users"');
      expect(sql).not.toContain('"table_name"');
    });

    it("should include schema when provided", () => {
      const sql = generateInsertStatements(rows, columns, {
        tableName: "users",
        schema: "public",
      });

      expect(sql).toContain('"public"."users"');
    });

    it("should handle different database types - PostgreSQL", () => {
      const sql = generateInsertStatements(rows, columns, {
        databaseType: "postgresql",
        tableName: "users",
      });

      expect(sql).toContain('"users"');
      expect(sql).toContain("TRUE");
      expect(sql).toContain("FALSE");
    });

    it("should handle different database types - MySQL", () => {
      const sql = generateInsertStatements(rows, columns, {
        databaseType: "mysql",
        tableName: "users",
      });

      expect(sql).toContain("`users`");
      expect(sql).toContain(", 1)");
      expect(sql).toContain(", 0)");
    });

    it("should handle different database types - MSSQL", () => {
      const sql = generateInsertStatements(rows, columns, {
        databaseType: "mssql",
        tableName: "users",
      });

      expect(sql).toContain("[users]");
      expect(sql).toContain(", 1)");
      expect(sql).toContain(", 0)");
    });

    it("should handle empty rows", () => {
      const sql = generateInsertStatements([], columns);

      expect(sql).toBe("");
    });

    it("should handle numbers correctly", () => {
      const numberRows = [[1, 42, 3.14, -10]];
      const numberCols = ["id", "count", "price", "balance"];

      const sql = generateInsertStatements(numberRows, numberCols);

      expect(sql).toContain("VALUES (1, 42, 3.14, -10)");
    });

    it("should handle objects by JSON stringifying them", () => {
      const objectRows = [[1, "test", { key: "value" }]];
      const objectCols = ["id", "name", "metadata"];

      const sql = generateInsertStatements(objectRows, objectCols);

      expect(sql).toContain('\'{"key":"value"}\'');
    });

    it("should handle Date objects", () => {
      // Use local-time constructor to avoid timezone-dependent output
      const date = new Date(2024, 0, 1, 12, 0, 0);
      const dateRows = [[1, date]];
      const dateCols = ["id", "created_at"];

      const sql = generateInsertStatements(dateRows, dateCols);

      expect(sql).toContain("'2024-01-01 12:00:00'");
    });

    it("should handle undefined values as NULL", () => {
      const undefinedRows = [[1, undefined]];
      const undefinedCols = ["id", "optional_field"];

      const sql = generateInsertStatements(undefinedRows, undefinedCols);

      expect(sql).toContain("NULL");
    });

    it("should properly format batch mode with schema", () => {
      const sql = generateInsertStatements(rows, columns, {
        tableName: "users",
        schema: "public",
        databaseType: "postgresql",
        batchMode: true,
      });

      expect(sql).toContain('"public"."users"');
      expect(sql).toContain("VALUES");
      expect(sql).toContain("(1, 'John', 'john@example.com', TRUE),");
      expect(sql).toContain("(2, 'Jane', NULL, FALSE),");
      expect(sql).toContain("(3, 'Bob''s Place', 'bob@test.com', TRUE);");
    });

    it("should handle special characters in column names", () => {
      const specialCols = ["user id", "first-name", "email@address"];
      const specialRows = [[1, "John", "john@example.com"]];

      const sql = generateInsertStatements(specialRows, specialCols, {
        databaseType: "postgresql",
      });

      expect(sql).toContain('"user id"');
      expect(sql).toContain('"first-name"');
      expect(sql).toContain('"email@address"');
    });

    it("should escape quotes in PostgreSQL identifiers", () => {
      const maliciousCols = ['col"name', 'normal'];
      const rows = [[1, "test"]];

      const sql = generateInsertStatements(rows, maliciousCols, {
        databaseType: "postgresql",
      });

      expect(sql).toContain('"col""name"');
      expect(sql).not.toContain('"col"name"');
    });

    it("should escape backticks in MySQL identifiers", () => {
      const maliciousCols = ["col`name", "normal"];
      const rows = [[1, "test"]];

      const sql = generateInsertStatements(rows, maliciousCols, {
        databaseType: "mysql",
      });

      expect(sql).toContain("`col``name`");
      expect(sql).not.toContain("`col`name`");
    });

    it("should escape brackets in MSSQL identifiers", () => {
      const maliciousCols = ["col]name", "normal"];
      const rows = [[1, "test"]];

      const sql = generateInsertStatements(rows, maliciousCols, {
        databaseType: "mssql",
      });

      expect(sql).toContain("[col]]name]");
      expect(sql).not.toContain("[col]name]");
    });

    it("should escape backslashes in MySQL string values", () => {
      const rows = [[1, "path\\to\\file"]];
      const cols = ["id", "path"];

      const sql = generateInsertStatements(rows, cols, {
        databaseType: "mysql",
      });

      expect(sql).toContain("'path\\\\to\\\\file'");
    });

    it("should not escape backslashes in PostgreSQL string values", () => {
      const rows = [[1, "path\\to\\file"]];
      const cols = ["id", "path"];

      const sql = generateInsertStatements(rows, cols, {
        databaseType: "postgresql",
      });

      expect(sql).toContain("'path\\to\\file'");
      expect(sql).not.toContain("'path\\\\to\\\\file'");
    });

    it("should escape quotes in schema and table names", () => {
      const sql = generateInsertStatements(rows, columns, {
        schema: 'sche"ma',
        tableName: 'ta"ble',
        databaseType: "postgresql",
      });

      expect(sql).toContain('"sche""ma"."ta""ble"');
    });

    it("should throw error for empty table name", () => {
      expect(() =>
        generateInsertStatements(rows, columns, { tableName: "" }),
      ).toThrow("Table name cannot be empty");

      expect(() =>
        generateInsertStatements(rows, columns, { tableName: "   " }),
      ).toThrow("Table name cannot be empty");
    });

    it("should throw error for empty columns", () => {
      expect(() => generateInsertStatements(rows, [])).toThrow(
        "No columns provided",
      );
    });
  });
});
