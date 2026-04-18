import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { VaultSecretRecord } from "@/types/vault";

// Mock tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as Mock;

function makeVaultJson(secrets: VaultSecretRecord[]): string {
  return JSON.stringify({
    version: 2,
    connections: [],
    groupTags: [],
    workspaces: [],
    auth_profiles: [],
    tunnel_profiles: [],
    apiKeys: {},
    secrets,
  });
}

describe("vaultStorage secrets", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get a fresh instance
    vi.resetModules();
  });

  it("listSecrets returns records for connection", async () => {
    const record: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      provider: "config",
      persistent: false,
      params: { KEY_ID: "AKIA", SECRET: "xxx", REGION: "us-east-1" },
      connection_id: "conn-1",
    };
    mockedInvoke.mockResolvedValue(makeVaultJson([record]));
    const { vaultStorage } = await import("@/services/vaultStorage");
    const results = await vaultStorage.listSecrets("conn-1");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("my_s3");
    expect(results[0]!.params.KEY_ID).toBe("AKIA");
  });

  it("listSecrets filters by connection_id", async () => {
    const rec1: VaultSecretRecord = {
      name: "s1", type: "s3", params: {}, connection_id: "conn-1",
    };
    const rec2: VaultSecretRecord = {
      name: "s2", type: "s3", params: {}, connection_id: "conn-2",
    };
    mockedInvoke.mockResolvedValue(makeVaultJson([rec1, rec2]));
    const { vaultStorage } = await import("@/services/vaultStorage");
    const results = await vaultStorage.listSecrets("conn-1");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("s1");
  });

  it("upsertSecret inserts new record", async () => {
    mockedInvoke.mockResolvedValue(makeVaultJson([]));
    const { vaultStorage } = await import("@/services/vaultStorage");
    const rec: VaultSecretRecord = {
      name: "new_secret", type: "s3", params: { KEY_ID: "K" }, connection_id: "conn-x",
    };
    await vaultStorage.upsertSecret(rec);
    const all = await vaultStorage.listSecrets("conn-x");
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("new_secret");
  });

  it("deleteSecret removes the record", async () => {
    const rec: VaultSecretRecord = {
      name: "del_me", type: "s3", params: {}, connection_id: "conn-d",
    };
    mockedInvoke.mockResolvedValue(makeVaultJson([rec]));
    const { vaultStorage } = await import("@/services/vaultStorage");
    await vaultStorage.deleteSecret("conn-d", "del_me");
    const all = await vaultStorage.listSecrets("conn-d");
    expect(all).toHaveLength(0);
  });
});
