import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CrudCommand } from "@/types/crud";
import { DbType } from "@/types/connection";
import { GlobalChangesDialog } from "../GlobalChangesDialog";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getOperationExecutor } from "@/services/operationExecutors";
import { toast } from "sonner";

vi.mock("@/stores/crudStore");
vi.mock("@/stores/connectionStoreNew");
vi.mock("@/services/operationExecutors");
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 220,
      })),
    getTotalSize: () => count * 220,
    measureElement: () => {},
    scrollToOffset: () => {},
  }),
}));
vi.mock("@/stores/validationStore", () => ({
  useValidationStore: () => ({
    canCommit: () => ({ allowed: true, errorCount: 0 }),
  }),
}));

const invalidateTable = vi.fn();
const invalidateSchema = vi.fn();

vi.mock("@/stores/dataInvalidationStore", () => ({
  useDataInvalidationStore: {
    getState: () => ({
      invalidateTable,
      invalidateSchema,
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({
    value,
    language,
  }: {
    value: string;
    language?: string;
  }) => (
    <div data-testid="code-editor" data-language={language ?? ""}>
      {value}
    </div>
  ),
}));

vi.mock("react-diff-viewer-continued", () => ({
  DiffMethod: {
    WORDS: "WORDS",
  },
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) => (
    <div data-testid="diff-viewer">
      <div>{oldValue}</div>
      <div>{newValue}</div>
    </div>
  ),
}));

type MockCrudState = {
  stagedCommands: Map<string, CrudCommand[]>;
  commitAll: ReturnType<typeof vi.fn>;
  discardAll: ReturnType<typeof vi.fn>;
  getTableKey: ReturnType<typeof vi.fn>;
  commitChanges: ReturnType<typeof vi.fn>;
  discardChanges: ReturnType<typeof vi.fn>;
  unstageCommand: ReturnType<typeof vi.fn>;
  clearCommittedChanges: ReturnType<typeof vi.fn>;
  isCommittingAll: boolean;
  stageCommands: ReturnType<typeof vi.fn>;
};

type MockConnectionState = {
  connections: Array<{
    profile: { id: string; name: string; db_type: DbType };
  }>;
  getConnection: (id: string) => {
    profile: { id: string; name: string; db_type: DbType };
  } | undefined;
};

let crudState: MockCrudState;
let connectionState: MockConnectionState;

function createCommand(params: {
  id: string;
  type: CrudCommand["type"];
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
  payload: Record<string, unknown>;
}): CrudCommand {
  return {
    id: params.id,
    type: params.type,
    target: {
      connectionId: params.connectionId,
      database: params.database ?? "testdb",
      schema: params.schema ?? "public",
      table: params.table,
    },
    payload: params.payload,
    metadata: {
      timestamp: "2024-01-01T00:00:00Z",
      description: params.id,
    },
    state: "staged",
  };
}

function setupCrudStoreMock() {
  vi.mocked(useCrudStore).mockImplementation(
    ((selector?: (state: MockCrudState) => unknown) =>
      selector ? selector(crudState) : crudState) as typeof useCrudStore,
  );
  (useCrudStore as unknown as { getState: () => MockCrudState }).getState = () =>
    crudState;
}

function setupConnectionStoreMock() {
  vi.mocked(useConnectionStore).mockImplementation(
    ((selector?: (state: MockConnectionState) => unknown) =>
      selector ? selector(connectionState) : connectionState) as typeof useConnectionStore,
  );
}

describe("GlobalChangesDialog multi-connection behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    crudState = {
      stagedCommands: new Map(),
      commitAll: vi.fn(),
      discardAll: vi.fn(),
      getTableKey: vi.fn(
        ({
          connectionId,
          database,
          schema,
          table,
        }: {
          connectionId: string;
          database?: string;
          schema?: string;
          table?: string;
        }) => `${connectionId}:${database ?? ""}:${schema ?? "public"}:${table ?? ""}`,
      ),
      commitChanges: vi.fn().mockResolvedValue({
        committed: [],
        durationMs: 1,
      }),
      discardChanges: vi.fn(),
      unstageCommand: vi.fn(),
      clearCommittedChanges: vi.fn(),
      isCommittingAll: false,
      stageCommands: vi.fn(),
    };
    setupCrudStoreMock();

    connectionState = {
      connections: [
        {
          profile: { id: "conn-sql", name: "Conn PG", db_type: DbType.PostgreSQL },
        },
        {
          profile: { id: "conn-redis", name: "Conn Redis", db_type: DbType.Redis },
        },
      ],
      getConnection: (id: string) =>
        connectionState.connections.find((c) => c.profile.id === id),
    };
    setupConnectionStoreMock();

    vi.mocked(getOperationExecutor).mockImplementation((connectionId: string) =>
      Promise.resolve(
        ({
          preview: (commands: CrudCommand[]) => ({
            type: "sql",
            content: commands
              .map((cmd) => `-- ${connectionId}:${cmd.target.table}:${cmd.type}`)
              .join("\n"),
            operations: [],
          }),
        }) as unknown as Awaited<ReturnType<typeof getOperationExecutor>>,
      ),
    );
  });

  it("keeps rows from different tables separate when primary keys match", async () => {
    const usersUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const ordersUpdate = createCommand({
      id: "orders-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "orders",
      payload: {
        column: "status",
        oldValue: "pending",
        newValue: "paid",
        primaryKeys: { id: 1 },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:testdb:public:users", [usersUpdate]],
      ["conn-sql:testdb:public:orders", [ordersUpdate]],
    ]);
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        connectionId="conn-sql"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/2 changes across 2 tables/i),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Undo$/ })).toHaveLength(2);
    });
  });

  it("renders a connection-grouped sidebar in workspace-wide mode", async () => {
    const usersUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const redisSet = createCommand({
      id: "redis-set",
      type: "data.insert",
      connectionId: "conn-redis",
      table: "keys",
      payload: {
        values: { key: "user:1", value: "value" },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:testdb:public:users", [usersUpdate]],
      ["conn-redis:testdb:public:keys", [redisSet]],
    ]);
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        {...({
          open: true,
          onOpenChange: () => {},
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connections")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Conn PG/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Conn Redis/ })).toBeInTheDocument();
    });
  });

  it("scopes DDL preview and language to the selected sidebar filter", async () => {
    const usersUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const redisSet = createCommand({
      id: "redis-set",
      type: "data.insert",
      connectionId: "conn-redis",
      table: "keys",
      payload: {
        values: { key: "user:1", value: "value" },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:testdb:public:users", [usersUpdate]],
      ["conn-redis:testdb:public:keys", [redisSet]],
    ]);
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        {...({
          open: true,
          onOpenChange: () => {},
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connections")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: /DDL/i }));

    await waitFor(() => {
      const editor = screen.getByTestId("code-editor");
      expect(editor).toHaveAttribute("data-language", "text");
      expect(editor.textContent).toContain("conn-sql:users:data.update");
      expect(editor.textContent).toContain("conn-redis:keys:data.insert");
    });

    fireEvent.click(screen.getByRole("button", { name: /Conn PG/ }));

    await waitFor(() => {
      const editor = screen.getByTestId("code-editor");
      expect(editor).toHaveAttribute("data-language", "sql");
      expect(editor.textContent).toContain("conn-sql:users:data.update");
      expect(editor.textContent).not.toContain("conn-redis:keys:data.insert");
    });
  });

  it("hard-errors table-specific scope when connectionId is missing", async () => {
    const onOpenChange = vi.fn();

    render(
      <GlobalChangesDialog
        {...({
          database: "testdb",
          schema: "public",
          table: "users",
          open: true,
          onOpenChange,
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Internal error: missing connection context for table-specific changes",
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(crudState.commitChanges).not.toHaveBeenCalled();
  });

  it("commits workspace changes with partial success and keeps failed tables staged", async () => {
    const usersUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const ordersUpdate = createCommand({
      id: "orders-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "orders",
      payload: {
        column: "status",
        oldValue: "pending",
        newValue: "paid",
        primaryKeys: { id: 2 },
      },
    });

    const usersKey = "conn-sql:testdb:public:users";
    const ordersKey = "conn-sql:testdb:public:orders";
    crudState.stagedCommands = new Map([
      [usersKey, [usersUpdate]],
      [ordersKey, [ordersUpdate]],
    ]);
    crudState.commitChanges = vi
      .fn()
      .mockResolvedValueOnce({
        committed: [{ id: "users-update" }],
        durationMs: 2,
      })
      .mockRejectedValueOnce(new Error("orders failed"));
    setupCrudStoreMock();

    const onOpenChange = vi.fn();
    render(
      <GlobalChangesDialog
        {...({
          open: true,
          onOpenChange,
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Commit 2 Changes/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Commit 2 Changes/i }));

    await waitFor(() => {
      expect(crudState.commitChanges).toHaveBeenCalledTimes(2);
    });
    expect(crudState.clearCommittedChanges).toHaveBeenCalledWith(usersKey);
    expect(crudState.clearCommittedChanges).not.toHaveBeenCalledWith(ordersKey);
    expect(invalidateTable).toHaveBeenCalledWith(
      "conn-sql",
      "testdb",
      "public",
      "users",
    );
    expect(invalidateTable).not.toHaveBeenCalledWith(
      "conn-sql",
      "testdb",
      "public",
      "orders",
    );
    expect(invalidateSchema).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("scopes discard-all to the current connection when connectionId is provided", async () => {
    const sqlUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const redisSet = createCommand({
      id: "redis-set",
      type: "data.insert",
      connectionId: "conn-redis",
      table: "keys",
      payload: {
        values: { key: "user:1", value: "value" },
      },
    });

    const sqlKey = "conn-sql:testdb:public:users";
    const redisKey = "conn-redis:testdb:public:keys";
    crudState.stagedCommands = new Map([
      [sqlKey, [sqlUpdate]],
      [redisKey, [redisSet]],
    ]);
    setupCrudStoreMock();

    const onOpenChange = vi.fn();
    render(
      <GlobalChangesDialog
        connectionId="conn-sql"
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Discard All/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Discard All/i }));

    expect(crudState.discardChanges).toHaveBeenCalledWith(sqlKey);
    expect(crudState.discardChanges).not.toHaveBeenCalledWith(redisKey);
    expect(crudState.discardAll).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces conflict UI when workspace commit has a conflict failure", async () => {
    const usersUpdate = createCommand({
      id: "users-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "users",
      payload: {
        column: "email",
        oldValue: "a@example.com",
        newValue: "b@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const ordersUpdate = createCommand({
      id: "orders-update",
      type: "data.update",
      connectionId: "conn-sql",
      table: "orders",
      payload: {
        column: "status",
        oldValue: "pending",
        newValue: "paid",
        primaryKeys: { id: 2 },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:testdb:public:users", [usersUpdate]],
      ["conn-sql:testdb:public:orders", [ordersUpdate]],
    ]);
    crudState.commitChanges = vi
      .fn()
      .mockResolvedValueOnce({
        committed: [{ id: "users-update" }],
        durationMs: 2,
      })
      .mockRejectedValueOnce(
        new Error("CONFLICT: row modified by another user"),
      );
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        {...({
          open: true,
          onOpenChange: () => {},
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Commit 2 Changes/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Commit 2 Changes/i }));

    await waitFor(() => {
      expect(screen.getByText("Conflict Detected")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Override with My Changes/i }),
      ).toBeInTheDocument();
    });
  });

  it("filters by selected table key across databases with same schema.table", async () => {
    const usersDb1 = createCommand({
      id: "users-db1-update",
      type: "data.update",
      connectionId: "conn-sql",
      database: "db1",
      table: "users",
      payload: {
        column: "email",
        oldValue: "db1-old@example.com",
        newValue: "db1-new@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const usersDb2 = createCommand({
      id: "users-db2-update",
      type: "data.update",
      connectionId: "conn-sql",
      database: "db2",
      table: "users",
      payload: {
        column: "email",
        oldValue: "db2-old@example.com",
        newValue: "db2-new@example.com",
        primaryKeys: { id: 1 },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:db1:public:users", [usersDb1]],
      ["conn-sql:db2:public:users", [usersDb2]],
    ]);
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        connectionId="conn-sql"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Undo$/ })).toHaveLength(2);
    });

    const [db1TableButton] = screen.getAllByRole("button", {
      name: /db1\.public\.users/i,
    });
    expect(db1TableButton).toBeDefined();
    if (!db1TableButton) {
      throw new Error("Expected db1 table button");
    }
    fireEvent.click(db1TableButton);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Undo$/ })).toHaveLength(1);
    });
  });

  it("shows changes from multiple databases in workspace-wide mode", async () => {
    const usersDb1 = createCommand({
      id: "users-db1-update",
      type: "data.update",
      connectionId: "conn-sql",
      database: "db1",
      table: "users",
      payload: {
        column: "email",
        oldValue: "db1-old@example.com",
        newValue: "db1-new@example.com",
        primaryKeys: { id: 1 },
      },
    });
    const usersDb2 = createCommand({
      id: "users-db2-update",
      type: "data.update",
      connectionId: "conn-sql",
      database: "db2",
      table: "users",
      payload: {
        column: "email",
        oldValue: "db2-old@example.com",
        newValue: "db2-new@example.com",
        primaryKeys: { id: 1 },
      },
    });

    crudState.stagedCommands = new Map([
      ["conn-sql:db1:public:users", [usersDb1]],
      ["conn-sql:db2:public:users", [usersDb2]],
    ]);
    setupCrudStoreMock();

    render(
      <GlobalChangesDialog
        {...({
          open: true,
          onOpenChange: () => {},
        } as Parameters<typeof GlobalChangesDialog>[0])}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/2 changes across 2 tables/i),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Undo$/ })).toHaveLength(2);
      expect(screen.getAllByText("db1.public.users")).toHaveLength(2);
      expect(screen.getAllByText("db2.public.users")).toHaveLength(2);
    });
  });
});
