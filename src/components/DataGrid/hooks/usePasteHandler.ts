import { logger } from "@/lib/logger";
import { useCallback, useMemo } from "react";
import type { Item } from "@glideapps/glide-data-grid";
import type { DataGridBaseProps } from "../base/DataGridBase";
import type { GridPasteEvent } from "../types";

export type DataEditorPasteHandler = NonNullable<DataGridBaseProps["onPaste"]>;

export interface UsePasteHandlerOptions {
  onPaste?: (event: GridPasteEvent) => boolean | undefined;
  coerceValue?: (value: string) => string | number | boolean | null;
  allowGridFallback?: boolean;
  afterPaste?: (event: GridPasteEvent, result: unknown) => void;
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

const normalizeMatrix = (
  values: readonly (readonly string[])[],
  coerce: (value: string) => string | number | boolean | null,
): (string | number | boolean | null)[][] =>
  values.map((row) => row.map((value) => coerce(value)));

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
  } = options;

  const handleDataEditorPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      logger.info('[usePasteHandler] handleDataEditorPaste called:', { target, values, hasOnPaste: !!onPaste, allowGridFallback });
      if (!onPaste) {
        logger.info('[usePasteHandler] No onPaste handler, returning allowGridFallback:', allowGridFallback);
        return allowGridFallback;
      }

      const normalized = normalizeMatrix(values, coerceValue);
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
    [allowGridFallback, coerceValue, onPaste, afterPaste],
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
