import { logger } from "@/lib/logger";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { BaseDialectValidator } from "./base";
import { PostgreSQLValidator } from "./postgresql";
import { MySQLValidator } from "./mysql";
import { MSSQLValidator } from "./mssql";
import { SQLiteValidator } from "./sqlite";

// Export all validators
export { PostgreSQLValidator } from "./postgresql";
export { MySQLValidator } from "./mysql";
export { MSSQLValidator } from "./mssql";
export { SQLiteValidator } from "./sqlite";
export type {
  BaseDialectValidator,
  SuppressionPattern,
  SyntaxError,
} from "./base";

// Validator registry
const validatorRegistry = new Map<SqlDialect, BaseDialectValidator>([
  ["postgresql", new PostgreSQLValidator()],
  ["plsql", new PostgreSQLValidator()], // Use PostgreSQL validator for PL/SQL dialect
  ["mysql", new MySQLValidator()],
  ["mssql", new MSSQLValidator()],
  ["sqlite", new SQLiteValidator()],
]);

/**
 * Get the appropriate dialect validator for the given SQL dialect
 * @param dialect - The SQL dialect
 * @returns The dialect validator instance
 */
export function getDialectValidator(
  dialect?: SqlDialect,
): BaseDialectValidator {
  // Default to PostgreSQL if no dialect specified
  const normalizedDialect = dialect || "postgresql";
  const validator = validatorRegistry.get(normalizedDialect);

  if (!validator) {
    logger.warn(
      `No validator found for dialect "${normalizedDialect}", falling back to PostgreSQL`,
    );
    return validatorRegistry.get("postgresql")!;
  }

  return validator;
}

/**
 * Check if a dialect is supported
 * @param dialect - The SQL dialect to check
 * @returns true if the dialect has a validator
 */
export function isDialectSupported(dialect: SqlDialect): boolean {
  return validatorRegistry.has(dialect);
}
