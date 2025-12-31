import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { IndexConditionCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from "@tabler/icons-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql, PostgreSQL, MySQL, SQLite, MSSQL } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { useTheme } from "@/components/theme-provider";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";

interface ConditionCellEditorProps {
  value: IndexConditionCell;
  onFinishedEditing: (
    newValue?: IndexConditionCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

/**
 * Simple syntax validation for SQL WHERE conditions:
 * - Check for balanced parentheses
 * - Check for unclosed quotes (single and double)
 */
function validateSqlCondition(text: string): string | null {
  if (!text.trim()) {
    return null; // Empty is valid
  }

  // Check balanced parentheses
  let parenDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : "";

    // Handle escape sequences
    if (prevChar === "\\") {
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === "(") {
        parenDepth++;
      } else if (char === ")") {
        parenDepth--;
        if (parenDepth < 0) {
          return "Unmatched closing parenthesis";
        }
      }
    }
  }

  if (inSingleQuote) {
    return "Unclosed single quote";
  }
  if (inDoubleQuote) {
    return "Unclosed double quote";
  }
  if (parenDepth > 0) {
    return "Unclosed parenthesis";
  }

  return null;
}

/**
 * Get SQL dialect extension based on dialect string
 */
function getSqlDialect(dialect: string) {
  switch (dialect.toLowerCase()) {
    case "postgresql":
    case "postgres":
      return PostgreSQL;
    case "mysql":
      return MySQL;
    case "sqlite":
      return SQLite;
    case "mssql":
    case "sqlserver":
      return MSSQL;
    default:
      return PostgreSQL; // Default to PostgreSQL
  }
}

export const ConditionCellEditor: React.FC<ConditionCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value || "";
  const [text, setText] = useState(initialValue);
  const finishedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const originalValueRef = useRef(initialValue);
  const { requiresRecreate, dialect } = value.data;
  const { resolvedTheme } = useTheme();

  // Show confirmation dialog for existing indexes that require recreate
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);

  // Validate synchronously - derived from text
  const validationError = useMemo(() => validateSqlCondition(text), [text]);

  // Focus the editor on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      editorRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const buildCell = useCallback(
    (nextValue: string): IndexConditionCell => ({
      kind: value.kind,
      data: {
        ...value.data,
        value: nextValue,
      },
      copyData: nextValue,
      allowOverlay: value.allowOverlay,
      readonly: value.readonly,
    }),
    [value],
  );

  const commitValue = useCallback(
    (nextValue: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedEditing(buildCell(nextValue));
    },
    [buildCell, onFinishedEditing],
  );

  const commitCurrent = useCallback(() => {
    const trimmed = text.trim();

    // Don't commit if there's a validation error
    if (validationError) {
      return;
    }

    // No change - cancel
    if (trimmed === originalValueRef.current) {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Check if this requires recreate confirmation
    if (requiresRecreate && !showConfirm) {
      setPendingText(trimmed);
      setShowConfirm(true);
      return;
    }

    commitValue(trimmed);
  }, [commitValue, onFinishedEditing, text, validationError, requiresRecreate, showConfirm]);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleConfirmContinue = useCallback(() => {
    if (pendingText !== null && !finishedRef.current) {
      finishedRef.current = true;
      onFinishedEditing(buildCell(pendingText));
    }
  }, [pendingText, buildCell, onFinishedEditing]);

  const handleConfirmCancel = useCallback(() => {
    setShowConfirm(false);
    setPendingText(null);
    // Refocus editor
    setTimeout(() => {
      editorRef.current?.focus();
    }, 50);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (showConfirm) {
          handleConfirmCancel();
        } else {
          handleCancel();
        }
      } else if (e.key === "Enter" && !e.shiftKey && !showConfirm) {
        // Enter to save (Shift+Enter for newline)
        e.preventDefault();
        e.stopPropagation();
        commitCurrent();
      } else if (e.key === "Tab" && !showConfirm) {
        // Allow Tab navigation between cells (skip if in confirmation dialog)
        e.preventDefault();
        e.stopPropagation();

        const trimmed = text.trim();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];

        // If no change or validation error, just move
        if (trimmed === originalValueRef.current || validationError) {
          finishedRef.current = true;
          onFinishedEditing(undefined, movement);
          return;
        }

        // If requires recreate, show confirmation first
        if (requiresRecreate) {
          setPendingText(trimmed);
          setShowConfirm(true);
          return;
        }

        // Otherwise save and move
        finishedRef.current = true;
        onFinishedEditing(buildCell(trimmed), movement);
      }
    },
    [handleCancel, handleConfirmCancel, showConfirm, text, validationError, requiresRecreate, onFinishedEditing, buildCell, commitCurrent],
  );

  // Global keydown handler to catch Enter before CodeMirror
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (showConfirm) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrent();
      }
    };

    // Use capture phase to intercept before CodeMirror
    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [commitCurrent, showConfirm]);

  // Determine theme for CodeMirror
  const actualTheme = useMemo(() => {
    return resolvedTheme === "dark" ? "dark" : "light";
  }, [resolvedTheme]);

  const themeExtensions = useMemo(
    () => getThemeExtensions(actualTheme),
    [actualTheme],
  );

  // Get SQL language extension
  const sqlExtension = useMemo(() => {
    const dialectConfig = getSqlDialect(dialect);
    return sql({ dialect: dialectConfig });
  }, [dialect]);

  // Editor extensions
  const extensions = useMemo(
    () => [
      sqlExtension,
      history(),
      Prec.highest(keymap.of(historyKeymap)),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "12px",
        },
        ".cm-content": {
          padding: "8px",
          minHeight: "80px",
        },
        ".cm-scroller": {
          overflow: "auto",
        },
      }),
      ...themeExtensions,
    ],
    [sqlExtension, themeExtensions],
  );

  useCommitOnUnmount(finishedRef, commitCurrent);

  // Render confirmation dialog
  if (showConfirm) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex flex-col relative click-outside-ignore z-50 bg-popover border shadow-lg min-w-[320px]"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50">
          <IconAlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 flex-shrink-0" />
          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Recreate Required
          </span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Changing the WHERE condition will drop and recreate this index.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/50 bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleConfirmCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleConfirmContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // Render editor
  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-popover shadow-lg click-outside-ignore min-w-[320px] max-w-[520px] w-max"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          WHERE Condition (partial index)
        </span>
      </div>

      {/* CodeMirror Editor */}
      <div className="flex-1 overflow-hidden border-b border-border/50">
        <CodeMirror
          value={text}
          onChange={setText}
          extensions={extensions}
          height="120px"
          placeholder="e.g. status = 'active'"
          theme="none"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            autocompletion: false,
            defaultKeymap: true,
            highlightActiveLine: false,
          }}
          onCreateEditor={(view) => {
            editorRef.current = view;
          }}
        />
      </div>

      {/* Validation Error */}
      {validationError && (
        <div className="px-2 py-1.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800/50">
          <p className="text-[10px] text-red-600 dark:text-red-400">
            {validationError}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
        <div className="flex-1">Enter to save, Shift+Enter for new line, Esc to cancel</div>
      </div>
    </div>
  );
};

export const ConditionCellEditorWithProps = Object.assign(
  ConditionCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);

export default ConditionCellEditorWithProps;
