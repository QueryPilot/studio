import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { IntrospectionService } from "../introspectionService";
import { BackendAPI } from "../backend";
import { getSqlAdapterForConnection } from "@/adapters";

vi.mock("../backend", () => ({
  BackendAPI: {
    query: vi.fn(),
  },
}));

vi.mock("@/adapters", () => ({
  getSqlAdapterForConnection: vi.fn(),
}));

describe("IntrospectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coerces string boolean values for column flags", async () => {
    const adapter = {
      getColumnsQuery: vi.fn(() => "SELECT 1"),
    };

    (getSqlAdapterForConnection as unknown as Mock).mockResolvedValue(adapter);
    (BackendAPI.query as unknown as Mock).mockResolvedValue({
      rows: [
        ["id", "int", "int", "0", "1", null, null, null, null],
        ["name", "varchar", "varchar", "1", "0", null, null, null, null],
      ],
    });

    const columns = await IntrospectionService.getColumns(
      "conn-1",
      "testdb",
      "todos",
    );

    expect(columns[0]?.primary_key).toBe(true);
    expect(columns[0]?.nullable).toBe(false);
    expect(columns[1]?.primary_key).toBe(false);
    expect(columns[1]?.nullable).toBe(true);
  });

  it("retries with index stats fallback query when primary query fails", async () => {
    const queryMock = BackendAPI.query as unknown as Mock;
    const adapter = {
      getIndexUsageStatsQuery: vi.fn(() => "PRIMARY_SQL"),
      getIndexUsageStatsFallbackQuery: vi.fn(() => "FALLBACK_SQL"),
    };

    (getSqlAdapterForConnection as unknown as Mock).mockResolvedValue(adapter);
    queryMock
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce({
        rows: [["idx_users_email", 0, 0, 0, null, null, 0, null, null]],
      });

    const stats = await IntrospectionService.getIndexUsageStats(
      "conn-1",
      "public",
      "users",
    );

    expect(stats).toHaveLength(1);
    expect(stats[0]?.index_name).toBe("idx_users_email");
    expect(queryMock).toHaveBeenNthCalledWith(1, "conn-1", "PRIMARY_SQL");
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      "conn-1",
      "FALLBACK_SQL",
    );
  });

  it("rethrows index stats errors when no fallback query is available", async () => {
    const queryMock = BackendAPI.query as unknown as Mock;
    const adapter = {
      getIndexUsageStatsQuery: vi.fn(() => "PRIMARY_SQL"),
      getIndexUsageStatsFallbackQuery: vi.fn(() => null),
    };

    (getSqlAdapterForConnection as unknown as Mock).mockResolvedValue(adapter);
    queryMock.mockRejectedValue(new Error("primary failure"));

    await expect(
      IntrospectionService.getIndexUsageStats("conn-1", "public", "users"),
    ).rejects.toThrow("primary failure");
  });
});
