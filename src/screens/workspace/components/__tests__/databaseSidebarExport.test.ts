import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveMock, writeTextFileMock, getObjectDefinitionMock, getTableStructureMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  getObjectDefinitionMock: vi.fn(),
  getTableStructureMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("@/utils/tauriFs", () => ({
  writeTextFile: writeTextFileMock,
}));

vi.mock("@/services/databaseService", () => ({
  databaseService: {
    getObjectDefinition: getObjectDefinitionMock,
    getTableStructure: getTableStructureMock,
  },
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: () => true,
}));

const { schemaToDBMLMock } = vi.hoisted(() => ({
  schemaToDBMLMock: vi.fn(),
}));

vi.mock("@/services/dbmlService", () => ({
  dbmlService: {
    schemaToDBML: schemaToDBMLMock,
  },
}));

const { generateMermaidERDMock } = vi.hoisted(() => ({
  generateMermaidERDMock: vi.fn(),
}));

vi.mock("@/utils/mermaidExport", () => ({
  generateMermaidERD: generateMermaidERDMock,
}));

import {
  exportSidebarObjectsToFile,
  exportSidebarObjectsAsDBML,
  exportSidebarObjectsAsMermaid,
} from "../databaseSidebarExport";

describe("databaseSidebarExport", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeTextFileMock.mockReset();
    getObjectDefinitionMock.mockReset();
    getTableStructureMock.mockReset();
    schemaToDBMLMock.mockReset();
    generateMermaidERDMock.mockReset();
  });

  it("exports selected object definitions to a SQL file", async () => {
    getObjectDefinitionMock
      .mockResolvedValueOnce("CREATE TABLE public.users (id int);")
      .mockResolvedValueOnce("CREATE VIEW public.active_users AS SELECT * FROM public.users;");
    saveMock.mockResolvedValue("/tmp/my-export.sql");
    writeTextFileMock.mockResolvedValue(undefined);

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
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/tmp/my-export.sql",
      expect.stringContaining("CREATE TABLE public.users (id int);"),
    );

    const writtenContent = writeTextFileMock.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("CREATE VIEW public.active_users AS SELECT * FROM public.users;");
    expect(writtenContent).toContain("-- TABLE public.users");
    expect(writtenContent).toContain("-- VIEW public.active_users");
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
    writeTextFileMock.mockResolvedValue(undefined);

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

    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      cancelled: true,
      itemCount: 1,
    });
  });

  it("exports selected objects as DBML file", async () => {
    const fakeStructure = { name: "users", schema: "public", columns: [] };
    getTableStructureMock.mockResolvedValue(fakeStructure);
    schemaToDBMLMock.mockResolvedValue({ dbml: "Table public.users {\n  id int [pk]\n}" });
    saveMock.mockResolvedValue("/tmp/export.dbml");
    writeTextFileMock.mockResolvedValue(undefined);

    const result = await exportSidebarObjectsAsDBML({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(result.success).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: ["dbml"] }),
        ]),
      }),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/tmp/export.dbml",
      expect.stringContaining("Table public.users"),
    );
  });

  it("exports selected objects as Mermaid ERD markdown", async () => {
    const fakeStructure = { name: "users", schema: "public", columns: [] };
    getTableStructureMock.mockResolvedValue(fakeStructure);
    generateMermaidERDMock.mockReturnValue("erDiagram\n    users {\n    }");
    saveMock.mockResolvedValue("/tmp/export.md");
    writeTextFileMock.mockResolvedValue(undefined);

    const result = await exportSidebarObjectsAsMermaid({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(result.success).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/tmp/export.md",
      expect.stringContaining("```mermaid"),
    );
  });

  it("returns cancelled when user dismisses DBML save dialog", async () => {
    saveMock.mockResolvedValue(null);

    const result = await exportSidebarObjectsAsDBML({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(result.cancelled).toBe(true);
    expect(getTableStructureMock).not.toHaveBeenCalled();
  });

  it("returns cancelled when user dismisses Mermaid save dialog", async () => {
    saveMock.mockResolvedValue(null);

    const result = await exportSidebarObjectsAsMermaid({
      connectionId: "conn-1",
      database: "appdb",
      items: [{ schema: "public", name: "users", objectType: "table" }],
    });

    expect(result.cancelled).toBe(true);
    expect(getTableStructureMock).not.toHaveBeenCalled();
  });
});
