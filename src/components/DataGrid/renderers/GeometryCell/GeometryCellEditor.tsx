import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import type { GeometryCustomCell } from "./types";
import { parseGeometry } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useEditorResize } from "../hooks/useEditorResize";
import { CodeEditor } from "@/components/CodeEditor";

interface GeometryCellEditorProps {
  value: GeometryCustomCell;
  onFinishedEditing: (
    newValue?: GeometryCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const GeometryCellEditor: React.FC<GeometryCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value ?? "";
  const [text, setText] = useState(initialValue);
  const [isValid, setIsValid] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const finishedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  const validate = useCallback((wkt: string) => {
    if (!wkt.trim()) {
      setIsValid(true);
      setErrorMessage("");
      return true;
    }
    const parsed = parseGeometry(wkt);
    setIsValid(parsed.isValid);
    setErrorMessage(parsed.error ?? "");
    return parsed.isValid;
  }, []);

  const handleChange = (newText: string) => {
    setText(newText);
    validate(newText);
  };

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: GeometryCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
        },
        copyData: nextValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const commitCurrentText = useCallback(() => {
    const trimmed = text.trim();
    const currentValue = trimmed || null;

    const hasChanged = currentValue !== (initialValue || null);
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!trimmed && nullable) {
      commit(null);
    } else if (!trimmed && !nullable) {
      // Can't set non-nullable column to NULL, discard the edit
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (isValid) {
      commit(currentValue);
    } else {
      finishedRef.current = true;
      onFinishedEditing(undefined);
    }
  }, [commit, isValid, text, initialValue, nullable, onFinishedEditing]);

  const handleEnter = useCallback(() => {
    if (finishedRef.current) return false;
    commitCurrentText();
    return true;
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

  useEditorResize({ containerRef, minWidth: 300, minHeight: 200, maxHeight: 500 });

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
          language="text"
          autoFocus={true}
          lineNumbers={false}
          height="100%"
          placeholder="SRID=4326;POINT(0 0)"
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
        {nullable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => { commit(null); }}
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

export const GeometryCellEditorWithProps = Object.assign(GeometryCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
