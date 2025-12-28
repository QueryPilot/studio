/**
 * Optimized bulk paste operations for large datasets
 */

import type { ColumnTypeHint, PasteValidationError } from "./pasteUtils";
import { coerceToColumnType, validatePasteData } from "./pasteUtils";

export interface BulkPasteOptions {
  /** Column type hints for smart coercion */
  columnHints: ColumnTypeHint[];
  /** Batch size for processing (default: 500) */
  batchSize?: number;
  /** Whether to validate before applying (default: true) */
  validate?: boolean;
  /** Progress callback */
  onProgress?: (progress: BulkPasteProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface BulkPasteProgress {
  phase: "coercing" | "validating" | "complete";
  processed: number;
  total: number;
  percent: number;
}

export interface BulkPasteResult {
  /** Coerced rows ready for insertion */
  rows: (string | number | boolean | null)[][];
  /** Validation errors (if validation enabled) */
  errors: PasteValidationError[];
  /** Whether operation was cancelled */
  cancelled: boolean;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Process large paste data in batches with progress reporting
 */
export async function processBulkPaste(
  rawRows: (string | number | boolean | null)[][],
  options: BulkPasteOptions
): Promise<BulkPasteResult> {
  const {
    columnHints,
    batchSize = 500,
    validate = true,
    onProgress,
    signal,
  } = options;

  const startTime = performance.now();
  const totalRows = rawRows.length;
  const coercedRows: (string | number | boolean | null)[][] = [];
  const allErrors: PasteValidationError[] = [];

  // Phase 1: Coerce values in batches
  for (let i = 0; i < totalRows; i += batchSize) {
    if (signal?.aborted) {
      return {
        rows: coercedRows,
        errors: allErrors,
        cancelled: true,
        processingTimeMs: performance.now() - startTime,
      };
    }

    const batch = rawRows.slice(i, i + batchSize);
    const coercedBatch = coerceBatch(batch, columnHints);
    coercedRows.push(...coercedBatch);

    onProgress?.({
      phase: "coercing",
      processed: Math.min(i + batchSize, totalRows),
      total: totalRows,
      percent: Math.round((Math.min(i + batchSize, totalRows) / totalRows) * 50),
    });

    // Yield to main thread every batch
    await yieldToMain();
  }

  // Phase 2: Validate in batches (if enabled)
  if (validate) {
    for (let i = 0; i < coercedRows.length; i += batchSize) {
      if (signal?.aborted) {
        return {
          rows: coercedRows,
          errors: allErrors,
          cancelled: true,
          processingTimeMs: performance.now() - startTime,
        };
      }

      const batch = coercedRows.slice(i, i + batchSize);
      const batchHints = columnHints.slice(0, batch[0]?.length ?? 0);
      const batchErrors = validatePasteData(batch, batchHints);

      // Adjust row indices to global position
      for (const error of batchErrors) {
        allErrors.push({
          ...error,
          row: error.row + i,
        });
      }

      onProgress?.({
        phase: "validating",
        processed: Math.min(i + batchSize, coercedRows.length),
        total: coercedRows.length,
        percent: 50 + Math.round((Math.min(i + batchSize, coercedRows.length) / coercedRows.length) * 50),
      });

      await yieldToMain();
    }
  }

  onProgress?.({
    phase: "complete",
    processed: totalRows,
    total: totalRows,
    percent: 100,
  });

  return {
    rows: coercedRows,
    errors: allErrors,
    cancelled: false,
    processingTimeMs: performance.now() - startTime,
  };
}

/**
 * Coerce a batch of rows
 */
function coerceBatch(
  rows: (string | number | boolean | null)[][],
  columnHints: ColumnTypeHint[]
): (string | number | boolean | null)[][] {
  return rows.map((row) =>
    row.map((value, colIndex) => {
      const hint = columnHints[colIndex];
      if (!hint) return value;
      return coerceToColumnType(value, hint);
    })
  );
}

/**
 * Yield to main thread using requestIdleCallback or setTimeout fallback
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => { resolve(); }, { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Estimate processing time for paste operation
 */
export function estimatePasteProcessingTime(
  rowCount: number,
  columnCount: number
): { estimatedMs: number; isLarge: boolean } {
  // Rough estimate: ~0.1ms per cell for coercion + validation
  const cellCount = rowCount * columnCount;
  const estimatedMs = cellCount * 0.1;
  return {
    estimatedMs,
    isLarge: cellCount > 5000, // Consider large if >5000 cells
  };
}

/**
 * Create chunked paste data for incremental application
 */
export function createPasteChunks(
  rows: (string | number | boolean | null)[][],
  chunkSize: number
): {
  chunks: (string | number | boolean | null)[][][];
  totalChunks: number;
} {
  const chunks: (string | number | boolean | null)[][][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return {
    chunks,
    totalChunks: chunks.length,
  };
}

/**
 * Apply paste chunks incrementally with progress
 */
export async function applyPasteChunks<T>(
  chunks: (string | number | boolean | null)[][][],
  applyChunk: (
    chunk: (string | number | boolean | null)[][],
    startRowIndex: number
  ) => Promise<T>,
  options: {
    onProgress?: (chunkIndex: number, totalChunks: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ results: T[]; cancelled: boolean }> {
  const { onProgress, signal } = options;
  const results: T[] = [];
  let startRowIndex = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) {
      return { results, cancelled: true };
    }

    const chunk = chunks[i]!;
    const result = await applyChunk(chunk, startRowIndex);
    results.push(result);
    startRowIndex += chunk.length;

    onProgress?.(i + 1, chunks.length);
    await yieldToMain();
  }

  return { results, cancelled: false };
}
