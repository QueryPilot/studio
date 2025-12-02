import { describe, it, expect } from "vitest";
import {
  tokenizeSearch,
  parseSearchTokens,
  validateSearchAst,
  parseSearchQuery,
  parseSimpleSearch,
  DEFAULT_SEARCH_LIMITS,
  type FilterColumnInfo,
} from "./filterParser";

const testColumns: FilterColumnInfo[] = [
  { name: "name", dataType: "varchar" },
  { name: "email", dataType: "varchar" },
  { name: "age", dataType: "integer" },
];

describe("tokenizeSearch", () => {
  it("tokenizes simple term", () => {
    const tokens = tokenizeSearch("john");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      caseSensitive: false,
      patternType: "contains",
    });
  });

  it("tokenizes case-sensitive term with !", () => {
    const tokens = tokenizeSearch("!John");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "John",
      caseSensitive: true,
      patternType: "contains",
    });
  });

  it("tokenizes starts-with anchor ^", () => {
    const tokens = tokenizeSearch("^john");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      patternType: "startsWith",
    });
  });

  it("tokenizes ends-with anchor $", () => {
    const tokens = tokenizeSearch("son$");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "son",
      patternType: "endsWith",
    });
  });

  it("tokenizes exact match ^...$", () => {
    const tokens = tokenizeSearch("^john$");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      patternType: "exact",
    });
  });

  it("tokenizes regex pattern /regex/", () => {
    const tokens = tokenizeSearch("/^[A-Z]+$/");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "^[A-Z]+$",
      patternType: "regex",
      caseSensitive: true,
    });
  });

  it("tokenizes case-insensitive regex /regex/i", () => {
    const tokens = tokenizeSearch("/john/i");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      patternType: "regex",
      caseSensitive: false,
      regexFlags: "i",
    });
  });

  it("tokenizes OR operator |", () => {
    const tokens = tokenizeSearch("john | jane");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: "term", value: "john" });
    expect(tokens[1]).toMatchObject({ type: "or" });
    expect(tokens[2]).toMatchObject({ type: "term", value: "jane" });
  });

  it("tokenizes AND operator (implicit space)", () => {
    const tokens = tokenizeSearch("john jane");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ type: "term", value: "john" });
    expect(tokens[1]).toMatchObject({ type: "term", value: "jane" });
  });

  it("tokenizes explicit AND operator &", () => {
    const tokens = tokenizeSearch("john & jane");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: "term", value: "john" });
    expect(tokens[1]).toMatchObject({ type: "and" });
    expect(tokens[2]).toMatchObject({ type: "term", value: "jane" });
  });

  it("tokenizes NOT operator -", () => {
    const tokens = tokenizeSearch("-banned");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ type: "not" });
    expect(tokens[1]).toMatchObject({ type: "term", value: "banned" });
  });

  it("tokenizes parentheses for grouping", () => {
    const tokens = tokenizeSearch("(john | jane)");
    expect(tokens).toHaveLength(5);
    expect(tokens[0]).toMatchObject({ type: "lparen" });
    expect(tokens[1]).toMatchObject({ type: "term", value: "john" });
    expect(tokens[2]).toMatchObject({ type: "or" });
    expect(tokens[3]).toMatchObject({ type: "term", value: "jane" });
    expect(tokens[4]).toMatchObject({ type: "rparen" });
  });

  it("tokenizes quoted phrases", () => {
    const tokens = tokenizeSearch('"hello world"');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "hello world",
      patternType: "contains",
    });
  });

  it("tokenizes complex expression", () => {
    const tokens = tokenizeSearch("(^john | jane$) active -banned");
    // 8 tokens: ( ^john | jane$ ) active - banned
    expect(tokens).toHaveLength(8);
    expect(tokens[0]).toMatchObject({ type: "lparen" });
    expect(tokens[1]).toMatchObject({ type: "term", value: "john", patternType: "startsWith" });
    expect(tokens[2]).toMatchObject({ type: "or" });
    expect(tokens[3]).toMatchObject({ type: "term", value: "jane", patternType: "endsWith" });
    expect(tokens[4]).toMatchObject({ type: "rparen" });
    expect(tokens[5]).toMatchObject({ type: "term", value: "active" });
    expect(tokens[6]).toMatchObject({ type: "not" });
    expect(tokens[7]).toMatchObject({ type: "term", value: "banned" });
  });

  it("handles wildcards in terms", () => {
    const tokens = tokenizeSearch("jo*son");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "jo*son",
      patternType: "contains",
    });
  });

  it("tokenizes column:value syntax", () => {
    const tokens = tokenizeSearch("name:john");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      targetColumn: "name",
      patternType: "contains",
    });
  });

  it("tokenizes column:val1|val2|val3 syntax", () => {
    const tokens = tokenizeSearch("status:active|pending|done");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "group",
      children: [{
        type: "or",
        children: [
          { type: "term", value: "active", targetColumn: "status" },
          { type: "term", value: "pending", targetColumn: "status" },
          { type: "term", value: "done", targetColumn: "status" },
        ],
      }],
    });
  });

  it("tokenizes column with anchors", () => {
    const tokens = tokenizeSearch("name:^john$");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "john",
      targetColumn: "name",
      patternType: "exact",
    });
  });

  it("tokenizes column with regex", () => {
    const tokens = tokenizeSearch("email:/.*@gmail/i");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: ".*@gmail",
      targetColumn: "email",
      patternType: "regex",
      caseSensitive: false,
    });
  });

  it("handles escaped colon for literal search", () => {
    const tokens = tokenizeSearch("time\\:10");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "time:10",
      patternType: "contains",
    });
    expect(tokens[0]?.targetColumn).toBeUndefined();
  });

  it("handles escaped pipe for literal search", () => {
    const tokens = tokenizeSearch("a\\|b");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "term",
      value: "a|b",
    });
  });
});

describe("parseSearchTokens", () => {
  it("parses single term", () => {
    const tokens = tokenizeSearch("john");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "term",
      value: "john",
    });
  });

  it("parses OR expression", () => {
    const tokens = tokenizeSearch("john | jane");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "or",
      children: [
        { type: "term", value: "john" },
        { type: "term", value: "jane" },
      ],
    });
  });

  it("parses AND expression (implicit)", () => {
    const tokens = tokenizeSearch("john jane");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "and",
      children: [
        { type: "term", value: "john" },
        { type: "term", value: "jane" },
      ],
    });
  });

  it("parses NOT expression", () => {
    const tokens = tokenizeSearch("-banned");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "not",
      children: [{ type: "term", value: "banned" }],
    });
  });

  it("parses grouped expression", () => {
    const tokens = tokenizeSearch("(john | jane) active");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "and",
      children: [
        {
          type: "group",
          children: [
            {
              type: "or",
              children: [
                { type: "term", value: "john" },
                { type: "term", value: "jane" },
              ],
            },
          ],
        },
        { type: "term", value: "active" },
      ],
    });
  });

  it("respects operator precedence (OR < AND)", () => {
    const tokens = tokenizeSearch("a b | c d");
    const ast = parseSearchTokens(tokens);
    // Should be: (a AND b) OR (c AND d)
    expect(ast).toMatchObject({
      type: "or",
      children: [
        {
          type: "and",
          children: [
            { type: "term", value: "a" },
            { type: "term", value: "b" },
          ],
        },
        {
          type: "and",
          children: [
            { type: "term", value: "c" },
            { type: "term", value: "d" },
          ],
        },
      ],
    });
  });

  it("parses complex nested expression", () => {
    const tokens = tokenizeSearch("(a | b) (c | d) -e");
    const ast = parseSearchTokens(tokens);
    expect(ast).toMatchObject({
      type: "and",
      children: [
        { type: "group" },
        { type: "group" },
        { type: "not", children: [{ type: "term", value: "e" }] },
      ],
    });
  });
});

describe("validateSearchAst", () => {
  it("validates empty AST", () => {
    const result = validateSearchAst(null);
    expect(result.valid).toBe(true);
  });

  it("validates simple term", () => {
    const tokens = tokenizeSearch("john");
    const ast = parseSearchTokens(tokens);
    const result = validateSearchAst(ast);
    expect(result.valid).toBe(true);
    expect(result.termCount).toBe(1);
  });

  it("rejects too many terms", () => {
    const tokens = tokenizeSearch("a b c d e f g h i j k l");
    const ast = parseSearchTokens(tokens);
    const result = validateSearchAst(ast, { ...DEFAULT_SEARCH_LIMITS, maxTerms: 10 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Max 10 search terms");
  });

  it("rejects too deep nesting", () => {
    const tokens = tokenizeSearch("((((a))))");
    const ast = parseSearchTokens(tokens);
    const result = validateSearchAst(ast, { ...DEFAULT_SEARCH_LIMITS, maxGroupDepth: 2 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Max nesting depth");
  });

  it("rejects too many regex patterns", () => {
    const tokens = tokenizeSearch("/a/ /b/ /c/ /d/");
    const ast = parseSearchTokens(tokens);
    const result = validateSearchAst(ast, { ...DEFAULT_SEARCH_LIMITS, maxRegexPatterns: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Max 3 regex patterns");
  });

  it("counts regex patterns correctly", () => {
    const tokens = tokenizeSearch("/a/ john /b/");
    const ast = parseSearchTokens(tokens);
    const result = validateSearchAst(ast);
    expect(result.valid).toBe(true);
    expect(result.termCount).toBe(3);
    expect(result.regexCount).toBe(2);
  });
});

describe("parseSearchQuery", () => {
  it("returns empty filter for empty input", () => {
    const result = parseSearchQuery("", testColumns);
    expect(result.success).toBe(true);
    expect(result.filter?.root.conditions).toHaveLength(0);
  });

  it("generates OR conditions across columns for simple term", () => {
    const result = parseSearchQuery("john", testColumns);
    expect(result.success).toBe(true);
    expect(result.filter?.root.logical).toBe("OR");
    expect(result.filter?.root.conditions).toHaveLength(3);
  });

  it("generates ILIKE for case-insensitive search", () => {
    const result = parseSearchQuery("john", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].operator).toBe("ILIKE");
    expect(conditions[0].value).toBe("%john%");
  });

  it("generates LIKE for case-sensitive search", () => {
    const result = parseSearchQuery("!John", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].operator).toBe("LIKE");
    expect(conditions[0].value).toBe("%John%");
  });

  it("generates startsWith pattern", () => {
    const result = parseSearchQuery("^john", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].value).toBe("john%");
  });

  it("generates endsWith pattern", () => {
    const result = parseSearchQuery("son$", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].value).toBe("%son");
  });

  it("generates exact match pattern", () => {
    const result = parseSearchQuery("^john$", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].value).toBe("john");
  });

  it("generates REGEX operator for regex pattern", () => {
    const result = parseSearchQuery("/^[A-Z]+$/", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].operator).toBe("REGEX");
  });

  it("generates REGEX_I operator for case-insensitive regex", () => {
    const result = parseSearchQuery("/john/i", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].operator).toBe("REGEX_I");
  });

  it("handles OR with nested groups", () => {
    const result = parseSearchQuery("john | jane", testColumns);
    expect(result.success).toBe(true);
    expect(result.filter?.root.logical).toBe("OR");
    expect(result.filter?.root.conditions).toHaveLength(2);
  });

  it("handles AND with nested groups", () => {
    const result = parseSearchQuery("john jane", testColumns);
    expect(result.success).toBe(true);
    expect(result.filter?.root.logical).toBe("AND");
    expect(result.filter?.root.conditions).toHaveLength(2);
  });

  it("marks negated conditions", () => {
    const result = parseSearchQuery("-banned", testColumns);
    expect(result.success).toBe(true);
    const group = result.filter?.root as any;
    expect(group.conditions[0].negated).toBe(true);
  });

  it("handles complex boolean expression", () => {
    const result = parseSearchQuery("(john | jane) active -banned", testColumns);
    expect(result.success).toBe(true);
    expect(result.filter?.root.logical).toBe("AND");
    expect(result.filter?.root.conditions).toHaveLength(3);
  });

  it("returns error for validation failure", () => {
    const manyTerms = Array(15).fill("term").join(" ");
    const result = parseSearchQuery(manyTerms, testColumns);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Max");
  });

  it("handles wildcards in value", () => {
    const result = parseSearchQuery("jo*son", testColumns);
    expect(result.success).toBe(true);
    const conditions = result.filter?.root.conditions as any[];
    expect(conditions[0].value).toBe("%jo%son%");
  });

  it("targets specific column with column:value", () => {
    const result = parseSearchQuery("name:john", testColumns);
    expect(result.success).toBe(true);
    // Should only have 1 condition for the 'name' column
    expect(result.filter?.root.conditions).toHaveLength(1);
    const condition = result.filter?.root.conditions[0] as any;
    expect(condition.column).toBe("name");
    expect(condition.value).toBe("%john%");
  });

  it("handles column:val1|val2|val3 as OR", () => {
    const columnsWithStatus = [
      ...testColumns,
      { name: "status", dataType: "varchar" },
    ];
    const result = parseSearchQuery("status:active|pending", columnsWithStatus);
    expect(result.success).toBe(true);
    // Should be a group with OR containing two term groups
    const root = result.filter?.root;
    expect(root?.logical).toBe("OR");
  });

  it("returns empty for non-existent column target", () => {
    const result = parseSearchQuery("nonexistent:value", testColumns);
    expect(result.success).toBe(true);
    // Should return empty group since column doesn't exist
    expect(result.filter?.root.conditions).toHaveLength(0);
  });
});

describe("parseSimpleSearch (legacy API)", () => {
  it("returns empty filter for empty input", () => {
    const result = parseSimpleSearch("", testColumns);
    expect(result.root.conditions).toHaveLength(0);
  });

  it("returns filter for valid input", () => {
    const result = parseSimpleSearch("john", testColumns);
    expect(result.root.conditions.length).toBeGreaterThan(0);
  });

  it("handles complex patterns", () => {
    const result = parseSimpleSearch("(john | jane) -banned", testColumns);
    expect(result.root.conditions.length).toBeGreaterThan(0);
  });
});
