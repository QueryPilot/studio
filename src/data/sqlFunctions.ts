import type { SqlFunction, SqlDialect } from "@/types/sqlFunctions";

/**
 * Comprehensive SQL Function Catalog
 * Organized by category with dialect support
 */
export const SQL_FUNCTIONS: SqlFunction[] = [
  // AGGREGATE FUNCTIONS
  {
    name: "COUNT",
    category: "aggregate",
    parameters: [{ name: "expression", type: "any", optional: true }],
    returnType: "bigint",
    description: "Returns the count of rows or non-null values",
    example: "COUNT(*), COUNT(DISTINCT user_id)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "SUM",
    category: "aggregate",
    parameters: [{ name: "expression", type: "numeric" }],
    returnType: "numeric",
    description: "Returns the sum of numeric values",
    example: "SUM(amount)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "AVG",
    category: "aggregate",
    parameters: [{ name: "expression", type: "numeric" }],
    returnType: "numeric",
    description: "Returns the average of numeric values",
    example: "AVG(price)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "MIN",
    category: "aggregate",
    parameters: [{ name: "expression", type: "any" }],
    returnType: "same as input",
    description: "Returns the minimum value",
    example: "MIN(created_at)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "MAX",
    category: "aggregate",
    parameters: [{ name: "expression", type: "any" }],
    returnType: "same as input",
    description: "Returns the maximum value",
    example: "MAX(updated_at)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "STRING_AGG",
    category: "aggregate",
    parameters: [
      { name: "expression", type: "text" },
      { name: "delimiter", type: "text" },
    ],
    returnType: "text",
    description: "Concatenates strings with a delimiter",
    example: "STRING_AGG(name, ', ')",
    dialects: ["PostgreSQL", "MSSQL"],
    aliases: { MySQL: "GROUP_CONCAT" },
  },
  {
    name: "JSON_AGG",
    category: "aggregate",
    parameters: [{ name: "expression", type: "any" }],
    returnType: "json",
    description: "Aggregates values into a JSON array",
    example: "JSON_AGG(user_id)",
    dialects: ["PostgreSQL"],
  },

  // STRING FUNCTIONS
  {
    name: "CONCAT",
    category: "string",
    parameters: [
      { name: "string1", type: "text" },
      { name: "string2", type: "text" },
      { name: "...", type: "text", optional: true },
    ],
    returnType: "text",
    description: "Concatenates strings",
    example: "CONCAT(first_name, ' ', last_name)",
    dialects: ["PostgreSQL", "MySQL", "MSSQL"],
  },
  {
    name: "SUBSTRING",
    category: "string",
    parameters: [
      { name: "string", type: "text" },
      { name: "start", type: "integer" },
      { name: "length", type: "integer", optional: true },
    ],
    returnType: "text",
    description: "Extracts a substring",
    example: "SUBSTRING(email, 1, 10)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
    aliases: { PostgreSQL: "SUBSTR", MySQL: "SUBSTR", SQLite: "SUBSTR" },
  },
  {
    name: "UPPER",
    category: "string",
    parameters: [{ name: "string", type: "text" }],
    returnType: "text",
    description: "Converts string to uppercase",
    example: "UPPER(name)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "LOWER",
    category: "string",
    parameters: [{ name: "string", type: "text" }],
    returnType: "text",
    description: "Converts string to lowercase",
    example: "LOWER(email)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "TRIM",
    category: "string",
    parameters: [
      { name: "characters", type: "text", optional: true },
      { name: "string", type: "text" },
    ],
    returnType: "text",
    description: "Removes leading and trailing characters",
    example: "TRIM(name)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "LENGTH",
    category: "string",
    parameters: [{ name: "string", type: "text" }],
    returnType: "integer",
    description: "Returns the length of a string",
    example: "LENGTH(description)",
    dialects: ["PostgreSQL", "MySQL", "SQLite"],
    aliases: { MSSQL: "LEN" },
  },
  {
    name: "REPLACE",
    category: "string",
    parameters: [
      { name: "string", type: "text" },
      { name: "from", type: "text" },
      { name: "to", type: "text" },
    ],
    returnType: "text",
    description: "Replaces occurrences of a substring",
    example: "REPLACE(text, 'old', 'new')",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "REGEXP_REPLACE",
    category: "string",
    parameters: [
      { name: "string", type: "text" },
      { name: "pattern", type: "text" },
      { name: "replacement", type: "text" },
      { name: "flags", type: "text", optional: true },
    ],
    returnType: "text",
    description: "Replaces substrings matching a regex pattern",
    example: "REGEXP_REPLACE(text, '[0-9]+', '')",
    dialects: ["PostgreSQL", "MySQL"],
  },

  // DATE/TIME FUNCTIONS
  {
    name: "NOW",
    category: "datetime",
    parameters: [],
    returnType: "timestamp",
    description: "Returns current date and time",
    example: "NOW()",
    dialects: ["PostgreSQL", "MySQL"],
    aliases: { MSSQL: "GETDATE", SQLite: "datetime('now')" },
  },
  {
    name: "CURRENT_DATE",
    category: "datetime",
    parameters: [],
    returnType: "date",
    description: "Returns current date",
    example: "CURRENT_DATE",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "DATE_TRUNC",
    category: "datetime",
    parameters: [
      { name: "field", type: "text" },
      { name: "source", type: "timestamp" },
    ],
    returnType: "timestamp",
    description: "Truncates timestamp to specified precision",
    example: "DATE_TRUNC('day', created_at)",
    dialects: ["PostgreSQL"],
  },
  {
    name: "DATE_PART",
    category: "datetime",
    parameters: [
      { name: "field", type: "text" },
      { name: "source", type: "timestamp" },
    ],
    returnType: "double precision",
    description: "Extracts a field from a timestamp",
    example: "DATE_PART('year', created_at)",
    dialects: ["PostgreSQL"],
    aliases: { MySQL: "EXTRACT", MSSQL: "DATEPART" },
  },
  {
    name: "AGE",
    category: "datetime",
    parameters: [
      { name: "timestamp1", type: "timestamp" },
      { name: "timestamp2", type: "timestamp", optional: true },
    ],
    returnType: "interval",
    description: "Calculates the interval between timestamps",
    example: "AGE(created_at)",
    dialects: ["PostgreSQL"],
  },
  {
    name: "INTERVAL",
    category: "datetime",
    parameters: [{ name: "expression", type: "text" }],
    returnType: "interval",
    description: "Creates an interval value",
    example: "INTERVAL '1 day'",
    dialects: ["PostgreSQL", "MySQL"],
  },

  // NUMERIC FUNCTIONS
  {
    name: "ROUND",
    category: "numeric",
    parameters: [
      { name: "value", type: "numeric" },
      { name: "decimals", type: "integer", optional: true },
    ],
    returnType: "numeric",
    description: "Rounds a number to specified decimal places",
    example: "ROUND(price, 2)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "CEIL",
    category: "numeric",
    parameters: [{ name: "value", type: "numeric" }],
    returnType: "numeric",
    description: "Rounds up to nearest integer",
    example: "CEIL(3.14)",
    dialects: ["PostgreSQL", "MySQL", "SQLite"],
    aliases: { MSSQL: "CEILING" },
  },
  {
    name: "FLOOR",
    category: "numeric",
    parameters: [{ name: "value", type: "numeric" }],
    returnType: "numeric",
    description: "Rounds down to nearest integer",
    example: "FLOOR(3.99)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "ABS",
    category: "numeric",
    parameters: [{ name: "value", type: "numeric" }],
    returnType: "numeric",
    description: "Returns absolute value",
    example: "ABS(-10)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "RANDOM",
    category: "numeric",
    parameters: [],
    returnType: "double precision",
    description: "Returns random number between 0 and 1",
    example: "RANDOM()",
    dialects: ["PostgreSQL", "SQLite"],
    aliases: { MySQL: "RAND", MSSQL: "RAND" },
  },

  // JSON FUNCTIONS
  {
    name: "JSON_EXTRACT",
    category: "json",
    parameters: [
      { name: "json_doc", type: "json" },
      { name: "path", type: "text" },
    ],
    returnType: "json",
    description: "Extracts data from JSON document",
    example: "JSON_EXTRACT(data, '$.user.name')",
    dialects: ["MySQL", "SQLite"],
    aliases: { PostgreSQL: "->>" },
  },
  {
    name: "JSONB_PATH_QUERY",
    category: "json",
    parameters: [
      { name: "target", type: "jsonb" },
      { name: "path", type: "jsonpath" },
    ],
    returnType: "jsonb",
    description: "Queries JSONB using JSONPath",
    example: "JSONB_PATH_QUERY(data, '$.items[*].price')",
    dialects: ["PostgreSQL"],
  },
  {
    name: "JSON_OBJECT",
    category: "json",
    parameters: [
      { name: "key", type: "text" },
      { name: "value", type: "any" },
      { name: "...", type: "any", optional: true },
    ],
    returnType: "json",
    description: "Creates a JSON object from key-value pairs",
    example: "JSON_OBJECT('name', name, 'age', age)",
    dialects: ["PostgreSQL", "MySQL", "MSSQL"],
  },

  // WINDOW FUNCTIONS
  {
    name: "ROW_NUMBER",
    category: "window",
    parameters: [],
    returnType: "bigint",
    description: "Assigns unique sequential number to rows",
    example: "ROW_NUMBER() OVER (ORDER BY created_at)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "RANK",
    category: "window",
    parameters: [],
    returnType: "bigint",
    description: "Assigns rank with gaps for ties",
    example: "RANK() OVER (ORDER BY score DESC)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "DENSE_RANK",
    category: "window",
    parameters: [],
    returnType: "bigint",
    description: "Assigns rank without gaps for ties",
    example: "DENSE_RANK() OVER (PARTITION BY category ORDER BY price)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "LAG",
    category: "window",
    parameters: [
      { name: "value", type: "any" },
      { name: "offset", type: "integer", optional: true },
      { name: "default", type: "any", optional: true },
    ],
    returnType: "same as value",
    description: "Accesses value from previous row",
    example: "LAG(price, 1) OVER (ORDER BY date)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "LEAD",
    category: "window",
    parameters: [
      { name: "value", type: "any" },
      { name: "offset", type: "integer", optional: true },
      { name: "default", type: "any", optional: true },
    ],
    returnType: "same as value",
    description: "Accesses value from next row",
    example: "LEAD(price, 1) OVER (ORDER BY date)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "NTILE",
    category: "window",
    parameters: [{ name: "num_buckets", type: "integer" }],
    returnType: "bigint",
    description: "Divides rows into specified number of groups",
    example: "NTILE(4) OVER (ORDER BY amount)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },

  // CONDITIONAL FUNCTIONS
  {
    name: "COALESCE",
    category: "conditional",
    parameters: [
      { name: "value1", type: "any" },
      { name: "value2", type: "any" },
      { name: "...", type: "any", optional: true },
    ],
    returnType: "same as input",
    description: "Returns first non-null value",
    example: "COALESCE(phone, email, 'No contact')",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "NULLIF",
    category: "conditional",
    parameters: [
      { name: "value1", type: "any" },
      { name: "value2", type: "any" },
    ],
    returnType: "same as input",
    description: "Returns NULL if values are equal",
    example: "NULLIF(count, 0)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "CASE",
    category: "conditional",
    parameters: [
      { name: "condition", type: "boolean" },
      { name: "result", type: "any" },
    ],
    returnType: "any",
    description: "Conditional expression",
    example: "CASE WHEN status = 'active' THEN 1 ELSE 0 END",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },

  // CONVERSION FUNCTIONS
  {
    name: "CAST",
    category: "conversion",
    parameters: [
      { name: "expression", type: "any" },
      { name: "type", type: "type" },
    ],
    returnType: "specified type",
    description: "Converts value to specified type",
    example: "CAST(user_id AS TEXT)",
    dialects: ["PostgreSQL", "MySQL", "SQLite", "MSSQL"],
  },
  {
    name: "TO_CHAR",
    category: "conversion",
    parameters: [
      { name: "value", type: "any" },
      { name: "format", type: "text" },
    ],
    returnType: "text",
    description: "Converts value to string with format",
    example: "TO_CHAR(created_at, 'YYYY-MM-DD')",
    dialects: ["PostgreSQL"],
  },
  {
    name: "TO_NUMBER",
    category: "conversion",
    parameters: [
      { name: "text", type: "text" },
      { name: "format", type: "text", optional: true },
    ],
    returnType: "numeric",
    description: "Converts string to number",
    example: "TO_NUMBER('123.45', '999.99')",
    dialects: ["PostgreSQL"],
  },
];

/**
 * Get functions for a specific dialect
 */
export function getFunctionsForDialect(dialect: string): SqlFunction[] {
  const dialectKey = dialect as SqlDialect;
  return SQL_FUNCTIONS.filter((fn) => fn.dialects.includes(dialectKey));
}

/**
 * Get functions by category
 */
export function getFunctionsByCategory(category: string): SqlFunction[] {
  return SQL_FUNCTIONS.filter((fn) => fn.category === category);
}

/**
 * Search functions by name or description
 */
export function searchFunctions(query: string): SqlFunction[] {
  const lowerQuery = query.toLowerCase();
  return SQL_FUNCTIONS.filter(
    (fn) =>
      fn.name.toLowerCase().includes(lowerQuery) ||
      fn.description.toLowerCase().includes(lowerQuery),
  );
}
