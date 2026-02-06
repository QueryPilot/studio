import type { QueryColumnMeta, RawCellValue } from "./backend";
import type { ColumnMeta } from "@/types/schema";
import type { TableDataRow } from "./tableDataTypes";
import type { GridCellValue, GridCellValueType } from "@/types/cellValue";

export function mapBackendColumnsToColumnMeta(
  columns: QueryColumnMeta[],
): ColumnMeta[] {
  // The backend (Rust) serializes with serde(rename_all = "camelCase"),
  // so JSON keys are camelCase (dbType, primaryKey, etc.) while the TS
  // interface uses snake_case. Access both to handle the mismatch.
  return columns.map((col, index) => {
    const raw = col as unknown as Record<string, unknown>;
    return {
      name: col.name,
      db_type: col.db_type || (raw.dbType as string) || "",
      nullable: col.nullable ?? (raw.nullable as boolean) ?? true,
      default:
        (raw.default_value as string | null) ??
        (raw.defaultValue as string | null) ??
        null,
      is_pk: col.primary_key ?? (raw.primaryKey as boolean) ?? false,
      is_fk: false,
      ordinal: index,
      precision: null,
      scale: null,
      comment: (raw.comment as string | null) ?? null,
      enum_values: (raw.enum_values as string[]) ?? (raw.enumValues as string[]),
      set_values: (raw.set_values as string[]) ?? (raw.setValues as string[]),
      type_category: (raw.type_category as string) ?? (raw.typeCategory as string),
    };
  });
}

export function deriveValueType(
  rawValue: RawCellValue | undefined,
  dbType: string,
): GridCellValueType {
  if (rawValue === null || rawValue === undefined) {
    return "Null";
  }

  if (typeof rawValue === "boolean") {
    return "Boolean";
  }

  if (typeof rawValue === "number" || typeof rawValue === "bigint") {
    const normalizedType = (dbType || "").toLowerCase();
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
    const normalizedType = (dbType || "").toLowerCase();
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

export function normalizeBackendValue(
  value: RawCellValue | undefined,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    // BigInt from MessagePack i64 -> convert to string for Decimal.js
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeBackendValue(item));
  }

  if (typeof value === "object") {
    const normalizedEntries = Object.entries(value).map(([key, inner]) => {
      const normalized = normalizeBackendValue(
        inner as RawCellValue | undefined,
      );
      return [key, normalized];
    });
    return Object.fromEntries(normalizedEntries);
  }

  // Numbers and strings pass through as-is
  // Strings are important for BIGINT values sent from Rust to preserve precision
  return value;
}

export function mapRowsToTableData(
  columns: ColumnMeta[],
  rawRows: RawCellValue[][],
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
      const cellValue: GridCellValue = {
        value: normalizedValue ?? null,
        db_type: column.db_type,
        value_type: deriveValueType(rawValue, column.db_type),
        is_truncated: false,
        metadata,
      };
      // Use index-based key to handle duplicate column names in JOINs
      tableRow[`col_${index}`] = cellValue;
    });
    return tableRow;
  });
}
