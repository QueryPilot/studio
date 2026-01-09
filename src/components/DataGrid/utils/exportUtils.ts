import type { GridColumnV2, GridRowModel } from "../types";
import { copyAsCSV, copyAsJSON, copyAsTSV } from "./copyUtils";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri";
import { generateMarkdownTable } from "@/utils/markdownExport";

/**
 * Trigger browser download for a file
 */
function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export rows as CSV file
 */
export async function exportToCSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.csv",
): Promise<void> {
  try {
    const content = copyAsCSV(rows, columns);
    
    if (isTauri()) {
      const filePath = await save({
        defaultPath: filename,
        filters: [
          { name: "CSV Files", extensions: ["csv"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (filePath) {
        await invoke("plugin:fs|write_text_file", {
          path: filePath,
          contents: content,
        });
      }
    } else {
      downloadFile(content, filename, "text/csv;charset=utf-8;");
    }
  } catch (error) {
    console.error("exportToCSV error:", error);
    throw new Error(
      `Failed to export CSV: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export rows as JSON file
 */
export async function exportToJSON(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.json",
): Promise<void> {
  try {
    const content = copyAsJSON(rows, columns);
    
    if (isTauri()) {
      const filePath = await save({
        defaultPath: filename,
        filters: [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (filePath) {
        await invoke("plugin:fs|write_text_file", {
          path: filePath,
          contents: content,
        });
      }
    } else {
      downloadFile(content, filename, "application/json;charset=utf-8;");
    }
  } catch (error) {
    console.error("exportToJSON error:", error);
    throw new Error(
      `Failed to export JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export rows as TSV file
 */
export async function exportToTSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.tsv",
): Promise<void> {
  try {
    const content = copyAsTSV(rows, columns);
    
    if (isTauri()) {
      const filePath = await save({
        defaultPath: filename,
        filters: [
          { name: "TSV Files", extensions: ["tsv"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (filePath) {
        await invoke("plugin:fs|write_text_file", {
          path: filePath,
          contents: content,
        });
      }
    } else {
      downloadFile(content, filename, "text/tab-separated-values;charset=utf-8;");
    }
  } catch (error) {
    console.error("exportToTSV error:", error);
    throw new Error(
      `Failed to export TSV: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export rows as Markdown table file
 */
export async function exportToMarkdown(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.md",
): Promise<void> {
  try {
    const columnNames = columns.map(col => col.name);
    const rowData = rows.map(row => columnNames.map(name => row[name]));
    const content = generateMarkdownTable(rowData, columnNames, { alignNumeric: "right" });
    
    if (isTauri()) {
      const filePath = await save({
        defaultPath: filename,
        filters: [
          { name: "Markdown Files", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (filePath) {
        await invoke("plugin:fs|write_text_file", {
          path: filePath,
          contents: content,
        });
      }
    } else {
      downloadFile(content, filename, "text/markdown;charset=utf-8;");
    }
  } catch (error) {
    console.error("exportToMarkdown error:", error);
    throw new Error(
      `Failed to export Markdown: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export rows as Excel file
 * For now, we'll export as CSV which Excel can open
 * In the future, we can use a library like xlsx for true .xlsx format
 */
export async function exportToExcel(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.xlsx",
): Promise<void> {
  // For now, export as CSV which Excel can open
  // To export true .xlsx format, we'd need to add the 'xlsx' package
  const csvFilename = filename.replace(/\.xlsx$/i, ".csv");
  await exportToCSV(rows, columns, csvFilename);
}

/**
 * Get suggested filename based on table name and timestamp
 */
export function getSuggestedFilename(
  tableName: string,
  extension: "csv" | "json" | "tsv" | "xlsx" | "md",
): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  return `${tableName}_${timestamp}.${extension}`;
}
