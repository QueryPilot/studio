import { logger } from "@/lib/logger";
/**
 * Represents a table reference in SQL
 */
export interface TableReference {
  schema?: string;
  table: string;
}

/**
 * Parse SQL to extract affected table names from mutation queries
 * (INSERT, UPDATE, DELETE, TRUNCATE)
 *
 * This is a simple regex-based parser suitable for most common SQL patterns.
 * For complex queries with CTEs, subqueries, etc., this may not catch all tables.
 *
 * @param sql - The SQL query to parse
 * @returns Array of table references found in the query
 */
export function parseMutationTables(sql: string): TableReference[] {
  try {
    // Remove comments to avoid false matches
    let normalized = sql
      .replace(/--.*$/gm, "") // Remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
      .toLowerCase()
      .trim();

    // Remove quoted strings to avoid false matches in string literals
    normalized = normalized.replace(/'[^']*'/g, "''");
    normalized = normalized.replace(/"([^"]*)"/g, (match) => {
      // Keep quoted identifiers but normalize them
      return match.toLowerCase();
    });

    const tables: TableReference[] = [];

    // Pattern: INSERT INTO [schema.]table (supports quoted identifiers)
    const insertPattern = /insert\s+into\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    let match = insertPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = insertPattern.exec(normalized);
    }

    // Pattern: UPDATE [schema.]table
    const updatePattern = /update\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = updatePattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = updatePattern.exec(normalized);
    }

    // Pattern: DELETE FROM [schema.]table
    const deletePattern = /delete\s+from\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = deletePattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = deletePattern.exec(normalized);
    }

    // Pattern: TRUNCATE [TABLE] [schema.]table
    const truncatePattern = /truncate(?:\s+table)?\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = truncatePattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = truncatePattern.exec(normalized);
    }

    // Pattern: DROP TABLE [schema.]table
    const dropPattern = /drop\s+table\s+(?:if\s+exists\s+)?(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = dropPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = dropPattern.exec(normalized);
    }

    // Pattern: CREATE TABLE [schema.]table
    const createPattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = createPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = createPattern.exec(normalized);
    }

    // Pattern: ALTER TABLE [schema.]table
    const alterPattern = /alter\s+table\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = alterPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = alterPattern.exec(normalized);
    }

    // Pattern: DROP VIEW [IF EXISTS] [schema.]view
    const dropViewPattern = /drop\s+view\s+(?:if\s+exists\s+)?(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = dropViewPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = dropViewPattern.exec(normalized);
    }

    // Pattern: CREATE [OR REPLACE] VIEW [schema.]view
    const createViewPattern = /create\s+(?:or\s+replace\s+)?view\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = createViewPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = createViewPattern.exec(normalized);
    }

    // Pattern: DROP MATERIALIZED VIEW [IF EXISTS] [schema.]view
    const dropMatViewPattern = /drop\s+materialized\s+view\s+(?:if\s+exists\s+)?(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = dropMatViewPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = dropMatViewPattern.exec(normalized);
    }

    // Pattern: CREATE MATERIALIZED VIEW [schema.]view
    const createMatViewPattern = /create\s+materialized\s+view\s+(?:(?:"?(\w+)"?|(\w+))\.)?(?:"?(\w+)"?|(\w+))/gi;
    match = createMatViewPattern.exec(normalized);
    while (match) {
      tables.push({
        schema: match[1] || match[2],
        table: (match[3] || match[4])!,
      });
      match = createMatViewPattern.exec(normalized);
    }

    // Remove duplicates (keep first occurrence)
    const seen = new Set<string>();
    const uniqueTables = tables.filter((ref) => {
      const key = `${ref.schema ?? ""}:${ref.table}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    logger.info(`[SQLParser] Parsed ${uniqueTables.length} unique table(s) from SQL:`, uniqueTables);
    return uniqueTables;
  } catch (error) {
    logger.error("[SQLParser] Error parsing SQL:", error, { sql });
    // Return empty array on error to prevent crashes
    return [];
  }
}

