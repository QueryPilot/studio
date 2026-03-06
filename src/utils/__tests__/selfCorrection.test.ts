import { describe, it, expect } from "vitest";
import {
  isReadOnlyStatement,
  buildCorrectionPrompt,
  MAX_CORRECTION_ATTEMPTS,
} from "../selfCorrection";

describe("selfCorrection", () => {
  describe("isReadOnlyStatement", () => {
    it("returns true for SELECT", () => {
      expect(isReadOnlyStatement("SELECT * FROM users")).toBe(true);
    });

    it("returns true for EXPLAIN", () => {
      expect(isReadOnlyStatement("EXPLAIN SELECT * FROM users")).toBe(true);
    });

    it("returns false for EXPLAIN ANALYZE over mutating statements", () => {
      expect(
        isReadOnlyStatement("EXPLAIN ANALYZE DELETE FROM users WHERE id = 1"),
      ).toBe(false);
      expect(
        isReadOnlyStatement("EXPLAIN (ANALYZE, FORMAT TEXT) UPDATE users SET name = 'x'"),
      ).toBe(false);
    });

    it("returns true for WITH ... SELECT (read-only CTE)", () => {
      expect(
        isReadOnlyStatement("WITH cte AS (SELECT 1) SELECT * FROM cte"),
      ).toBe(true);
    });

    it("returns false for WITH ... DELETE (mutating CTE)", () => {
      expect(
        isReadOnlyStatement(
          "WITH cte AS (SELECT id FROM users WHERE inactive = true) DELETE FROM users WHERE id IN (SELECT id FROM cte)",
        ),
      ).toBe(false);
    });

    it("returns false for WITH ... INSERT (mutating CTE)", () => {
      expect(
        isReadOnlyStatement(
          "WITH cte AS (SELECT 1) INSERT INTO users (id) SELECT * FROM cte",
        ),
      ).toBe(false);
    });

    it("returns false for WITH ... UPDATE (mutating CTE)", () => {
      expect(
        isReadOnlyStatement(
          "WITH cte AS (SELECT id FROM users) UPDATE users SET active = false WHERE id IN (SELECT id FROM cte)",
        ),
      ).toBe(false);
    });

    it("returns true for WITH ... SELECT from table with mutating keyword in name", () => {
      expect(
        isReadOnlyStatement(
          "WITH cte AS (SELECT * FROM user_updates) SELECT * FROM cte",
        ),
      ).toBe(true);
      expect(
        isReadOnlyStatement(
          "WITH cte AS (SELECT * FROM deleted_items) SELECT * FROM cte",
        ),
      ).toBe(true);
    });

    it("ignores mutating keywords inside string literals", () => {
      expect(
        isReadOnlyStatement("SELECT * FROM logs WHERE message LIKE '%UPDATE%'"),
      ).toBe(true);
      expect(
        isReadOnlyStatement("SELECT 'DELETE FROM users' AS example_text"),
      ).toBe(true);
    });

    it("returns true for SHOW", () => {
      expect(isReadOnlyStatement("SHOW TABLES")).toBe(true);
    });

    it("returns true for DESCRIBE", () => {
      expect(isReadOnlyStatement("DESCRIBE users")).toBe(true);
    });

    it("returns false for INSERT", () => {
      expect(
        isReadOnlyStatement("INSERT INTO users (name) VALUES ('a')"),
      ).toBe(false);
    });

    it("returns false for UPDATE", () => {
      expect(
        isReadOnlyStatement("UPDATE users SET name = 'b' WHERE id = 1"),
      ).toBe(false);
    });

    it("returns false for DELETE", () => {
      expect(isReadOnlyStatement("DELETE FROM users WHERE id = 1")).toBe(false);
    });

    it("returns false for DROP", () => {
      expect(isReadOnlyStatement("DROP TABLE users")).toBe(false);
    });

    it("returns false for CREATE", () => {
      expect(
        isReadOnlyStatement("CREATE TABLE users (id INT)"),
      ).toBe(false);
    });

    it("returns false for ALTER", () => {
      expect(
        isReadOnlyStatement("ALTER TABLE users ADD COLUMN email TEXT"),
      ).toBe(false);
    });

    it("handles leading whitespace and single-line comments", () => {
      expect(isReadOnlyStatement("  \n  SELECT 1")).toBe(true);
      expect(isReadOnlyStatement("-- comment\nSELECT 1")).toBe(true);
    });

    it("handles block comments", () => {
      expect(isReadOnlyStatement("/* comment */ SELECT 1")).toBe(true);
      expect(
        isReadOnlyStatement("/* multi\nline\ncomment */ SELECT 1"),
      ).toBe(true);
      expect(
        isReadOnlyStatement("/* comment */ DELETE FROM users"),
      ).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isReadOnlyStatement("select * from users")).toBe(true);
      expect(isReadOnlyStatement("Select * From users")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(isReadOnlyStatement("")).toBe(false);
    });

    it("returns false for whitespace only", () => {
      expect(isReadOnlyStatement("   \n  ")).toBe(false);
    });

    it("returns false when a SQL batch contains any mutating statement", () => {
      expect(
        isReadOnlyStatement("SELECT 1; UPDATE users SET name = 'x' WHERE id = 1;"),
      ).toBe(false);
    });
  });

  describe("buildCorrectionPrompt", () => {
    it("includes the original query", () => {
      const prompt = buildCorrectionPrompt("SELECT * FORM users", "syntax error", 1);
      expect(prompt).toContain("SELECT * FORM users");
    });

    it("includes the error message", () => {
      const prompt = buildCorrectionPrompt("SELECT * FORM users", "syntax error near FORM", 1);
      expect(prompt).toContain("syntax error near FORM");
    });

    it("includes the attempt number", () => {
      const prompt = buildCorrectionPrompt("SELECT 1", "error", 2);
      expect(prompt).toContain("attempt 2");
    });

    it("includes the max attempts", () => {
      const prompt = buildCorrectionPrompt("SELECT 1", "error", 1);
      expect(prompt).toContain(`of ${MAX_CORRECTION_ATTEMPTS}`);
    });
  });

  describe("MAX_CORRECTION_ATTEMPTS", () => {
    it("is 3", () => {
      expect(MAX_CORRECTION_ATTEMPTS).toBe(3);
    });
  });
});
