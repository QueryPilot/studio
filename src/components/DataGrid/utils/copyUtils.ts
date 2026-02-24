import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types";

export type DataParadigm = "sql" | "document" | "keyvalue";

/**
 * Format rows as JSON array
 */
export function copyAsJSON(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col) => {
      const cellValue = row[col.field];
      // Use column name for JSON key, not internal field identifier
      const columnName = col.name ?? col.field;
      obj[columnName] =
        cellValue && typeof cellValue === "object" && "value" in cellValue
          ? cellValue.value
          : null;
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

/**
 * Format rows as CSV with headers
 */
export function copyAsCSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const headers = columns.map((col) => escapeCSV(col.name));
  const headerRow = headers.join(",");

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const cellValue = row[col.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : null;
        return escapeCSV(formatValue(value));
      })
      .join(","),
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Format rows as TSV (tab-separated values)
 */
export function copyAsTSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const headers = columns.map((col) => col.name);
  const headerRow = headers.join("\t");

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const cellValue = row[col.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : null;
        return formatValue(value);
      })
      .join("\t"),
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Generate SQL INSERT statement based on database type
 * Uses single INSERT with multiple VALUES clauses: INSERT INTO ... VALUES (...), (...), (...)
 */
export function copyAsInsert(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  tableName: string,
  dbType: DatabaseType,
  schema?: string,
): string {
  if (rows.length === 0) return "";

  const { quoteIdentifier, formatTableName } = getDialectQuoting(dbType);
  const fullTableName = schema
    ? formatTableName(schema, tableName)
    : quoteIdentifier(tableName);

  // Use actual column names for SQL, not internal field identifiers
  const columnNames = columns
    .map((col) => quoteIdentifier(col.name ?? col.field))
    .join(", ");

  // Generate all value sets
  const valueSets = rows.map((row) => {
    const values = columns.map((col) => {
      const cellValue = row[col.field];
      const value =
        cellValue && typeof cellValue === "object" && "value" in cellValue
          ? cellValue.value
          : null;
      return formatSQLValue(value, dbType);
    });

    return `  (${values.join(", ")})`;
  });

  // Single INSERT statement with multiple VALUES
  return `INSERT INTO ${fullTableName} (${columnNames})\nVALUES\n${valueSets.join(",\n")};`;
}

/**
 * Get quoting rules for different database types
 */
function getDialectQuoting(dbType: DatabaseType) {
  switch (dbType) {
    case "postgresql":
    case "sqlite":
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
    case "mysql":
    case "mariadb":
      return {
        quoteIdentifier: (id: string) => `\`${id}\``,
        formatTableName: (schema: string, table: string) =>
          `\`${schema}\`.\`${table}\``,
      };
    case "mssql":
      return {
        quoteIdentifier: (id: string) => `[${id}]`,
        formatTableName: (schema: string, table: string) =>
          `[${schema}].[${table}]`,
      };
    case "mongodb":
      // MongoDB doesn't use SQL INSERT
      return {
        quoteIdentifier: (id: string) => id,
        formatTableName: (schema: string, table: string) =>
          `${schema}.${table}`,
      };
    default:
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
  }
}

/**
 * Format value for SQL INSERT
 */
function formatSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    // Different databases handle booleans differently
    switch (dbType) {
      case "postgresql":
        return value ? "TRUE" : "FALSE";
      case "mysql":
      case "mariadb":
      case "sqlite":
        return value ? "1" : "0";
      case "mssql":
        return value ? "1" : "0";
      default:
        return value ? "TRUE" : "FALSE";
    }
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  // For objects/arrays, serialize as JSON
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      const escaped = json.replace(/'/g, "''");
      return `'${escaped}'`;
    } catch {
      return "NULL";
    }
  }

  return "NULL";
}

/**
 * Escape CSV field
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format value as string
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return typeof value === "object" ? "[Object]" : String(value);
    }
  }

  if (typeof value === "object") return JSON.stringify(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return "[Unknown]";
}

// ============================================================================
// Redis-specific copy functions
// ============================================================================

/**
 * Extract cell value from a row given column field
 */
function extractCellValue(row: GridRowModel, field: string): unknown {
  const cellValue = row[field];
  return cellValue && typeof cellValue === "object" && "value" in cellValue
    ? cellValue.value
    : cellValue;
}

/**
 * Get Redis key type from row data (browser mode has 'type' in col_1)
 */
function getRedisKeyType(row: GridRowModel): string {
  const typeValue = extractCellValue(row, "col_1");
  return typeof typeValue === "string" ? typeValue.toLowerCase() : "string";
}

/**
 * Get Redis key name from row data (browser mode has 'key' in col_0)
 */
function getRedisKeyName(row: GridRowModel): string {
  const keyValue = extractCellValue(row, "col_0");
  return typeof keyValue === "string" ? keyValue : "";
}

/**
 * Escape Redis string value for CLI
 */
function escapeRedisString(value: string): string {
  // Escape quotes and newlines
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * Generate Redis GET commands for selected keys
 */
export function copyAsRedisGet(rows: GridRowModel[]): string {
  return rows
    .map((row) => {
      const key = getRedisKeyName(row);
      const keyType = getRedisKeyType(row);

      switch (keyType) {
        case "string":
          return `GET ${escapeRedisString(key)}`;
        case "hash":
          return `HGETALL ${escapeRedisString(key)}`;
        case "list":
          return `LRANGE ${escapeRedisString(key)} 0 -1`;
        case "set":
          return `SMEMBERS ${escapeRedisString(key)}`;
        case "zset":
          return `ZRANGE ${escapeRedisString(key)} 0 -1 WITHSCORES`;
        case "stream":
          return `XRANGE ${escapeRedisString(key)} - +`;
        default:
          return `GET ${escapeRedisString(key)}`;
      }
    })
    .join("\n");
}

/**
 * Generate Redis SET/write commands for selected keys
 * For browser mode, generates commands to set current values
 */
export function copyAsRedisSet(rows: GridRowModel[], columns: GridColumnV2[]): string {
  return rows
    .map((row) => {
      const key = getRedisKeyName(row);
      const keyType = getRedisKeyType(row);

      // For key view mode (hash fields, list items, etc.), use different logic
      // Check if we have standard browser columns or key-specific columns
      const isBrowserMode = columns.some(c => c.id === "key" && c.field === "col_0");

      if (isBrowserMode) {
        // Browser mode - generate type-appropriate commands
        switch (keyType) {
          case "string":
            return `SET ${escapeRedisString(key)} "<value>"`;
          case "hash":
            return `HSET ${escapeRedisString(key)} "<field>" "<value>"`;
          case "list":
            return `RPUSH ${escapeRedisString(key)} "<value>"`;
          case "set":
            return `SADD ${escapeRedisString(key)} "<member>"`;
          case "zset":
            return `ZADD ${escapeRedisString(key)} <score> "<member>"`;
          case "stream":
            return `XADD ${escapeRedisString(key)} * <field> <value>`;
          default:
            return `SET ${escapeRedisString(key)} "<value>"`;
        }
      } else {
        // Key view mode - use actual values from the row
        // col_0 is typically field/index/member, col_1 is value (or score for zset)
        const field = extractCellValue(row, "col_0");
        const value = extractCellValue(row, "col_1");

        // Detect type from column structure
        const hasScore = columns.some(c => c.name?.toLowerCase() === "score");
        const hasIndex = columns.some(c => c.name?.toLowerCase() === "index");

        if (hasScore) {
          // ZSet
          return `ZADD <key> ${value} ${escapeRedisString(String(field))}`;
        } else if (hasIndex) {
          // List
          return `LSET <key> ${field} ${escapeRedisString(String(value))}`;
        } else if (columns.length === 2 && columns[0]?.name?.toLowerCase() === "field") {
          // Hash
          return `HSET <key> ${escapeRedisString(String(field))} ${escapeRedisString(String(value))}`;
        } else if (columns.length === 1) {
          // Set
          return `SADD <key> ${escapeRedisString(String(field))}`;
        }

        return `SET <key> ${escapeRedisString(String(value ?? field))}`;
      }
    })
    .join("\n");
}

/**
 * Generate Redis DEL commands for selected keys
 */
export function copyAsRedisDel(rows: GridRowModel[]): string {
  const keys = rows.map((row) => getRedisKeyName(row)).filter(Boolean);
  if (keys.length === 0) return "";

  // DEL can take multiple keys
  return `DEL ${keys.map(k => escapeRedisString(k)).join(" ")}`;
}

/**
 * Copy Redis keys only (for pipelining or other operations)
 */
export function copyRedisKeys(rows: GridRowModel[]): string {
  return rows
    .map((row) => getRedisKeyName(row))
    .filter(Boolean)
    .join("\n");
}

// ============================================================================
// MongoDB-specific copy functions
// ============================================================================

/**
 * Format MongoDB ObjectId if it looks like one
 */
function formatMongoValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    // Check if it looks like an ObjectId (24 hex characters)
    if (/^[a-f0-9]{24}$/i.test(value)) {
      return `ObjectId("${value}")`;
    }
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return `ISODate("${value.toISOString()}")`;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}

/**
 * Generate MongoDB find query for selected documents
 */
export function copyAsMongoFind(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  collectionName: string,
): string {
  // Find the _id column
  const idColumn = columns.find(c => c.name === "_id" || c.field.includes("_id"));

  if (!idColumn || rows.length === 0) {
    return `db.${collectionName}.find({})`;
  }

  const ids = rows.map((row) => {
    const idValue = extractCellValue(row, idColumn.field);
    return formatMongoValue(idValue);
  });

  if (ids.length === 1) {
    return `db.${collectionName}.find({ _id: ${ids[0]} })`;
  }

  return `db.${collectionName}.find({ _id: { $in: [${ids.join(", ")}] } })`;
}

/**
 * Generate MongoDB insertOne/insertMany for selected documents
 */
export function copyAsMongoInsert(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  collectionName: string,
): string {
  if (rows.length === 0) return "";

  const docs = rows.map((row) => {
    const doc: Record<string, unknown> = {};
    columns.forEach((col) => {
      const columnName = col.name ?? col.field;
      // Skip _id for inserts (let MongoDB generate new ones)
      if (columnName === "_id") return;
      const value = extractCellValue(row, col.field);
      doc[columnName] = value;
    });
    return doc;
  });

  if (docs.length === 1) {
    return `db.${collectionName}.insertOne(${JSON.stringify(docs[0], null, 2)})`;
  }

  return `db.${collectionName}.insertMany(${JSON.stringify(docs, null, 2)})`;
}

/**
 * Generate MongoDB updateOne for selected documents
 */
export function copyAsMongoUpdate(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  collectionName: string,
): string {
  if (rows.length === 0) return "";

  // Find the _id column
  const idColumn = columns.find(c => c.name === "_id" || c.field.includes("_id"));

  return rows.map((row) => {
    const idValue = idColumn ? extractCellValue(row, idColumn.field) : null;
    const filter = idValue ? `{ _id: ${formatMongoValue(idValue)} }` : "{ /* filter */ }";

    // Build $set object with all non-_id fields
    const setFields: Record<string, unknown> = {};
    columns.forEach((col) => {
      const columnName = col.name ?? col.field;
      if (columnName === "_id") return;
      const value = extractCellValue(row, col.field);
      setFields[columnName] = value;
    });

    return `db.${collectionName}.updateOne(\n  ${filter},\n  { $set: ${JSON.stringify(setFields, null, 4).split("\n").join("\n  ")} }\n)`;
  }).join("\n\n");
}

/**
 * Generate MongoDB deleteOne/deleteMany for selected documents
 */
export function copyAsMongoDelete(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  collectionName: string,
): string {
  // Find the _id column
  const idColumn = columns.find(c => c.name === "_id" || c.field.includes("_id"));

  if (!idColumn || rows.length === 0) {
    return `db.${collectionName}.deleteMany({ /* filter */ })`;
  }

  const ids = rows.map((row) => {
    const idValue = extractCellValue(row, idColumn.field);
    return formatMongoValue(idValue);
  });

  if (ids.length === 1) {
    return `db.${collectionName}.deleteOne({ _id: ${ids[0]} })`;
  }

  return `db.${collectionName}.deleteMany({ _id: { $in: [${ids.join(", ")}] } })`;
}
