/**
 * Type-Aware Value Suggestions
 * Provides intelligent value suggestions based on column data types
 */

import type { ColumnMeta } from "@/types/database";
import type { Completion } from "@codemirror/autocomplete";

interface ValueSuggestion extends Completion {
  score: number;
}

/**
 * Get value suggestions for a column based on its type
 */
export function getValueSuggestionsForColumn(
  column: ColumnMeta,
  dbType: string,
): ValueSuggestion[] {
  const suggestions: ValueSuggestion[] = [];
  const typeLower = column.db_type.toLowerCase();

  // BOOLEAN types
  if (isBoolean(typeLower, dbType)) {
    suggestions.push(
      {
        label: "TRUE",
        type: "constant",
        detail: "boolean",
        score: 100,
      },
      {
        label: "FALSE",
        type: "constant",
        detail: "boolean",
        score: 99,
      },
    );
  }

  // ENUM types (MySQL/MariaDB)
  if (column.enum_values && column.enum_values.length > 0) {
    for (const value of column.enum_values) {
      suggestions.push({
        label: `'${value}'`,
        apply: `'${value}'`,
        type: "enum",
        detail: "enum value",
        info: `Valid enum value for ${column.name}`,
        score: 95,
      });
    }
  }

  // SET types (MySQL/MariaDB)
  if (column.set_values && column.set_values.length > 0) {
    for (const value of column.set_values) {
      suggestions.push({
        label: `'${value}'`,
        apply: `'${value}'`,
        type: "enum",
        detail: "set value",
        info: `Valid set value for ${column.name}`,
        score: 95,
      });
    }
  }

  // PostgreSQL ENUM (check type_category)
  if (column.type_category === "enum") {
    // Note: We'd need to fetch enum values from pg_enum
    // For now, we can suggest the pattern
    suggestions.push({
      label: "''",
      apply: "''",
      type: "text",
      detail: "enum value",
      info: `${column.db_type} enum - use a valid enum value`,
      score: 90,
    });
  }

  // NULL suggestion for nullable columns
  if (column.nullable) {
    suggestions.push({
      label: "NULL",
      type: "constant",
      detail: "null value",
      score: column.default === null ? 85 : 70, // Higher score if default is null
    });
  }

  // DEFAULT suggestion if column has a default value
  if (column.default !== null && column.default !== undefined) {
    suggestions.push({
      label: "DEFAULT",
      type: "keyword",
      detail: `default: ${column.default}`,
      info: `Use default value: ${column.default}`,
      score: 80,
    });
  }

  // DATE/TIME suggestions
  if (isDate(typeLower)) {
    suggestions.push(
      {
        label: "CURRENT_DATE",
        type: "keyword",
        detail: "current date",
        score: 75,
      },
      {
        label: "''",
        apply: "''",
        type: "text",
        detail: "YYYY-MM-DD",
        info: "Date format: 'YYYY-MM-DD'",
        score: 70,
      },
    );
  }

  if (isTimestamp(typeLower)) {
    suggestions.push(
      {
        label: "CURRENT_TIMESTAMP",
        type: "keyword",
        detail: "current timestamp",
        score: 75,
      },
      {
        label: "NOW()",
        type: "function",
        detail: "current timestamp",
        score: 74,
      },
      {
        label: "''",
        apply: "''",
        type: "text",
        detail: "timestamp",
        info: "Timestamp format: 'YYYY-MM-DD HH:MM:SS'",
        score: 70,
      },
    );
  }

  if (isTime(typeLower)) {
    suggestions.push(
      {
        label: "CURRENT_TIME",
        type: "keyword",
        detail: "current time",
        score: 75,
      },
      {
        label: "''",
        apply: "''",
        type: "text",
        detail: "HH:MM:SS",
        info: "Time format: 'HH:MM:SS'",
        score: 70,
      },
    );
  }

  // STRING/TEXT suggestions
  if (isString(typeLower)) {
    suggestions.push({
      label: "''",
      apply: "''",
      type: "text",
      detail: "string",
      score: 70,
    });
  }

  // NUMERIC suggestions
  if (isNumeric(typeLower)) {
    suggestions.push({
      label: "0",
      type: "constant",
      detail: "number",
      score: 70,
    });
  }

  // JSON suggestions (PostgreSQL, MySQL 5.7+)
  if (isJson(typeLower) || column.is_json) {
    suggestions.push(
      {
        label: "'{}'",
        apply: "'{}'",
        type: "text",
        detail: "JSON object",
        score: 75,
      },
      {
        label: "'[]'",
        apply: "'[]'",
        type: "text",
        detail: "JSON array",
        score: 74,
      },
    );
  }

  // UUID suggestions (PostgreSQL)
  if (isUuid(typeLower)) {
    if (dbType === "PostgreSQL") {
      suggestions.push({
        label: "gen_random_uuid()",
        type: "function",
        detail: "generate UUID",
        info: "Generates a random UUID (requires pgcrypto extension)",
        score: 80,
      });
    }
    suggestions.push({
      label: "''",
      apply: "''",
      type: "text",
      detail: "UUID format",
      info: "UUID format: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'",
      score: 70,
    });
  }

  return suggestions;
}

/**
 * Type checking utilities
 */
function isBoolean(type: string, dbType: string): boolean {
  if (dbType === "PostgreSQL") {
    return type === "boolean" || type === "bool";
  }
  if (dbType === "MySQL" || dbType === "MariaDB") {
    return type === "tinyint(1)" || type === "boolean" || type === "bool";
  }
  if (dbType === "SQLite") {
    return type === "boolean" || type === "bool";
  }
  if (dbType === "MSSQL") {
    return type === "bit";
  }
  return false;
}

function isDate(type: string): boolean {
  return type === "date";
}

function isTimestamp(type: string): boolean {
  return (
    type.includes("timestamp") ||
    type === "datetime" ||
    type === "datetime2" ||
    type === "smalldatetime" ||
    type === "datetimeoffset"
  );
}

function isTime(type: string): boolean {
  return (
    type === "time" ||
    type.includes("time without") ||
    type.includes("time with")
  );
}

function isString(type: string): boolean {
  return (
    type.includes("char") ||
    type.includes("text") ||
    type === "varchar" ||
    type === "nvarchar" ||
    type === "string" ||
    type === "clob"
  );
}

function isNumeric(type: string): boolean {
  return (
    type.includes("int") ||
    type.includes("decimal") ||
    type.includes("numeric") ||
    type.includes("float") ||
    type.includes("double") ||
    type.includes("real") ||
    type === "money" ||
    type === "smallmoney" ||
    type === "number"
  );
}

function isJson(type: string): boolean {
  return type === "json" || type === "jsonb";
}

function isUuid(type: string): boolean {
  return type === "uuid" || type === "uniqueidentifier";
}
