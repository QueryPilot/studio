/**
 * SQL Dialect System
 *
 * This module provides a unified interface for database-specific SQL generation.
 * All SQL generation logic lives here - the backend simply executes the SQL.
 *
 * Architecture:
 * - Frontend generates SQL using dialect classes
 * - Backend executes SQL and handles connection/type conversion
 *
 * Usage:
 * ```typescript
 * import { getDialect } from '@/dialects';
 *
 * const dialect = getDialect(DbType.PostgreSQL);
 * const sql = dialect.getTablesQuery('public');
 * // Execute via backend: invoke('execute_query', { sql })
 * ```
 */

export * from "./types";
export * from "./base";
export { PostgresDialect, postgresDialect } from "./postgres";

import { DbType } from "@/services/backend";
import type { SqlDialect, DialectRegistry, DialectFactory } from "./types";
import { PostgresDialect } from "./postgres";

// ============================================================================
// Dialect Registry
// ============================================================================

class DialectRegistryImpl implements DialectRegistry {
  private dialects = new Map<DbType, DialectFactory>();
  private instances = new Map<DbType, SqlDialect>();

  constructor() {
    // Register built-in dialects
    this.register(DbType.PostgreSQL, () => new PostgresDialect());
    // Future: MySQL, SQLite, SQLServer will be added here
  }

  register(dbType: DbType, factory: DialectFactory): void {
    this.dialects.set(dbType, factory);
    // Clear cached instance if re-registering
    this.instances.delete(dbType);
  }

  get(dbType: DbType): SqlDialect {
    // Return cached instance
    const cached = this.instances.get(dbType);
    if (cached) {
      return cached;
    }

    // Create new instance
    const factory = this.dialects.get(dbType);
    if (!factory) {
      throw new Error(`No dialect registered for database type: ${dbType}`);
    }

    const instance = factory();
    this.instances.set(dbType, instance);
    return instance;
  }

  has(dbType: DbType): boolean {
    return this.dialects.has(dbType);
  }
}

// Global registry singleton
const registry = new DialectRegistryImpl();

/**
 * Get the SQL dialect for a database type
 */
export function getDialect(dbType: DbType): SqlDialect {
  return registry.get(dbType);
}

/**
 * Check if a dialect is available for a database type
 */
export function hasDialect(dbType: DbType): boolean {
  return registry.has(dbType);
}

/**
 * Register a custom dialect
 */
export function registerDialect(dbType: DbType, factory: DialectFactory): void {
  registry.register(dbType, factory);
}

/**
 * Get the dialect registry for advanced usage
 */
export function getDialectRegistry(): DialectRegistry {
  return registry;
}
