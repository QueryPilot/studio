import type { QueryColumnMeta } from "@/services/backend";

const EXCLUDED_PATTERNS = [
  /^.*_id$/i,
  /^.*_at$/i,
  /^uuid$/i,
  /^id$/i,
  /^created_.*$/i,
  /^updated_.*$/i,
  /^deleted_.*$/i,
  /^.*_uuid$/i,
  /^guid$/i,
  /^.*_guid$/i,
];

export function isExcludedColumn(columnName: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(columnName));
}

export function filterMeaningfulColumns(
  columns: QueryColumnMeta[],
  maxColumns: number = 7,
): QueryColumnMeta[] {
  const pkColumns = columns.filter((col) => col.primary_key);
  const nonPkColumns = columns.filter((col) => !col.primary_key);
  const meaningfulColumns = nonPkColumns.filter(
    (col) => !isExcludedColumn(col.name),
  );

  const selected: QueryColumnMeta[] = [];

  pkColumns.forEach((col) => selected.push(col));

  const remaining = maxColumns - selected.length;
  meaningfulColumns.slice(0, remaining).forEach((col) => selected.push(col));

  return selected;
}

export function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string")
    return `'${value.replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
  if (typeof value === "bigint") return String(value);
  return `'${String(value).replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
}
