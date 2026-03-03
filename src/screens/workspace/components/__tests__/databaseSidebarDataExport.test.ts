import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  saveMock,
  writeTextFileMock,
  queryMock,
  getAdapterForConnectionMock,
} = vi.hoisted(() => ({
  saveMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  queryMock: vi.fn(),
  getAdapterForConnectionMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("@/utils/tauriFs", () => ({
  writeTextFile: writeTextFileMock,
}));

vi.mock("@/services/backend", () => ({
  BackendAPI: {
    query: queryMock,
  },
}));

vi.mock("@/adapters", () => ({
  getAdapterForConnection: getAdapterForConnectionMock,
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: () => true,
}));

import { exportSidebarObjectDataToFile } from "../databaseSidebarExport";

describe("databaseSidebarExport data", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeTextFileMock.mockReset();
    queryMock.mockReset();
    getAdapterForConnectionMock.mockReset();
  });

  it("exports table data as CSV with expected default filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T01:02:03.000Z"));

    getAdapterForConnectionMock.mockResolvedValue({
      paradigm: "sql",
      select: vi.fn(() => 'SELECT * FROM "public"."users"'),
    });
    queryMock.mockResolvedValue({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [[1, "Alice"], [2, "Bob"]],
    });
    saveMock.mockResolvedValue("/tmp/users.csv");
    writeTextFileMock.mockResolvedValue(undefined);

    const result = await exportSidebarObjectDataToFile({
      connectionId: "conn-1",
      database: "appdb",
      dbType: "postgresql",
      item: {
        schema: "public",
        name: "users",
        objectType: "table",
      },
      format: "csv",
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "appdb.public.users-20260228-010203.csv",
      }),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/tmp/users.csv",
      "id,name\n1,Alice\n2,Bob",
    );
    expect(result).toEqual({
      success: true,
      cancelled: false,
      rowCount: 2,
      filePath: "/tmp/users.csv",
    });

    vi.useRealTimers();
  });

  it("exports table data as SQL INSERT file", async () => {
    getAdapterForConnectionMock.mockResolvedValue({
      paradigm: "sql",
      select: vi.fn(() => 'SELECT * FROM "public"."users"'),
    });
    queryMock.mockResolvedValue({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [[1, "Alice"]],
    });
    saveMock.mockResolvedValue("/tmp/users.sql");
    writeTextFileMock.mockResolvedValue(undefined);

    await exportSidebarObjectDataToFile({
      connectionId: "conn-1",
      database: "appdb",
      dbType: "postgresql",
      item: {
        schema: "public",
        name: "users",
        objectType: "table",
      },
      format: "insert",
    });

    const writtenContent = writeTextFileMock.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('INSERT INTO "public"."users"');
  });

  it("returns cancelled when user closes save dialog", async () => {
    saveMock.mockResolvedValue(null);

    const result = await exportSidebarObjectDataToFile({
      connectionId: "conn-1",
      database: "appdb",
      dbType: "postgresql",
      item: {
        schema: "public",
        name: "users",
        objectType: "table",
      },
      format: "json",
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      cancelled: true,
      rowCount: 0,
    });
  });
});
