import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchemaDropdown } from "@/screens/workspace/components/SchemaDropdown";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";

vi.mock("@/services/databaseService", () => ({
  databaseService: {
    listSchemas: vi.fn().mockResolvedValue(["public", "reporting", "audit"]),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/vaultStorage", () => ({
  vaultStorage: { updateConnection: vi.fn().mockResolvedValue(undefined) },
}));

const setVisibleSchemas = vi.fn().mockResolvedValue(undefined);

describe("SchemaDropdown auto-applies on toggle", () => {
  it("toggling a schema auto-applies to connection store", async () => {
    vi.spyOn(useConnectionStore.getState(), "setVisibleSchemas").mockImplementation(setVisibleSchemas);
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "c", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
          database: "d", username: "u", options: {},
          databases: [{ name: "d", visible_schemas: ["public"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
    render(<SchemaDropdown connectionId="c" databaseName="d" />);
    fireEvent.click(screen.getByRole("button")); // trigger
    await screen.findByText(/reporting/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /reporting/i }));
    await waitFor(() =>
      expect(setVisibleSchemas).toHaveBeenCalledWith(
        "c",
        "d",
        expect.arrayContaining(["public", "reporting"]),
      ),
    );
  });
});

describe("SchemaDropdown multi-select", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "c1", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
          database: "mydb", username: "u", options: {},
          databases: [{ name: "mydb", visible_schemas: ["public"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
  });

  it("trigger label: single schema shows 'public'", () => {
    render(<SchemaDropdown connectionId="c1" databaseName="mydb" />);
    expect(screen.getByRole("button", { name: /public/ })).toBeInTheDocument();
  });

  it("trigger label: N schemas shows 'public (+N-1 more)'", () => {
    useConnectionStore.setState((s) => ({
      ...s,
      connections: s.connections.map((c) => ({
        ...c,
        profile: { ...c.profile, databases: [{ name: "mydb", visible_schemas: ["public", "reporting", "audit"] }] },
      })),
    }));
    render(<SchemaDropdown connectionId="c1" databaseName="mydb" />);
    expect(screen.getByRole("button", { name: /public \(\+2 more\)/ })).toBeInTheDocument();
  });

  it("does not remove last schema when allowEmptySelection is false", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useConnectionStore.getState(), "setVisibleSchemas").mockImplementation(spy);
    render(<SchemaDropdown connectionId="c1" databaseName="mydb" />);
    await userEvent.click(screen.getByRole("button", { name: /public/ }));
    // Try to uncheck the only selected schema
    await userEvent.click(await screen.findByRole("checkbox", { name: /public/ }));
    // Should NOT have called setVisibleSchemas since it would result in empty
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SchemaDropdown Trino empty-schemas exception", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "trino1", name: "t", db_type: DbType.Trino, host: "h", port: 8080,
          database: "hive", username: "u", options: {},
          databases: [{ name: "memory", visible_schemas: ["default"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
  });

  it("allows empty selection for Trino (unchecking last schema applies)", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useConnectionStore.getState(), "setVisibleSchemas").mockImplementation(spy);
    render(<SchemaDropdown connectionId="trino1" databaseName="memory" />);
    await userEvent.click(screen.getByRole("button"));
    // Uncheck the only schema — Trino allows empty
    await userEvent.click(await screen.findByRole("checkbox", { name: /default/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("trino1", "memory", []),
    );
  });
});
