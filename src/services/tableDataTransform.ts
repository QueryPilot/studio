import type {
  ColumnMeta as BackendColumnMeta,
  CellValue as BackendCellValue,
} from "./backend";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "./tableDataTypes";
import type { CellValue as FrontCellValue } from "@/types/cellValue";

export function mapBackendColumnsToColumnMeta(
  columns: BackendColumnMeta[],
): ColumnMeta[] {
  return columns.map((col, index) => ({
    name: col.name,
    db_type: col.db_type,
    nullable: col.nullable,
    default:
      (col as unknown as { default_value?: string | null }).default_value ??
      null,
    is_pk: col.primary_key,
    is_fk: false,
    ordinal: index,
    precision: null,
    scale: null,
    comment: (col as unknown as { comment?: string | null }).comment ?? null,
    enum_values: (col as unknown as { enum_values?: string[] }).enum_values,
    type_category: (col as unknown as { type_category?: string }).type_category,
  }));
}

function deriveValueType(
  rawValue: BackendCellValue | undefined,
  dbType: string,
): FrontCellValue["value_type"] {
  if (rawValue === null || rawValue === undefined) {
    return "Null";
  }

  if (typeof rawValue === "boolean") {
    return "Boolean";
  }

  if (typeof rawValue === "number") {
    const normalizedType = dbType.toLowerCase();
    if (normalizedType.includes("int") || normalizedType.includes("serial")) {
      return "Integer";
    }
    if (
      normalizedType.includes("timestamp") ||
      normalizedType.includes("time")
    ) {
      return "DateTime";
    }
    if (normalizedType.includes("date")) {
      return "Date";
    }
    return "Decimal";
  }

  if (Array.isArray(rawValue)) {
    const normalizedType = dbType.toLowerCase();
    if (
      normalizedType.includes("bytea") ||
      normalizedType.includes("blob") ||
      normalizedType.includes("binary")
    ) {
      return "Binary";
    }
    return "Array";
  }

  if (typeof rawValue === "object") {
    return "Json";
  }

  return "Text";
}

export function mapRowsToTableData(
  columns: ColumnMeta[],
  rawRows: BackendCellValue[][],
): TableDataRow[] {
  return rawRows.map((row) => {
    const tableRow: TableDataRow = {};
    columns.forEach((column, index) => {
      const rawValue = row[index];
      const cellValue: FrontCellValue = {
        value: rawValue ?? null,
        db_type: column.db_type,
        value_type: deriveValueType(rawValue, column.db_type),
        is_truncated: false,
      };
      tableRow[column.name] = cellValue;
    });
    return tableRow;
  });
}
