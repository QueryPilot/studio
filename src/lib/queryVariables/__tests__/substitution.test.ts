import { describe, it, expect } from "vitest";
import { substituteVariables, substituteStatementVariables } from "../substitution";
import type { QueryVariable } from "../types";

function makeVar(
  name: string,
  value: string,
  type: QueryVariable["type"] = "text",
  syntax: QueryVariable["syntax"] = "mustache",
): QueryVariable {
  return { name, value, type, syntax };
}

describe("substituteVariables", () => {
  it("replaces mustache variables with text values", () => {
    const sql = "SELECT * FROM orders WHERE region = {{ region }}";
    const vars: Record<string, QueryVariable> = {
      region: makeVar("region", "US West"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM orders WHERE region = 'US West'");
    expect(result.isComplete).toBe(true);
    expect(result.missingVariables).toEqual([]);
  });

  it("replaces colon variables", () => {
    const sql = "SELECT * FROM users WHERE id = :user_id";
    const vars: Record<string, QueryVariable> = {
      user_id: makeVar("user_id", "42", "number", "colon"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 42");
    expect(result.isComplete).toBe(true);
  });

  it("replaces at variables", () => {
    const sql = "SELECT * FROM users WHERE id = @userId";
    const vars: Record<string, QueryVariable> = {
      userId: makeVar("userId", "hello", "text", "at"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 'hello'");
  });

  it("replaces dollar_brace variables", () => {
    const sql = "SELECT * FROM ${table}";
    const vars: Record<string, QueryVariable> = {
      table: makeVar("table", "orders", "text", "dollar_brace"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM 'orders'");
  });

  it("replaces dollar_num positional parameters", () => {
    const sql = "SELECT * FROM users WHERE id = $1 AND name = $2";
    const vars: Record<string, QueryVariable> = {
      $1: makeVar("$1", "42", "number", "dollar_num"),
      $2: makeVar("$2", "Alice", "text", "dollar_num"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 42 AND name = 'Alice'");
  });

  it("replaces question mark positional parameters", () => {
    const sql = "SELECT * FROM users WHERE id = ? AND name = ?";
    const vars: Record<string, QueryVariable> = {
      "#1": makeVar("#1", "42", "number", "question_mark"),
      "#2": makeVar("#2", "Bob", "text", "question_mark"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 42 AND name = 'Bob'");
  });

  it("reports missing variables when value is empty", () => {
    const sql = "SELECT * FROM orders WHERE region = {{ region }} AND date = {{ date }}";
    const vars: Record<string, QueryVariable> = {
      region: makeVar("region", "US West"),
      date: makeVar("date", ""),
    };
    const result = substituteVariables(sql, vars);
    expect(result.isComplete).toBe(false);
    expect(result.missingVariables).toContain("date");
  });

  it("reports missing variables when variable is not in map", () => {
    const sql = "SELECT * FROM orders WHERE region = {{ region }}";
    const result = substituteVariables(sql, {});
    expect(result.isComplete).toBe(false);
    expect(result.missingVariables).toContain("region");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const sql = "SELECT {{ col }}, {{ col }} FROM t";
    const vars: Record<string, QueryVariable> = {
      col: makeVar("col", "name"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT 'name', 'name' FROM t");
  });

  it("handles boolean type", () => {
    const sql = "SELECT * FROM users WHERE active = :is_active";
    const vars: Record<string, QueryVariable> = {
      is_active: makeVar("is_active", "true", "boolean", "colon"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE active = TRUE");
  });

  it("handles date type as quoted string", () => {
    const sql = "SELECT * FROM orders WHERE created_at >= :start_date";
    const vars: Record<string, QueryVariable> = {
      start_date: makeVar("start_date", "2024-01-01", "date", "colon"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM orders WHERE created_at >= '2024-01-01'");
  });

  it("escapes single quotes in values", () => {
    const sql = "SELECT * FROM users WHERE name = :name";
    const vars: Record<string, QueryVariable> = {
      name: makeVar("name", "O'Brien", "text", "colon"),
    };
    const result = substituteVariables(sql, vars);
    expect(result.sql).toBe("SELECT * FROM users WHERE name = 'O''Brien'");
  });

  it("handles no variables gracefully", () => {
    const sql = "SELECT 1 + 1";
    const result = substituteVariables(sql, {});
    expect(result.sql).toBe(sql);
    expect(result.isComplete).toBe(true);
  });
});

describe("substituteStatementVariables", () => {
  it("substitutes variables for a single statement in per_statement scope", () => {
    const statement = "SELECT * FROM users WHERE id = $1";
    const vars: Record<string, QueryVariable> = {
      "stmt:2:$1": makeVar("$1", "99", "number", "dollar_num"),
    };
    const result = substituteStatementVariables(statement, 2, vars, "per_statement");
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 99");
    expect(result.isComplete).toBe(true);
  });

  it("uses global keys when scope is global", () => {
    const statement = "SELECT * FROM users WHERE id = $1";
    const vars: Record<string, QueryVariable> = {
      $1: makeVar("$1", "55", "number", "dollar_num"),
    };
    const result = substituteStatementVariables(statement, 0, vars, "global");
    expect(result.sql).toBe("SELECT * FROM users WHERE id = 55");
  });
});
