import type { ColumnMeta } from "@/types/database";
import type { ForeignKeyInfo, Constraint } from "@/types/tableStructure";

export type StructureModifiedField =
  | "column_name"
  | "db_type"
  | "nullable"
  | "default"
  | "foreign_key"
  | "check_constraint"
  | "comment";

export function buildStructureModifiedFieldsMap(
  pendingCommands: CrudCommand[],
  foreignKeys: ForeignKeyInfo[],
): Map<string, Set<StructureModifiedField>> {
  const map = new Map<string, Set<StructureModifiedField>>();
  const fkByConstraint = new Map<string, string[]>();

  foreignKeys.forEach((fk) => {
    fkByConstraint.set(fk.name, fk.columns);
  });

  const addField = (
    columnName: string | undefined,
    field: StructureModifiedField,
  ) => {
    if (!columnName) return;
    const existing = map.get(columnName);
    if (existing) {
      existing.add(field);
      return;
    }
    map.set(columnName, new Set([field]));
  };

  pendingCommands.forEach((command) => {
    switch (command.type) {
      case "column.rename": {
        const payload = command.payload as { columnName?: string };
        addField(payload.columnName, "column_name");
        break;
      }
      case "column.modify": {
        const payload = command.payload as {
          columnName?: string;
          newDefinition?: {
            name?: string;
            dataType?: string;
            nullable?: boolean;
            defaultValue?: unknown;
            comment?: string;
            checkExpression?: string;
            length?: number;
            precision?: number;
            scale?: number;
          };
        };
        const columnName = payload.columnName;
        const def = payload.newDefinition ?? {};
        if (def.name !== undefined) addField(columnName, "column_name");
        if (
          def.dataType !== undefined ||
          def.length !== undefined ||
          def.precision !== undefined ||
          def.scale !== undefined
        ) {
          addField(columnName, "db_type");
        }
        if (def.nullable !== undefined) addField(columnName, "nullable");
        if (def.defaultValue !== undefined) addField(columnName, "default");
        if (def.comment !== undefined) addField(columnName, "comment");
        if (def.checkExpression !== undefined) {
          addField(columnName, "check_constraint");
        }
        break;
      }
      case "fk.add": {
        const payload = command.payload as {
          definition?: { columns?: string[] };
        };
        (payload.definition?.columns ?? []).forEach((columnName) => {
          addField(columnName, "foreign_key");
        });
        break;
      }
      case "fk.drop": {
        const payload = command.payload as { constraintName?: string };
        const columns = payload.constraintName
          ? fkByConstraint.get(payload.constraintName)
          : undefined;
        (columns ?? []).forEach((columnName) => {
          addField(columnName, "foreign_key");
        });
        break;
      }
      default:
        break;
    }
  });

  return map;
}
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

  const pendingFkAdds = pendingCommands.filter((cmd) => cmd.type === "fk.add");

  const pendingFkDrops = pendingCommands.filter(
    (cmd) => cmd.type === "fk.drop",
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
    let dbType = column.db_type;
    let nullable = column.nullable ? "YES" : "NO";
    let defaultValue = column.default; // Keep null/undefined as-is
    let comment = column.comment ?? "";
    let checkConstraintValue = checkConstraint?.definition ?? "";
    const baseForeignTable = fkInfo
      ? fkInfo.foreignSchema
        ? `${fkInfo.foreignSchema}.${fkInfo.foreignTable}`
        : fkInfo.foreignTable
      : "";
    let foreignKey = fkInfo
      ? `${baseForeignTable}.${fkInfo.foreignColumns[0] ?? ""}`
      : "";
    let hasFkChange = false;

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
      if (newDef.checkExpression !== undefined) {
        checkConstraintValue = String(newDef.checkExpression ?? "");
      }
    }

    const fkDrop = fkInfo
      ? pendingFkDrops.find(
          (cmd) => (cmd.payload as any).constraintName === fkInfo.name,
        )
      : undefined;
    if (fkDrop) {
      foreignKey = "";
      hasFkChange = true;
    }

    const fkAdd = pendingFkAdds.find((cmd) => {
      const definition = (cmd.payload as any).definition as {
        columns?: string[];
      };
      if (!definition?.columns) return false;
      return (
        definition.columns.includes(column.name) ||
        definition.columns.includes(displayName)
      );
    });
    if (fkAdd) {
      const def = (fkAdd.payload as any).definition as {
        referenceTable: string;
        referenceColumns: string[];
        referenceSchema?: string;
      };
      const refTable = def.referenceSchema
        ? `${def.referenceSchema}.${def.referenceTable}`
        : def.referenceTable;
      foreignKey = `${refTable}.${def.referenceColumns[0] ?? ""}`.replace(
        /\.$/,
        "",
      );
      hasFkChange = true;
    }

    return {
      row_number: idx + 1,
      column_name: displayName,
      column_meta: {
        is_pk: column.is_pk,
        is_fk: !!fkInfo, // Determine FK from actual foreign key relationship
        is_computed: column.is_computed,
        is_identity: column.is_identity,
      },
      db_type: dbType,
      nullable: nullable,
      default: defaultValue,
      foreign_key: foreignKey,
      is_computed: column.is_computed ? "YES" : "NO",
      check_constraint: checkConstraintValue,
      comment: comment,
      // MySQL/MariaDB specific
      character_set: column.character_set ?? "",
      collation: column.collation ?? "",
      extra: column.extra ?? "",
      _originalData: column,
      _isModified: !!(modifyCmd || renameCmd || hasFkChange), // Mark row as modified
      _isPendingDelete: isPendingDelete, // Mark row for deletion
    };
  });

  // Create virtual rows for pending additions (at bottom)
  const virtualRows: StructureGridRow[] = pendingAdds.map((cmd, idx) => {
    const col = cmd.payload.column;
    const fkAdd = pendingFkAdds.find((fkCmd) => {
      const definition = (fkCmd.payload as any).definition as {
        columns?: string[];
      };
      if (!definition?.columns) return false;
      return definition.columns.includes(col.name || "");
    });
    const fkDefinition = fkAdd
      ? ((fkAdd.payload as any).definition as {
          referenceTable: string;
          referenceColumns: string[];
          referenceSchema?: string;
        })
      : null;
    const refTable = fkDefinition?.referenceSchema
      ? `${fkDefinition.referenceSchema}.${fkDefinition.referenceTable}`
      : fkDefinition?.referenceTable;
    const foreignKey = fkDefinition
      ? `${refTable}.${fkDefinition.referenceColumns[0] ?? ""}`.replace(
          /\.$/,
          "",
        )
      : "";
    return {
      row_number: actualRows.length + idx + 1,
      column_name: col.name || "(new column)",
      column_meta: {
        is_pk: col.isPrimaryKey || false,
        is_fk: false,
      },
      db_type: col.dataType || "text",
      nullable: col.nullable ? "YES" : "NO",
      default:
        col.defaultValue != null ? JSON.stringify(col.defaultValue) : null,
      foreign_key: foreignKey,
      is_computed: "NO",
      check_constraint: col.checkExpression ?? "",
      comment: col.comment ?? "",
      // MySQL/MariaDB specific - empty for new columns
      character_set: "",
      collation: "",
      extra: "",
      _tempId: cmd.payload.tempId,
      _isPending: true,
      _isModified: Boolean(fkAdd),
    };
  });

  // Merge: actual columns first, then pending additions at bottom
  return [...actualRows, ...virtualRows];
}
