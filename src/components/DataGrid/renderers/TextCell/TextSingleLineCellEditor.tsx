import React, { useRef, useCallback, useEffect } from "react";
import type { TextSingleLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey, IconLink } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useNavigationStore } from "../../stores/navigationStore";

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
  // Get navigation state for type-to-edit support
  const editTrigger = useNavigationStore((s) => s.editTrigger);
  const initialChar = useNavigationStore((s) => s.initialChar);

  // Determine initial value based on edit trigger
  const isTypeReplace = editTrigger === 'type-replace' && initialChar;
  const initialValue = isTypeReplace ? initialChar : (value.data.value ?? "");

  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Store the original value to properly detect changes including null
  const originalValueRef = useRef(isTypeReplace ? initialChar : value.data.value);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, isForeignKey, dbType } = value.data;

  // Position cursor at end for type-to-edit mode
  useEffect(() => {
    if (isTypeReplace && inputRef.current) {
      const len = initialChar.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [isTypeReplace, initialChar]);

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
    // Use originalValueRef instead of inputRef to avoid reading null during unmount
    const text = originalValueRef.current ?? "";

    // IconCheck if value actually changed (compare with original value)
    const hasChanged = text !== (value.data.value ?? "");

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
  }, [commit, value.data.nullable, onFinishedEditing, value.data.value]);

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
    <div className="flex flex-col click-outside-ignore z-50 bg-popover border shadow-lg min-w-[200px] max-w-[500px] w-max">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        {isForeignKey && (
          <IconLink className="h-3 w-3 text-blue-600 dark:text-blue-400" />
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
      <div className="flex items-center relative">
        <input
          ref={inputRef}
          type="text"
          defaultValue={initialValue}
          autoFocus
          onFocus={(e) => {
            // Don't select all in type-replace mode - cursor already positioned
            if (!isTypeReplace) {
              e.target.select();
            }
          }}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            originalValueRef.current = e.target.value;
          }}
          maxLength={value.data.maxLength}
          className={cn(
            "w-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono",
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
            <IconTrash className="h-3 w-3" />
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
