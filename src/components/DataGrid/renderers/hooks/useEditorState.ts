import { useCallback, useRef, useEffect } from "react";

type Movement = readonly [-1 | 0 | 1, -1 | 0 | 1];

export interface EditorStateOptions<T> {
  /** The original value when editing started */
  originalValue: T;
  /** Whether the field is nullable */
  nullable?: boolean;
  /** Callback to finish editing with new value */
  onFinish: (newValue: T | undefined, movement?: Movement) => void;
  /** Get current value from editor (e.g., from input ref) */
  getCurrentValue: () => T;
  /** Check if current value equals original (for change detection) */
  isValueChanged?: (current: T, original: T) => boolean;
  /** Transform value before commit (e.g., trim, validate) */
  transformValue?: (value: T) => T;
  /** Validate value before commit */
  isValid?: (value: T) => boolean;
}

export interface EditorState<T> {
  /** Ref to track if editing has finished (prevents double-commits) */
  finishedRef: React.MutableRefObject<boolean>;
  /** Ref to original value */
  originalValueRef: React.MutableRefObject<T>;
  /** Commit current value and finish editing */
  commit: (value: T) => void;
  /** Commit current value if changed, or cancel if unchanged */
  commitIfChanged: () => void;
  /** Cancel editing without committing */
  cancel: () => void;
  /** Handle common keyboard events (Escape, Enter, Tab) */
  handleKeyDown: (e: React.KeyboardEvent, options?: {
    /** Allow Shift+Enter for newlines (default: false) */
    allowShiftEnter?: boolean;
    /** Custom Tab behavior */
    onTab?: (shiftKey: boolean) => void;
  }) => void;
}

/**
 * Standardized hook for managing editor state in DataGrid cell editors.
 * 
 * Features:
 * - Tracks finished state to prevent double-commits
 * - Handles commit-on-unmount (e.g., click outside)
 * - Provides common keyboard handlers (Escape, Enter, Tab)
 * - Change detection to skip commit if value unchanged
 * 
 * @example
 * ```tsx
 * const { finishedRef, commit, handleKeyDown, commitIfChanged } = useEditorState({
 *   originalValue: value.data.value,
 *   nullable: value.data.nullable,
 *   onFinish: (newValue, movement) => {
 *     if (newValue === undefined) {
 *       onFinishedEditing(undefined, movement);
 *     } else {
 *       const newCell = { ...value, data: { ...value.data, value: newValue } };
 *       onFinishedEditing(newCell, movement);
 *     }
 *   },
 *   getCurrentValue: () => inputRef.current?.value ?? "",
 * });
 * ```
 */
export function useEditorState<T>(options: EditorStateOptions<T>): EditorState<T> {
  const {
    originalValue,
    // nullable is available in options but handling is delegated to transformValue
    onFinish,
    getCurrentValue,
    isValueChanged = (current, original) => current !== original,
    transformValue = (v) => v,
    isValid = () => true,
  } = options;

  const finishedRef = useRef(false);
  const originalValueRef = useRef(originalValue);
  const onFinishRef = useRef(onFinish);
  const getCurrentValueRef = useRef(getCurrentValue);
  const isValueChangedRef = useRef(isValueChanged);
  const transformValueRef = useRef(transformValue);
  const isValidRef = useRef(isValid);
  const skipStrictCleanupRef = useRef(import.meta.env.DEV);

  // Update refs on each render
  onFinishRef.current = onFinish;
  getCurrentValueRef.current = getCurrentValue;
  isValueChangedRef.current = isValueChanged;
  transformValueRef.current = transformValue;
  isValidRef.current = isValid;

  const commit = useCallback((value: T) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    
    const transformed = transformValueRef.current(value);
    if (!isValidRef.current(transformed)) {
      // Invalid value - cancel instead
      onFinishRef.current(undefined);
      return;
    }
    
    onFinishRef.current(transformed);
  }, []);

  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishRef.current(undefined);
  }, []);

  const commitIfChanged = useCallback(() => {
    if (finishedRef.current) return;
    
    const currentValue = getCurrentValueRef.current();
    const hasChanged = isValueChangedRef.current(currentValue, originalValueRef.current);
    
    if (!hasChanged) {
      // No changes - cancel
      cancel();
      return;
    }
    
    commit(currentValue);
  }, [commit, cancel]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent,
    keyOptions?: {
      allowShiftEnter?: boolean;
      onTab?: (shiftKey: boolean) => void;
    }
  ) => {
    if (finishedRef.current) return;

    const { allowShiftEnter = false, onTab } = keyOptions ?? {};

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }

    if (e.key === "Enter") {
      if (allowShiftEnter && e.shiftKey) {
        // Allow newline
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      commitIfChanged();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      
      const movement: Movement = e.shiftKey ? [-1, 0] : [1, 0];
      
      if (onTab) {
        onTab(e.shiftKey);
        return;
      }
      
      // Default Tab behavior: commit if changed and move
      const currentValue = getCurrentValueRef.current();
      const hasChanged = isValueChangedRef.current(currentValue, originalValueRef.current);
      
      finishedRef.current = true;
      
      if (!hasChanged) {
        onFinishRef.current(undefined, movement);
      } else {
        const transformed = transformValueRef.current(currentValue);
        if (isValidRef.current(transformed)) {
          onFinishRef.current(transformed, movement);
        } else {
          onFinishRef.current(undefined, movement);
        }
      }
    }
  }, [cancel, commitIfChanged]);

  // Commit on unmount
  useEffect(() => {
    const finishedRefSnapshot = finishedRef;
    
    return () => {
      // Skip first cleanup in React 18 StrictMode (dev only)
      if (skipStrictCleanupRef.current) {
        skipStrictCleanupRef.current = false;
        return;
      }
      
      if (!finishedRefSnapshot.current) {
        // Component unmounting without explicit finish - commit if changed
        const currentValue = getCurrentValueRef.current();
        const hasChanged = isValueChangedRef.current(currentValue, originalValueRef.current);
        
        if (hasChanged) {
          const transformed = transformValueRef.current(currentValue);
          if (isValidRef.current(transformed)) {
            finishedRefSnapshot.current = true;
            onFinishRef.current(transformed);
          } else {
            // Invalid - cancel
            finishedRefSnapshot.current = true;
            onFinishRef.current(undefined);
          }
        } else {
          // No changes - cancel
          finishedRefSnapshot.current = true;
          onFinishRef.current(undefined);
        }
      }
    };
  }, []);

  return {
    finishedRef,
    originalValueRef,
    commit,
    commitIfChanged,
    cancel,
    handleKeyDown,
  };
}

/**
 * Simpler version that just wraps text input editing
 */
export function useTextEditorState(options: {
  originalValue: string | null;
  nullable?: boolean;
  onFinish: (newValue: string | null | undefined, movement?: Movement) => void;
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
}) {
  const { originalValue, nullable = false, onFinish, inputRef } = options;

  return useEditorState({
    originalValue,
    onFinish,
    getCurrentValue: () => inputRef.current?.value ?? "",
    isValueChanged: (current, original) => {
      const trimmedCurrent = (current ?? "").trim();
      const trimmedOriginal = (original ?? "").trim();
      return trimmedCurrent !== trimmedOriginal;
    },
    transformValue: (value) => {
      const trimmed = (value ?? "").trim();
      if (!trimmed && nullable) return null as unknown as string;
      return trimmed;
    },
  });
}

