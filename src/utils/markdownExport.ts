/**
 * Markdown table export utilities
 */
import { writeClipboardText } from "@/lib/clipboard";

export interface MarkdownExportOptions {
  alignNumeric?: "left" | "center" | "right";
  maxColumnWidth?: number;
}

/**
 * Escape markdown special characters in cell values
 */
function escapeMarkdown(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
    .replace(/\r/g, "");
}

/**
 * Format a cell value for markdown
 */
function formatCellValue(value: unknown, maxWidth?: number): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  let str: string;
  if (typeof value === "object") {
    str = JSON.stringify(value);
  } else if (typeof value === "boolean") {
    str = value ? "true" : "false";
  } else {
    str = String(value);
  }

  const escaped = escapeMarkdown(str);

  if (maxWidth && escaped.length > maxWidth) {
    return escaped.slice(0, maxWidth - 3) + "...";
  }

  return escaped;
}

/**
 * Detect if a column contains primarily numeric values
 */
function isNumericColumn(rows: unknown[][], columnIndex: number): boolean {
  const nonNullValues = rows
    .map((row) => row[columnIndex])
    .filter((v) => v !== null && v !== undefined);

  if (nonNullValues.length === 0) {
    return false;
  }

  const numericCount = nonNullValues.filter((v) => typeof v === "number").length;
  return numericCount / nonNullValues.length > 0.5;
}

/**
 * Generate markdown table from rows and columns
 */
export function generateMarkdownTable(
  rows: unknown[][],
  columns: string[],
  options: MarkdownExportOptions = {},
): string {
  const { alignNumeric = "right", maxColumnWidth } = options;

  if (columns.length === 0) {
    return "";
  }

  // Detect numeric columns for alignment
  const columnTypes = columns.map((_, i) => isNumericColumn(rows, i));

  // Generate header row
  const headerCells = columns.map((col) => escapeMarkdown(col));
  const headerRow = `| ${headerCells.join(" | ")} |`;

  // Generate separator row with alignment
  const separatorCells = columnTypes.map((isNumeric) => {
    if (isNumeric) {
      switch (alignNumeric) {
        case "left":
          return ":---";
        case "center":
          return ":---:";
        case "right":
          return "---:";
      }
    }
    return "---";
  });
  const separatorRow = `| ${separatorCells.join(" | ")} |`;

  // Generate data rows
  const dataRows = rows.map((row) => {
    const cells = columns.map((_, i) => formatCellValue(row[i], maxColumnWidth));
    return `| ${cells.join(" | ")} |`;
  });

  return [headerRow, separatorRow, ...dataRows].join("\n");
}

export interface MarkdownExportResult {
  success: boolean;
  rowCount: number;
  error?: string;
}

/**
 * Copy data as markdown table to clipboard
 */
export async function copyMarkdownToClipboard(
  rows: unknown[][],
  columns: string[],
  options: MarkdownExportOptions = {},
): Promise<MarkdownExportResult> {
  try {
    if (columns.length === 0) {
      return { success: false, rowCount: 0, error: "No columns to export" };
    }

    const markdown = generateMarkdownTable(rows, columns, options);

    await writeClipboardText(markdown);

    return { success: true, rowCount: rows.length };
  } catch (error) {
    return {
      success: false,
      rowCount: 0,
      error: error instanceof Error ? error.message : "Failed to copy to clipboard",
    };
  }
}
