import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { vaultStorage } from "@/services/vaultStorage";
import type { VaultSecretRecord } from "@/types/vault";
import type { ConnectionProfile } from "@/types/connection";
import { DbType } from "@/types/connection";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";
import { runDuckDbReplay } from "@/services/duckdbReplayOrchestrator";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/services/vaultStorage", () => ({
  vaultStorage: {
    listSecrets: vi.fn(),
  },
}));

const mockedInvoke = invoke as Mock;
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockedListSecrets = vaultStorage.listSecrets as Mock;

function makeDuckDBProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "conn-1",
    name: "test duckdb",
    db_type: DbType.DuckDB,
    host: "",
    port: 0,
    database: "/tmp/test.duckdb",
    username: "",
    options: {},
    databases: [
      {
        name: "main",
        visible_schemas: ["main"],
        attachments: [
          {
            alias: "lake",
            kind: "iceberg",
            uri: "s3://bucket/ice",
            secret_ref: "my_s3",
          },
        ],
        secret_refs: ["my_s3"],
      },
    ],
    ...overrides,
  };
}

describe("runDuckDbReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRuntimeDatabasesStore.setState({ byConnection: {} });
  });

  it("populates runtimeDatabasesStore from replay result", async () => {
    const secretRec: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      params: { KEY_ID: "K", SECRET: "S", REGION: "us-east-1" },
      connection_id: "conn-1",
    };
    mockedListSecrets.mockResolvedValue([secretRec]);
    mockedInvoke.mockResolvedValue({
      runtime_databases: [{ name: "lake", visible_schemas: ["main"] }],
      errors: [],
    });

    const profile = makeDuckDBProfile();
    const result = await runDuckDbReplay(profile);

    expect(mockedInvoke).toHaveBeenCalledWith(
      "duckdb_replay_setup",
      expect.objectContaining({ connId: "conn-1" }),
    );
    expect(result.runtime_databases).toHaveLength(1);
    const state = useRuntimeDatabasesStore.getState().get("conn-1");
    expect(state.databases[0]?.name).toBe("lake");
  });

  it("passes decrypted secrets from vault to command", async () => {
    const secretRec: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      params: { KEY_ID: "K" },
      connection_id: "conn-1",
    };
    mockedListSecrets.mockResolvedValue([secretRec]);
    mockedInvoke.mockResolvedValue({ runtime_databases: [], errors: [] });

    await runDuckDbReplay(makeDuckDBProfile());

    const [, args] = mockedInvoke.mock.calls[0] as [string, Record<string, unknown>];
    const secrets = args["secrets"] as unknown[];
    expect(secrets).toHaveLength(1);
    expect((secrets[0] as Record<string, unknown>)["name"]).toBe("my_s3");
  });

  it("handles replay with no attachments gracefully", async () => {
    mockedListSecrets.mockResolvedValue([]);
    mockedInvoke.mockResolvedValue({ runtime_databases: [], errors: [] });

    const profile = makeDuckDBProfile({
      databases: [{ name: "main", visible_schemas: ["main"] }],
    });
    const result = await runDuckDbReplay(profile);
    expect(result.errors).toHaveLength(0);
  });
});
