import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMarkdownTable, copyMarkdownToClipboard } from "./markdownExport";

describe("markdownExport", () => {
  describe("generateMarkdownTable", () => {
    it("generates basic table with headers and data", () => {
      const columns = ["id", "name", "email"];
      const rows = [
        [1, "Alice", "alice@test.com"],
        [2, "Bob", "bob@test.com"],
      ];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toBe(
        "| id | name | email |\n" +
          "| ---: | --- | --- |\n" +
          "| 1 | Alice | alice@test.com |\n" +
          "| 2 | Bob | bob@test.com |",
      );
    });

    it("handles empty rows", () => {
      const columns = ["id", "name"];
      const rows: unknown[][] = [];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toBe("| id | name |\n| --- | --- |");
    });

    it("handles empty columns", () => {
      const columns: string[] = [];
      const rows = [[1, "test"]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toBe("");
    });

    it("escapes pipe characters", () => {
      const columns = ["data"];
      const rows = [["value|with|pipes"]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain("value\\|with\\|pipes");
    });

    it("converts newlines to <br>", () => {
      const columns = ["text"];
      const rows = [["line1\nline2"]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain("line1<br>line2");
    });

    it("handles NULL values", () => {
      const columns = ["id", "value"];
      const rows = [[1, null]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain("| 1 | NULL |");
    });

    it("handles undefined values", () => {
      const columns = ["id", "value"];
      const rows = [[1, undefined]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain("| 1 | NULL |");
    });

    it("handles boolean values", () => {
      const columns = ["active"];
      const rows = [[true], [false]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain("| true |");
      expect(result).toContain("| false |");
    });

    it("handles object values as JSON", () => {
      const columns = ["data"];
      const rows = [[{ key: "value" }]];

      const result = generateMarkdownTable(rows, columns);

      expect(result).toContain('{"key":"value"}');
    });

    it("aligns numeric columns right by default", () => {
      const columns = ["id", "name"];
      const rows = [
        [1, "Alice"],
        [2, "Bob"],
      ];

      const result = generateMarkdownTable(rows, columns);

      // First column (numeric) should have right alignment
      expect(result).toContain("| ---: | --- |");
    });

    it("respects alignNumeric option for left", () => {
      const columns = ["id"];
      const rows = [[1], [2]];

      const result = generateMarkdownTable(rows, columns, { alignNumeric: "left" });

      expect(result).toContain("| :--- |");
    });

    it("respects alignNumeric option for center", () => {
      const columns = ["id"];
      const rows = [[1], [2]];

      const result = generateMarkdownTable(rows, columns, { alignNumeric: "center" });

      expect(result).toContain("| :---: |");
    });

    it("truncates long values with maxColumnWidth", () => {
      const columns = ["text"];
      const rows = [["This is a very long text that should be truncated"]];

      const result = generateMarkdownTable(rows, columns, { maxColumnWidth: 20 });

      expect(result).toContain("This is a very lo...");
    });

    it("does not truncate short values", () => {
      const columns = ["text"];
      const rows = [["Short"]];

      const result = generateMarkdownTable(rows, columns, { maxColumnWidth: 20 });

      expect(result).toContain("| Short |");
    });

    it("handles mixed column types", () => {
      const columns = ["id", "name", "score", "active"];
      const rows = [
        [1, "Alice", 95.5, true],
        [2, "Bob", 87.3, false],
      ];

      const result = generateMarkdownTable(rows, columns);

      // id and score should be right-aligned (numeric), name and active should be left
      expect(result).toContain("| ---: | --- | ---: | --- |");
    });
  });

  describe("copyMarkdownToClipboard", () => {
    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });
    });

    it("copies markdown to clipboard", async () => {
      const columns = ["id", "name"];
      const rows = [[1, "Test"]];

      const result = await copyMarkdownToClipboard(rows, columns);

      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(1);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it("returns error for empty columns", async () => {
      const columns: string[] = [];
      const rows = [[1]];

      const result = await copyMarkdownToClipboard(rows, columns);

      expect(result.success).toBe(false);
      expect(result.error).toBe("No columns to export");
    });

    it("handles clipboard errors", async () => {
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard failed"));

      const columns = ["id"];
      const rows = [[1]];

      const result = await copyMarkdownToClipboard(rows, columns);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clipboard failed");
    });

    it("passes options to generateMarkdownTable", async () => {
      const columns = ["text"];
      const rows = [["Very long text that should be truncated"]];

      await copyMarkdownToClipboard(rows, columns, { maxColumnWidth: 15 });

      const calls = vi.mocked(navigator.clipboard.writeText).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const call = calls[0]?.[0];
      expect(call).toContain("Very long te...");
    });
  });
});
