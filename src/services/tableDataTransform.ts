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

  if (typeof rawValue === "number" || typeof rawValue === "bigint") {
    const normalizedType = dbType.toLowerCase();
    if (
      normalizedType.includes("int") ||
      normalizedType.includes("serial") ||
      typeof rawValue === "bigint"
    ) {
      return "Integer";
    }

    if (typeof rawValue === "number") {
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

    return "Integer";
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

function normalizeBackendValue(value: BackendCellValue): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeBackendValue(item));
  }

  if (typeof value === "object") {
    const normalizedEntries = Object.entries(value).map(([key, inner]) => [
      key,
      normalizeBackendValue(inner as BackendCellValue),
    ]);
    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

export function mapRowsToTableData(
  columns: ColumnMeta[],
  rawRows: BackendCellValue[][],
): TableDataRow[] {
  return rawRows.map((row) => {
    const tableRow: TableDataRow = {};
    columns.forEach((column, index) => {
      const rawValue = row[index];
      const metadata =
        typeof rawValue === "bigint"
          ? {
              attributes: {
                originalBigInt: rawValue.toString(),
              },
            }
          : undefined;
      const normalizedValue = normalizeBackendValue(rawValue);
      const cellValue: FrontCellValue = {
        value: normalizedValue ?? null,
        db_type: column.db_type,
        value_type: deriveValueType(rawValue, column.db_type),
        is_truncated: false,
        metadata,
      };
      tableRow[column.name] = cellValue;
    });
    return tableRow;
  });
}
