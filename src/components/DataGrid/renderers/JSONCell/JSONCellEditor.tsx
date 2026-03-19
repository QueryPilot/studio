import React, { useState, useRef, useEffect, useCallback } from "react";
import type { JsonCustomCell } from "./types";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useEditorResize } from "../hooks/useEditorResize";

interface JsonCellEditorProps {
  value: JsonCustomCell;
  onFinishedEditing: (
    newValue?: JsonCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const JsonCellEditor: React.FC<JsonCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  // Format JSON by default for editing (handle both string and object values)
  const formatJson = (jsonValue: string | object | number | null): string => {
    if (jsonValue == null) return "";
    // If already an object from DB, stringify directly
    if (typeof jsonValue === "object") {
      return JSON.stringify(jsonValue, null, 2);
    }
    if (typeof jsonValue === "number") {
      return jsonValue.toString();
    }

    if (!jsonValue.trim()) return "";
    try {
      const parsed = JSON.parse(jsonValue);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonValue;
    }
  };

  // Minify JSON for storage
  const minifyJson = (jsonString: string): string => {
    try {
      const parsed = JSON.parse(jsonString);
      return JSON.stringify(parsed);
    } catch {
      return jsonString;
    }
  };

  const initialValue = formatJson(value.data.value);
  const [text, setText] = useState<string>(initialValue);
  const [isValid, setIsValid] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const finishedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Normalize original value to minified JSON string for comparison
  // This handles both object values from DB and string values
  const getOriginalMinified = (): string | null => {
    const val = value.data.value;
    if (val == null) return null;
    if (typeof val === "object") {
      return JSON.stringify(val); // Already minified
    }
    // For string values, parse and re-stringify to normalize formatting
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed);
    } catch {
      return val; // Keep as-is if not valid JSON
    }
  };
  const originalValueRef = useRef<string | null>(getOriginalMinified());

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Validate JSON on change
  const validateJson = useCallback((jsonString: string) => {
    if (!jsonString.trim()) {
      setIsValid(true);
      setErrorMessage("");
      return true;
    }
    try {
      JSON.parse(jsonString);
      setIsValid(true);
      setErrorMessage("");
      return true;
    } catch (e) {
      setIsValid(false);
      setErrorMessage(e instanceof Error ? e.message : "Invalid JSON");
      return false;
    }
  }, []);

  const handleChange = (newText: string) => {
    setText(newText);
    validateJson(newText);
  };

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      // Minify JSON before saving
      const minified = nextValue ? minifyJson(nextValue) : null;

      const newCell: JsonCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: minified,
          isValid: minified ? validateJson(minified) : true,
        },
        copyData: minified ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value, validateJson],
  );

  const commitCurrentText = useCallback(() => {
    const trimmed = text.trim();

    // Minify current value for comparison
    // originalValueRef.current is already normalized/minified
    const currentMinified = trimmed ? minifyJson(trimmed) : null;

    // Check if value actually changed
    const hasChanged = currentMinified !== originalValueRef.current;

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else if (isValid) {
      commit(trimmed);
    } else {
      // Invalid JSON - don't commit, but mark as finished to avoid re-triggering
      finishedRef.current = true;
      onFinishedEditing(undefined);
    }
  }, [commit, isValid, text, value.data.nullable, onFinishedEditing]);

  const handleEnter = useCallback(() => {
    if (finishedRef.current) return false;

    commitCurrentText();
    return true; // Prevent default
  }, [commitCurrentText]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onFinishedEditing]);

  useCommitOnUnmount(finishedRef, commitCurrentText);

  useEditorResize({ containerRef });

  return (
    <div
      ref={containerRef}
      className="flex flex-col gdg-editor-shell click-outside-ignore"
      style={{
        width: 400,
        minWidth: "100%",
        height: 300,
        position: "relative",
      }}
    >
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        <span className="text-[10px] font-medium text-foreground/80">
          {columnName}
        </span>
        {dbType && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {dbType}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <CodeEditor
          value={text}
          onChange={handleChange}
          onEnter={handleEnter}
          language="json"
          autoFocus={true}
          lineNumbers={true}
          height="100%"
          placeholder={value.data.nullable ? "null" : "{}"}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 sticky bottom-0 bg-popover">
        <div className="flex-1">
          {!isValid && errorMessage ? (
            <span className="text-destructive">{errorMessage}</span>
          ) : (
            "Enter to save, Shift+Enter for new line, Esc to cancel"
          )}
        </div>
        {value.data.nullable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              commit(null);
            }}
            title="Clear (NULL)"
          >
            <IconTrash className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, currentColor 50%)",
          opacity: 0.3,
        }}
      />
    </div>
  );
};

export const JsonCellEditorWithProps = Object.assign(JsonCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
