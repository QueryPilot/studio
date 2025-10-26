/**
 * Validation Service
 *
 * Async validation with dry-run execution for pending changes.
 */

import type { DatabaseType } from "@/types/database";
import type {
  EditingScopeKey,
  ScopeState,
  ValidationResult,
  ValidationDiagnostic,
} from "@/stores/tableEditStore.types";
import { sqlPreviewService } from "./sqlPreviewService";
import { databaseService } from "./databaseService";

// ============================================================================
// Types
// ============================================================================

export interface ValidationOptions {
  timeoutMs?: number;
  checkSyntaxOnly?: boolean; // For databases that don't support DDL in transactions
  onProgress?: (message: string) => void;
}

export interface ValidationError {
  message: string;
  sql?: string;
  line?: number;
  column?: number;
}

// ============================================================================
// Validation Service
// ============================================================================

class ValidationService {
  private abortControllers = new Map<string, AbortController>();

  /**
   * Validate scope changes with dry-run
   */
  async validateScope(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
    options: ValidationOptions = {},
  ): Promise<ValidationResult> {
    const { timeoutMs = 30000, checkSyntaxOnly = false, onProgress } = options;

    const startTime = Date.now();
    const scopeKey = this.getScopeKey(scope);

    // Cancel any existing validation for this scope
    this.cancel(scopeKey);

    // Create new abort controller
    const abortController = new AbortController();
    this.abortControllers.set(scopeKey, abortController);

    try {
      onProgress?.("Generating SQL preview...");

      // Generate SQL preview
      const preview = sqlPreviewService.generateScopePreview(
        scope,
        scopeState,
        dbType,
        { includeWarnings: true, wrapInTransaction: true },
      );

      // Check for preview warnings
      const diagnostics: ValidationDiagnostic[] = preview.warnings.map((w) => ({
        severity: w.severity,
        message: w.message,
        source: w.domain,
      }));

      // If syntax-only mode or no statements, return early
      if (checkSyntaxOnly || preview.sql.length === 0) {
        return {
          status: diagnostics.some((d) => d.severity === "error")
            ? "failed"
            : "passed",
          checkedAt: Date.now(),
          diagnostics,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check for databases that don't support DDL in transactions
      if (dbType === "sqlite" || dbType === "mongodb") {
        diagnostics.push({
          severity: "warning",
          message: `${dbType} does not support full transaction rollback for DDL. Validation is syntax-only.`,
        });

        return {
          status: diagnostics.some((d) => d.severity === "error")
            ? "failed"
            : "passed",
          checkedAt: Date.now(),
          diagnostics,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Perform dry-run validation
      onProgress?.("Running dry-run validation...");

      try {
        await this.executeDryRun(
          scope.connectionId,
          preview.sql,
          dbType,
          abortController.signal,
          timeoutMs,
        );

        // If we get here, validation passed
        diagnostics.push({
          severity: "info",
          message: "All changes validated successfully",
        });

        return {
          status: "passed",
          checkedAt: Date.now(),
          diagnostics,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        // Validation failed
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        diagnostics.push({
          severity: "error",
          message: `Validation failed: ${errorMessage}`,
        });

        return {
          status: "failed",
          checkedAt: Date.now(),
          diagnostics,
          executionTimeMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      // Unexpected error during validation
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        status: "failed",
        checkedAt: Date.now(),
        diagnostics: [
          {
            severity: "error",
            message: `Validation error: ${errorMessage}`,
          },
        ],
        executionTimeMs: Date.now() - startTime,
      };
    } finally {
      this.abortControllers.delete(scopeKey);
    }
  }

  /**
   * Execute dry-run (wrapped in transaction with ROLLBACK)
   */
  private async executeDryRun(
    connectionId: string,
    sqlStatements: string[],
    dbType: DatabaseType,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    // Create dry-run SQL
    const dryRunSql = this.createDryRunSql(sqlStatements, dbType);

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Validation timeout")), timeoutMs);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error("Validation cancelled"));
      }
      signal.addEventListener("abort", () => {
        reject(new Error("Validation cancelled"));
      });
    });

    // Execute query
    try {
      await Promise.race([
        databaseService.executeQuery(connectionId, dryRunSql),
        timeoutPromise,
        abortPromise,
      ]);
    } catch (error) {
      // Check if it's a validation error or execution error
      if (error instanceof Error) {
        // Extract useful error information
        throw new Error(this.parseValidationError(error.message));
      }
      throw error;
    }
  }

  /**
   * Create dry-run SQL with transaction rollback
   */
  private createDryRunSql(
    sqlStatements: string[],
    dbType: DatabaseType,
  ): string {
    const filtered = sqlStatements.filter((s) => s && !s.startsWith("--"));

    if (dbType === "mssql") {
      return `
        BEGIN TRANSACTION;
        BEGIN TRY
          ${filtered.join(";\n")}
          ROLLBACK TRANSACTION;
        END TRY
        BEGIN CATCH
          ROLLBACK TRANSACTION;
          THROW;
        END CATCH
      `;
    }

    // PostgreSQL, MySQL, MariaDB
    return `
      BEGIN;
      ${filtered.join(";\n")};
      ROLLBACK;
    `;
  }

  /**
   * Parse validation error message to extract useful information
   */
  private parseValidationError(message: string): string {
    // Remove common prefixes
    message = message.replace(/^ERROR:\s*/i, "");
    message = message.replace(/^SQLSTATE\[[^\]]+\]:\s*/i, "");

    // Truncate very long messages
    if (message.length > 500) {
      message = message.substring(0, 497) + "...";
    }

    return message;
  }

  /**
   * Cancel validation for a scope
   */
  cancel(scopeKey: string): void {
    const controller = this.abortControllers.get(scopeKey);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(scopeKey);
    }
  }

  /**
   * Cancel all validations
   */
  cancelAll(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /**
   * Get scope key for abort controller map
   */
  private getScopeKey(scope: EditingScopeKey): string {
    return `${scope.connectionId}|||${scope.database}|||${scope.schema}|||${scope.table}`;
  }

  /**
   * Quick syntax validation without execution
   */
  async validateSyntax(
    scope: EditingScopeKey,
    scopeState: ScopeState,
    dbType: DatabaseType,
  ): Promise<ValidationResult> {
    return this.validateScope(scope, scopeState, dbType, {
      checkSyntaxOnly: true,
    });
  }
}

// Export singleton instance
export const validationService = new ValidationService();
