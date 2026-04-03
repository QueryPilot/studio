import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { databaseService } from "../databaseService";
import { DbType, type ConnectionProfile } from "@/types/connection";

const vaultStorageMock = vi.hoisted(() => ({
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: vi.fn(() => true),
  safeInvoke: vi.fn(),
  safeEmit: vi.fn(),
}));

vi.mock("../vaultStorage", () => ({
  vaultStorage: vaultStorageMock,
}));

describe("databaseService.switchSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists Oracle current schema and reconnects the session", async () => {
    const profile: ConnectionProfile = {
      id: "oracle-conn",
      name: "Oracle Dev",
      db_type: DbType.Oracle,
      host: "localhost",
      port: 1521,
      database: "XEPDB1",
      username: "system",
      options: {
        oracle_connect_mode: "service_name",
      },
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
    (vaultStorageMock.updateConnection as unknown as Mock).mockResolvedValue(undefined);

    vi.spyOn(databaseService, "isConnectionActive").mockReturnValue(true);
    const disconnectSpy = vi
      .spyOn(databaseService, "disconnect")
      .mockResolvedValue(undefined);
    const reconnectSpy = vi.spyOn(databaseService, "connectById").mockResolvedValue({
      connection_id: "oracle-conn",
      server_version: "Oracle Database 21c",
    });

    await databaseService.switchSchema("oracle-conn", "REPORTING");

    expect(vaultStorageMock.updateConnection).toHaveBeenCalledWith(
      "oracle-conn",
      expect.objectContaining({
        options: expect.objectContaining({
          oracle_current_schema: "REPORTING",
        }),
      }),
    );
    expect(disconnectSpy).toHaveBeenCalledWith("oracle-conn");
    expect(reconnectSpy).toHaveBeenCalledWith("oracle-conn");
  });
});
