import type { ColumnMeta } from "@/types/database";
import type { ForeignKeyInfo, Constraint } from "@/types/tableStructure";
import type { StructureGridRow } from "./types";

export function transformStructureToRows(
  columns: ColumnMeta[],
  foreignKeys: ForeignKeyInfo[],
  constraints: Constraint[],
): StructureGridRow[] {
  return columns.map((column, idx) => {
    const fkInfo = foreignKeys.find((fk) => fk.columns.includes(column.name));

    const checkConstraint = constraints.find((c) => {
      if ((c as any).columnName) {
        return (c as any).columnName === column.name;
      }
      if (!c.definition) return false;
      return new RegExp(`"?${column.name}"?`, "i").test(c.definition);
    });

    return {
      row_number: idx + 1,
      column_name: column.name,
      column_meta: {
        is_pk: column.is_pk ?? false,
        is_fk: column.is_fk ?? false,
      },
      db_type: column.db_type ?? "",
      nullable: column.nullable ? "YES" : "NO",
      default: column.default ?? "",
      foreign_key: fkInfo
        ? `${fkInfo.foreignTable}.${fkInfo.foreignColumns[0]}`
        : "",
      check_constraint: checkConstraint?.definition ?? "",
      comment: column.comment ?? "",
      _original: column,
    };
  });
}
