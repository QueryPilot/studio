import type { ColumnDefinitionInput } from "@/types/crud";

export interface DesignerGridRow {
  row_number: number;
  column_name: string;
  column_meta: {
    is_pk: boolean;
    is_fk: boolean;
  };
  db_type: string;
  nullable: string;
  default: string;
  foreign_key: string;
  check_constraint: string;
  comment: string;
  _tempId: string;
}

export type DesignerModifiedField =
  | "column_name"
  | "db_type"
  | "nullable"
  | "default"
  | "foreign_key"
  | "check_constraint"
  | "comment";

export function getDesignerModifiedFields(
  row: DesignerGridRow,
  baseline: ColumnDefinitionInput | undefined,
  baselineForeignKey = "",
): Set<DesignerModifiedField> {
  const fields = new Set<DesignerModifiedField>();
  if (!baseline) {
    return fields;
  }

  const baselineName = baseline.name ?? "";
  if ((row.column_name ?? "") !== baselineName) {
    fields.add("column_name");
  }

  const baselineType = baseline.dataType ?? "VARCHAR(255)";
  if ((row.db_type ?? "") !== baselineType) {
    fields.add("db_type");
  }

  const baselineNullable = baseline.nullable === false ? "NO" : "YES";
  if (row.nullable !== baselineNullable) {
    fields.add("nullable");
  }

  const baselineDefault = normalizeValue(baseline.defaultValue);
  const rowDefault = normalizeValue(row.default);
  if (rowDefault !== baselineDefault) {
    fields.add("default");
  }

  const baselineComment = baseline.comment ?? "";
  if ((row.comment ?? "") !== baselineComment) {
    fields.add("comment");
  }

  const baselineCheck = baseline.checkExpression ?? "";
  if ((row.check_constraint ?? "") !== baselineCheck) {
    fields.add("check_constraint");
  }

  if ((row.foreign_key ?? "") !== baselineForeignKey) {
    fields.add("foreign_key");
  }

  return fields;
}

const normalizeValue = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);
