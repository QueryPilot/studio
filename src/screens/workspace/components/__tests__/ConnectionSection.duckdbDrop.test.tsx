import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
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
    isLoading: true,
    error: null,
  }),
}));
vi.mock("../SchemaDropdown", () => ({
  SchemaDropdown: () => <button type="button">main</button>,
}));
vi.mock("../DuckDbAddFileDialog", () => ({
  DuckDbAddFileDialog: ({
    open,
    filePath,
    files,
  }: {
    open: boolean;
    filePath?: string | null;
    files?: { filePath: string }[];
  }) =>
    open ? (
      <div>
        {files
          ? files.length === 1
            ? `Import file: ${files[0]?.filePath}`
            : `Import batch: ${files.length}`
          : `Import file: ${filePath}`}
      </div>
    ) : null,
}));

function makeDomStringListTypes(types: string[]): DataTransfer["types"] {
  return {
    length: types.length,
    contains: (type: string) => types.includes(type),
    item: (index: number) => types[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* types;
    },
  } as unknown as DataTransfer["types"];
}

function makeFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as FileList & Record<number, File>;

  files.forEach((file, index) => {
    fileList[index] = file;
  });

  return fileList;
}

function makeFile(name: string, path: string): File {
  const file = new File(["id,name\n1,Ada"], name, { type: "text/csv" });
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  });
  return file;
}

function makeXlsxFile(name: string, path: string): File {
  const file = new File(["fake-xlsx"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  });
  return file;
}

function makeDataTransfer(types: string[], files: File[] = []): DataTransfer {
  return {
    dropEffect: "none",
    files: makeFileList(files),
    getData: () => "",
    types: makeDomStringListTypes(types),
  } as unknown as DataTransfer;
}

function renderConnectionSection(connection: OpenConnection) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
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

function getDuckDbConnection(): OpenConnection {
  const connection = useWorkspaceBundleStore
    .getState()
    .activeWorkspace?.connections.get("duck-1");
  if (!connection) {
    throw new Error("DuckDB test connection was not initialized");
  }
  return connection;
}

describe("ConnectionSection DuckDB sidebar drop zone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "duckdb_list_excel_sheets") {
        return Promise.reject(new Error("sheet lookup should not block dialog open"));
      }
      return Promise.resolve(undefined);
    });

    const connection: OpenConnection = {
      id: "duck-1",
      status: "connecting",
      database: "/tmp/scratch.duckdb",
      schema: "main",
      profile: {
        id: "duck-1",
        name: "Scratch",
        db_type: DbType.DuckDB,
        host: "",
        port: 0,
        database: "/tmp/scratch.duckdb",
        username: "",
        options: {},
        databases: [
          { name: "/tmp/scratch.duckdb", visible_schemas: ["main"] },
        ],
      },
    };

    useConnectionStore.setState({
      connections: [
        {
          profile: connection.profile,
          metadata: {
            created_at: "2026-04-21T00:00:00.000Z",
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
        focusedConnectionId: "duck-1",
        connections: new Map([["duck-1", connection]]),
        config: {
          id: "workspace-1",
          name: "Workspace",
          connectionIds: ["duck-1"],
          connectionStates: {
            "duck-1": {
              database: "/tmp/scratch.duckdb",
              schema: "main",
            },
          },
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      },
      getConnectionById: vi.fn((id: string) =>
        id === "duck-1" ? connection : undefined,
      ),
      reconnectConnection: vi.fn().mockResolvedValue(undefined),
      reconnectDisconnectedConnections: vi.fn().mockResolvedValue(undefined),
      removeConnectionFromWorkspace: vi.fn().mockResolvedValue(undefined),
      setFocusedConnection: vi.fn(),
    });
  });

  it("shows the drop overlay when dragging over the always-mounted connection root", async () => {
    const connection = getDuckDbConnection();
    const { container } = renderConnectionSection(connection);
    const root = container.firstElementChild;

    expect(root).toBeInstanceOf(HTMLElement);
    fireEvent.dragEnter(root as HTMLElement, {
      dataTransfer: makeDataTransfer(["Files"]),
    });

    await waitFor(() => {
      expect(
        screen.getByText("Drop file or URL to import into DuckDB"),
      ).toBeInTheDocument();
    });
  });

  it("opens the existing single-file import dialog when dropping on the connection root", async () => {
    const connection = getDuckDbConnection();
    const { container } = renderConnectionSection(connection);
    const root = container.firstElementChild;

    expect(root).toBeInstanceOf(HTMLElement);
    fireEvent.drop(root as HTMLElement, {
      dataTransfer: makeDataTransfer(
        ["Files"],
        [makeFile("people.csv", "/tmp/people.csv")],
      ),
    });

    await waitFor(() => {
      expect(screen.getByText("Import file: /tmp/people.csv")).toBeInTheDocument();
    });
  });

  it("opens the batch import dialog when dropping multiple files", async () => {
    const connection = getDuckDbConnection();
    const { container } = renderConnectionSection(connection);
    const root = container.firstElementChild;

    expect(root).toBeInstanceOf(HTMLElement);
    fireEvent.drop(root as HTMLElement, {
      dataTransfer: makeDataTransfer(
        ["Files"],
        [
          makeFile("people.csv", "/tmp/people.csv"),
          makeXlsxFile("workbook.xlsx", "/tmp/workbook.xlsx"),
        ],
      ),
    });

    await waitFor(() => {
      expect(screen.getByText("Import batch: 2")).toBeInTheDocument();
    });
  });
});
