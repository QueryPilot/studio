/**
 * Canonical schema types for database introspection and column metadata.
 * This is the single source of truth for schema-related types.
 *
 * NOTE: For raw cell values from Rust backend, see backend.ts (RawCellValue)
 * NOTE: For grid display cell values, see cellValue.ts (GridCellValue)
 */

/**
 * Column metadata from database introspection.
 * Used throughout the application for schema information.
 */
export interface ColumnMeta {
  /** Column name */
  name: string;
  /** Source table name (for query results with JOINs) */
  table_name?: string;
  /** Original database type (e.g., "VARCHAR(255)", "INT", "TIMESTAMP") */
  db_type: string;
  /** Whether the column allows NULL values */
  nullable: boolean;
  /** Default value expression or null */
  default: string | null;
  /** Whether this column is part of the primary key */
  is_pk: boolean;
  /** Whether this column has a foreign key constraint */
  is_fk: boolean;
  /** Column ordinal position (0-based) */
  ordinal: number;
  /** Numeric precision (total digits) */
  precision?: number | null;
  /** Numeric scale (decimal places) */
  scale?: number | null;
  /** Column comment/description */
  comment?: string | null;

  // PostgreSQL specific
  /** PostgreSQL custom type category: 'enum', 'domain', 'composite', 'base', 'range', 'multirange' */
  type_category?: string;
  /** PostgreSQL type OID */
  type_oid?: number;

  // MySQL/MariaDB specific
  /** Whether this is a JSON column */
  is_json?: boolean;
  /** ENUM type values */
  enum_values?: string[];
  /** SET type values */
  set_values?: string[];
  /** Whether this is a virtual/generated column */
  is_virtual?: boolean;
  /** Character set name (MySQL/MariaDB) */
  character_set?: string | null;
  /** Collation name (MySQL/MariaDB) */
  collation?: string | null;
  /** Extra column info like auto_increment (MySQL/MariaDB) */
  extra?: string | null;

  // MSSQL specific
  /** Whether this is an identity column */
  is_identity?: boolean;
  /** Whether this is a computed column */
  is_computed?: boolean;
  /** Whether this is a hierarchyid type */
  is_hierarchyid?: boolean;
  /** Whether this is a spatial type */
  is_spatial?: boolean;
}

/**
 * Foreign key reference information
 */
export interface ForeignKeyRef {
  constraint_name: string;
  referenced_schema: string;
  referenced_table: string;
  referenced_column: string;
  on_delete: string;
  on_update: string;
}

/**
 * Extended column metadata with foreign key, check constraint, and additional details
 */
export interface EnhancedColumnMeta extends ColumnMeta {
  fk_reference?: ForeignKeyRef | null;
  check_constraint?: string | null;
  character_maximum_length?: number | null;
  is_unique?: boolean;
  is_indexed?: boolean;
}

/**
 * Table metadata from introspection
 */
export interface TableMeta {
  schema: string;
  name: string;
  kind: TableKind;
  owner?: string;
  size?: string;
  row_count?: number;
  comment?: string;
}

export type TableKind =
  | "regular"
  | "partitioned"
  | "foreign"
  | "view"
  | "materialized_view"
  | "temporary";

/**
 * Index metadata from introspection
 */
export interface IndexMeta {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  type: string;
  definition?: string;
}

/**
 * Constraint metadata from introspection
 */
export interface ConstraintMeta {
  name: string;
  type: ConstraintType;
  columns: string[];
  definition?: string;
  referenced_table?: string;
  referenced_columns?: string[];
}

export type ConstraintType =
  | "primary_key"
  | "foreign_key"
  | "unique"
  | "check"
  | "exclusion";

/**
 * Trigger metadata from introspection
 */
export interface TriggerMeta {
  name: string;
  event: string;
  timing: string;
  definition?: string;
}

/**
 * Function/procedure metadata from introspection
 */
export interface RoutineMeta {
  schema: string;
  name: string;
  type: "function" | "procedure";
  return_type?: string;
  arguments?: string;
  language?: string;
  volatility?: string;
  owner?: string;
  comment?: string;
}

/**
 * Sequence metadata from introspection
 */
export interface SequenceMeta {
  schema: string;
  name: string;
  data_type: string;
  start_value: number;
  min_value: number;
  max_value: number;
  increment: number;
  cycle: boolean;
  owner?: string;
}

/**
 * Type/domain metadata from introspection
 */
export interface TypeMeta {
  schema: string;
  name: string;
  type: "enum" | "domain" | "composite" | "range";
  values?: string[]; // For enums
  base_type?: string; // For domains
  fields?: Array<{ name: string; type: string }>; // For composites
  owner?: string;
  comment?: string;
}
