import { describe, it, expect } from "vitest";
import { parseVariables } from "../parser";

describe("parseVariables", () => {
  describe("mustache syntax {{ var }}", () => {
    it("extracts simple mustache variables", () => {
      const result = parseVariables("SELECT * FROM orders WHERE region = {{ region }}");
      expect(result.variables).toHaveLength(1);
      expect(result.variables[0]).toMatchObject({
        name: "region",
        syntax: "mustache",
        statementIndex: 0,
      });
    });

    it("extracts multiple mustache variables", () => {
      const sql = "SELECT * FROM orders WHERE region = {{ region }} AND date >= {{ start_date }}";
      const result = parseVariables(sql);
      expect(result.variables).toHaveLength(2);
      expect(result.uniqueNames).toEqual(new Set(["region", "start_date"]));
    });

    it("handles whitespace variations in mustache", () => {
      const result = parseVariables("{{foo}} {{ bar }} {{  baz  }}");
      expect(result.variables).toHaveLength(3);
      expect(result.variables.map((v) => v.name)).toEqual(["foo", "bar", "baz"]);
    });

    it("deduplicates same mustache variable", () => {
      const result = parseVariables("{{ x }} AND {{ x }}");
      expect(result.variables).toHaveLength(2);
      expect(result.uniqueNames).toEqual(new Set(["x"]));
    });
  });

  describe("colon syntax :var", () => {
    it("extracts colon-prefixed variables", () => {
      const result = parseVariables("SELECT * FROM users WHERE id = :user_id");
      expect(result.variables).toHaveLength(1);
      expect(result.variables[0]).toMatchObject({
        name: "user_id",
        syntax: "colon",
      });
    });

    it("skips :: (PostgreSQL type cast)", () => {
      const result = parseVariables("SELECT '2024-01-01'::date");
      expect(result.variables).toHaveLength(0);
    });

    it("skips := (PL/SQL assignment)", () => {
      const result = parseVariables("x := 5");
      expect(result.variables).toHaveLength(0);
    });

    it("handles colon var after type cast", () => {
      const result = parseVariables("SELECT col::text, :my_var FROM t");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "my_var" });
    });
  });

  describe("at syntax @var", () => {
    it("extracts @-prefixed variables", () => {
      const result = parseVariables("SELECT * FROM users WHERE id = @userId");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({
        name: "userId",
        syntax: "at",
      });
    });

    it("skips @@ (system variables)", () => {
      const result = parseVariables("SELECT @@VERSION");
      expect(result.variables).toHaveLength(0);
    });

    it("distinguishes @var from @@sysvar", () => {
      const result = parseVariables("SELECT @myParam, @@SERVERNAME");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "myParam" });
    });
  });

  describe("dollar_brace syntax ${var}", () => {
    it("extracts ${var} variables", () => {
      const result = parseVariables("SELECT * FROM ${table_name} WHERE id = ${id}");
      expect(result.variables).toHaveLength(2);
      expect(result.variables.map((v) => v.name)).toEqual(["table_name", "id"]);
      expect(result.variables.at(0)).toMatchObject({ syntax: "dollar_brace" });
    });
  });

  describe("dollar_num syntax $1, $2", () => {
    it("extracts $N positional parameters", () => {
      const result = parseVariables("SELECT * FROM users WHERE id = $1 AND name = $2");
      expect(result.variables).toHaveLength(2);
      expect(result.variables[0]).toMatchObject({ name: "$1", syntax: "dollar_num" });
      expect(result.variables[1]).toMatchObject({ name: "$2", syntax: "dollar_num" });
    });

    it("skips $N inside dollar-quoted strings", () => {
      const result = parseVariables("SELECT $$body with $1 inside$$");
      expect(result.variables).toHaveLength(0);
    });

    it("does not confuse ${var} with $N", () => {
      const result = parseVariables("SELECT ${name}, $1");
      const dollarBrace = result.variables.filter((v) => v.syntax === "dollar_brace");
      const dollarNum = result.variables.filter((v) => v.syntax === "dollar_num");
      expect(dollarBrace).toHaveLength(1);
      expect(dollarNum).toHaveLength(1);
    });
  });

  describe("question_mark syntax ?", () => {
    it("extracts ? placeholders with auto-indexing (global)", () => {
      const result = parseVariables("SELECT * FROM users WHERE id = ? AND name = ?");
      expect(result.variables).toHaveLength(2);
      expect(result.variables[0]).toMatchObject({ name: "#1", syntax: "question_mark" });
      expect(result.variables[1]).toMatchObject({ name: "#2", syntax: "question_mark" });
    });

    it("skips ?| (PG JSON operator)", () => {
      const result = parseVariables("SELECT data ?| array['a','b']");
      expect(result.variables).toHaveLength(0);
    });

    it("skips ?& (PG JSON operator)", () => {
      const result = parseVariables("SELECT data ?& array['a','b']");
      expect(result.variables).toHaveLength(0);
    });

    it("auto-indexes sequentially across statements (global scope)", () => {
      const sql = "SELECT ? FROM a; SELECT ? FROM b";
      const result = parseVariables(sql, { scope: "global" });
      expect(result.variables.map((v) => v.name)).toEqual(["#1", "#2"]);
    });

    it("resets auto-index per statement (per_statement scope)", () => {
      const sql = "SELECT ? FROM a; SELECT ? FROM b";
      const result = parseVariables(sql, { scope: "per_statement" });
      expect(result.variables.map((v) => v.name)).toEqual(["#1", "#1"]);
      expect(result.variables.at(0)).toMatchObject({ statementIndex: 0 });
      expect(result.variables.at(1)).toMatchObject({ statementIndex: 1 });
    });
  });

  describe("exclusion zones", () => {
    it("ignores variables inside single-quoted strings", () => {
      const result = parseVariables("SELECT * FROM t WHERE col = ':not_a_var'");
      expect(result.variables).toHaveLength(0);
    });

    it("ignores variables inside double-quoted identifiers", () => {
      const result = parseVariables('SELECT ":not_a_var" FROM t');
      expect(result.variables).toHaveLength(0);
    });

    it("ignores variables inside dollar-quoted strings", () => {
      const result = parseVariables("SELECT $$ :inside $$ FROM t WHERE x = :outside");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "outside" });
    });

    it("ignores variables inside line comments", () => {
      const result = parseVariables("SELECT :real -- :commented\nFROM t");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "real" });
    });

    it("ignores variables inside block comments", () => {
      const result = parseVariables("SELECT :real /* :commented */ FROM t");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "real" });
    });

    it("ignores mustache inside strings", () => {
      const result = parseVariables("SELECT '{{ not_a_var }}' FROM t WHERE x = {{ real }}");
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "real" });
    });
  });

  describe("multi-statement awareness", () => {
    it("tracks statement index for each variable", () => {
      const sql = "SELECT :a FROM t1; SELECT :b FROM t2; SELECT :c FROM t3";
      const result = parseVariables(sql);
      expect(result.statementCount).toBe(3);
      expect(result.variables[0]).toMatchObject({ name: "a", statementIndex: 0 });
      expect(result.variables[1]).toMatchObject({ name: "b", statementIndex: 1 });
      expect(result.variables[2]).toMatchObject({ name: "c", statementIndex: 2 });
    });

    it("handles $N in per_statement scope with unique keys", () => {
      const sql = "SELECT $1 FROM a; SELECT $1 FROM b";
      const result = parseVariables(sql, { scope: "per_statement" });
      expect(result.uniqueNames).toEqual(new Set(["stmt:0:$1", "stmt:1:$1"]));
    });

    it("$N in global scope shares same key", () => {
      const sql = "SELECT $1 FROM a; SELECT $1 FROM b";
      const result = parseVariables(sql, { scope: "global" });
      expect(result.uniqueNames).toEqual(new Set(["$1"]));
    });
  });

  describe("mixed syntaxes", () => {
    it("extracts variables from multiple syntaxes in one query", () => {
      const sql = "SELECT {{ col }} FROM t WHERE id = :id AND status = @status AND limit = $1";
      const result = parseVariables(sql);
      expect(result.variables).toHaveLength(4);
      expect(result.variables.map((v) => v.syntax)).toEqual([
        "mustache", "colon", "at", "dollar_num",
      ]);
    });

    it("respects syntax filter option", () => {
      const sql = "SELECT :a, @b, {{ c }}";
      const result = parseVariables(sql, { syntaxes: ["colon"] });
      expect(result.variables).toHaveLength(1);
      expect(result.variables.at(0)).toMatchObject({ name: "a" });
    });
  });

  describe("edge cases", () => {
    it("returns empty for empty SQL", () => {
      const result = parseVariables("");
      expect(result.variables).toHaveLength(0);
      expect(result.statementCount).toBe(1);
    });

    it("returns empty for whitespace-only SQL", () => {
      const result = parseVariables("   \n\t  ");
      expect(result.variables).toHaveLength(0);
    });

    it("handles SQL with no variables", () => {
      const result = parseVariables("SELECT 1 + 1");
      expect(result.variables).toHaveLength(0);
      expect(result.uniqueNames.size).toBe(0);
    });

    it("records correct offsets and lengths", () => {
      const sql = "WHERE x = {{ name }}";
      const result = parseVariables(sql);
      const first = result.variables.at(0);
      expect(first).toBeDefined();
      expect(first?.offset).toBe(10);
      expect(first?.length).toBe(10);
      expect(sql.slice(10, 20)).toBe("{{ name }}");
    });
  });
});
