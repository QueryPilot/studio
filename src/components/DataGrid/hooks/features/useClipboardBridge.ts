import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { GridSelection } from "@glideapps/glide-data-grid";
import { writeClipboardText, isClipboardAvailable } from "@/lib/clipboard";

export type CopyMode = "text" | "json";

export interface UseClipboardBridgeOptions {
  toText: (selection: GridSelection) => string;
  toJson: (selection: GridSelection) => unknown[];
  onCopySuccess?: (mode: CopyMode) => void;
  onCopyError?: (mode: CopyMode, error: unknown) => void;
}

type KeyboardLikeEvent = KeyboardEvent | ReactKeyboardEvent<unknown>;

export interface UseClipboardBridgeResult {
  copySelection: (selection: GridSelection, mode?: CopyMode) => Promise<void>;
  handleKeyboardCopy: (
    event: KeyboardLikeEvent,
    selection: GridSelection | undefined,
  ) => Promise<boolean>;
  lastCopyMode: CopyMode | null;
}

export const hasNavigatorClipboard = isClipboardAvailable();

/**
 * Write text to clipboard using Tauri's native clipboard plugin.
 * Falls back to browser API in non-Tauri environments.
 */
export const writeTextToClipboard = writeClipboardText;

export function useClipboardBridge(
  options: UseClipboardBridgeOptions,
): UseClipboardBridgeResult {
  const { toText, toJson, onCopySuccess, onCopyError } = options;
  const [lastCopyMode, setLastCopyMode] = useState<CopyMode | null>(null);

  const copySelection = useCallback<UseClipboardBridgeResult["copySelection"]>(
    async (selection, mode = "text") => {
      try {
        const payload =
          mode === "json"
            ? JSON.stringify(toJson(selection), null, 2)
            : toText(selection);

        if (!payload) throw new Error("Clipboard payload is empty");

        await writeTextToClipboard(payload);
        setLastCopyMode(mode);
        onCopySuccess?.(mode);
      } catch (error) {
        onCopyError?.(mode, error);
        throw error;
      }
    },
    [onCopyError, onCopySuccess, toJson, toText],
  );

  const handleKeyboardCopy = useCallback<
    UseClipboardBridgeResult["handleKeyboardCopy"]
  >(
    async (event, selection) => {
      if (!selection) return false;

      const key = event.key.toLowerCase();
      const isMeta = event.metaKey || event.ctrlKey;

      if (!isMeta || key !== "c") {
        return false;
      }

      event.preventDefault();
      const mode: CopyMode = event.shiftKey ? "json" : "text";
      await copySelection(selection, mode);
      return true;
    },
    [copySelection],
  );

  return useMemo(
    () => ({ copySelection, handleKeyboardCopy, lastCopyMode }),
    [copySelection, handleKeyboardCopy, lastCopyMode],
  );
}
