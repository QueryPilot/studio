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
      if (!onPaste) {
        return allowGridFallback;
      }

      const normalized = normalizeMatrix(values, coerceValue);
      const event = { target, values: normalized } satisfies GridPasteEvent;
      const result = onPaste(event);
      afterPaste?.(event, result);

      if (typeof result === "boolean") {
        return result;
      }

      return allowGridFallback;
    },
    [allowGridFallback, coerceValue, onPaste],
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
