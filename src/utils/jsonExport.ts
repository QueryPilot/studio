import { logger } from "@/lib/logger";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

export type JsonFormat = "pretty" | "compact";

export interface JsonExportOptions {
  format?: JsonFormat;
}

export interface JsonExportResult {
  success: boolean;
  rowCount: number;
  error?: string;
}

function convertRowsToObjects(
  rows: unknown[][],
  columns: string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

export function generateJSON(
  rows: unknown[][],
  columns: string[],
  options: JsonExportOptions = {},
): string {
  const format = options.format ?? "pretty";
  const objects = convertRowsToObjects(rows, columns);

  if (format === "compact") {
    return JSON.stringify(objects);
  }

  return JSON.stringify(objects, null, 2);
}

export function downloadJSON(
  jsonContent: string,
  filename = "export.json",
): void {
  const blob = new Blob([jsonContent], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportToJSON(
  rows: unknown[][],
  columns: string[],
  options: JsonExportOptions = {},
  filename = "export.json",
): Promise<JsonExportResult> {
  try {
    const jsonContent = generateJSON(rows, columns, options);

    if (isTauri()) {
      // Use native save dialog in Tauri
      const filePath = await save({
        defaultPath: filename,
        filters: [
          {
            name: "JSON Files",
            extensions: ["json"],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        return { success: false, rowCount: 0, error: "Export cancelled" };
      }

      // Write file using Tauri
      await invoke("plugin:fs|write_text_file", {
        path: filePath,
        contents: jsonContent,
      });

      logger.info(`[JSON Export] Exported ${rows.length} rows to ${filePath} as ${options.format ?? "pretty"}`);
    } else {
      // Fallback to browser download
      downloadJSON(jsonContent, filename);
      logger.info(`[JSON Export] Exported ${rows.length} rows as ${options.format ?? "pretty"}`);
    }

    return { success: true, rowCount: rows.length };
  } catch (err) {
    logger.error("[JSON Export] Failed to export JSON", err);
    return {
      success: false,
      rowCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
