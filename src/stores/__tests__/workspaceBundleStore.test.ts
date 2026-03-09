import { beforeEach, describe, expect, it, vi } from "vitest";

import { DbType } from "@/types/connection";
import type { ActiveWorkspace, OpenConnection } from "@/types/workspace";
import { schemaCache } from "@/services/schemaCache";
import { useDataInvalidationStore } from "../dataInvalidationStore";
import { useWorkspaceBundleStore } from "../workspaceBundleStore";

const { connectByIdMock } = vi.hoisted(() => ({
  connectByIdMock: vi.fn(),
}));

vi.mock("@/services/databaseService", () => ({
  databaseService: {
    connectById: connectByIdMock,
  },
}));

vi.mock("@/services/vaultStorage", () => ({
  vaultStorage: {
    listWorkspaces: vi.fn(),
    storeWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  },
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [],
      getConnection: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/workbenchStore", () => ({
  default: {
    getState: () => ({
      panelContents: new Map(),
    }),
  },
}));

const createConnection = (
  id: string,
  status: OpenConnection["status"],
): OpenConnection => ({
  id,
  status,
  database: `${id}-db`,
  schema: "public",
  profile: {
    id,
    name: id,
    db_type: DbType.PostgreSQL,
    host: "localhost",
    port: 5432,
    database: `${id}-db`,
    username: "postgres",
    options: {},
  },
});

const createWorkspace = (connections: OpenConnection[]): ActiveWorkspace => {
  const connectionMap = new Map(connections.map((connection) => [connection.id, connection]));
  const connectionIds = connections.map((connection) => connection.id);
  const focusedConnectionId = connections[0]?.id ?? null;

  return {
    focusedConnectionId,
    connections: connectionMap,
    config: {
      id: "workspace-1",
      name: "Workspace",
      connectionIds,
      connectionStates: Object.fromEntries(
        connections.map((connection) => [
          connection.id,
          {
            database: connection.database,
            schema: connection.schema,
          },
        ]),
      ),
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    },
  };
};

describe("workspaceBundleStore reconnect flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useWorkspaceBundleStore.setState({
      savedWorkspaces: [],
      activeWorkspace: null,
      isDirty: false,
    });

    useDataInvalidationStore.setState({
      invalidations: new Map<string, number>(),
      schemaInvalidations: new Map<string, number>(),
    });
  });

  it("invalidates sidebar schema data after a connection reconnects", async () => {
    const invalidateConnectionSpy = vi.spyOn(schemaCache, "invalidateConnection");
    connectByIdMock.mockResolvedValue({
      connection_id: "conn-1",
      server_version: "16.0",
    });

    useWorkspaceBundleStore.setState({
      activeWorkspace: createWorkspace([createConnection("conn-1", "error")]),
    });

    await useWorkspaceBundleStore.getState().reconnectConnection("conn-1");

    expect(connectByIdMock).toHaveBeenCalledWith("conn-1", "conn-1-db");
    expect(invalidateConnectionSpy).toHaveBeenCalledWith("conn-1");
    expect(
      useDataInvalidationStore.getState().getSchemaLastModified(
        "conn-1",
        "conn-1-db",
        "public",
      ),
    ).toBeGreaterThan(0);
    expect(
      useWorkspaceBundleStore.getState().activeWorkspace?.connections.get("conn-1")?.status,
    ).toBe("connected");
  });

  it("retries every disconnected or failed connection together", async () => {
    connectByIdMock.mockImplementation((connectionId: string) => ({
      connection_id: connectionId,
      server_version: "16.0",
    }));

    useWorkspaceBundleStore.setState({
      activeWorkspace: createWorkspace([
        createConnection("connected-1", "connected"),
        createConnection("error-1", "error"),
        createConnection("disconnected-1", "disconnected"),
      ]),
    });

    await useWorkspaceBundleStore
      .getState()
      .reconnectDisconnectedConnections();

    expect(connectByIdMock).toHaveBeenCalledTimes(2);
    expect(connectByIdMock).toHaveBeenCalledWith("error-1", "error-1-db");
    expect(connectByIdMock).toHaveBeenCalledWith(
      "disconnected-1",
      "disconnected-1-db",
    );
    expect(connectByIdMock).not.toHaveBeenCalledWith(
      "connected-1",
      expect.anything(),
    );
    expect(
      useWorkspaceBundleStore.getState().activeWorkspace?.connections.get("error-1")?.status,
    ).toBe("connected");
    expect(
      useWorkspaceBundleStore
        .getState()
        .activeWorkspace?.connections.get("disconnected-1")?.status,
    ).toBe("connected");
  });
});
