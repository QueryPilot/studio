import { describe, it, expect } from "vitest";
import { generateCSV, getDelimiterName } from "./csvExport";

describe("csvExport", () => {
  describe("generateCSV", () => {
    it("generates CSV with headers", () => {
      const columns = ["id", "name", "email"];
      const rows = [
        [1, "John Doe", "john@example.com"],
        [2, "Jane Smith", "jane@example.com"],
      ];

      const result = generateCSV(rows, columns);

      expect(result).toBe(
        'id,name,email\n1,John Doe,john@example.com\n2,Jane Smith,jane@example.com'
      );
    });

    it("generates CSV without headers", () => {
      const columns = ["id", "name"];
      const rows = [
        [1, "John"],
        [2, "Jane"],
      ];

      const result = generateCSV(rows, columns, { includeHeaders: false });

      expect(result).toBe("1,John\n2,Jane");
    });

    it("escapes values with commas", () => {
      const columns = ["name"];
      const rows = [["Doe, John"]];

      const result = generateCSV(rows, columns);

      expect(result).toBe('name\n"Doe, John"');
    });

    it("escapes values with quotes", () => {
      const columns = ["description"];
      const rows = [['He said "Hello"']];

      const result = generateCSV(rows, columns);

      expect(result).toBe('description\n"He said ""Hello"""');
    });

    it("escapes values with newlines", () => {
      const columns = ["text"];
      const rows = [["Line 1\nLine 2"]];

      const result = generateCSV(rows, columns);

      expect(result).toBe('text\n"Line 1\nLine 2"');
    });

    it("handles null values", () => {
      const columns = ["id", "value"];
      const rows = [[1, null]];

      const result = generateCSV(rows, columns);

      expect(result).toBe("id,value\n1,");
    });

    it("handles undefined values", () => {
      const columns = ["id", "value"];
      const rows = [[1, undefined]];

      const result = generateCSV(rows, columns);

      expect(result).toBe("id,value\n1,");
    });

    it("uses semicolon delimiter", () => {
      const columns = ["id", "name"];
      const rows = [
        [1, "John"],
        [2, "Jane"],
      ];

      const result = generateCSV(rows, columns, { delimiter: ";" });

      expect(result).toBe("id;name\n1;John\n2;Jane");
    });

    it("uses tab delimiter", () => {
      const columns = ["id", "name"];
      const rows = [
        [1, "John"],
        [2, "Jane"],
      ];

      const result = generateCSV(rows, columns, { delimiter: "\t" });

      expect(result).toBe("id\tname\n1\tJohn\n2\tJane");
    });

    it("escapes values based on delimiter", () => {
      const columns = ["text"];
      const rows = [["value;with;semicolons"]];

      const result = generateCSV(rows, columns, { delimiter: ";" });

      expect(result).toBe('text\n"value;with;semicolons"');
    });

    it("handles complex mixed data types", () => {
      const columns = ["id", "name", "active", "score", "notes"];
      const rows = [
        [1, "John Doe", true, 95.5, "Good student, needs improvement"],
        [2, 'Jane "Jay" Smith', false, null, "Line 1\nLine 2"],
        [3, null, undefined, 0, ""],
      ];

      const result = generateCSV(rows, columns);

      expect(result).toBe(
        'id,name,active,score,notes\n' +
        '1,John Doe,true,95.5,"Good student, needs improvement"\n' +
        '2,"Jane ""Jay"" Smith",false,,"Line 1\nLine 2"\n' +
        '3,,,0,'
      );
    });

    it("handles empty rows array", () => {
      const columns = ["id", "name"];
      const rows: unknown[][] = [];

      const result = generateCSV(rows, columns);

      expect(result).toBe("id,name");
    });

    it("handles carriage return characters", () => {
      const columns = ["text"];
      const rows = [["Line 1\r\nLine 2"]];

      const result = generateCSV(rows, columns);

      expect(result).toBe('text\n"Line 1\r\nLine 2"');
    });
  });

  describe("getDelimiterName", () => {
    it("returns name for comma", () => {
      expect(getDelimiterName(",")).toBe("Comma");
    });

    it("returns name for semicolon", () => {
      expect(getDelimiterName(";")).toBe("Semicolon");
    });

    it("returns name for tab", () => {
      expect(getDelimiterName("\t")).toBe("Tab");
    });
  });
});
