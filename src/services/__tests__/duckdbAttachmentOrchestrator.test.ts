import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "@/types/connection";
import type { VaultSecretRecord } from "@/types/vault";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockVaultStorage = {
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
  upsertSecret: vi.fn(),
  deleteSecret: vi.fn(),
};

vi.mock("@/services/vaultStorage", () => ({
  vaultStorage: mockVaultStorage,
}));

const mockedInvoke = invoke as Mock;

function makeConn(attachments: Attachment[] = []) {
  return {
    profile: {
      id: "conn-1",
      name: "DuckDB local",
      db_type: "DuckDB",
      host: "localhost",
      port: 0,
      database: "/tmp/test.duckdb",
      username: "",
      options: {},
      databases: [
        {
          name: "main",
          visible_schemas: ["main"],
          attachments,
        },
      ],
    },
    metadata: { id: "conn-1", name: "DuckDB local", createdAt: "", updatedAt: "" },
  };
}

describe("addAttachmentWithSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultStorage.getConnection.mockResolvedValue(makeConn());
    mockVaultStorage.updateConnection.mockResolvedValue(undefined);
    mockVaultStorage.upsertSecret.mockResolvedValue(undefined);
    mockVaultStorage.deleteSecret.mockResolvedValue(undefined);
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("happy path: upserts vault secret → issues secret → updates profile → runs attach", async () => {
    const { addAttachmentWithSecret } = await import("@/services/duckdbAttachmentOrchestrator");
    const attachment: Attachment = {
      alias: "lake",
      kind: "iceberg",
      uri: "s3://b/ice",
      secret_ref: "my_s3",
    };
    const secret: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      params: { KEY_ID: "AKIA", SECRET: "xxx" },
      connection_id: "conn-1",
    };

    await addAttachmentWithSecret({ connectionId: "conn-1", attachment, secret });

    // vault upsert called first
    expect(mockVaultStorage.upsertSecret).toHaveBeenCalledWith(secret);
    // issue_secret called with payload
    expect(mockedInvoke).toHaveBeenCalledWith("duckdb_issue_secret", expect.objectContaining({
      connId: "conn-1",
    }));
    // profile updated
    expect(mockVaultStorage.updateConnection).toHaveBeenCalled();
    // run_attach called last
    expect(mockedInvoke).toHaveBeenCalledWith("duckdb_run_attach", expect.objectContaining({
      connId: "conn-1",
      attachment,
    }));
  });

  it("rolls back profile update and vault secret when ATTACH fails", async () => {
    // updateConnection succeeds for step 3, but run_attach fails
    mockVaultStorage.updateConnection.mockImplementation(() => {
      return Promise.resolve();
    });
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "duckdb_run_attach") return Promise.reject(new Error("ATTACH failed"));
      return Promise.resolve();
    });

    const { addAttachmentWithSecret } = await import("@/services/duckdbAttachmentOrchestrator");
    const attachment: Attachment = {
      alias: "lake",
      kind: "iceberg",
      uri: "s3://b/ice",
      secret_ref: "my_s3",
    };
    const secret: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      params: {},
      connection_id: "conn-1",
    };

    await expect(addAttachmentWithSecret({ connectionId: "conn-1", attachment, secret })).rejects.toThrow("ATTACH failed");

    // Profile should have been restored (called twice: once to set, once to rollback)
    expect(mockVaultStorage.updateConnection).toHaveBeenCalledTimes(2);
    // Vault secret should be deleted on rollback
    expect(mockVaultStorage.deleteSecret).toHaveBeenCalledWith("conn-1", "my_s3");
  });

  it("persists and attaches a DuckDB file attachment without requiring a secret", async () => {
    const { addDatabaseAttachment } = await import("@/services/duckdbAttachmentOrchestrator");

    await addDatabaseAttachment({
      connectionId: "conn-1",
      path: "/tmp/attached.duckdb",
      alias: "test_attach",
      dbType: undefined,
      readOnly: true,
    });

    expect(mockVaultStorage.updateConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({
        databases: [
          expect.objectContaining({
            attachments: [
              {
                alias: "test_attach",
                kind: "duckdb",
                uri: "/tmp/attached.duckdb",
                read_only: true,
              },
            ],
          }),
        ],
      }),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("duckdb_run_attach", {
      connId: "conn-1",
      attachment: {
        alias: "test_attach",
        kind: "duckdb",
        uri: "/tmp/attached.duckdb",
        read_only: true,
      },
      secret: null,
    });
  });
});

describe("removeAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    mockVaultStorage.updateConnection.mockResolvedValue(undefined);
    mockVaultStorage.deleteSecret.mockResolvedValue(undefined);
  });

  it("detaches, updates profile, and removes orphaned secret", async () => {
    mockVaultStorage.getConnection.mockResolvedValue(
      makeConn([
        { alias: "lake", kind: "iceberg", uri: "s3://b", secret_ref: "my_s3" },
      ]),
    );

    const { removeAttachment } = await import("@/services/duckdbAttachmentOrchestrator");
    await removeAttachment("conn-1", "lake");

    expect(mockedInvoke).toHaveBeenCalledWith("duckdb_run_detach", { connId: "conn-1", alias: "lake" });
    expect(mockVaultStorage.updateConnection).toHaveBeenCalled();
    // Orphaned secret removed
    expect(mockVaultStorage.deleteSecret).toHaveBeenCalledWith("conn-1", "my_s3");
  });

  it("does NOT remove secret if another attachment still references it", async () => {
    mockVaultStorage.getConnection.mockResolvedValue(
      makeConn([
        { alias: "lake1", kind: "iceberg", uri: "s3://a", secret_ref: "shared_s3" },
        { alias: "lake2", kind: "iceberg", uri: "s3://b", secret_ref: "shared_s3" },
      ]),
    );

    const { removeAttachment } = await import("@/services/duckdbAttachmentOrchestrator");
    await removeAttachment("conn-1", "lake1");

    // shared_s3 still used by lake2 → should NOT delete
    expect(mockVaultStorage.deleteSecret).not.toHaveBeenCalled();
  });
});
