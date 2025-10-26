/**
 * SQL Preview Service
 *
 * Generates SQL previews for pending changes with caching and ordering.
 */

import type { DatabaseType } from "@/types/database";
import type {
  EditingScopeKey,
  ScopeState,
  DomainKind,
} from "@/stores/tableEditStore.types";
import {
  generateAddColumn,
  generateAlterColumn,
  generateDropColumn,
  generateRenameColumn,
  generateCreateIndex,
  generateDropIndex,
  generateCreateTrigger,
  generateDropTrigger,
  generateToggleTrigger,
  generateInsert,
  generateUpdate,
  generateDelete,
  generateTransaction,
  type ColumnOperation,
  type IndexOperation,
  type TriggerOperation,
  type DataOperation,
} from "@/utils/sqlGenerator";
import { hashDiffKeys } from "@/utils/changeRecordUtils";

// ============================================================================
// Types
// ============================================================================

export interface SqlPreviewOptions {
  domains?: DomainKind[];
  includeWarnings?: boolean;
  includeComments?: boolean;
  wrapInTransaction?: boolean;
}

export interface SqlPreviewResult {
  sql: string[];
  warnings: Warning[];
  generatedAt: number;
  statementCount: number;
}

export interface Warning {
  severity: "error" | "warning" | "info";
  message: string;
  domain?: DomainKind;
  entityId?: string;
}

interface CachedPreview {
  result: SqlPreviewResult;
  generatedAt: number;
  cacheKey: string;
}

// ============================================================================
// SQL Preview Service
// ============================================================================

class SqlPreviewService {
  private cache = new Map<string, CachedPreview>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Generate SQL preview for a scope
   */
  generateScopePreview(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: SqlPreviewOptions = {},
  ): SqlPreviewResult {
    const {
      domains = ["structure", "indexes", "triggers", "data"],
      includeWarnings = true,
      includeComments = true,
      wrapInTransaction = true,
    } = options;

    const cacheKey = this.generateCacheKey(scope, scopeState, domains);
    const cached = this.cache.get(cacheKey);

    // Return cached if valid
    if (cached && !this.isCacheStale(cached)) {
      return cached.result;
    }

    const sql: string[] = [];
    const warnings: Warning[] = [];

    // Add comment header
    if (includeComments) {
      sql.push(`-- Generated SQL for ${scopeState.meta.displayName}`);
      sql.push(`-- Generated at: ${new Date().toISOString()}`);
      sql.push("");
    }

    // Generate SQL in dependency order: structure → indexes → triggers → data
    const orderedDomains = this.orderDomains(domains);

    for (const domain of orderedDomains) {
      if (includeComments) {
        sql.push(`-- ${domain.toUpperCase()} CHANGES --`);
      }

      const domainResult = this.generateDomainPreview(
        domain,
        scopeState,
        scope,
        dbType,
        includeWarnings,
      );

      sql.push(...domainResult.sql);
      warnings.push(...domainResult.warnings);

      if (includeComments && domainResult.sql.length > 0) {
        sql.push("");
      }
    }

    // Wrap in transaction if requested
    let finalSql = sql;
    if (wrapInTransaction && sql.length > 2) {
      finalSql = generateTransaction(
        sql,
        { begin: true, commit: true },
        dbType,
      );
    }

    const result: SqlPreviewResult = {
      sql: finalSql,
      warnings,
      generatedAt: Date.now(),
      statementCount: finalSql.filter((s) => s && !s.startsWith("--")).length,
    };

    // Cache result
    this.cache.set(cacheKey, {
      result,
      generatedAt: Date.now(),
      cacheKey,
    });

    return result;
  }

  /**
   * Generate SQL for a specific domain
   */
  private generateDomainPreview(
    domain: DomainKind,
    scopeState: ScopeState,
    scope: EditingScopeKey,
    dbType: DatabaseType,
    includeWarnings: boolean,
  ): { sql: string[]; warnings: Warning[] } {
    switch (domain) {
      case "structure":
        return this.generateStructurePreview(
          scopeState,
          scope,
          dbType,
          includeWarnings,
        );
      case "indexes":
        return this.generateIndexesPreview(
          scopeState,
          scope,
          dbType,
          includeWarnings,
        );
      case "triggers":
        return this.generateTriggersPreview(
          scopeState,
          scope,
          dbType,
          includeWarnings,
        );
      case "data":
        return this.generateDataPreview(
          scopeState,
          scope,
          dbType,
          includeWarnings,
        );
      default:
        return { sql: [], warnings: [] };
    }
  }

  /**
   * Generate structure (column) SQL
   */
  private generateStructurePreview(
    scopeState: ScopeState,
    scope: EditingScopeKey,
    dbType: DatabaseType,
    includeWarnings: boolean,
  ): { sql: string[]; warnings: Warning[] } {
    const sql: string[] = [];
    const warnings: Warning[] = [];
    const domain = scopeState.domains.structure;

    // 1. Drop columns (do first to avoid conflicts)
    for (const columnName of domain.deletedColumns) {
      if (includeWarnings) {
        warnings.push({
          severity: "warning",
          message: `Dropping column '${columnName}' will permanently delete all data`,
          domain: "structure",
          entityId: columnName,
        });
      }

      const op: ColumnOperation = {
        type: "drop",
        schema: scope.schema,
        table: scope.table,
        column: { name: columnName },
      };

      sql.push(generateDropColumn(op, dbType));
    }

    // 2. Add new columns
    for (const [, draft] of domain.newColumns) {
      const op: ColumnOperation = {
        type: "add",
        schema: scope.schema,
        table: scope.table,
        column: {
          name: draft.name,
          db_type: draft.db_type,
          nullable: draft.nullable,
          default: draft.default,
          check_constraint: draft.check_constraint,
          comment: draft.comment,
        },
      };

      sql.push(generateAddColumn(op, dbType));
    }

    // 3. Alter existing columns
    for (const [, draft] of domain.editedColumns) {
      // Check if it's a rename
      if (draft.originalName && draft.originalName !== draft.name) {
        const op: ColumnOperation = {
          type: "rename",
          schema: scope.schema,
          table: scope.table,
          column: {
            name: draft.originalName,
            newName: draft.name,
            db_type: draft.db_type,
          },
        };

        sql.push(generateRenameColumn(op, dbType));
      }

      // Generate ALTER COLUMN statements
      const op: ColumnOperation = {
        type: "alter",
        schema: scope.schema,
        table: scope.table,
        column: {
          name: draft.name,
          db_type: draft.db_type,
          nullable: draft.nullable,
          default: draft.default,
          check_constraint: draft.check_constraint,
          comment: draft.comment,
        },
      };

      const alterStatements = generateAlterColumn(op, dbType);
      sql.push(...alterStatements);

      if (includeWarnings && alterStatements.some((s) => s.includes("TYPE"))) {
        warnings.push({
          severity: "warning",
          message: `Changing type of column '${draft.name}' may result in data loss`,
          domain: "structure",
          entityId: draft.name,
        });
      }
    }

    return { sql, warnings };
  }

  /**
   * Generate indexes SQL
   */
  private generateIndexesPreview(
    scopeState: ScopeState,
    scope: EditingScopeKey,
    dbType: DatabaseType,
    includeWarnings: boolean,
  ): { sql: string[]; warnings: Warning[] } {
    const sql: string[] = [];
    const warnings: Warning[] = [];
    const domain = scopeState.domains.indexes;

    // 1. Drop indexes
    for (const indexName of domain.deletedIndexes) {
      if (includeWarnings) {
        warnings.push({
          severity: "info",
          message: `Dropping index '${indexName}' may slow down queries`,
          domain: "indexes",
          entityId: indexName,
        });
      }

      const op: IndexOperation = {
        type: "drop",
        schema: scope.schema,
        table: scope.table,
        index: { name: indexName, columns: [] },
      };

      sql.push(generateDropIndex(op, dbType));
    }

    // 2. Create new indexes
    for (const [, draft] of domain.newIndexes) {
      const op: IndexOperation = {
        type: "create",
        schema: scope.schema,
        table: scope.table,
        index: {
          name: draft.name,
          columns: draft.columns,
          unique: draft.unique,
          indexType: draft.type,
          condition: draft.condition,
        },
      };

      sql.push(generateCreateIndex(op, dbType));
    }

    // 3. Edited indexes (drop and recreate)
    for (const [, draft] of domain.editedIndexes) {
      // Drop old
      const dropOp: IndexOperation = {
        type: "drop",
        schema: scope.schema,
        table: scope.table,
        index: { name: draft.originalName || draft.name, columns: [] },
      };
      sql.push(generateDropIndex(dropOp, dbType));

      // Create new
      const createOp: IndexOperation = {
        type: "create",
        schema: scope.schema,
        table: scope.table,
        index: {
          name: draft.name,
          columns: draft.columns,
          unique: draft.unique,
          indexType: draft.type,
          condition: draft.condition,
        },
      };
      sql.push(generateCreateIndex(createOp, dbType));
    }

    return { sql, warnings };
  }

  /**
   * Generate triggers SQL
   */
  private generateTriggersPreview(
    scopeState: ScopeState,
    scope: EditingScopeKey,
    dbType: DatabaseType,
    includeWarnings: boolean,
  ): { sql: string[]; warnings: Warning[] } {
    const sql: string[] = [];
    const warnings: Warning[] = [];
    const domain = scopeState.domains.triggers;

    // 1. Drop triggers
    for (const triggerName of domain.deletedTriggers) {
      if (includeWarnings) {
        warnings.push({
          severity: "warning",
          message: `Dropping trigger '${triggerName}' may affect data integrity`,
          domain: "triggers",
          entityId: triggerName,
        });
      }

      const op: TriggerOperation = {
        type: "drop",
        schema: scope.schema,
        table: scope.table,
        trigger: { name: triggerName },
      };

      sql.push(generateDropTrigger(op, dbType));
    }

    // 2. Create new triggers
    for (const [, draft] of domain.newTriggers) {
      const op: TriggerOperation = {
        type: "create",
        schema: scope.schema,
        table: scope.table,
        trigger: {
          name: draft.name,
          event: draft.event.split(" OR "),
          timing: draft.timing,
          level: draft.level,
          function: draft.function,
          condition: draft.condition,
        },
      };

      sql.push(generateCreateTrigger(op, dbType));
    }

    // 3. Enable/disable triggers
    for (const [, draft] of domain.editedTriggers) {
      const op: TriggerOperation = {
        type: draft.enabled ? "enable" : "disable",
        schema: scope.schema,
        table: scope.table,
        trigger: { name: draft.name },
      };

      sql.push(generateToggleTrigger(op, dbType, draft.enabled));
    }

    return { sql, warnings };
  }

  /**
   * Generate data (row) SQL
   */
  private generateDataPreview(
    scopeState: ScopeState,
    scope: EditingScopeKey,
    dbType: DatabaseType,
    includeWarnings: boolean,
  ): { sql: string[]; warnings: Warning[] } {
    const sql: string[] = [];
    const warnings: Warning[] = [];
    const domain = scopeState.domains.data;

    // Sort drafts by action: delete → insert → update
    const deletes: typeof domain.rowDrafts = new Map();
    const inserts: typeof domain.rowDrafts = new Map();
    const updates: typeof domain.rowDrafts = new Map();

    for (const [key, draft] of domain.rowDrafts) {
      if (draft.action === "delete") deletes.set(key, draft);
      else if (draft.action === "insert") inserts.set(key, draft);
      else if (draft.action === "update") updates.set(key, draft);
    }

    // 1. Deletes
    for (const [, draft] of deletes) {
      if (!draft.originalRow) continue;

      // Extract PK from original row
      const where: Record<string, any> = {};
      for (const pkCol of scopeState.meta.primaryKey) {
        const cell = draft.originalRow[pkCol];
        where[pkCol] = cell?.value ?? null;
      }

      if (Object.keys(where).length === 0) {
        if (includeWarnings) {
          warnings.push({
            severity: "error",
            message: "Cannot delete row without primary key",
            domain: "data",
            entityId: draft.rowKey,
          });
        }
        continue;
      }

      const op: DataOperation = {
        type: "delete",
        schema: scope.schema,
        table: scope.table,
        data: { where },
      };

      sql.push(generateDelete(op, dbType));
    }

    // 2. Inserts
    for (const [, draft] of inserts) {
      if (!draft.draftRow) continue;

      const columns: string[] = [];
      const values: any[] = [];

      for (const [colName, cell] of Object.entries(draft.draftRow)) {
        columns.push(colName);
        values.push(cell?.value ?? null);
      }

      if (columns.length === 0) continue;

      const op: DataOperation = {
        type: "insert",
        schema: scope.schema,
        table: scope.table,
        data: { columns, values },
      };

      sql.push(generateInsert(op, dbType));
    }

    // 3. Updates
    for (const [, draft] of updates) {
      if (!draft.originalRow || !draft.draftRow) continue;

      // Extract PK from original row
      const where: Record<string, any> = {};
      for (const pkCol of scopeState.meta.primaryKey) {
        const cell = draft.originalRow[pkCol];
        where[pkCol] = cell?.value ?? null;
      }

      if (Object.keys(where).length === 0) {
        if (includeWarnings) {
          warnings.push({
            severity: "error",
            message: "Cannot update row without primary key",
            domain: "data",
            entityId: draft.rowKey,
          });
        }
        continue;
      }

      // Extract changed cells
      const set: Record<string, any> = {};
      for (const [colName, cellDraft] of draft.cells) {
        if (cellDraft.hasChanged) {
          set[colName] = cellDraft.draftValue?.value ?? null;
        }
      }

      if (Object.keys(set).length === 0) continue;

      const op: DataOperation = {
        type: "update",
        schema: scope.schema,
        table: scope.table,
        data: { set, where },
      };

      sql.push(generateUpdate(op, dbType));
    }

    return { sql, warnings };
  }

  /**
   * Order domains by dependency
   */
  private orderDomains(domains: DomainKind[]): DomainKind[] {
    const order: DomainKind[] = [
      "structure",
      "indexes",
      "triggers",
      "constraints",
      "data",
    ];
    return order.filter((d) => domains.includes(d));
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    domains: DomainKind[],
  ): string {
    const parts = [
      scope.connectionId,
      scope.database,
      scope.schema,
      scope.table,
      domains.join(","),
      scopeState.summary.totalChanges,
      scopeState.lastTouchedAt,
    ];

    return parts.join("|||");
  }

  /**
   * Check if cache entry is stale
   */
  private isCacheStale(cached: CachedPreview): boolean {
    const age = Date.now() - cached.generatedAt;
    return age > this.cacheTTL;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for specific scope
   */
  clearScopeCache(scope: EditingScopeKey): void {
    const prefix = `${scope.connectionId}|||${scope.database}|||${scope.schema}|||${scope.table}`;

    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

// Export singleton instance
export const sqlPreviewService = new SqlPreviewService();
