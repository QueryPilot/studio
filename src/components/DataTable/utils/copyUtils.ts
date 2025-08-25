/**
 * Utility functions for copying data in different formats
 */
import type { DataTableRow, CellValue } from "../types";

export function formatCellValue(value: CellValue | undefined): string {
  if (!value || value.value === null) return "NULL";

  switch (value.value_type) {
    case "Text":
    case "Uuid":
      return String(value.value);
    case "Integer":
      return String(value.value);
    case "Decimal":
      return String(value.value);
    case "Boolean":
      return value.value ? "true" : "false";
    case "Date":
    case "DateTime":
    case "Time":
      return String(value.value);
    case "Json":
    case "Array":
      return JSON.stringify(value.value);
    case "Binary":
      return `Binary(${value.byte_size || 0} bytes)`;
    case "Xml":
      return String(value.value);
    case "Enum":
      return String(value.value);
    case "Geometry":
      return JSON.stringify(value.value);
    default:
      return String(value.value);
  }
}

export function copyAsJson(
  rows: DataTableRow[],
  columns: Array<{ id: string; name: string }>,
): string {
  const data = rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col) => {
      const cellValue = row[col.id];
      obj[col.name] = cellValue?.value ?? null;
    });
    return obj;
  });

  return JSON.stringify(data, null, 2);
}

export function copyAsCsv(
  rows: DataTableRow[],
  columns: Array<{ id: string; name: string }>,
): string {
  const headers = columns.map((col) => col.name).join(",");

  const dataRows = rows.map((row) => {
    return columns
      .map((col) => {
        const cellValue = row[col.id];
        const value = formatCellValue(cellValue);

        // Escape values containing comma, quotes, or newlines
        if (
          value.includes(",") ||
          value.includes('"') ||
          value.includes("\n")
        ) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",");
  });

  return [headers, ...dataRows].join("\n");
}

export function copyAsInsert(
  rows: DataTableRow[],
  columns: Array<{ id: string; name: string }>,
  tableName: string = "table_name",
): string {
  const columnNames = columns.map((col) => `\`${col.name}\``).join(", ");

  const statements = rows.map((row) => {
    const values = columns
      .map((col) => {
        const cellValue = row[col.id];

        if (!cellValue || cellValue.value === null) {
          return "NULL";
        }

        switch (cellValue.value_type) {
          case "Text":
          case "Uuid":
          case "Date":
          case "DateTime":
          case "Time":
          case "Enum":
          case "Xml":
            return `'${String(cellValue.value).replace(/'/g, "''")}'`;
          case "Integer":
          case "Decimal":
            return String(cellValue.value);
          case "Boolean":
            return cellValue.value ? "TRUE" : "FALSE";
          case "Json":
          case "Array":
            return `'${JSON.stringify(cellValue.value).replace(/'/g, "''")}'`;
          case "Binary":
            return `X'${cellValue.value}'`; // Hex representation
          case "Geometry":
            return `ST_GeomFromText('${JSON.stringify(cellValue.value)}')`;
          default:
            return `'${String(cellValue.value).replace(/'/g, "''")}'`;
        }
      })
      .join(", ");

    return `INSERT INTO ${tableName} (${columnNames}) VALUES (${values});`;
  });

  return statements.join("\n");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy to clipboard:", err);
    return false;
  }
}
