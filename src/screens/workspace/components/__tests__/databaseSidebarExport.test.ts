import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveMock, invokeMock, getObjectDefinitionMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  invokeMock: vi.fn(),
  getObjectDefinitionMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/services/databaseService", () => ({
  databaseService: {
    getObjectDefinition: getObjectDefinitionMock,
  },
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: () => true,
}));

import { exportSidebarObjectsToFile } from "../databaseSidebarExport";

describe("databaseSidebarExport", () => {
  beforeEach(() => {
    saveMock.mockReset();
    invokeMock.mockReset();
    getObjectDefinitionMock.mockReset();
  });

  it("exports selected object definitions to a SQL file", async () => {
    getObjectDefinitionMock
      .mockResolvedValueOnce("CREATE TABLE public.users (id int);")
      .mockResolvedValueOnce("CREATE VIEW public.active_users AS SELECT * FROM public.users;");
    saveMock.mockResolvedValue("/tmp/my-export.sql");
    invokeMock.mockResolvedValue(undefined);

    const result = await exportSidebarObjectsToFile({
      connectionId: "conn-1",
      database: "appdb",
      items: [
        { schema: "public", name: "users", objectType: "table" },
        { schema: "public", name: "active_users", objectType: "view" },
      ],
    });

    expect(getObjectDefinitionMock).toHaveBeenNthCalledWith(
      1,
      "conn-1",
      "appdb",
      "public",
      "users",
      "table",
    );
    expect(getObjectDefinitionMock).toHaveBeenNthCalledWith(
      2,
      "conn-1",
      "appdb",
      "public",
      "active_users",
      "view",
    );

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("plugin:fs|write_text_file", {
      path: "/tmp/my-export.sql",
      contents: expect.stringContaining("CREATE TABLE public.users (id int);"),
    });

    const writtenPayload = invokeMock.mock.calls[0]?.[1] as { contents: string };
    expect(writtenPayload.contents).toContain("CREATE VIEW public.active_users AS SELECT * FROM public.users;");
    expect(writtenPayload.contents).toContain("-- TABLE public.users");
    expect(writtenPayload.contents).toContain("-- VIEW public.active_users");
    expect(result).toEqual({
      success: true,
      cancelled: false,
      itemCount: 2,
      filePath: "/tmp/my-export.sql",
    });
  });

  it("uses db.schema.table-timestamp as default filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T01:02:03.000Z"));

    getObjectDefinitionMock.mockResolvedValue("CREATE TABLE public.users (id int);");
    saveMock.mockResolvedValue("/tmp/my-export.sql");
    invokeMock.mockResolvedValue(undefined);

    await exportSidebarObjectsToFile({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "appdb.public.users-20260228-010203.sql",
      }),
    );

    vi.useRealTimers();
  });

  it("returns cancelled when user closes save dialog", async () => {
    getObjectDefinitionMock.mockResolvedValue("CREATE TABLE public.users (id int);");
    saveMock.mockResolvedValue(null);

    const result = await exportSidebarObjectsToFile({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      cancelled: true,
      itemCount: 1,
    });
  });
});
