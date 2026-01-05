import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntrospectionService } from "../introspectionService";
import { BackendAPI } from "../backend";
import { getAdapterForConnection } from "@/adapters";

vi.mock("../backend", () => ({
  BackendAPI: {
    query: vi.fn(),
  },
}));

vi.mock("@/adapters", () => ({
  getAdapterForConnection: vi.fn(),
}));

describe("IntrospectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coerces string boolean values for column flags", async () => {
    const adapter = {
      getColumnsQuery: vi.fn(() => "SELECT 1"),
    };

    (getAdapterForConnection as unknown as vi.Mock).mockResolvedValue(adapter);
    (BackendAPI.query as unknown as vi.Mock).mockResolvedValue({
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
});
