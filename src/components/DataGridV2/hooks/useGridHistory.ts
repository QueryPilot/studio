import { useCallback, useMemo, useRef, useState } from "react";
import type {
  GridHistoryEntry,
  PushHistoryOptions,
} from "../types";

export interface UseGridHistoryOptions {
  maxDepth?: number;
}

export interface UseGridHistoryResult<TMetadata = unknown> {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  push: (entry: GridHistoryEntry<TMetadata>, options?: PushHistoryOptions) => void;
  peekUndo: () => GridHistoryEntry<TMetadata> | undefined;
  peekRedo: () => GridHistoryEntry<TMetadata> | undefined;
  undoStack: readonly GridHistoryEntry<TMetadata>[];
  redoStack: readonly GridHistoryEntry<TMetadata>[];
}

const DEFAULT_MAX_DEPTH = 100;

export function useGridHistory<TMetadata = unknown>(
  options: UseGridHistoryOptions = {},
): UseGridHistoryResult<TMetadata> {
  const { maxDepth = DEFAULT_MAX_DEPTH } = options;
  const undoStackRef = useRef<GridHistoryEntry<TMetadata>[]>([]);
  const redoStackRef = useRef<GridHistoryEntry<TMetadata>[]>([]);
  const [revision, setRevision] = useState(0);

  const emitRevision = useCallback(() => {
    setRevision((prev) => prev + 1);
  }, []);

  const push = useCallback<UseGridHistoryResult<TMetadata>["push"]>(
    (entry, pushOptions) => {
      const timestampedEntry =
        entry.timestamp != null ? entry : { ...entry, timestamp: Date.now() };

      undoStackRef.current.push(timestampedEntry);
      if (undoStackRef.current.length > maxDepth) {
        undoStackRef.current.shift();
      }

      redoStackRef.current = [];

      if (pushOptions?.applyRedo) {
        timestampedEntry.redo();
      }

      emitRevision();
    },
    [emitRevision, maxDepth],
  );

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    try {
      entry.undo();
    } finally {
      redoStackRef.current.push(entry);
      emitRevision();
    }
  }, [emitRevision]);

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    try {
      entry.redo();
    } finally {
      undoStackRef.current.push(entry);
      emitRevision();
    }
  }, [emitRevision]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    emitRevision();
  }, [emitRevision]);

  const peekUndo = useCallback<UseGridHistoryResult<TMetadata>["peekUndo"]>(
    () => undoStackRef.current[undoStackRef.current.length - 1],
    [],
  );

  const peekRedo = useCallback<UseGridHistoryResult<TMetadata>["peekRedo"]>(
    () => redoStackRef.current[redoStackRef.current.length - 1],
    [],
  );

  const snapshot = useMemo(() => ({
    undoStack: [...undoStackRef.current],
    redoStack: [...redoStackRef.current],
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
  }), [revision]);

  return {
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    undo,
    redo,
    clear,
    push,
    peekUndo,
    peekRedo,
    undoStack: snapshot.undoStack,
    redoStack: snapshot.redoStack,
  };
}
