import { describe, it, expect } from "vitest";
import type { AIContext } from "@/types/aiContext";
import {
  buildSuggestionGroups,
  flattenSelectableItems,
  parseFilter,
  type OpenTab,
} from "../useMentionSuggestions";

// =============================================================================
// Mock data
// =============================================================================

const mockContext: AIContext = {
  connections: [
    {
      id: "c1",
      name: "DevDB",
      dbType: "PostgreSQL",
      database: "dev",
      paradigm: "sql",
      schemas: [
        {
          name: "public",
          tables: [
            "users",
            "orders",
            "products",
            "user_sessions",
            "user_roles",
          ],
          views: ["active_users"],
          functions: ["get_user"],
        },
        {
          name: "analytics",
          tables: ["events", "sessions"],
          views: [],
          functions: [],
        },
      ],
    },
    {
      id: "c2",
      name: "ProdDB",
      dbType: "MySQL",
      database: "prod",
      paradigm: "sql",
      schemas: [
        {
          name: "default",
          tables: ["customers", "invoices"],
          views: [],
          functions: [],
        },
      ],
    },
  ],
  focusedConnectionId: "c1",
  mentions: [],
};

const mockTabs: OpenTab[] = [
  { id: "t1", name: "My Query", type: "query", panelId: "p1" },
  { id: "t2", name: "User Analysis", type: "query", panelId: "p1" },
];

// =============================================================================
// parseFilter
// =============================================================================

describe("parseFilter", () => {
  it("parses empty string", () => {
    expect(parseFilter("")).toEqual({ text: "" });
  });

  it("parses plain text", () => {
    expect(parseFilter("user")).toEqual({ text: "user" });
  });

  it("parses connection scope", () => {
    expect(parseFilter("DevDB/")).toEqual({
      conn: "DevDB",
      text: "",
    });
  });

  it("parses connection + schema scope", () => {
    expect(parseFilter("DevDB/public.")).toEqual({
      conn: "DevDB",
      schema: "public",
      text: "",
    });
  });

  it("parses connection + schema + text", () => {
    expect(parseFilter("DevDB/public.us")).toEqual({
      conn: "DevDB",
      schema: "public",
      text: "us",
    });
  });

  it("parses quoted connection name", () => {
    expect(parseFilter('"My DB"/public.')).toEqual({
      conn: "My DB",
      schema: "public",
      text: "",
    });
  });

  it("parses tab: prefix as type filter", () => {
    expect(parseFilter("tab:something")).toEqual({ typeFilter: "tab", text: "something" });
  });

  it("parses table: prefix as type filter", () => {
    expect(parseFilter("table:users")).toEqual({ typeFilter: "table", text: "users" });
  });

  it("parses view: prefix as type filter", () => {
    expect(parseFilter("view:active")).toEqual({ typeFilter: "view", text: "active" });
  });

  it("parses fn: prefix as type filter", () => {
    expect(parseFilter("fn:calc")).toEqual({ typeFilter: "function", text: "calc" });
  });
});

// =============================================================================
// buildSuggestionGroups
// =============================================================================

describe("buildSuggestionGroups", () => {
  it("returns connection groups with focused first on empty filter", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0]!.label).toBe("DevDB");
    expect(groups[1]!.label).toBe("ProdDB");
  });

  it("shows tabs group at bottom on empty filter", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    const lastGroup = groups[groups.length - 1]!;
    expect(lastGroup.label).toBe("Tabs");
    expect(lastGroup.items).toHaveLength(2);
    expect(lastGroup.items[0]!.name).toBe("My Query");
  });

  it("scopes to connection when filter is 'DevDB/'", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "DevDB/", "c1");

    expect(groups.length).toBe(2);
    expect(groups[0]!.label).toBe("DevDB / public");
    expect(groups[1]!.label).toBe("DevDB / analytics");

    for (const group of groups) {
      for (const item of group.items) {
        expect(item.connectionId).toBe("c1");
      }
    }
  });

  it("scopes to schema when filter is 'DevDB/public.'", () => {
    const groups = buildSuggestionGroups(
      mockContext,
      mockTabs,
      "DevDB/public.",
      "c1",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("DevDB / public");
    expect(groups[0]!.items).toHaveLength(7);
  });

  it("filters items by text match", () => {
    const groups = buildSuggestionGroups(
      mockContext,
      mockTabs,
      "DevDB/public.us",
      "c1",
    );

    expect(groups).toHaveLength(1);
    const names = groups[0]!.items.map((i) => i.name);
    expect(names).toContain("users");
    expect(names).toContain("user_sessions");
    expect(names).toContain("user_roles");
    expect(names).toContain("active_users");
    expect(names).toContain("get_user");
    expect(names).not.toContain("orders");
    expect(names).not.toContain("products");
  });

  it("returns tab results for 'tab:' prefix", () => {
    const groups = buildSuggestionGroups(
      mockContext,
      mockTabs,
      "tab:query",
      "c1",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Tabs");
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]!.name).toBe("My Query");
  });

  it("returns connection as selectable item (connectionItem on group)", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    const devGroup = groups.find((g) => g.label === "DevDB");
    expect(devGroup).toBeDefined();
    expect(devGroup!.connectionItem).toBeDefined();
    expect(devGroup!.connectionItem!.mentionType).toBe("connection");
    expect(devGroup!.connectionItem!.name).toBe("DevDB");
    expect(devGroup!.connectionItem!.connectionId).toBe("c1");
  });

  it("focused connection shows more items than others", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    const devGroup = groups.find((g) => g.label === "DevDB");
    const prodGroup = groups.find((g) => g.label === "ProdDB");

    expect(devGroup).toBeDefined();
    expect(prodGroup).toBeDefined();

    expect(devGroup!.items.length).toBeLessThanOrEqual(5);
    expect(devGroup!.items).toHaveLength(5);
  });

  it("non-focused connections show fewer preview items (OTHER_PREVIEW=3)", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    const prodGroup = groups.find((g) => g.label === "ProdDB");
    expect(prodGroup).toBeDefined();
    expect(prodGroup!.items.length).toBeLessThanOrEqual(3);
    expect(prodGroup!.items).toHaveLength(2);
  });

  it("empty filter with no connections returns empty", () => {
    const emptyContext: AIContext = {
      connections: [],
      focusedConnectionId: null,
      mentions: [],
    };

    const groups = buildSuggestionGroups(emptyContext, [], "", undefined);
    expect(groups).toHaveLength(0);
  });

  it("filters across all connections with no scope", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "user", "c1");

    const devGroup = groups.find((g) => g.label === "DevDB");
    expect(devGroup).toBeDefined();
    const devNames = devGroup!.items.map((i) => i.name);
    expect(devNames).toContain("users");
    expect(devNames).toContain("user_sessions");
    expect(devNames).toContain("user_roles");
    expect(devNames).toContain("active_users");
    expect(devNames).toContain("get_user");

    const tabGroup = groups.find((g) => g.label === "Tabs");
    expect(tabGroup).toBeDefined();
    expect(tabGroup!.items[0]!.name).toBe("User Analysis");
  });

  it("shows schema in displayLabel for PostgreSQL but not MySQL", () => {
    const groups = buildSuggestionGroups(
      mockContext,
      mockTabs,
      "DevDB/public.",
      "c1",
    );
    const pgItem = groups[0]!.items.find((i) => i.name === "users");
    expect(pgItem!.displayLabel).toBe("public.users");

    const groups2 = buildSuggestionGroups(
      mockContext,
      mockTabs,
      "ProdDB/",
      "c1",
    );
    const mysqlItem = groups2[0]!.items.find((i) => i.name === "customers");
    expect(mysqlItem!.displayLabel).toBe("customers");
  });

  it("includes overflowHint when items exceed preview limit", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");

    const devGroup = groups.find((g) => g.label === "DevDB");
    expect(devGroup).toBeDefined();
    expect(devGroup!.overflowHint).toContain("more");
  });
});

// =============================================================================
// flattenSelectableItems
// =============================================================================

describe("flattenSelectableItems", () => {
  it("includes connection headers and items", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");
    const flat = flattenSelectableItems(groups);

    const connectionItems = flat.filter((i) => i.mentionType === "connection");
    expect(connectionItems.length).toBe(2);

    expect(flat.length).toBeGreaterThan(2);
  });

  it("returns empty array for empty groups", () => {
    expect(flattenSelectableItems([])).toEqual([]);
  });

  it("preserves order: connection header before its items", () => {
    const groups = buildSuggestionGroups(mockContext, mockTabs, "", "c1");
    const flat = flattenSelectableItems(groups);

    expect(flat[0]!.mentionType).toBe("connection");
    expect(flat[0]!.name).toBe("DevDB");
    expect(flat[1]!.connectionId).toBe("c1");
  });
});
