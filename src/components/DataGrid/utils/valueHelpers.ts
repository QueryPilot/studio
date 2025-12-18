import type { CellValue, CellValueType } from "@/types";

export const inferValueType = (value: unknown): CellValueType => {
  if (value === null) return "Null";
  switch (typeof value) {
    case "boolean":
      return "Boolean";
    case "number":
      return Number.isInteger(value) ? "Integer" : "Decimal";
    case "object":
      return Array.isArray(value) ? "Array" : "Json";
    default:
      return "Text";
  }
};

export const toCellValue = (
  value: unknown,
  dbType: string | undefined,
): CellValue => ({
  value,
  db_type: dbType ?? typeof value,
  value_type: inferValueType(value),
  is_truncated: false,
});
