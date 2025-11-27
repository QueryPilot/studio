import React, { useRef, useCallback, useState, useLayoutEffect } from "react";
import type { TextSingleLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey, IconLink } from '@tabler/icons-react';
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

// Constants for layout
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const PADDING = 48; // Extra padding for clear button, icons, etc.

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
  const measureRef = useRef<HTMLSpanElement>(null);
  // Store the original value to properly detect changes including null
  const originalValueRef = useRef(value.data.value);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, isForeignKey, dbType } = value.data;

  // Measure text width
  const measureTextWidth = useCallback((text: string) => {
    if (!measureRef.current) return MIN_WIDTH;
    measureRef.current.textContent = text || " ";
    const width = measureRef.current.offsetWidth + PADDING;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
  }, []);

  const [width, setWidth] = useState(() => measureTextWidth(initialValue));

  // Measure on mount
  useLayoutEffect(() => {
    setWidth(measureTextWidth(initialValue));
  }, [initialValue, measureTextWidth]);

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
    <div
      className="flex flex-col relative click-outside-ignore z-50 bg-popover border border-border rounded-lg shadow-lg"
      style={{ width: `${width}px` }}
    >
      {/* Hidden span for measuring text width */}
      <span
        ref={measureRef}
        className="absolute invisible whitespace-pre text-xs font-mono px-2"
        aria-hidden="true"
      />

      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50 rounded-t-lg">
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
          onFocus={(e) => e.target.select()}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            originalValueRef.current = e.target.value;
            setWidth(measureTextWidth(e.target.value));
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
