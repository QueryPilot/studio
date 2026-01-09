import { logger } from "@/lib/logger";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

export interface ExportOptions {
  delimiter?: "," | ";" | "\t";
  includeHeaders?: boolean;
  encoding?: "utf-8";
}

export interface ExportResult {
  success: boolean;
  rowCount: number;
  error?: string;
}

function escapeCSVValue(val: unknown, delimiter: string): string {
  if (val === null || val === undefined) return "";

  let str: string;
  if (typeof val === "string") {
    str = val;
  } else if (typeof val === "number" || typeof val === "boolean") {
    str = String(val);
  } else if (typeof val === "object") {
    str = JSON.stringify(val);
  } else {
    str = val as string;
  }

  if (
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateCSV(
  rows: unknown[][],
  columns: string[],
  options: ExportOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const includeHeaders = options.includeHeaders ?? true;

  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(columns.map((col) => escapeCSVValue(col, delimiter)).join(delimiter));
  }

  for (const row of rows) {
    lines.push(row.map((val) => escapeCSVValue(val, delimiter)).join(delimiter));
  }

  return lines.join("\n");
}

export function getDelimiterName(delimiter: "," | ";" | "\t"): string {
  switch (delimiter) {
    case ",":
      return "Comma";
    case ";":
      return "Semicolon";
    case "\t":
      return "Tab";
    default:
      return "Unknown";
  }
}

export function downloadCSV(
  csvContent: string,
  filename = "export.csv",
): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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

export async function exportToCSV(
  rows: unknown[][],
  columns: string[],
  options: ExportOptions = {},
  filename = "export.csv",
): Promise<ExportResult> {
  try {
    const csvContent = generateCSV(rows, columns, options);

    if (isTauri()) {
      // Use native save dialog in Tauri
      const filePath = await save({
        defaultPath: filename,
        filters: [
          {
            name: "CSV Files",
            extensions: ["csv"],
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
        contents: csvContent,
      });

      logger.info(`[CSV Export] Exported ${rows.length} rows to ${filePath}`);
    } else {
      // Fallback to browser download
      downloadCSV(csvContent, filename);
      logger.info(`[CSV Export] Exported ${rows.length} rows`);
    }

    return { success: true, rowCount: rows.length };
  } catch (err) {
    logger.error("[CSV Export] Failed to export CSV", err);
    return {
      success: false,
      rowCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
