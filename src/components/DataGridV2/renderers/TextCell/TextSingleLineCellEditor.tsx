import React, { useRef, useCallback } from "react";
import type { TextSingleLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { Trash2, Key } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface TextSingleLineCellEditorProps {
  value: TextSingleLineCustomCell;
  onFinishedEditing: (
    newValue?: TextSingleLineCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TextSingleLineCellEditor: React.FC<
  TextSingleLineCellEditorProps
> = ({ value, onFinishedEditing }) => {
  const initialValue = value.data.value ?? "";
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Store the original value to properly detect changes including null
  const originalValueRef = useRef(value.data.value);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: TextSingleLineCustomCell = {
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
    const text = inputRef.current?.value ?? "";

    // Update the ref with current value for proper change detection
    const currentInputValue = text;

    // Check if value actually changed (compare raw text with initial)
    const hasChanged = currentInputValue !== (value.data.value ?? "");

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    const trimmed = text.trim();
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else {
      commit(trimmed || text);
    }
  }, [commit, value.data.nullable, onFinishedEditing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    // Update the ref with current input value before processing keyboard events
    originalValueRef.current = inputRef.current?.value ?? "";

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitCurrentText();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;

      // Commit the current text value before moving
      const text = inputRef.current?.value ?? "";
      const trimmed = text.trim();
      const committedValue: string | null =
        !trimmed && value.data.nullable ? null : trimmed || text;

      const newCell: TextSingleLineCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: committedValue,
        },
        copyData: committedValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  useCommitOnUnmount(finishedRef, commitCurrentText);

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <Key className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
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

      {/* Input field */}
      <div className="flex items-center flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          defaultValue={initialValue}
          autoFocus
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            originalValueRef.current = e.target.value;
          }}
          maxLength={value.data.maxLength}
          className={cn(
            "h-full w-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono",
            !value.data.value ? "italic text-muted-foreground" : "",
            { "pr-8": value.data.nullable },
          )}
          placeholder={value.data.nullable ? "NULL" : ""}
        />
        {value.data.nullable && (
          <Button
            variant="ghost"
            className="h-5 w-5 p-0 absolute right-2 top-1/2 -translate-y-1/2"
            onClick={handleClear}
            title="Clear (NULL)"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const TextSingleLineCellEditorWithProps = Object.assign(
  TextSingleLineCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
