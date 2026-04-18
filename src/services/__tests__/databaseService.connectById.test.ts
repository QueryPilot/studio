import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { databaseService } from "../databaseService";
import { BackendAPI } from "../backend";
import { DbType, type ConnectionProfile } from "@/types/connection";
import type * as BackendModule from "../backend";

const vaultStorageMock = vi.hoisted(() => ({
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
}));

const duckDbReplayMock = vi.hoisted(() => ({
  runDuckDbReplay: vi.fn(),
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: vi.fn(() => true),
  safeInvoke: vi.fn(),
  safeEmit: vi.fn(),
}));

vi.mock("../backend", async (importOriginal) => {
  const actual = await importOriginal<typeof BackendModule>();

  return {
    ...actual,
    BackendAPI: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getConnectionHealth: vi.fn(),
      ping: vi.fn(),
      updateActiveSchema: vi.fn(),
    },
  };
});

vi.mock("../vaultStorage", () => ({
  vaultStorage: vaultStorageMock,
}));

vi.mock("../duckdbReplayOrchestrator", () => duckDbReplayMock);

describe("databaseService.connectById", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const service = databaseService as unknown as {
      activeConnections: Map<string, unknown>;
      healthMonitors: Map<string, ReturnType<typeof setInterval>>;
      healthListeners: Map<string, unknown>;
      healthStatus: Map<string, string>;
      inflightConnects: Map<string, Promise<unknown>>;
      startHealthMonitoring: (connectionId: string) => void;
    };

    service.activeConnections.clear();
    service.healthMonitors.forEach((monitor) => {
      clearInterval(monitor);
    });
    service.healthMonitors.clear();
    service.healthListeners.clear();
    service.healthStatus.clear();
    service.inflightConnects.clear();

    vi.spyOn(service, "startHealthMonitoring").mockImplementation(() => {});
  });

  it("persists auto-detected pooler mode after a real connection succeeds", async () => {
    const profile: ConnectionProfile = {
      id: "pg-pooler",
      name: "Postgres Pooler",
      db_type: DbType.PostgreSQL,
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "postgres",
      password: "secret",
      options: {},
      pooler_mode: null,
      databases: [],
    };

    (vaultStorageMock.getConnection as unknown as Mock).mockResolvedValue({
      profile,
      metadata: {
        favorite: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsed: null,
      },
    });
    (BackendAPI.disconnect as unknown as Mock).mockResolvedValue(undefined);
    (BackendAPI.connect as unknown as Mock).mockResolvedValue({
      id: "pg-pooler",
      db_type: DbType.PostgreSQL,
      database: "postgres",
      version: "16.0",
      pooler_mode: true,
    });
    await databaseService.connectById("pg-pooler");

    expect(vaultStorageMock.updateConnection).toHaveBeenCalledWith(
      "pg-pooler",
      expect.objectContaining({
        pooler_mode: true,
      }),
    );
  });

  it("forwards Trino default_schema into backend options during connect", async () => {
    const profile: ConnectionProfile = {
      id: "trino-conn",
      name: "Trino Dev",
      db_type: DbType.Trino,
      host: "localhost",
      port: 8080,
      database: "tpch",
      username: "analyst",
      password: "secret",
      default_schema: "tiny",
      options: {
        trino_source: "query-pilot-test",
      },
      databases: [],
    };

    (vaultStorageMock.getConnection as unknown as Mock).mockResolvedValue({
      profile,
      metadata: {
        favorite: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsed: null,
      },
    });
    (BackendAPI.connect as unknown as Mock).mockResolvedValue({
      id: "trino-conn",
      db_type: DbType.Trino,
      database: "tpch",
      version: "Trino 480",
      pooler_mode: null,
    });

    await databaseService.connectById("trino-conn");

    const connectCalls = (BackendAPI.connect as unknown as Mock).mock.calls;
    expect(connectCalls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          default_schema: "tiny",
          trino_source: "query-pilot-test",
        }),
      }),
    );
  });

  it("waits for DuckDB replay before resolving the connection", async () => {
    const profile: ConnectionProfile = {
      id: "duck-conn",
      name: "DuckDB Scratchpad",
      db_type: DbType.DuckDB,
      host: "localhost",
      port: 0,
      database: "/tmp/main.duckdb",
      username: "",
      password: "",
      options: {},
      databases: [
        {
          name: "/tmp/main.duckdb",
          visible_schemas: ["main"],
          attachments: [
            {
              alias: "test_attach",
              kind: "duckdb",
              uri: "/tmp/attached.duckdb",
            },
          ],
        },
      ],
    };

    (vaultStorageMock.getConnection as unknown as Mock).mockResolvedValue({
      profile,
      metadata: {
        favorite: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsed: null,
      },
    });
    (BackendAPI.connect as unknown as Mock).mockResolvedValue({
      id: "duck-conn",
      db_type: DbType.DuckDB,
      database: "/tmp/main.duckdb",
      version: "v1.4.0",
      pooler_mode: null,
    });

    let resolveReplay!: () => void;
    duckDbReplayMock.runDuckDbReplay.mockReturnValue(
      new Promise((resolve) => {
        resolveReplay = () => {
          resolve({ runtime_databases: [], errors: [] });
        };
      }),
    );

    const connectPromise = databaseService.connectById("duck-conn");
    let settled = false;
    void connectPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);

    resolveReplay();

    await expect(connectPromise).resolves.toEqual({
      connection_id: "duck-conn",
      server_version: "v1.4.0",
    });
  });
});
