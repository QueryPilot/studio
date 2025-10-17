/**
 * SQL Function Catalog Types
 */

export interface FunctionParameter {
  name: string;
  type: string;
  optional?: boolean;
  description?: string;
}

export interface SqlFunction {
  name: string;
  category: FunctionCategory;
  parameters: FunctionParameter[];
  returnType: string;
  description: string;
  example?: string;
  /** Dialects that support this function */
  dialects: SqlDialect[];
  /** Aliases for this function in different dialects */
  aliases?: Record<string, string>;
}

export type FunctionCategory =
  | "aggregate"
  | "string"
  | "numeric"
  | "datetime"
  | "json"
  | "array"
  | "window"
  | "conditional"
  | "conversion"
  | "system";

export type SqlDialect = "PostgreSQL" | "MySQL" | "SQLite" | "MSSQL";
