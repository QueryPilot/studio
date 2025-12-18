import type { GridColumnV2, GridRowModel } from "../types";
import { copyAsCSV, copyAsJSON, copyAsTSV } from "./copyUtils";

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
export function exportToCSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.csv",
): void {
  const content = copyAsCSV(rows, columns);
  downloadFile(content, filename, "text/csv;charset=utf-8;");
}

/**
 * Export rows as JSON file
 */
export function exportToJSON(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.json",
): void {
  const content = copyAsJSON(rows, columns);
  downloadFile(content, filename, "application/json;charset=utf-8;");
}

/**
 * Export rows as TSV file
 */
export function exportToTSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.tsv",
): void {
  const content = copyAsTSV(rows, columns);
  downloadFile(content, filename, "text/tab-separated-values;charset=utf-8;");
}

/**
 * Export rows as Excel file
 * For now, we'll export as CSV which Excel can open
 * In the future, we can use a library like xlsx for true .xlsx format
 */
export function exportToExcel(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  filename: string = "export.xlsx",
): void {
  // For now, export as CSV which Excel can open
  // To export true .xlsx format, we'd need to add the 'xlsx' package
  const csvFilename = filename.replace(/\.xlsx$/i, ".csv");
  exportToCSV(rows, columns, csvFilename);
}

/**
 * Get suggested filename based on table name and timestamp
 */
export function getSuggestedFilename(
  tableName: string,
  extension: "csv" | "json" | "tsv" | "xlsx",
): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  return `${tableName}_${timestamp}.${extension}`;
}
