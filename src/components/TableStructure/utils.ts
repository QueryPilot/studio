import type { ColumnMeta } from "@/types/database";
import type { ForeignKeyInfo, Constraint } from "@/types/tableStructure";
import type { StructureGridRow } from "./types";
import type { CrudCommand, ColumnAddPayload } from "@/types/crud";

export function transformStructureToRows(
  columns: ColumnMeta[],
  foreignKeys: ForeignKeyInfo[],
  constraints: Constraint[],
  pendingCommands: CrudCommand[] = [],
): StructureGridRow[] {
  // Extract pending column operations by type
  const pendingAdds = pendingCommands.filter(
    (cmd) => cmd.type === "column.add",
  ) as CrudCommand<ColumnAddPayload>[];

  const pendingModifies = pendingCommands.filter(
    (cmd) => cmd.type === "column.modify",
  );

  const pendingDeletes = pendingCommands.filter(
    (cmd) => cmd.type === "column.drop",
  );

  const pendingRenames = pendingCommands.filter(
    (cmd) => cmd.type === "column.rename",
  );

  // Build lookup sets for quick checks
  const deletedColumnNames = new Set(
    pendingDeletes.map((cmd) => (cmd.payload as any).columnName as string),
  );

  // Transform actual columns first
  const actualRows: StructureGridRow[] = columns.map((column, idx) => {
    const fkInfo = foreignKeys.find((fk) => fk.columns.includes(column.name));

    const checkConstraint = constraints.find((c) => {
      if ((c as any).columnName) {
        return (c as any).columnName === column.name;
      }
      if (!c.definition) return false;
      return new RegExp(`"?${column.name}"?`, "i").test(c.definition);
    });

    // Check if there's a pending modify command for this column
    const modifyCmd = pendingModifies.find(
      (cmd) => (cmd.payload as any).columnName === column.name,
    );

    // Check if there's a pending rename command for this column
    const renameCmd = pendingRenames.find(
      (cmd) => (cmd.payload as any).columnName === column.name,
    );

    // Check if column is marked for deletion
    const isPendingDelete = deletedColumnNames.has(column.name);

    let displayName = column.name;
    let dbType = column.db_type ?? "";
    let nullable = column.nullable ? "YES" : "NO";
    let defaultValue = column.default; // Keep null/undefined as-is
    let comment = column.comment ?? "";

    // Apply pending rename
    if (renameCmd) {
      displayName = (renameCmd.payload as any).newName ?? column.name;
    }

    // Apply pending modifications
    if (modifyCmd) {
      const newDef = (modifyCmd.payload as any).newDefinition;
      if (newDef.dataType !== undefined) {
        dbType = newDef.dataType;
      }
      if (newDef.nullable !== undefined) {
        nullable = newDef.nullable ? "YES" : "NO";
      }
      if (newDef.defaultValue !== undefined) {
        defaultValue = newDef.defaultValue; // Keep null as-is
      }
      if (newDef.comment !== undefined) {
        comment = String(newDef.comment ?? "");
      }
    }

    return {
      row_number: idx + 1,
      column_name: displayName,
      column_meta: {
        is_pk: column.is_pk ?? false,
        is_fk: column.is_fk ?? false,
      },
      db_type: dbType,
      nullable: nullable,
      default: defaultValue,
      foreign_key: fkInfo
        ? `${fkInfo.foreignTable}.${fkInfo.foreignColumns[0]}`
        : "",
      check_constraint: checkConstraint?.definition ?? "",
      comment: comment,
      _original: column,
      _isModified: !!(modifyCmd || renameCmd), // Mark row as modified
      _isPendingDelete: isPendingDelete, // Mark row for deletion
    };
  });

  // Create virtual rows for pending additions (at bottom)
  const virtualRows: StructureGridRow[] = pendingAdds.map((cmd, idx) => {
    const col = cmd.payload.column;
    return {
      row_number: actualRows.length + idx + 1,
      column_name: col.name || "(new column)",
      column_meta: {
        is_pk: col.isPrimaryKey ?? false,
        is_fk: false,
      },
      db_type: col.dataType || "text",
      nullable: col.nullable ? "YES" : "NO",
      default: col.defaultValue != null ? String(col.defaultValue) : null,
      foreign_key: "",
      check_constraint: col.checkExpression ?? "",
      comment: col.comment ?? "",
      _tempId: cmd.payload.tempId,
      _isPending: true,
    };
  });

  // Merge: actual columns first, then pending additions at bottom
  return [...actualRows, ...virtualRows];
}
