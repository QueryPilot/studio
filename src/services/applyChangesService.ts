/**
 * Apply Changes Service
 *
 * Orchestrates applying all pending changes to the database.
 */

import type { DatabaseType } from "@/types/database";
import type {
  EditingScopeKey,
  ScopeState,
  DomainKind,
} from "@/stores/tableEditStore.types";
import { databaseService } from "./databaseService";
import { sqlPreviewService } from "./sqlPreviewService";
import {
  generateAddColumn,
  generateAlterColumn,
  generateDropColumn,
  generateCreateIndex,
  generateDropIndex,
  generateCreateTrigger,
  generateDropTrigger,
  generateToggleTrigger,
  generateInsert,
  generateUpdate,
  generateDelete,
  type ColumnOperation,
  type IndexOperation,
  type TriggerOperation,
  type DataOperation,
} from "@/utils/sqlGenerator";

// ============================================================================
// Types
// ============================================================================

export interface ApplyResult {
  success: boolean;
  applied?: DomainApplyResults;
  errors?: string[];
  partial?: DomainApplyResults;
}

export interface DomainApplyResults {
  structure: DomainApplyResult;
  indexes: DomainApplyResult;
  triggers: DomainApplyResult;
  data: DomainApplyResult;
}

export interface DomainApplyResult {
  success: boolean;
  applied: number;
  errors: string[];
  skipped: number;
}

export interface ApplyOptions {
  domains?: DomainKind[];
  dryRun?: boolean;
  continueOnError?: boolean;
  onProgress?: (domain: DomainKind, progress: number, total: number) => void;
}

// ============================================================================
// Apply Changes Service
// ============================================================================

class ApplyChangesService {
  /**
   * Apply all changes for a scope
   */
  async applyScope(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: ApplyOptions = {},
  ): Promise<ApplyResult> {
    const {
      domains = ["structure", "indexes", "triggers", "data"],
      dryRun = false,
      continueOnError = false,
      onProgress,
    } = options;

    const results: DomainApplyResults = {
      structure: { success: true, applied: 0, errors: [], skipped: 0 },
      indexes: { success: true, applied: 0, errors: [], skipped: 0 },
      triggers: { success: true, applied: 0, errors: [], skipped: 0 },
      data: { success: true, applied: 0, errors: [], skipped: 0 },
    };

    try {
      // Apply in dependency order: structure → indexes → triggers → data
      const orderedDomains = this.orderDomains(domains);

      for (const domain of orderedDomains) {
        // Report progress
        onProgress?.(domain, 0, 1);

        // Apply domain changes
        try {
          results[domain] = await this.applyDomain(
            domain,
            scope,
            scopeState,
            dbType,
            { dryRun, continueOnError },
          );

          // If domain failed and not continuing on error, stop
          if (!results[domain].success && !continueOnError) {
            return {
              success: false,
              errors: results[domain].errors,
              partial: results,
            };
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results[domain] = {
            success: false,
            applied: 0,
            errors: [errorMessage],
            skipped: 0,
          };

          if (!continueOnError) {
            return {
              success: false,
              errors: [errorMessage],
              partial: results,
            };
          }
        }

        // Report completion
        onProgress?.(domain, 1, 1);
      }

      // Check overall success
      const allSuccessful = Object.values(results).every((r) => r.success);

      return {
        success: allSuccessful,
        applied: results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [errorMessage],
        partial: results,
      };
    }
  }

  /**
   * Apply changes for a specific domain
   */
  private async applyDomain(
    domain: DomainKind,
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: { dryRun: boolean; continueOnError: boolean },
  ): Promise<DomainApplyResult> {
    switch (domain) {
      case "structure":
        return this.applyStructure(scope, scopeState, dbType, options);
      case "indexes":
        return this.applyIndexes(scope, scopeState, dbType, options);
      case "triggers":
        return this.applyTriggers(scope, scopeState, dbType, options);
      case "data":
        return this.applyData(scope, scopeState, dbType, options);
      default:
        return { success: true, applied: 0, errors: [], skipped: 0 };
    }
  }

  /**
   * Apply structure (column) changes
   */
  private async applyStructure(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: { dryRun: boolean; continueOnError: boolean },
  ): Promise<DomainApplyResult> {
    const domain = scopeState.domains.structure;
    const result: DomainApplyResult = {
      success: true,
      applied: 0,
      errors: [],
      skipped: 0,
    };

    if (options.dryRun) {
      result.applied =
        domain.editedColumns.size +
        domain.newColumns.size +
        domain.deletedColumns.size;
      return result;
    }

    // 1. Drop columns
    for (const columnName of domain.deletedColumns) {
      try {
        await databaseService.dropColumn(
          scope.connectionId,
          scope.schema,
          scope.table,
          columnName,
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to drop column ${columnName}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    // 2. Add new columns
    for (const [, draft] of domain.newColumns) {
      try {
        await databaseService.addColumn(
          scope.connectionId,
          scope.schema,
          scope.table,
          {
            name: draft.name,
            db_type: draft.db_type,
            nullable: draft.nullable,
            default: draft.default || undefined,
            check_constraint: draft.check_constraint || undefined,
            comment: draft.comment || undefined,
          },
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to add column ${draft.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    // 3. Modify columns
    for (const [, draft] of domain.editedColumns) {
      try {
        await databaseService.modifyColumn(
          scope.connectionId,
          scope.schema,
          scope.table,
          {
            name: draft.name,
            newType: draft.db_type,
            nullable: draft.nullable,
            defaultValue: draft.default || undefined,
            comment: draft.comment || undefined,
          },
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to modify column ${draft.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Apply index changes
   */
  private async applyIndexes(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: { dryRun: boolean; continueOnError: boolean },
  ): Promise<DomainApplyResult> {
    const domain = scopeState.domains.indexes;
    const result: DomainApplyResult = {
      success: true,
      applied: 0,
      errors: [],
      skipped: 0,
    };

    if (options.dryRun) {
      result.applied =
        domain.editedIndexes.size +
        domain.newIndexes.size +
        domain.deletedIndexes.size;
      return result;
    }

    // 1. Drop indexes
    for (const indexName of domain.deletedIndexes) {
      try {
        await databaseService.dropIndex(
          scope.connectionId,
          scope.schema,
          scope.table,
          indexName,
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to drop index ${indexName}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    // 2. Create new indexes
    for (const [, draft] of domain.newIndexes) {
      try {
        await databaseService.createIndex(
          scope.connectionId,
          scope.schema,
          scope.table,
          {
            name: draft.name,
            columns: draft.columns,
            unique: draft.unique,
            indexType: draft.type,
            condition: draft.condition,
          },
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to create index ${draft.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Apply trigger changes
   */
  private async applyTriggers(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: { dryRun: boolean; continueOnError: boolean },
  ): Promise<DomainApplyResult> {
    const domain = scopeState.domains.triggers;
    const result: DomainApplyResult = {
      success: true,
      applied: 0,
      errors: [],
      skipped: 0,
    };

    if (options.dryRun) {
      result.applied =
        domain.editedTriggers.size +
        domain.newTriggers.size +
        domain.deletedTriggers.size;
      return result;
    }

    // 1. Drop triggers
    for (const triggerName of domain.deletedTriggers) {
      try {
        await databaseService.dropTrigger(
          scope.connectionId,
          scope.schema,
          scope.table,
          triggerName,
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to drop trigger ${triggerName}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    // 2. Create new triggers
    for (const [, draft] of domain.newTriggers) {
      try {
        await databaseService.createTrigger(
          scope.connectionId,
          scope.schema,
          scope.table,
          {
            name: draft.name,
            event: draft.event.split(" OR "),
            timing: draft.timing,
            level: draft.level,
            functionName: draft.function,
            condition: draft.condition,
          },
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to create trigger ${draft.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    // 3. Enable/disable triggers
    for (const [, draft] of domain.editedTriggers) {
      try {
        await databaseService.enableDisableTrigger(
          scope.connectionId,
          scope.schema,
          scope.table,
          draft.name,
          draft.enabled,
        );
        result.applied++;
      } catch (error) {
        const errorMsg = `Failed to toggle trigger ${draft.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Apply data (row) changes
   */
  private async applyData(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: { dryRun: boolean; continueOnError: boolean },
  ): Promise<DomainApplyResult> {
    const domain = scopeState.domains.data;
    const result: DomainApplyResult = {
      success: true,
      applied: 0,
      errors: [],
      skipped: 0,
    };

    if (options.dryRun) {
      result.applied = domain.rowDrafts.size;
      return result;
    }

    // Apply changes per row
    for (const [, draft] of domain.rowDrafts) {
      try {
        if (draft.action === "delete") {
          // Build DELETE query
          const where: Record<string, any> = {};
          for (const pkCol of scopeState.meta.primaryKey) {
            const cell = draft.originalRow?.[pkCol];
            where[pkCol] = cell?.value ?? null;
          }

          // Execute via SQL generator
          const op: DataOperation = {
            type: "delete",
            schema: scope.schema,
            table: scope.table,
            data: { where },
          };

          const sql = generateDelete(op, dbType);
          await databaseService.executeQuery(scope.connectionId, sql);
          result.applied++;
        } else if (draft.action === "insert") {
          // Build INSERT query
          const columns: string[] = [];
          const values: any[] = [];

          for (const [colName, cell] of Object.entries(draft.draftRow || {})) {
            columns.push(colName);
            values.push(cell?.value ?? null);
          }

          const op: DataOperation = {
            type: "insert",
            schema: scope.schema,
            table: scope.table,
            data: { columns, values },
          };

          const sql = generateInsert(op, dbType);
          await databaseService.executeQuery(scope.connectionId, sql);
          result.applied++;
        } else if (draft.action === "update") {
          // Build UPDATE query
          const where: Record<string, any> = {};
          for (const pkCol of scopeState.meta.primaryKey) {
            const cell = draft.originalRow?.[pkCol];
            where[pkCol] = cell?.value ?? null;
          }

          const set: Record<string, any> = {};
          for (const [colName, cellDraft] of draft.cells) {
            if (cellDraft.hasChanged) {
              set[colName] = cellDraft.draftValue?.value ?? null;
            }
          }

          const op: DataOperation = {
            type: "update",
            schema: scope.schema,
            table: scope.table,
            data: { set, where },
          };

          const sql = generateUpdate(op, dbType);
          await databaseService.executeQuery(scope.connectionId, sql);
          result.applied++;
        }
      } catch (error) {
        const errorMsg = `Failed to apply row change: ${
          error instanceof Error ? error.message : String(error)
        }`;
        result.errors.push(errorMsg);
        if (!options.continueOnError) {
          result.success = false;
          return result;
        }
        result.skipped++;
      }
    }

    return result;
  }

  /**
   * Order domains by dependency
   */
  private orderDomains(domains: DomainKind[]): DomainKind[] {
    const order: DomainKind[] = ["structure", "indexes", "triggers", "data"];
    return order.filter((d) => domains.includes(d));
  }
}

// Export singleton instance
export const applyChangesService = new ApplyChangesService();
