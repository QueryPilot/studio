import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { DbType } from "@/types/connection";
import type { OpenConnection } from "@/types/workspace";
import { ConnectionSection } from "../ConnectionSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("react-diff-viewer-continued", () => ({
  default: () => <div data-testid="diff-viewer" />,
  DiffMethod: { WORDS: "WORDS" },
}));
vi.mock("@/lib/refreshConnectionData", () => ({
  refreshConnectionData: vi.fn(),
}));
vi.mock("@/hooks/useSchemaData", () => ({
  useSchemaData: () => ({
    tables: [],
    views: [],
    functions: [],
    allFunctions: [],
    sequences: [],
    packages: [],
    synonyms: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../SchemaDropdown", () => ({
  SchemaDropdown: () => <button type="button">main</button>,
}));
vi.mock("../DuckDbAttachDatabaseDialog", () => ({
  DuckDbAttachDatabaseDialog: ({ open }: { open: boolean }) =>
    open ? <div>Attach database dialog</div> : null,
}));

function makeConnection(dbType: DbType): OpenConnection {
  const id = `${dbType}-1`;
  const database = dbType === DbType.DuckDB ? "/tmp/scratch.duckdb" : "app";
  const schema = dbType === DbType.DuckDB ? "main" : "public";
  return {
    id,
    status: "connected",
    database,
    schema,
    profile: {
      id,
      name: "Test",
      db_type: dbType,
      host: "",
      port: 0,
      database,
      username: "",
      options: {},
      databases: [{ name: database, visible_schemas: [schema] }],
    },
  };
}

function setupStores(connection: OpenConnection) {
  useConnectionStore.setState({
    connections: [
      {
        profile: connection.profile,
        metadata: {
          created_at: "2026-10-05T00:00:00.000Z",
          last_used: null,
          use_count: 0,
          is_favorite: false,
          tags: [],
        },
      },
    ],
  });

  useWorkspaceBundleStore.setState({
    activeWorkspace: {
      focusedConnectionId: connection.id,
      connections: new Map([[connection.id, connection]]),
      config: {
        id: "workspace-1",
        name: "Workspace",
        connectionIds: [connection.id],
        connectionStates: {
          [connection.id]: {
            database: connection.database,
            schema: connection.schema,
          },
        },
        createdAt: "2026-10-05T00:00:00.000Z",
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
    },
    getConnectionById: vi.fn((id: string) =>
      id === connection.id ? connection : undefined,
    ),
    reconnectConnection: vi.fn().mockResolvedValue(undefined),
    reconnectDisconnectedConnections: vi.fn().mockResolvedValue(undefined),
    removeConnectionFromWorkspace: vi.fn().mockResolvedValue(undefined),
    setFocusedConnection: vi.fn(),
  });
}

function renderConnectionSection(connection: OpenConnection) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectionSection
        connection={connection}
        isExpanded
        onToggle={vi.fn()}
        searchQuery=""
      />
    </QueryClientProvider>,
  );
}

async function findEmptyState() {
  const message = await screen.findByText("No objects found");
  const container = message.parentElement;
  if (!container) throw new Error("Empty state container not found");
  return within(container);
}

describe("ConnectionSection SQL empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("shows import and attach actions for DuckDB", async () => {
    const connection = makeConnection(DbType.DuckDB);
    setupStores(connection);
    renderConnectionSection(connection);
    const emptyState = await findEmptyState();

    expect(
      emptyState.getByRole("button", { name: /create table/i }),
    ).toBeInTheDocument();
    expect(emptyState.getByRole("button", { name: /create view/i })).toBeInTheDocument();
    expect(emptyState.getByRole("button", { name: /import data/i })).toBeInTheDocument();
    expect(
      emptyState.getByRole("button", { name: /attach database/i }),
    ).toBeInTheDocument();
  });

  it("keeps only create actions for non-DuckDB connections", async () => {
    const connection = makeConnection(DbType.PostgreSQL);
    setupStores(connection);
    renderConnectionSection(connection);
    const emptyState = await findEmptyState();

    expect(
      emptyState.getByRole("button", { name: /create table/i }),
    ).toBeInTheDocument();
    expect(emptyState.getByRole("button", { name: /create view/i })).toBeInTheDocument();
    expect(emptyState.queryByRole("button", { name: /import data/i })).toBeNull();
    expect(emptyState.queryByRole("button", { name: /attach database/i })).toBeNull();
  });

  it("opens the file picker from Import Data > From File", async () => {
    const user = userEvent.setup();
    const connection = makeConnection(DbType.DuckDB);
    setupStores(connection);
    renderConnectionSection(connection);
    const emptyState = await findEmptyState();

    await user.click(emptyState.getByRole("button", { name: /import data/i }));
    await user.click(await screen.findByRole("menuitem", { name: /from file/i }));

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ multiple: true }),
      );
    });
  });

  it("opens the attach dialog from Attach Database > Database file", async () => {
    const user = userEvent.setup();
    const connection = makeConnection(DbType.DuckDB);
    setupStores(connection);
    renderConnectionSection(connection);
    const emptyState = await findEmptyState();

    await user.click(
      emptyState.getByRole("button", { name: /attach database/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /database file/i }),
    );

    expect(await screen.findByText("Attach database dialog")).toBeInTheDocument();
  });
});
