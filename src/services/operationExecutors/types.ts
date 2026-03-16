import type { CrudCommand } from '@/types/crud';

/**
 * Result of executing commands
 */
export interface ExecuteResult {
  success: boolean;
  affectedCount: number;
  errors: ExecuteError[];
  /** IDs of commands that were successfully committed (for partial-failure cleanup) */
  committedCommandIds?: string[];
}

export interface ExecuteError {
  commandId: string;
  message: string;
}

/**
 * Preview of operations before execution
 */
export interface OperationPreview {
  type: 'sql' | 'mongo-ops' | 'redis-cmds';
  content: string;           // Human-readable preview
  operations: PreviewOp[];   // Structured for diff viewer
}

export interface PreviewOp {
  action: string;            // 'insert', 'update', 'delete', 'set', 'hset', etc.
  target: string;            // table/collection/key name
  description: string;       // Human-readable description
  before?: unknown;          // Previous value (for updates/deletes)
  after?: unknown;           // New value (for inserts/updates)
}

/**
 * Validation result for a command
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Operation executor interface
 * Each database paradigm implements this for command execution
 */
export interface OperationExecutor {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';

  /**
   * Execute staged commands against the database
   *
   * Transaction Behavior:
   * - SQL: Commands execute in a single transaction (all-or-nothing)
   * - MongoDB: Uses multi-document transactions if available
   * - Redis: Commands execute via MULTI/EXEC (atomic batch)
   *
   * Failure Handling:
   * - SQL: Entire transaction rolls back on any failure
   * - MongoDB: Rolls back if transaction supported, otherwise partial execution
   * - Redis: MULTI/EXEC fails atomically, no partial execution
   *
   * @param commands - Array of CRUD commands to execute
   * @returns Promise resolving to execution result with success status and errors
   */
  execute(commands: CrudCommand[]): Promise<ExecuteResult>;

  /**
   * Generate a human-readable preview of what commands will do
   *
   * This is a synchronous operation that does not touch the database.
   * Useful for showing users what will happen before they commit changes.
   *
   * @param commands - Array of CRUD commands to preview
   * @returns Preview object with paradigm-specific content and structured operations
   */
  preview(commands: CrudCommand[]): OperationPreview;

  /**
   * Validate a single command before staging
   *
   * Performs syntax and semantic validation without database connection.
   * Does not check for data conflicts - that happens during execution.
   *
   * @param command - CRUD command to validate
   * @returns Validation result with any errors found
   */
  validate(command: CrudCommand): ValidationResult;
}

/**
 * SQL-specific operation executor
 */
export interface SqlOperationExecutor extends OperationExecutor {
  readonly paradigm: 'sql';
}

/**
 * Document-specific operation executor (MongoDB)
 */
export interface DocumentOperationExecutor extends OperationExecutor {
  readonly paradigm: 'document';
}

/**
 * Key-Value operation executor (Redis)
 */
export interface KeyValueOperationExecutor extends OperationExecutor {
  readonly paradigm: 'keyvalue';
}

/**
 * Type guard to check if executor is SQL
 */
export function isSqlExecutor(executor: OperationExecutor): executor is SqlOperationExecutor {
  return executor.paradigm === 'sql';
}

/**
 * Type guard to check if executor is Document
 */
export function isDocumentExecutor(executor: OperationExecutor): executor is DocumentOperationExecutor {
  return executor.paradigm === 'document';
}

/**
 * Type guard to check if executor is KeyValue
 */
export function isKeyValueExecutor(executor: OperationExecutor): executor is KeyValueOperationExecutor {
  return executor.paradigm === 'keyvalue';
}
