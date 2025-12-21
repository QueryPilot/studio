import { logger } from "@/lib/logger";
import { useCallback, useMemo } from "react";
import type { Item } from "@glideapps/glide-data-grid";
import type { DataGridBaseProps } from "../base/DataGridBase";
import type { GridPasteEvent } from "../types";
import {
  type ColumnTypeHint,
  type PasteValidationError,
  coerceToColumnType,
  validatePasteData,
} from "../utils/pasteUtils";

export type DataEditorPasteHandler = NonNullable<DataGridBaseProps["onPaste"]>;

export interface UsePasteHandlerOptions {
  onPaste?: (event: GridPasteEvent) => boolean | undefined;
  coerceValue?: (value: string) => string | number | boolean | null;
  allowGridFallback?: boolean;
  afterPaste?: (event: GridPasteEvent, result: unknown) => void;
  /** Column type hints for smart paste coercion (ordered by column index) */
  columnHints?: ColumnTypeHint[];
  /** Callback when paste has validation errors */
  onValidationErrors?: (errors: PasteValidationError[]) => void;
}

export interface UsePasteHandlerResult {
  handleDataEditorPaste: DataEditorPasteHandler;
  parseTextMatrix: (text: string) => string[][];
}

const defaultCoerce = (value: string): string | number | boolean | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (/^null$/i.test(trimmed)) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  const maybeNumber = Number(trimmed);
  if (!Number.isNaN(maybeNumber) && trimmed === `${maybeNumber}`) {
    return maybeNumber;
  }
  return value;
};

/**
 * Smart coercion that uses column type hints when available
 */
const smartCoerce = (
  value: string,
  colIndex: number,
  targetColIndex: number,
  columnHints?: ColumnTypeHint[],
  fallbackCoerce?: (value: string) => string | number | boolean | null,
): string | number | boolean | null => {
  // Calculate the actual column index based on target offset
  const actualColIndex = targetColIndex + colIndex;
  const hint = columnHints?.[actualColIndex];

  if (hint) {
    return coerceToColumnType(value, hint);
  }

  // Fall back to default coercion
  return fallbackCoerce ? fallbackCoerce(value) : defaultCoerce(value);
};

const normalizeMatrix = (
  values: readonly (readonly string[])[],
  coerce: (value: string) => string | number | boolean | null,
): (string | number | boolean | null)[][] =>
  values.map((row) => row.map((value) => coerce(value)));

/**
 * Smart normalization with column type hints
 */
const normalizeMatrixWithHints = (
  values: readonly (readonly string[])[],
  targetColIndex: number,
  columnHints?: ColumnTypeHint[],
  fallbackCoerce?: (value: string) => string | number | boolean | null,
): (string | number | boolean | null)[][] =>
  values.map((row) =>
    row.map((value, colIndex) =>
      smartCoerce(value, colIndex, targetColIndex, columnHints, fallbackCoerce)
    )
  );

export function parseClipboardText(text: string): string[][] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, index, arr) => !(line === "" && index === arr.length - 1))
    .map((line) => line.split("\t"));
}

export function usePasteHandler(
  options: UsePasteHandlerOptions = {},
): UsePasteHandlerResult {
  const {
    onPaste,
    coerceValue = defaultCoerce,
    allowGridFallback = false,
    afterPaste,
    columnHints,
    onValidationErrors,
  } = options;

  const handleDataEditorPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      const [targetColIndex] = target;
      logger.info('[usePasteHandler] handleDataEditorPaste called:', {
        target,
        values,
        hasOnPaste: !!onPaste,
        allowGridFallback,
        hasColumnHints: !!columnHints,
      });

      if (!onPaste) {
        logger.info('[usePasteHandler] No onPaste handler, returning allowGridFallback:', allowGridFallback);
        return allowGridFallback;
      }

      // Use smart coercion if column hints are available
      const normalized = columnHints
        ? normalizeMatrixWithHints(values, targetColIndex, columnHints, coerceValue)
        : normalizeMatrix(values, coerceValue);

      // Validate paste data if column hints are provided
      if (columnHints && onValidationErrors) {
        // Build hints for the target columns only
        const targetHints = columnHints.slice(targetColIndex);
        const errors = validatePasteData(normalized, targetHints);
        if (errors.length > 0) {
          logger.info('[usePasteHandler] Validation errors found:', errors);
          onValidationErrors(errors);
        }
      }

      const event = { target, values: normalized } satisfies GridPasteEvent;
      logger.info('[usePasteHandler] Calling onPaste with normalized event:', event);
      const result = onPaste(event);
      logger.info('[usePasteHandler] onPaste returned:', result);
      afterPaste?.(event, result);

      if (typeof result === "boolean") {
        logger.info('[usePasteHandler] Returning boolean result:', result);
        return result;
      }

      logger.info('[usePasteHandler] Returning allowGridFallback:', allowGridFallback);
      return allowGridFallback;
    },
    [allowGridFallback, coerceValue, onPaste, afterPaste, columnHints, onValidationErrors],
  );

  const parseTextMatrix = useCallback<UsePasteHandlerResult["parseTextMatrix"]>(
    (text) => parseClipboardText(text),
    [],
  );

  return useMemo(
    () => ({ handleDataEditorPaste, parseTextMatrix }),
    [handleDataEditorPaste, parseTextMatrix],
  );
}
