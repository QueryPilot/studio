import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface DataTypeCellData {
  kind: "datatype-cell";
  value: string;
  customTypes?: string[]; // Custom enum/composite types from database
  columnName?: string; // Column name for display in editor header
}

export interface DataTypeCell extends CustomCell<DataTypeCellData> {
  kind: GridCellKind.Custom;
}

// Common PostgreSQL data types
export const POSTGRES_STANDARD_TYPES = [
  // Numeric types
  "smallint",
  "integer",
  "bigint",
  "decimal",
  "numeric",
  "real",
  "double precision",
  "smallserial",
  "serial",
  "bigserial",

  // Monetary
  "money",

  // Character types
  "character varying",
  "varchar",
  "character",
  "char",
  "text",

  // Binary types
  "bytea",

  // Date/time types
  "timestamp",
  "timestamp without time zone",
  "timestamp with time zone",
  "timestamptz",
  "date",
  "time",
  "time without time zone",
  "time with time zone",
  "timetz",
  "interval",

  // Boolean
  "boolean",
  "bool",

  // UUID
  "uuid",

  // JSON
  "json",
  "jsonb",

  // Network address types
  "cidr",
  "inet",
  "macaddr",
  "macaddr8",

  // Geometric types
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",

  // Text search
  "tsvector",
  "tsquery",

  // XML
  "xml",

  // Bit strings
  "bit",
  "bit varying",

  // Arrays (examples)
  "integer[]",
  "text[]",
  "varchar[]",
];
