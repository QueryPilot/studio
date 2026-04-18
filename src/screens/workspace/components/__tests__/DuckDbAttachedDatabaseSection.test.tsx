import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DuckDbAttachedDatabaseSection } from "../DuckDbAttachedDatabaseSection";

const introspectionMocks = vi.hoisted(() => ({
  getSchemas: vi.fn(),
  getTables: vi.fn(),
  getViews: vi.fn(),
}));

vi.mock("@/services/introspectionService", () => ({
  IntrospectionService: {
    getSchemas: introspectionMocks.getSchemas,
    getTables: introspectionMocks.getTables,
    getViews: introspectionMocks.getViews,
  },
}));

function renderSection({
  dbName = "pg",
  dbType = "postgres",
  schemaNames,
}: {
  dbName?: string;
  dbType?: string;
  schemaNames: string[];
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DuckDbAttachedDatabaseSection
        connectionId="duck-conn"
        dbName={dbName}
        dbType={dbType}
        schemaNames={schemaNames}
        onTableClick={vi.fn()}
        onDetach={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("DuckDbAttachedDatabaseSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    introspectionMocks.getSchemas.mockResolvedValue([
      { name: "main" },
      { name: "pg.public" },
      { name: "pg.test" },
    ]);
    introspectionMocks.getTables.mockImplementation((_connectionId, schema) => {
      if (schema === "pg.public") {
        return Promise.resolve([
          { schema: "pg.public", name: "addresses", row_count: 12 },
        ]);
      }
      if (schema === "pg.test") {
        return Promise.resolve([
          { schema: "pg.test", name: "hola", row_count: 1 },
        ]);
      }
      return Promise.resolve([]);
    });
    introspectionMocks.getViews.mockResolvedValue([]);
  });

  it("shows attached schemas without loading objects when none are selected", async () => {
    renderSection({ schemaNames: [] });

    expect(await screen.findByText("public")).toBeInTheDocument();
    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(screen.queryByText("addresses")).not.toBeInTheDocument();
    expect(screen.queryByText("hola")).not.toBeInTheDocument();
    expect(introspectionMocks.getTables).not.toHaveBeenCalled();
    expect(introspectionMocks.getViews).not.toHaveBeenCalled();
  });

  it("groups selected attached database objects under their schemas", async () => {
    renderSection({ schemaNames: ["public", "test"] });

    expect(await screen.findByText("public")).toBeInTheDocument();
    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(await screen.findByText("addresses")).toBeInTheDocument();
    expect(await screen.findByText("hola")).toBeInTheDocument();

    await waitFor(() => {
      expect(introspectionMocks.getTables).toHaveBeenCalledWith("duck-conn", "pg.public");
      expect(introspectionMocks.getTables).toHaveBeenCalledWith("duck-conn", "pg.test");
    });
  });

  it("falls back to main for attached DuckDB files when schema discovery is empty", async () => {
    introspectionMocks.getSchemas.mockResolvedValue([]);
    introspectionMocks.getTables.mockImplementation((_connectionId, schema) => {
      if (schema === "test_attach.main") {
        return Promise.resolve([
          { schema: "test_attach.main", name: "orders", row_count: 3 },
        ]);
      }
      return Promise.resolve([]);
    });

    renderSection({
      dbName: "test_attach",
      dbType: "DuckDB",
      schemaNames: [],
    });

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(await screen.findByText("orders")).toBeInTheDocument();
    expect(introspectionMocks.getTables).toHaveBeenCalledWith(
      "duck-conn",
      "test_attach.main",
    );
  });
});
