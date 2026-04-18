import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockVaultStorage = {
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
};
vi.mock("@/services/vaultStorage", () => ({ vaultStorage: mockVaultStorage }));

const mockedInvoke = invoke as Mock;

function makeConn(extensions: string[] = []) {
  return {
    profile: {
      id: "conn-1",
      name: "DuckDB",
      db_type: "DuckDB",
      host: "",
      port: 0,
      database: "/tmp/test.duckdb",
      username: "",
      options: {},
      databases: [{ name: "main", visible_schemas: ["main"], extensions }],
    },
    metadata: { id: "conn-1", name: "DuckDB", createdAt: "", updatedAt: "" },
  };
}

describe("duckdbExtensionsOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    mockVaultStorage.updateConnection.mockResolvedValue(undefined);
  });

  describe("upsertExtension", () => {
    it("calls install_load_extension then appends to profile.databases[0].extensions", async () => {
      mockVaultStorage.getConnection.mockResolvedValue(makeConn([]));
      const { upsertExtension } = await import("@/services/duckdbExtensionsOrchestrator");
      await upsertExtension("conn-1", "iceberg");

      expect(mockedInvoke).toHaveBeenCalledWith("duckdb_install_load_extension", {
        connId: "conn-1",
        extension: "iceberg",
      });
      expect(mockVaultStorage.updateConnection).toHaveBeenCalledWith(
        "conn-1",
        expect.objectContaining({
          databases: expect.arrayContaining([
            expect.objectContaining({ extensions: ["iceberg"] }),
          ]),
        }),
      );
    });

    it("does not persist duplicate extensions", async () => {
      mockVaultStorage.getConnection.mockResolvedValue(makeConn(["iceberg"]));
      const { upsertExtension } = await import("@/services/duckdbExtensionsOrchestrator");
      await upsertExtension("conn-1", "iceberg");

      // updateConnection should NOT be called since extension already persisted
      expect(mockVaultStorage.updateConnection).not.toHaveBeenCalled();
    });
  });

  describe("removeExtension", () => {
    it("removes extension from profile without invoking any command", async () => {
      mockVaultStorage.getConnection.mockResolvedValue(makeConn(["iceberg", "httpfs"]));
      const { removeExtension } = await import("@/services/duckdbExtensionsOrchestrator");
      await removeExtension("conn-1", "iceberg");

      expect(mockedInvoke).not.toHaveBeenCalled();
      expect(mockVaultStorage.updateConnection).toHaveBeenCalledWith(
        "conn-1",
        expect.objectContaining({
          databases: expect.arrayContaining([
            expect.objectContaining({ extensions: ["httpfs"] }),
          ]),
        }),
      );
    });
  });
});
