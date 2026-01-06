/**
 * Suggested column names for FK display - common "display" columns
 * Used for smart detection when no explicit preference is set
 */
export const SUGGESTED_DISPLAY_COLUMNS = [
  "name",
  "title",
  "label",
  "display_name",
  "email",
  "username",
  "code",
  "description",
  "summary",
];

interface FKReference {
  schema: string;
  table: string;
  column: string;
}

interface ReferencedColumn {
  name: string;
  db_type: string;
}

/**
 * Resolve which column to display for FK values in the picker dropdown.
 *
 * Priority order:
 * 1. Embedded FK preference (user explicitly selected a display column)
 * 2. Smart detection (match against SUGGESTED_DISPLAY_COLUMNS)
 * 3. Fallback to PK column
 *
 * @param fkRef - FK reference info (schema, table, column)
 * @param embeddedColumns - User's embedded preference for this FK column (from store)
 * @param refTableColumns - Columns of the referenced table
 * @returns The column name to use for display
 */
export function resolveDisplayColumn(
  fkRef: FKReference,
  embeddedColumns: string[] | undefined,
  refTableColumns: ReferencedColumn[] | undefined,
): string {
  // 1. Check embedded FK preference first
  if (embeddedColumns && embeddedColumns.length > 0) {
    const firstColumn = embeddedColumns[0];
    if (firstColumn) {
      return firstColumn;
    }
  }

  // 2. Smart detection - find first matching suggested column
  if (refTableColumns && refTableColumns.length > 0) {
    for (const suggested of SUGGESTED_DISPLAY_COLUMNS) {
      const match = refTableColumns.find(
        (col) => col.name.toLowerCase().includes(suggested.toLowerCase())
      );
      if (match) {
        return match.name;
      }
    }
  }

  // 3. Fallback to PK column
  return fkRef.column;
}

/**
 * Check if a column name matches any suggested display column pattern
 */
export function isSuggestedDisplayColumn(columnName: string): boolean {
  return SUGGESTED_DISPLAY_COLUMNS.some((suggested) =>
    columnName.toLowerCase().includes(suggested.toLowerCase())
  );
}
