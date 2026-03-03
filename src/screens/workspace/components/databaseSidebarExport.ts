import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ObjectDefinitionType } from "@/adapters/types";
import type { DatabaseAdapter } from "@/adapters/types";
import { getAdapterForConnection } from "@/adapters";
import { BackendAPI } from "@/services/backend";
import { databaseService } from "@/services/databaseService";
import { dbmlService } from "@/services/dbmlService";
import { generateMermaidERD } from "@/utils/mermaidExport";
import type { TableStructure } from "@/types/tableStructure";
import { generateCSV } from "@/utils/csvExport";
import { generateJSON } from "@/utils/jsonExport";
import { generateInsertStatements } from "@/utils/sqlInsertExport";
import { generateMarkdownTable } from "@/utils/markdownExport";
import type { DbType } from "@/types/connection";
import { isTauri } from "@/utils/tauri";

export interface SidebarExportItem {
  schema: string;
  name: string;
  objectType: ObjectDefinitionType;
}

export interface ExportSidebarObjectsParams {
  connectionId: string;
  database: string | null;
  items: SidebarExportItem[];
}

export interface ExportSidebarObjectsResult {
  success: boolean;
  cancelled: boolean;
  itemCount: number;
  filePath?: string;
}

export type SidebarDataExportFormat = "csv" | "json" | "insert" | "markdown";

export interface SidebarDataExportItem {
  schema: string;
  name: string;
  objectType: "table" | "view" | "materialized_view";
}

export interface ExportSidebarDataParams {
  connectionId: string;
  database: string | null;
  dbType: DbType | string;
  item: SidebarDataExportItem;
  format: SidebarDataExportFormat;
}

export interface ExportSidebarDataResult {
  success: boolean;
  cancelled: boolean;
  rowCount: number;
  filePath?: string;
}

function objectTypeLabel(objectType: ObjectDefinitionType): string {
  if (objectType === "materialized_view") {
    return "MATERIALIZED VIEW";
  }
  return objectType.toUpperCase();
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function buildTimestamp(date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${day}-${time}`;
}

function extensionForDataFormat(format: SidebarDataExportFormat): string {
  switch (format) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "insert":
      return "sql";
    case "markdown":
      return "md";
  }
}

function dialogFilterForDataFormat(
  format: SidebarDataExportFormat,
): { name: string; extensions: string[] } {
  switch (format) {
    case "csv":
      return { name: "CSV Files", extensions: ["csv"] };
    case "json":
      return { name: "JSON Files", extensions: ["json"] };
    case "insert":
      return { name: "SQL Files", extensions: ["sql"] };
    case "markdown":
      return { name: "Markdown Files", extensions: ["md"] };
  }
}

function buildDataDefaultFilename(
  database: string | null,
  item: SidebarDataExportItem,
  format: SidebarDataExportFormat,
): string {
  const dbName = sanitizeFileSegment(database || "database");
  const schema = sanitizeFileSegment(item.schema);
  const objectName = sanitizeFileSegment(item.name);
  const timestamp = buildTimestamp(new Date());
  const extension = extensionForDataFormat(format);
  return `${dbName}.${schema}.${objectName}-${timestamp}.${extension}`;
}

function buildDataExportContent(
  rows: unknown[][],
  columns: string[],
  item: SidebarDataExportItem,
  dbType: DbType | string,
  format: SidebarDataExportFormat,
): string {
  switch (format) {
    case "csv":
      return generateCSV(rows, columns, {
        delimiter: ",",
        includeHeaders: true,
        encoding: "utf-8",
      });
    case "json":
      return generateJSON(rows, columns, {
        format: "pretty",
      });
    case "insert":
      return generateInsertStatements(rows, columns, {
        tableName: item.name,
        schema: item.schema,
        databaseType: dbType,
        batchMode: true,
      });
    case "markdown":
      return generateMarkdownTable(rows, columns, {
        alignNumeric: "right",
      });
  }
}

function queryPayloadToSql(payload: string | object): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object") {
    const sqlCandidate = (payload as { sql?: unknown }).sql;
    if (typeof sqlCandidate === "string") {
      return sqlCandidate;
    }
  }

  throw new Error("Failed to generate SQL for sidebar data export");
}

async function fetchTableStructures(
  connectionId: string,
  database: string | null,
  items: SidebarExportItem[],
): Promise<TableStructure[]> {
  const structures: TableStructure[] = [];
  for (const item of items) {
    const structure = await databaseService.getTableStructure(
      connectionId,
      database ?? "",
      item.schema,
      item.name,
      { includeIndexes: true, includeForeignKeys: true },
    );
    structures.push(structure);
  }
  return structures;
}

function buildDefaultFilename(
  database: string | null,
  items: SidebarExportItem[],
): string {
  const dbName = sanitizeFileSegment(database || "database");
  const primaryItem = items[0];
  const timestamp = buildTimestamp(new Date());

  if (!primaryItem) {
    return `${dbName}.export-${timestamp}.sql`;
  }

  const schema = sanitizeFileSegment(primaryItem.schema);
  const objectName = sanitizeFileSegment(primaryItem.name);
  return `${dbName}.${schema}.${objectName}-${timestamp}.sql`;
}

function buildDBMLDefaultFilename(
  database: string | null,
  items: SidebarExportItem[],
): string {
  const dbName = sanitizeFileSegment(database || "database");
  const primaryItem = items[0];
  const timestamp = buildTimestamp(new Date());
  if (!primaryItem) return `${dbName}.export-${timestamp}.dbml`;
  const schema = sanitizeFileSegment(primaryItem.schema);
  const objectName = sanitizeFileSegment(primaryItem.name);
  return `${dbName}.${schema}.${objectName}-${timestamp}.dbml`;
}

function buildMermaidDefaultFilename(
  database: string | null,
  items: SidebarExportItem[],
): string {
  const dbName = sanitizeFileSegment(database || "database");
  const primaryItem = items[0];
  const timestamp = buildTimestamp(new Date());
  if (!primaryItem) return `${dbName}.export-${timestamp}.md`;
  const schema = sanitizeFileSegment(primaryItem.schema);
  const objectName = sanitizeFileSegment(primaryItem.name);
  return `${dbName}.${schema}.${objectName}-erd-${timestamp}.md`;
}

function buildExportContent(
  database: string | null,
  definitions: Array<{ item: SidebarExportItem; definition: string }>,
): string {
  const lines: string[] = [
    "-- Query Pilot export",
    `-- Generated at: ${new Date().toISOString()}`,
    `-- Database: ${database ?? "(none)"}`,
    "",
  ];

  for (const { item, definition } of definitions) {
    lines.push(`-- ${objectTypeLabel(item.objectType)} ${item.schema}.${item.name}`);
    lines.push(definition.trimEnd());
    lines.push("");
  }

  return lines.join("\n");
}

function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/sql;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportSidebarObjectsToFile({
  connectionId,
  database,
  items,
}: ExportSidebarObjectsParams): Promise<ExportSidebarObjectsResult> {
  const defaultFilename = buildDefaultFilename(database, items);

  const resolveContent = async (): Promise<string> => {
    const definitions: Array<{ item: SidebarExportItem; definition: string }> =
      [];

    for (const item of items) {
      const definition = await databaseService.getObjectDefinition(
        connectionId,
        database ?? "",
        item.schema,
        item.name,
        item.objectType,
      );
      definitions.push({ item, definition });
    }

    return buildExportContent(database, definitions);
  };

  if (isTauri()) {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [
        { name: "SQL Files", extensions: ["sql"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!filePath) {
      return {
        success: false,
        cancelled: true,
        itemCount: items.length,
      };
    }

    const content = await resolveContent();
    await invoke("plugin:fs|write_text_file", {
      path: filePath,
      contents: content,
    });

    return {
      success: true,
      cancelled: false,
      itemCount: items.length,
      filePath,
    };
  }

  const content = await resolveContent();
  downloadFile(content, defaultFilename);

  return {
    success: true,
    cancelled: false,
    itemCount: items.length,
  };
}

export async function exportSidebarObjectDataToFile({
  connectionId,
  database,
  dbType,
  item,
  format,
}: ExportSidebarDataParams): Promise<ExportSidebarDataResult> {
  const defaultFilename = buildDataDefaultFilename(database, item, format);
  const fileFilter = dialogFilterForDataFormat(format);

  if (isTauri()) {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [fileFilter, { name: "All Files", extensions: ["*"] }],
    });

    if (!filePath) {
      return {
        success: false,
        cancelled: true,
        rowCount: 0,
      };
    }

    const adapter = await getAdapterForConnection(connectionId);
    if (adapter.paradigm !== "sql") {
      throw new Error("Data export is only supported for SQL connections");
    }
    const sqlAdapter = adapter as DatabaseAdapter;
    const sql = queryPayloadToSql(sqlAdapter.select({
      schema: item.schema,
      table: item.name,
    }));
    const result = await BackendAPI.query(connectionId, sql);
    const columns = result.columns.map((column) => column.name);
    const rows = result.rows as unknown[][];
    const content = buildDataExportContent(rows, columns, item, dbType, format);

    await invoke("plugin:fs|write_text_file", {
      path: filePath,
      contents: content,
    });

    return {
      success: true,
      cancelled: false,
      rowCount: rows.length,
      filePath,
    };
  }

  const adapter = await getAdapterForConnection(connectionId);
  if (adapter.paradigm !== "sql") {
    throw new Error("Data export is only supported for SQL connections");
  }
  const sqlAdapter = adapter as DatabaseAdapter;
  const sql = queryPayloadToSql(sqlAdapter.select({
    schema: item.schema,
    table: item.name,
  }));
  const result = await BackendAPI.query(connectionId, sql);
  const columns = result.columns.map((column) => column.name);
  const rows = result.rows as unknown[][];
  const content = buildDataExportContent(rows, columns, item, dbType, format);
  downloadFile(content, defaultFilename);

  return {
    success: true,
    cancelled: false,
    rowCount: rows.length,
  };
}

export async function exportSidebarObjectsAsDBML({
  connectionId,
  database,
  items,
}: ExportSidebarObjectsParams): Promise<ExportSidebarObjectsResult> {
  const defaultFilename = buildDBMLDefaultFilename(database, items);

  const resolveContent = async (): Promise<string> => {
    const structures = await fetchTableStructures(connectionId, database, items);
    const dbmlResult = await dbmlService.schemaToDBML(structures);
    return dbmlResult.dbml;
  };

  if (isTauri()) {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [
        { name: "DBML Files", extensions: ["dbml"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!filePath) {
      return { success: false, cancelled: true, itemCount: items.length };
    }

    const content = await resolveContent();
    await invoke("plugin:fs|write_text_file", { path: filePath, contents: content });
    return { success: true, cancelled: false, itemCount: items.length, filePath };
  }

  const content = await resolveContent();
  downloadFile(content, defaultFilename);
  return { success: true, cancelled: false, itemCount: items.length };
}

export async function exportSidebarObjectsAsMermaid({
  connectionId,
  database,
  items,
}: ExportSidebarObjectsParams): Promise<ExportSidebarObjectsResult> {
  const defaultFilename = buildMermaidDefaultFilename(database, items);

  const resolveContent = async (): Promise<string> => {
    const structures = await fetchTableStructures(connectionId, database, items);
    const erd = generateMermaidERD(structures);
    return `# ERD — ${database ?? "database"}\n\n\`\`\`mermaid\n${erd}\n\`\`\`\n`;
  };

  if (isTauri()) {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [
        { name: "Markdown Files", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!filePath) {
      return { success: false, cancelled: true, itemCount: items.length };
    }

    const content = await resolveContent();
    await invoke("plugin:fs|write_text_file", { path: filePath, contents: content });
    return { success: true, cancelled: false, itemCount: items.length, filePath };
  }

  const content = await resolveContent();
  downloadFile(content, defaultFilename);
  return { success: true, cancelled: false, itemCount: items.length };
}
