import type {
  ColumnDefinitionInput,
  CrudCommand,
  IndexCreatePayload,
} from "@/types/crud";
import type { IndexGridRow } from "@/components/TableIndexes/types";

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

// ---------------------------------------------------------------------------
// Index designer utilities
// ---------------------------------------------------------------------------

/**
 * Auto-generate an index name from table and column names.
 * Pattern: `idx_{tableName}_{col1}_{col2}`, truncated to `identifierLimit` chars.
 *
 * Common limits: PostgreSQL = 63, MySQL = 64, SQLite ≈ unlimited, MSSQL = 128.
 */
export function generateIndexName(
  tableName: string,
  columns: string[],
  identifierLimit = 63,
): string {
  if (columns.length === 0) return "";
  const raw = `idx_${tableName}_${columns.join("_")}`;
  return raw.slice(0, identifierLimit);
}

/**
 * Build `IndexGridRow[]` from staged CRUD commands, filtering to `index.create` only.
 */
export function buildDesignerIndexRows(
  commands: CrudCommand[],
): IndexGridRow[] {
  return commands
    .filter((cmd) => cmd.type === "index.create")
    .map((cmd, i) => {
      const payload = cmd.payload as IndexCreatePayload;
      const def = payload.definition;
      const isUnique = def.unique === true;
      return {
        row_number: i + 1,
        name: def.name,
        name_meta: { primary: false, unique: isUnique },
        columns: def.columns.join(", "),
        columns_array: def.columns,
        index_type: def.using ?? "btree",
        unique: isUnique ? "YES" : "NO",
        statistics: "",
        condition: def.where ?? "",
        _tempId: payload.tempId,
        _isPending: true,
      };
    });
}

// ---------------------------------------------------------------------------
// Column ↔ Index sync
// ---------------------------------------------------------------------------

/**
 * Sync index commands with current column state.
 * Returns updated commands array, or null if no changes needed.
 * Commands whose columns are all removed are excluded from the result
 * (caller should unstage them).
 */
export function syncIndexCommandsWithColumns(
  indexCommands: CrudCommand[],
  currentColumnNames: string[],
  renamedColumns: Map<string, string>,
): CrudCommand[] | null {
  const columnSet = new Set(currentColumnNames);
  let anyChanged = false;

  const result: CrudCommand[] = [];

  for (const cmd of indexCommands) {
    const payload = cmd.payload as IndexCreatePayload;
    const originalColumns = payload.definition.columns;

    // Apply renames, then filter to existing columns
    const updatedColumns = originalColumns
      .map((col) => renamedColumns.get(col) ?? col)
      .filter((col) => columnSet.has(col));

    // If all columns are gone, exclude this command (mark as changed).
    // But keep newly created indexes that have no columns yet.
    if (updatedColumns.length === 0 && originalColumns.length > 0) {
      anyChanged = true;
      continue;
    }

    // Check if columns actually changed
    const columnsChanged =
      updatedColumns.length !== originalColumns.length ||
      updatedColumns.some((col, i) => col !== originalColumns[i]);

    if (columnsChanged) {
      anyChanged = true;
      result.push({
        ...cmd,
        payload: {
          ...payload,
          definition: {
            ...payload.definition,
            columns: updatedColumns,
          },
        },
      });
    } else {
      // Unchanged — keep the original reference
      result.push(cmd);
    }
  }

  return anyChanged ? result : null;
}
