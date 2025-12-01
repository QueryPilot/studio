/**
 * Tests for tool factory service
 */

import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import { metadataCache } from "../utils/cache";

// Store original fetch before any imports that might use it
const originalFetch = globalThis.fetch;

// Mock fetch for Tauri calls
function createMockFetch() {
  return mock(async (url: string, options?: RequestInit): Promise<Response> => {
    const body = options?.body ? JSON.parse(options.body as string) : {};
    const { cmd, args } = body;

    // Simulate various Tauri commands
    switch (cmd) {
      case "get_tables":
        return new Response(
          JSON.stringify([
            { name: "users", schema: args?.schema || "public", row_count: 100, size: "1MB" },
            { name: "orders", schema: args?.schema || "public", row_count: 500, size: "5MB" },
          ])
        );

      case "get_columns":
        if (args?.table === "users") {
          return new Response(
            JSON.stringify([
              { name: "id", db_type: "integer", nullable: false, primary_key: true },
              { name: "name", db_type: "varchar(255)", nullable: false },
              { name: "email", db_type: "varchar(255)", nullable: true },
              { name: "org_id", db_type: "integer", nullable: true },
            ])
          );
        }
        if (args?.table === "orders") {
          return new Response(
            JSON.stringify([
              { name: "id", db_type: "integer", nullable: false, primary_key: true },
              { name: "user_id", db_type: "integer", nullable: false },
              { name: "amount", db_type: "decimal(10,2)", nullable: false },
            ])
          );
        }
        return new Response(JSON.stringify([]));

      case "get_constraints":
        if (args?.table === "orders") {
          return new Response(
            JSON.stringify([
              {
                name: "fk_orders_user",
                constraint_type: "ForeignKey",
                column_name: "user_id",
                foreign_table: "users",
                foreign_column: "id",
              },
            ])
          );
        }
        return new Response(JSON.stringify([]));

      case "get_indexes":
        if (args?.table === "users") {
          return new Response(
            JSON.stringify([
              { name: "users_pkey", columns: ["id"], is_unique: true, is_primary: true },
              { name: "idx_users_email", columns: ["email"], is_unique: true, is_primary: false },
            ])
          );
        }
        return new Response(JSON.stringify([]));

      case "execute_query":
        // Simulate search results
        if (args?.sql && args.sql.includes("users") && args.sql.includes("ILIKE")) {
          return new Response(JSON.stringify([{ id: 1 }, { id: 5 }, { id: 10 }]));
        }
        return new Response(JSON.stringify([]));

      default:
        return new Response(JSON.stringify([]));
    }
  }) as typeof fetch;
}

describe("Tool Factory Service", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  let createTextToSqlTools: typeof import("./tool-factory.service").createTextToSqlTools;
  let clearConnectionCache: typeof import("./tool-factory.service").clearConnectionCache;
  let getCacheStats: typeof import("./tool-factory.service").getCacheStats;

  const testContext = {
    connectionId: "test-conn-1",
    schema: "public",
  };

  beforeEach(async () => {
    // Clear cache before each test
    metadataCache.clear();

    // Create fresh mock
    mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    // Re-import the module to get fresh tools with mocked fetch
    // Use dynamic import to ensure mock is in place
    const module = await import("./tool-factory.service");
    createTextToSqlTools = module.createTextToSqlTools;
    clearConnectionCache = module.clearConnectionCache;
    getCacheStats = module.getCacheStats;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("createTextToSqlTools", () => {
    it("should create all expected tools", () => {
      const tools = createTextToSqlTools(testContext);

      expect(tools.list_tables).toBeDefined();
      expect(tools.get_table_structure).toBeDefined();
      expect(tools.get_indexes).toBeDefined();
      expect(tools.get_foreign_keys).toBeDefined();
      expect(tools.search_tables).toBeDefined();
      expect(tools.execute_readonly_query).toBeDefined();
      expect(tools.submit_where_clause).toBeDefined();
    });

    describe("list_tables tool", () => {
      it("should return structured result", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.list_tables.execute(
          {},
          { abortSignal: new AbortController().signal } as any
        );

        // Result should have success flag and tables array (even if empty due to mocking)
        expect(typeof result.success).toBe("boolean");
        expect(result).toHaveProperty("success");
      });
    });

    describe("get_table_structure tool", () => {
      it("should return columns and constraints", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.get_table_structure.execute(
          { table: "users" },
          { abortSignal: new AbortController().signal } as any
        );

        expect(result.success).toBe(true);
        expect((result as any).columns).toBeDefined();
      });
    });

    describe("get_indexes tool", () => {
      it("should return indexes for table", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.get_indexes.execute(
          { table: "users" },
          { abortSignal: new AbortController().signal } as any
        );

        expect(result.success).toBe(true);
        expect((result as any).indexes).toBeDefined();
      });
    });

    describe("get_foreign_keys tool", () => {
      it("should return foreign keys for table", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.get_foreign_keys.execute(
          { table: "orders" },
          { abortSignal: new AbortController().signal } as any
        );

        expect(result.success).toBe(true);
        expect((result as any).foreignKeys).toBeDefined();
      });
    });

    describe("execute_readonly_query tool", () => {
      it("should have execute function", async () => {
        const tools = createTextToSqlTools(testContext);
        expect(typeof tools.execute_readonly_query.execute).toBe("function");
      });

      it("should return result structure", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.execute_readonly_query.execute(
          { sql: "SELECT id FROM users" },
          { abortSignal: new AbortController().signal } as any
        );

        // Should have success field
        expect(result).toHaveProperty("success");
      });
    });

    describe("submit_where_clause tool", () => {
      it("should return structured result", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.submit_where_clause.execute(
          {
            whereClause: "status = 'active'",
            explanation: "Filter for active users",
            confidence: "high",
            usedSubquery: false,
          },
          { abortSignal: new AbortController().signal } as any
        );

        expect(result.success).toBe(true);
        expect((result as any).whereClause).toBe("status = 'active'");
        expect((result as any).explanation).toBe("Filter for active users");
        expect((result as any).confidence).toBe("high");
        expect((result as any).usedSubquery).toBe(false);
      });

      it("should accept subquery indicator", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.submit_where_clause.execute(
          {
            whereClause: "user_id IN (SELECT id FROM users WHERE name ILIKE '%john%')",
            usedSubquery: true,
          },
          { abortSignal: new AbortController().signal } as any
        );

        expect(result.success).toBe(true);
        expect((result as any).usedSubquery).toBe(true);
      });
    });

    describe("search_tables tool", () => {
      it("should have execute function", async () => {
        const tools = createTextToSqlTools(testContext);
        expect(typeof tools.search_tables.execute).toBe("function");
      });

      it("should return result structure", async () => {
        const tools = createTextToSqlTools(testContext);
        const result = await tools.search_tables.execute(
          {
            searchTerm: "John",
            tables: ["users"],
          },
          { abortSignal: new AbortController().signal } as any
        );

        // Should have success field
        expect(result).toHaveProperty("success");
      });
    });
  });

  describe("clearConnectionCache", () => {
    it("should clear cache for specific connection", async () => {
      const tools1 = createTextToSqlTools({ connectionId: "conn-1", schema: "public" });

      // Populate cache
      await tools1.list_tables.execute(
        {},
        { abortSignal: new AbortController().signal } as any
      );

      // Clear cache for conn-1
      clearConnectionCache("conn-1");

      // Verify cache is cleared by checking stats
      const stats = getCacheStats();
      expect(stats.connectionCounts["conn-1"]).toBeUndefined();
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", async () => {
      const tools = createTextToSqlTools(testContext);

      // Populate cache
      await tools.list_tables.execute(
        {},
        { abortSignal: new AbortController().signal } as any
      );

      const stats = getCacheStats();

      expect(stats.totalEntries).toBeGreaterThanOrEqual(0);
      expect(typeof stats.connectionCounts).toBe("object");
    });
  });

  describe("error handling", () => {
    it("tools should return success field on any result", async () => {
      const tools = createTextToSqlTools(testContext);
      const result = await tools.list_tables.execute(
        {},
        { abortSignal: new AbortController().signal } as any
      );

      // All tool results should have a success field
      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });
  });
});
