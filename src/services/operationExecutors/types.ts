import type { CrudCommand } from '@/types/crud';

/**
 * Result of executing commands
 */
export interface ExecuteResult {
  success: boolean;
  affectedCount: number;
  errors: ExecuteError[];
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
   */
  execute(commands: CrudCommand[]): Promise<ExecuteResult>;

  /**
   * Generate preview of what commands will do
   */
  preview(commands: CrudCommand[]): OperationPreview;

  /**
   * Validate a command before staging
   */
  validate(command: CrudCommand): ValidationResult;
}
