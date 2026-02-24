/**
 * SQL Operation Executor
 *
 * Wraps the existing commandToSql logic from the adapters module.
 * Executes SQL commands in a transaction for all-or-nothing semantics.
 */

import type { CrudCommand } from '@/types/crud';
import type { DatabaseAdapter } from '@/adapters/types';
import {
  commandToSql,
  applyColumnRenames,
  applyTableRenames,
  trackColumnRename,
  trackTableRename,
} from '@/adapters';
import { logger } from '@/lib/logger';
import type {
  ExecuteResult,
  ExecuteError,
  OperationPreview,
  PreviewOp,
  ValidationResult,
  SqlOperationExecutor as SqlOperationExecutorInterface,
} from './types';

/**
 * SQL executor implementing the OperationExecutor interface.
 * Uses existing commandToSql logic and wraps execution in transactions.
 */
export class SqlOperationExecutor implements SqlOperationExecutorInterface {
  readonly paradigm = 'sql' as const;

  constructor(
    private adapter: DatabaseAdapter,
    private connectionId: string,
  ) {}

  /**
   * Execute staged commands in a SQL transaction.
   *
   * Steps:
   * 1. Apply column/table renames to commands
   * 2. Generate SQL via commandToSql
   * 3. Wrap in transaction and execute via adapter
   * 4. Return success/error results
   */
  async execute(commands: CrudCommand[]): Promise<ExecuteResult> {
    logger.info('executor.sql', `Executing ${commands.length} commands for ${this.connectionId}`);

    const errors: ExecuteError[] = [];
    let affectedCount = 0;

    try {
      // Process commands with rename tracking
      const { statements, processedCommands } = this.processCommands(commands);

      // Filter out comment-only SQL
      const executable = this.filterExecutableStatements(statements);

      if (executable.length === 0) {
        logger.info('executor.sql', 'No executable SQL statements generated');
        return { success: true, affectedCount: 0, errors: [] };
      }

      logger.info('executor.sql', `Generated ${executable.length} SQL statements`, executable);

      // Wrap in transaction and execute
      const transactionQuery = this.adapter.transaction(executable);
      const transactionSql = typeof transactionQuery === 'string'
        ? transactionQuery
        : (transactionQuery as { sql: string }).sql;

      logger.info('executor.sql', 'Executing transaction', transactionSql);

      await this.adapter.execute(transactionQuery);

      // Transaction succeeded
      affectedCount = processedCommands.length;
      logger.info('executor.sql', `Transaction committed, affected ${affectedCount} operations`);

      return {
        success: true,
        affectedCount,
        errors: [],
      };
    } catch (error) {
      // Transaction failed - all operations rolled back
      const message = error instanceof Error ? error.message : String(error);
      logger.error('executor.sql', 'Transaction failed, all changes rolled back:', message);

      // Create errors for all commands since transaction failed
      for (const cmd of commands) {
        errors.push({
          commandId: cmd.id,
          message: `Transaction failed: ${message}`,
        });
      }

      return {
        success: false,
        affectedCount: 0,
        errors,
      };
    }
  }

  /**
   * Generate preview of SQL operations.
   *
   * Returns:
   * - content: Human-readable SQL preview
   * - operations: Structured preview for diff viewer
   */
  preview(commands: CrudCommand[]): OperationPreview {
    const { statements, processedCommands } = this.processCommands(commands);
    const executable = this.filterExecutableStatements(statements);

    // Generate human-readable SQL content
    const content = executable.length > 0
      ? executable.join(';\n\n') + ';'
      : '-- No SQL statements to execute';

    // Generate structured operations for diff viewer
    const operations: PreviewOp[] = processedCommands.map((cmd, index) => {
      const sql = statements[index] ?? null;

      // Parse operation details from command
      const action = this.getActionFromCommand(cmd);
      const target = this.getTargetFromCommand(cmd);
      const description = this.getDescriptionFromCommand(cmd, sql);

      return {
        action,
        target,
        description,
        before: this.getBeforeValue(cmd),
        after: this.getAfterValue(cmd),
      };
    });

    return {
      type: 'sql',
      content,
      operations,
    };
  }

  /**
   * Validate a single command before staging.
   *
   * Checks if SQL can be generated for this command.
   * Does not check for data conflicts - that happens during execution.
   */
  validate(command: CrudCommand): ValidationResult {
    const errors: string[] = [];

    try {
      const sql = commandToSql(this.adapter, command);

      if (!sql || sql.trim() === '') {
        errors.push('Unable to generate SQL for this operation');
      } else if (sql.startsWith('--')) {
        // Comment-only SQL indicates operation is not supported
        errors.push('This operation is not fully supported for this database type');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`SQL generation failed: ${message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Process commands with rename tracking and SQL generation.
   *
   * Returns:
   * - statements: Generated SQL strings (may include null for failed commands)
   * - processedCommands: Commands with renames applied
   */
  private processCommands(commands: CrudCommand[]): {
    statements: Array<string | null>;
    processedCommands: CrudCommand[];
  } {
    const columnRenames = new Map<string, string>();
    const tableRenames = new Map<string, string>();
    const processedCommands: CrudCommand[] = [];
    const statements: Array<string | null> = [];

    for (const originalCmd of commands) {
      // Apply renames from previous commands
      let adjustedCmd = applyTableRenames(originalCmd, tableRenames);
      adjustedCmd = applyColumnRenames(adjustedCmd, columnRenames);

      // Generate SQL
      const sql = commandToSql(this.adapter, adjustedCmd);
      statements.push(sql);
      processedCommands.push(adjustedCmd);

      // Track renames for subsequent commands
      trackTableRename(tableRenames, originalCmd, adjustedCmd);
      trackColumnRename(columnRenames, originalCmd, adjustedCmd);
    }

    return { statements, processedCommands };
  }

  /**
   * Filter out comment-only SQL statements.
   * These are generated for unsupported operations and should not be executed.
   */
  private filterExecutableStatements(statements: Array<string | null>): string[] {
    return statements.filter((sql): sql is string => {
      if (!sql || sql.trim() === '') return false;

      // Filter out comment-only statements
      const trimmed = sql.trim();
      if (trimmed.startsWith('--')) return false;

      return true;
    });
  }

  /**
   * Extract action name from command type.
   */
  private getActionFromCommand(command: CrudCommand): string {
    const [category, action] = command.type.split('.');
    return action || category || 'unknown';
  }

  /**
   * Extract target name from command.
   */
  private getTargetFromCommand(command: CrudCommand): string {
    const { schema, table } = command.target;
    if (schema && table) {
      return `${schema}.${table}`;
    }
    return table || schema || 'unknown';
  }

  /**
   * Generate human-readable description from command and SQL.
   */
  private getDescriptionFromCommand(command: CrudCommand, sql: string | null): string {
    if (!sql) {
      return `${command.type} (failed to generate SQL)`;
    }

    // Extract first line of SQL as description
    const firstLine = sql.split('\n')[0]?.trim() || '';

    // If it's too long, truncate
    if (firstLine.length > 80) {
      return firstLine.substring(0, 77) + '...';
    }

    return firstLine;
  }

  /**
   * Extract "before" value for diff viewer.
   */
  private getBeforeValue(command: CrudCommand): unknown {
    if (command.type === 'data.update') {
      const payload = command.payload as { column?: string; oldValue?: unknown };
      return payload.oldValue;
    }

    if (command.type === 'data.delete') {
      const payload = command.payload as { primaryKeys?: Record<string, unknown> };
      return payload.primaryKeys;
    }

    return undefined;
  }

  /**
   * Extract "after" value for diff viewer.
   */
  private getAfterValue(command: CrudCommand): unknown {
    if (command.type === 'data.insert') {
      const payload = command.payload as { values?: Record<string, unknown> };
      return payload.values;
    }

    if (command.type === 'data.update') {
      const payload = command.payload as { column?: string; newValue?: unknown };
      return payload.newValue;
    }

    return undefined;
  }
}
