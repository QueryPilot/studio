import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the dependencies
vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServices: () => ({
    commandService: {
      list: () => [
        {
          id: "test.command",
          label: "Test Command",
          category: "Test",
          description: "A test command",
        },
        {
          id: "another.command",
          label: "Another Command",
          category: "Another",
        },
      ],
    },
    keybindingService: {
      list: () => [
        {
          command: "test.command",
          resolvedLabel: "Ctrl+T",
          weight: 100,
        },
      ],
    },
  }),
}));

vi.mock("@/hooks/useSchemaData", () => ({
  useSchemaData: () => ({
    tables: [
      {
        name: "users",
        schema: "public",
        row_estimate: 100,
        kind: "Table",
      },
      {
        name: "orders",
        schema: "public",
        row_estimate: 500,
        kind: "Table",
      },
    ],
    views: [
      {
        name: "user_summary",
        schema: "public",
        row_estimate: null,
        kind: "View",
      },
      {
        name: "cached_stats",
        schema: "public",
        row_estimate: null,
        kind: "MaterializedView",
      },
    ],
    functions: [
      {
        name: "calculate_total",
        schema: "public",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

// Import after mocks are set up
import { useUnifiedItems } from "../useCommandPaletteQueries";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useUnifiedItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should combine tables and commands into unified items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;

    // Should have items from tables, views, functions, and commands
    expect(items.length).toBeGreaterThan(0);

    // Check for table items
    const tableItems = items.filter((i) => i.type === "table");
    expect(tableItems.length).toBe(2);
    expect(tableItems.some((t) => t.name === "users")).toBe(true);
    expect(tableItems.some((t) => t.name === "orders")).toBe(true);

    // Check for command items
    const commandItems = items.filter((i) => i.type === "command");
    expect(commandItems.length).toBe(2);
    expect(commandItems.some((c) => c.name === "Test Command")).toBe(true);
  });

  it("should include views in unified items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;

    // Check for view items
    const viewItems = items.filter((i) => i.type === "view");
    expect(viewItems.length).toBe(1);
    expect(viewItems[0]!.name).toBe("user_summary");

    // Check for materialized view items
    const matViewItems = items.filter((i) => i.type === "materializedView");
    expect(matViewItems.length).toBe(1);
    expect(matViewItems[0]!.name).toBe("cached_stats");
  });

  it("should include functions in unified items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;

    // Check for function items
    const funcItems = items.filter((i) => i.type === "function");
    expect(funcItems.length).toBe(1);
    expect(funcItems[0].name).toBe("calculate_total");
  });

  it("should have unique IDs for all items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const ids = items.map((i) => i.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should prefix command IDs with 'command:'", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const commandItems = items.filter((i) => i.type === "command");

    commandItems.forEach((item) => {
      expect(item.id).toMatch(/^command:/);
    });
  });

  it("should include schema in subtitle for database objects", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const tableItem = items.find((i) => i.name === "users");

    expect(tableItem?.schema).toBe("public");
  });

  it("should include keywords for search", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;

    items.forEach((item) => {
      expect(Array.isArray(item.keywords)).toBe(true);
      expect(item.keywords.length).toBeGreaterThan(0);
    });
  });

  it("should attach original table metadata to table items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const tableItem = items.find((i) => i.name === "users" && i.type === "table");

    expect(tableItem?.table).toBeDefined();
    expect(tableItem?.table?.name).toBe("users");
    expect(tableItem?.table?.schema).toBe("public");
  });

  it("should attach original command metadata to command items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const commandItem = items.find((i) => i.name === "Test Command");

    expect(commandItem?.command).toBeDefined();
    expect(commandItem?.command?.id).toBe("test.command");
  });

  it("should attach function metadata to function items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;
    const funcItem = items.find((i) => i.type === "function");

    expect(funcItem?.func).toBeDefined();
    expect(funcItem?.func?.name).toBe("calculate_total");
  });
});
