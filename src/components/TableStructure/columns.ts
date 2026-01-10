import type { GridColumnV2 } from "@/components/DataGrid/types";
import { DbType } from "@/types";

const trailingRowTheme = {
  bgIconHeader: "#D4A52B",
};

const trailingRowOptions = {
  hint: " ",
  themeOverride: trailingRowTheme,
};

// Base columns that are always shown
const baseColumns: GridColumnV2[] = [
  {
    id: "row_number",
    field: "row_number",
    title: "#",
    name: "#",
    width: 48,
    minWidth: 48,
    maxWidth: 80,
    trailingRowOptions,
  } as GridColumnV2,
  {
    id: "column_name",
    field: "column_name",
    title: "Column",
    name: "Column",
    width: 200,
    minWidth: 120,
    maxWidth: 400,
  } as GridColumnV2,
  {
    id: "db_type",
    field: "db_type",
    title: "Type",
    name: "Type",
    width: 180,
    minWidth: 100,
    maxWidth: 300,
  } as GridColumnV2,
  {
    id: "nullable",
    field: "nullable",
    title: "Nullable",
    name: "Nullable",
    width: 100,
    minWidth: 80,
    maxWidth: 120,
  } as GridColumnV2,
  {
    id: "default",
    field: "default",
    title: "Default",
    name: "Default",
    width: 160,
    minWidth: 100,
    maxWidth: 300,
  } as GridColumnV2,
  {
    id: "foreign_key",
    field: "foreign_key",
    title: "Foreign Key",
    name: "Foreign Key",
    width: 200,
    minWidth: 140,
    maxWidth: 400,
  } as GridColumnV2,
];

// MySQL/MariaDB-specific columns
const mysqlColumns: GridColumnV2[] = [
  {
    id: "character_set",
    field: "character_set",
    title: "Charset",
    name: "Charset",
    width: 100,
    minWidth: 80,
    maxWidth: 140,
  } as GridColumnV2,
  {
    id: "collation",
    field: "collation",
    title: "Collation",
    name: "Collation",
    width: 140,
    minWidth: 100,
    maxWidth: 200,
  } as GridColumnV2,
  {
    id: "extra",
    field: "extra",
    title: "Extra",
    name: "Extra",
    width: 140,
    minWidth: 80,
    maxWidth: 200,
  } as GridColumnV2,
];

// Database-specific columns
const dbSpecificColumns: Record<string, GridColumnV2[]> = {
  // MSSQL-specific columns
  [DbType.SQLServer]: [
    {
      id: "is_computed",
      field: "is_computed",
      title: "Computed",
      name: "Computed",
      width: 100,
      minWidth: 80,
      maxWidth: 120,
    } as GridColumnV2,
  ],
  // MySQL/MariaDB-specific columns
  [DbType.MySQL]: mysqlColumns,
  [DbType.MariaDB]: mysqlColumns,
};

// Trailing columns (always at the end)
const trailingColumns: GridColumnV2[] = [
  {
    id: "check_constraint",
    field: "check_constraint",
    title: "Check",
    name: "Check",
    width: 200,
    minWidth: 140,
  } as GridColumnV2,
  {
    id: "comment",
    field: "comment",
    title: "Comment",
    name: "Comment",
    width: 240,
    minWidth: 140,
  } as GridColumnV2,
  {
    id: "actions",
    field: "actions",
    title: "",
    name: "",
    width: 60,
    minWidth: 60,
    maxWidth: 60,
  } as GridColumnV2,
];

/**
 * Get structure columns based on database type
 * Inserts database-specific columns between base columns and trailing columns
 */
export function getStructureColumns(dbType?: DbType): GridColumnV2[] {
  const specificColumns = dbType ? dbSpecificColumns[dbType] || [] : [];
  return [...baseColumns, ...specificColumns, ...trailingColumns];
}

// Backwards compatibility: default export with all columns (for non-connected scenarios)
export const structureColumns: GridColumnV2[] = getStructureColumns();
