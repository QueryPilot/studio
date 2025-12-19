/**
 * Error recovery utilities for DataGrid operations
 */

export type ErrorSeverity = "warning" | "error" | "critical";

export interface CellEditError {
  rowIndex: number;
  columnIndex: number;
  columnName: string;
  originalValue: unknown;
  attemptedValue: unknown;
  error: string;
  severity: ErrorSeverity;
  recoverable: boolean;
}

export interface BulkOperationResult<T = unknown> {
  success: boolean;
  successCount: number;
  failureCount: number;
  errors: CellEditError[];
  results: T[];
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

/**
 * Classify error severity based on error type
 */
export function classifyErrorSeverity(error: unknown): ErrorSeverity {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Critical - data integrity issues
  if (
    lower.includes("constraint") ||
    lower.includes("foreign key") ||
    lower.includes("unique") ||
    lower.includes("primary key")
  ) {
    return "critical";
  }

  // Error - type/validation issues
  if (
    lower.includes("invalid") ||
    lower.includes("type") ||
    lower.includes("cannot") ||
    lower.includes("failed")
  ) {
    return "error";
  }

  // Warning - recoverable issues
  return "warning";
}

/**
 * Check if an error is recoverable (can be retried or user can fix)
 */
export function isRecoverableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Network errors are recoverable
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("connection") ||
    lower.includes("econnrefused")
  ) {
    return true;
  }

  // Validation errors are recoverable (user can fix input)
  if (
    lower.includes("invalid") ||
    lower.includes("format") ||
    lower.includes("parse")
  ) {
    return true;
  }

  // Constraint violations are NOT recoverable without schema changes
  if (
    lower.includes("constraint") ||
    lower.includes("foreign key") ||
    lower.includes("unique violation")
  ) {
    return false;
  }

  return true;
}

/**
 * Create a standardized cell edit error
 */
export function createCellEditError(
  rowIndex: number,
  columnIndex: number,
  columnName: string,
  originalValue: unknown,
  attemptedValue: unknown,
  error: unknown
): CellEditError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    rowIndex,
    columnIndex,
    columnName,
    originalValue,
    attemptedValue,
    error: message,
    severity: classifyErrorSeverity(error),
    recoverable: isRecoverableError(error),
  };
}

/**
 * Calculate delay with exponential backoff
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry non-recoverable errors
      if (!isRecoverableError(error)) {
        throw error;
      }

      // Don't delay after last attempt
      if (attempt < fullConfig.maxAttempts - 1) {
        const delay = calculateBackoffDelay(attempt, fullConfig);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Execute bulk operations with partial failure handling
 */
export async function executeBulkOperation<T, R>(
  items: T[],
  operation: (item: T, index: number) => Promise<R>,
  options: {
    continueOnError?: boolean;
    onProgress?: (completed: number, total: number) => void;
    onError?: (error: CellEditError) => void;
  } = {}
): Promise<BulkOperationResult<R>> {
  const { continueOnError = true, onProgress, onError } = options;
  const results: R[] = [];
  const errors: CellEditError[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await operation(items[i]!, i);
      results.push(result);
      successCount++;
    } catch (error) {
      failureCount++;
      const cellError = createCellEditError(
        i,
        0,
        "unknown",
        items[i],
        items[i],
        error
      );
      errors.push(cellError);
      onError?.(cellError);

      if (!continueOnError) {
        break;
      }
    }

    onProgress?.(i + 1, items.length);
  }

  return {
    success: failureCount === 0,
    successCount,
    failureCount,
    errors,
    results,
  };
}

/**
 * Batch items into chunks for processing
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Execute batched operations with progress tracking
 */
export async function executeBatchedOperation<T, R>(
  items: T[],
  operation: (batch: T[], batchIndex: number) => Promise<R[]>,
  options: {
    batchSize?: number;
    delayBetweenBatches?: number;
    onBatchComplete?: (batchIndex: number, totalBatches: number) => void;
  } = {}
): Promise<BulkOperationResult<R>> {
  const { batchSize = 100, delayBetweenBatches = 0, onBatchComplete } = options;
  const batches = batchItems(items, batchSize);
  const allResults: R[] = [];
  const allErrors: CellEditError[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < batches.length; i++) {
    try {
      const results = await operation(batches[i]!, i);
      allResults.push(...results);
      successCount += results.length;
    } catch (error) {
      failureCount += batches[i]!.length;
      const cellError = createCellEditError(
        i * batchSize,
        0,
        "batch",
        batches[i],
        batches[i],
        error
      );
      allErrors.push(cellError);
    }

    onBatchComplete?.(i + 1, batches.length);

    // Delay between batches to prevent overwhelming the backend
    if (delayBetweenBatches > 0 && i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return {
    success: failureCount === 0,
    successCount,
    failureCount,
    errors: allErrors,
    results: allResults,
  };
}

/**
 * Format error for user display
 */
export function formatErrorForDisplay(error: CellEditError): string {
  const location = `Row ${error.rowIndex + 1}, Column "${error.columnName}"`;
  return `${location}: ${error.error}`;
}

/**
 * Group errors by column for summary display
 */
export function groupErrorsByColumn(
  errors: CellEditError[]
): Map<string, CellEditError[]> {
  const grouped = new Map<string, CellEditError[]>();
  for (const error of errors) {
    const existing = grouped.get(error.columnName) ?? [];
    existing.push(error);
    grouped.set(error.columnName, existing);
  }
  return grouped;
}

/**
 * Create error summary for bulk operations
 */
export function createErrorSummary(result: BulkOperationResult): string {
  if (result.success) {
    return `Successfully processed ${result.successCount} items`;
  }

  const lines: string[] = [
    `Processed ${result.successCount} of ${result.successCount + result.failureCount} items`,
    `${result.failureCount} failures:`,
  ];

  const grouped = groupErrorsByColumn(result.errors);
  for (const [column, errors] of grouped) {
    lines.push(`  - ${column}: ${errors.length} error(s)`);
  }

  return lines.join("\n");
}
