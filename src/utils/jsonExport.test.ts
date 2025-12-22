import { describe, it, expect } from "vitest";
import { generateJSON } from "./jsonExport";

describe("jsonExport", () => {
  describe("generateJSON", () => {
    it("generates pretty-formatted JSON by default", () => {
      const rows = [
        [1, "John", "john@example.com"],
        [2, "Jane", "jane@example.com"],
      ];
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns);

      const expected = JSON.stringify(
        [
          { id: 1, name: "John", email: "john@example.com" },
          { id: 2, name: "Jane", email: "jane@example.com" },
        ],
        null,
        2,
      );

      expect(result).toBe(expected);
    });

    it("generates compact JSON when format is compact", () => {
      const rows = [
        [1, "John", "john@example.com"],
        [2, "Jane", "jane@example.com"],
      ];
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns, { format: "compact" });

      const expected = JSON.stringify([
        { id: 1, name: "John", email: "john@example.com" },
        { id: 2, name: "Jane", email: "jane@example.com" },
      ]);

      expect(result).toBe(expected);
    });

    it("handles empty rows", () => {
      const rows: unknown[][] = [];
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns);

      expect(result).toBe("[]");
    });

    it("handles null and undefined values", () => {
      const rows = [[1, null, undefined]];
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([{ id: 1, name: null, email: undefined }]);
    });

    it("handles various data types", () => {
      const rows = [
        [1, "string", true, 3.14, null, { nested: "object" }, [1, 2, 3]],
      ];
      const columns = ["id", "str", "bool", "num", "nil", "obj", "arr"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([
        {
          id: 1,
          str: "string",
          bool: true,
          num: 3.14,
          nil: null,
          obj: { nested: "object" },
          arr: [1, 2, 3],
        },
      ]);
    });

    it("handles special characters in column names", () => {
      const rows = [[1, "test"]];
      const columns = ["id", "column-with-dashes"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([{ id: 1, "column-with-dashes": "test" }]);
    });

    it("handles large datasets", () => {
      const rows = Array.from({ length: 1000 }, (_, i) => [
        i,
        `User ${i}`,
        `user${i}@example.com`,
      ]);
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns, { format: "compact" });
      const parsed = JSON.parse(result);

      expect(parsed.length).toBe(1000);
      expect(parsed[0]).toEqual({ id: 0, name: "User 0", email: "user0@example.com" });
      expect(parsed[999]).toEqual({
        id: 999,
        name: "User 999",
        email: "user999@example.com",
      });
    });

    it("preserves column order", () => {
      const rows = [[1, "John", "john@example.com"]];
      const columns = ["id", "name", "email"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);
      const keys = Object.keys(parsed[0]);

      expect(keys).toEqual(["id", "name", "email"]);
    });

    it("handles date objects", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      const rows = [[1, date]];
      const columns = ["id", "created_at"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([{ id: 1, created_at: date.toISOString() }]);
    });

    it("handles boolean false vs null distinction", () => {
      const rows = [
        [1, false, null],
        [2, true, undefined],
      ];
      const columns = ["id", "active", "deleted"];

      const result = generateJSON(rows, columns);
      const parsed = JSON.parse(result);

      expect(parsed[0].active).toBe(false);
      expect(parsed[0].deleted).toBe(null);
      expect(parsed[1].active).toBe(true);
      expect(parsed[1].deleted).toBe(undefined);
    });
  });
});
