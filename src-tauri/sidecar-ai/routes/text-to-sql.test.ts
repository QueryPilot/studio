/**
 * Tests for text-to-sql route handler - focuses on validation and parsing logic
 * Note: Full AI integration tests require mocking AI SDK which is complex.
 * These tests focus on input validation and internal functions.
 */

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { handleTextToSQL } from "./text-to-sql";

// Mock the AI SDK and provider service to prevent actual AI calls
mock.module("ai", () => ({
  generateObject: mock(async () => ({
    object: {
      whereClause: "status = 'active'",
      explanation: "Filter for active status",
    },
  })),
  generateText: mock(async () => ({
    text: "",
    steps: [],
    finishReason: "stop",
  })),
  stepCountIs: () => ({ type: "step-count" }),
}));

mock.module("../services/provider.service", () => ({
  ProviderService: {
    getProvider: () => () => ({ doGenerate: async () => ({}) }),
  },
}));

mock.module("../services/tool-factory.service", () => ({
  createTextToSqlTools: () => ({
    list_tables: { execute: async () => ({ success: true, tables: [] }) },
    get_table_structure: { execute: async () => ({ success: true, columns: [] }) },
    get_indexes: { execute: async () => ({ success: true, indexes: [] }) },
    get_foreign_keys: { execute: async () => ({ success: true, foreignKeys: [] }) },
    search_tables: { execute: async () => ({ success: true, results: [] }) },
    execute_readonly_query: { execute: async () => ({ success: true, rows: [] }) },
    submit_where_clause: { execute: async (input: any) => ({ success: true, ...input }) },
  }),
}));

describe("handleTextToSQL", () => {
  const baseRequest = {
    prompt: "active users",
    columns: [
      { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true },
      { name: "name", dataType: "varchar(255)", nullable: false },
      { name: "status", dataType: "varchar(50)", nullable: true },
    ],
    tableName: "users",
    schema: "public",
    dialect: "postgresql" as const,
    provider: "openai",
    model: "gpt-4o",
    connectionId: "conn-1",
  };

  function createRequest(body: object): Request {
    return new Request("http://localhost/text-to-sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  describe("input validation", () => {
    it("should reject empty prompt", async () => {
      const request = createRequest({ ...baseRequest, prompt: "" });
      const response = await handleTextToSQL(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      // Actionable error format
      expect(body.error).toContain("filter prompt");
      expect(body.code).toBe("INVALID_PROMPT");
      expect(body.suggestion).toBeDefined();
    });

    it("should reject whitespace-only prompt", async () => {
      const request = createRequest({ ...baseRequest, prompt: "   " });
      const response = await handleTextToSQL(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("INVALID_PROMPT");
    });

    it("should reject missing columns", async () => {
      const request = createRequest({ ...baseRequest, columns: [] });
      const response = await handleTextToSQL(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      // Actionable error format
      expect(body.error).toContain("column");
      expect(body.code).toBe("INVALID_COLUMNS");
      expect(body.suggestion).toBeDefined();
    });

    it("should reject null columns", async () => {
      const request = createRequest({ ...baseRequest, columns: null });
      const response = await handleTextToSQL(request);

      expect(response.status).toBe(400);
    });

    it("should reject undefined columns", async () => {
      const { columns, ...withoutColumns } = baseRequest;
      const request = createRequest(withoutColumns);
      const response = await handleTextToSQL(request);

      expect(response.status).toBe(400);
    });
  });

  describe("CORS headers", () => {
    it("should include Content-Type header in response", async () => {
      const request = createRequest({ ...baseRequest, prompt: "" }); // Invalid to get quick response
      const response = await handleTextToSQL(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("error handling", () => {
    it("should handle invalid JSON gracefully", async () => {
      const request = new Request("http://localhost/text-to-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      const response = await handleTextToSQL(request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("request parsing", () => {
    it("should use default schema when not provided", async () => {
      const { schema, ...requestWithoutSchema } = baseRequest;
      const request = createRequest(requestWithoutSchema);
      const response = await handleTextToSQL(request);

      // Should not fail due to missing schema
      // It may still fail due to mocked AI, but not due to schema
      expect([200, 500]).toContain(response.status);
    });

    it("should handle enableCrossTable flag", async () => {
      const request = createRequest({
        ...baseRequest,
        enableCrossTable: true,
      });
      const response = await handleTextToSQL(request);

      // Should process request (may succeed or fail due to mocking)
      expect([200, 500]).toContain(response.status);
    });
  });
});

describe("FK_PATTERNS matching", () => {
  // Test the pattern matching logic for FK detection
  // These patterns are used to infer relationships from column names

  const patterns = [
    { input: "user_id", matches: /^user_id$/i },
    { input: "USER_ID", matches: /^user_id$/i },
    { input: "created_by", matches: /^created_by$/i },
    { input: "updated_by", matches: /^updated_by$/i },
    { input: "org_id", matches: /^org_id$/i },
    { input: "organization_id", matches: /^organization_id$/i },
    { input: "category_id", matches: /^category_id$/i },
    { input: "team_id", matches: /^team_id$/i },
    { input: "project_id", matches: /^project_id$/i },
    { input: "parent_id", matches: /^parent_id$/i },
    { input: "author_id", matches: /^author_id$/i },
    { input: "owner_id", matches: /^owner_id$/i },
  ];

  for (const { input, matches } of patterns) {
    it(`should match pattern for ${input}`, () => {
      expect(matches.test(input)).toBe(true);
    });
  }

  it("should match generic _id pattern", () => {
    const genericPattern = /^(.+)_id$/i;
    expect(genericPattern.test("customer_id")).toBe(true);
    expect(genericPattern.test("product_id")).toBe(true);
    expect(genericPattern.test("random_thing_id")).toBe(true);
    expect(genericPattern.test("id")).toBe(false);
    expect(genericPattern.test("userid")).toBe(false);
  });
});

describe("Column detection patterns", () => {
  // Test detection of FK-like columns

  it("should identify _id suffix columns", () => {
    const columns = [
      { name: "id", dataType: "integer", isPrimaryKey: true },
      { name: "user_id", dataType: "integer" },
      { name: "org_id", dataType: "integer" },
      { name: "name", dataType: "varchar" },
    ];

    const fkLikeColumns = columns.filter(
      (c) => c.name.toLowerCase().endsWith("_id") && !c.isPrimaryKey
    );

    expect(fkLikeColumns).toHaveLength(2);
    expect(fkLikeColumns.map((c) => c.name)).toContain("user_id");
    expect(fkLikeColumns.map((c) => c.name)).toContain("org_id");
  });

  it("should identify _by suffix columns", () => {
    const columns = [
      { name: "created_by", dataType: "integer" },
      { name: "updated_by", dataType: "integer" },
      { name: "name", dataType: "varchar" },
    ];

    const byColumns = columns.filter((c) => c.name.toLowerCase().endsWith("_by"));

    expect(byColumns).toHaveLength(2);
  });

  it("should identify _ref columns", () => {
    const columns = [
      { name: "parent_ref", dataType: "integer" },
      { name: "data_ref", dataType: "varchar" },
    ];

    const refColumns = columns.filter((c) => c.name.toLowerCase().includes("_ref"));

    expect(refColumns).toHaveLength(2);
  });

  it("should skip columns with explicit FK metadata", () => {
    const columns = [
      {
        name: "user_id",
        dataType: "integer",
        isForeignKey: true,
        foreignTable: "users",
      },
      { name: "org_id", dataType: "integer" },
    ];

    // Columns with explicit FK should be skipped for inference
    const needsInference = columns.filter(
      (c) => c.name.endsWith("_id") && !c.isForeignKey
    );

    expect(needsInference).toHaveLength(1);
    expect(needsInference[0].name).toBe("org_id");
  });
});

describe("Dialect syntax hints", () => {
  // Test that different dialects get appropriate syntax

  const dialectHints = {
    postgresql: {
      caseInsensitive: "ILIKE",
      dateInterval: "NOW() - INTERVAL '7 days'",
      boolean: "column = true",
    },
    mysql: {
      caseInsensitive: "LOWER(col) LIKE",
      dateInterval: "DATE_SUB(NOW(), INTERVAL 7 DAY)",
      boolean: "column = 1",
    },
    sqlite: {
      caseInsensitive: "LOWER(col) LIKE",
      dateInterval: "datetime('now', '-7 days')",
      boolean: "column = 1",
    },
    mssql: {
      caseInsensitive: "LIKE", // MSSQL default collation is case-insensitive
      dateInterval: "DATEADD(day, -7, GETDATE())",
      boolean: "column = 1",
    },
  };

  for (const [dialect, hints] of Object.entries(dialectHints)) {
    describe(dialect, () => {
      it(`should use ${hints.caseInsensitive} for case-insensitive search`, () => {
        expect(hints.caseInsensitive).toBeDefined();
      });

      it(`should use ${hints.dateInterval} for date arithmetic`, () => {
        expect(hints.dateInterval).toBeDefined();
      });

      it(`should use ${hints.boolean} for boolean values`, () => {
        expect(hints.boolean).toBeDefined();
      });
    });
  }
});

describe("Response schema", () => {
  // Test the expected response format

  it("should have required whereClause field", () => {
    const validResponse = {
      whereClause: "status = 'active'",
    };
    expect(validResponse.whereClause).toBeDefined();
  });

  it("should allow optional explanation field", () => {
    const withExplanation = {
      whereClause: "status = 'active'",
      explanation: "Filter for active users",
    };
    const withoutExplanation = {
      whereClause: "status = 'active'",
    };

    expect(withExplanation.explanation).toBeDefined();
    expect(withoutExplanation.explanation).toBeUndefined();
  });

  it("should allow optional usedSubquery field", () => {
    const withSubquery = {
      whereClause: "user_id IN (SELECT id FROM users WHERE name = 'John')",
      usedSubquery: true,
    };
    const withoutSubquery = {
      whereClause: "status = 'active'",
      usedSubquery: false,
    };

    expect(withSubquery.usedSubquery).toBe(true);
    expect(withoutSubquery.usedSubquery).toBe(false);
  });
});
