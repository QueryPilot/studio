import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface DataTypeCellData {
  kind: "datatype-cell";
  value: string;
  standardTypes: string[]; // Dialect-specific standard types (from hook)
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

// Common MySQL/MariaDB data types
export const MYSQL_STANDARD_TYPES = [
  // Numeric
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "bigint",
  "decimal",
  "float",
  "double",
  // String
  "char",
  "varchar",
  "tinytext",
  "text",
  "mediumtext",
  "longtext",
  // Binary
  "binary",
  "varbinary",
  "tinyblob",
  "blob",
  "mediumblob",
  "longblob",
  // Date/time
  "date",
  "time",
  "datetime",
  "timestamp",
  "year",
  // Other
  "boolean",
  "json",
  "enum",
  "set",
];

// SQLite data types (SQLite uses type affinity)
export const SQLITE_STANDARD_TYPES = [
  "integer",
  "text",
  "real",
  "blob",
  "numeric",
];

// Common MSSQL data types
export const MSSQL_STANDARD_TYPES = [
  // Exact numeric
  "bit",
  "tinyint",
  "smallint",
  "int",
  "bigint",
  "decimal",
  "numeric",
  "money",
  "smallmoney",
  // Approximate numeric
  "float",
  "real",
  // String
  "char",
  "varchar",
  "nchar",
  "nvarchar",
  "text",
  "ntext",
  // Binary
  "binary",
  "varbinary",
  "image",
  // Date/time
  "date",
  "time",
  "datetime",
  "datetime2",
  "datetimeoffset",
  "smalldatetime",
  // Other
  "uniqueidentifier",
  "xml",
  "sql_variant",
  // LOB
  "varchar(max)",
  "nvarchar(max)",
  "varbinary(max)",
];

// Common Oracle data types
export const ORACLE_STANDARD_TYPES = [
  "number",
  "binary_float",
  "binary_double",
  "float",
  "varchar2",
  "nvarchar2",
  "char",
  "nchar",
  "clob",
  "nclob",
  "blob",
  "raw",
  "date",
  "timestamp",
  "timestamp with time zone",
  "timestamp with local time zone",
  "interval day to second",
  "interval year to month",
  "xmltype",
  "json",
];
