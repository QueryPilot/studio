import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import type { TextMultiLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { IconTrash, IconKey } from '@tabler/icons-react';
import { computeArrayStringsFromText } from "../../utils/arrayFormat";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

// Constants for layout
const HEADER_HEIGHT = 32; // Header with column info
const FOOTER_HEIGHT = 36; // Footer with instructions
const MIN_TEXTAREA_HEIGHT = 60;
const MAX_TEXTAREA_HEIGHT = 400;
const MIN_CONTAINER_WIDTH = 300;
const MAX_CONTAINER_WIDTH = 600;

interface TextMultiLineCellEditorProps {
  value: TextMultiLineCustomCell;
  onFinishedEditing: (
    newValue?: TextMultiLineCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TextMultiLineCellEditor: React.FC<
  TextMultiLineCellEditorProps
> = ({ value, onFinishedEditing }) => {
  const initialValue = value.data.value || "";
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialValueRef = useRef(value.data.value);
  const [isManuallyResized, setIsManuallyResized] = useState(false);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Calculate initial size based on content
  const calculateTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return MIN_TEXTAREA_HEIGHT;
    
    // Temporarily reset height to measure content
    const prevHeight = textarea.style.height;
    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = prevHeight;
    
    return Math.max(MIN_TEXTAREA_HEIGHT, Math.min(MAX_TEXTAREA_HEIGHT, scrollHeight));
  }, []);

  const [size, setSize] = useState(() => {
    // Estimate initial height based on content length and line count
    const lineCount = (initialValue.match(/\n/g) || []).length + 1;
    const estimatedLineHeight = 18; // Approximate line height for text-xs
    const estimatedHeight = Math.max(
      MIN_TEXTAREA_HEIGHT,
      Math.min(MAX_TEXTAREA_HEIGHT, lineCount * estimatedLineHeight + 20)
    );
    
    return {
      width: 400,
      height: estimatedHeight + HEADER_HEIGHT + FOOTER_HEIGHT,
    };
  });

  // Adjust height on mount after textarea is rendered
  useLayoutEffect(() => {
    if (isManuallyResized) return;
    
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Measure actual content height
    const textareaHeight = calculateTextareaHeight();
    const containerHeight = textareaHeight + HEADER_HEIGHT + FOOTER_HEIGHT;
    
    setSize((prev) => ({
      ...prev,
      height: containerHeight,
    }));
  }, [isManuallyResized, calculateTextareaHeight]);

  // Handle input changes to auto-resize
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    initialValueRef.current = e.target.value;
    
    if (isManuallyResized) return;
    
    const textarea = e.target;
    // Reset and measure
    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    const textareaHeight = Math.max(MIN_TEXTAREA_HEIGHT, Math.min(MAX_TEXTAREA_HEIGHT, scrollHeight));
    textarea.style.height = `${textareaHeight}px`;
    
    const containerHeight = textareaHeight + HEADER_HEIGHT + FOOTER_HEIGHT;
    setSize((prev) => ({
      ...prev,
      height: containerHeight,
    }));
  }, [isManuallyResized]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      let formattedValue = nextValue;
      let displayValue = value.data.displayValue;

      if (value.data.formatDisplayMode === "array-inline") {
        const { pretty, inline } = computeArrayStringsFromText(nextValue);
        formattedValue = pretty;
        displayValue = inline;
      }

      const copyPayload =
        formattedValue == null || formattedValue.length === 0
          ? "NULL"
          : displayValue ?? formattedValue;

      const newCell: TextMultiLineCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: formattedValue,
          displayValue,
        },
        copyData: copyPayload,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const commitCurrentText = useCallback(() => {
    const text = initialValueRef.current;

    // IconCheck if value actually changed (compare with original value)
    const hasChanged = initialValueRef.current !== (initialValue || "");

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    const trimmed = text?.trim();
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else {
      commit(trimmed ?? text ?? null);
    }
  }, [initialValue, value.data.nullable, onFinishedEditing, commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (finishedRef.current) return;

      // Update the ref with current textarea value before processing keyboard events
      initialValueRef.current = textareaRef.current?.value ?? "";

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Enter or Cmd/Ctrl+Enter saves, Shift+Enter adds newline
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

        // IconCheck if value actually changed
        const hasChanged = initialValueRef.current !== (initialValue || "");

        // If no changes, cancel and move
        if (!hasChanged) {
          onFinishedEditing(undefined, movement);
          return;
        }

        // Commit the current text value before moving
        const trimmed = initialValueRef.current.trim();
        const committedValue: string | null =
          !trimmed && value.data.nullable ? null : initialValueRef.current;

        let formattedValue = committedValue;
        let displayValue = value.data.displayValue;

        if (value.data.formatDisplayMode === "array-inline") {
          const { pretty, inline } =
            computeArrayStringsFromText(committedValue);
          formattedValue = pretty;
          displayValue = inline;
        }

        const copyPayload =
          formattedValue == null || formattedValue.length === 0
            ? "NULL"
            : displayValue ?? formattedValue;

        const newCell: TextMultiLineCustomCell = {
          kind: value.kind,
          data: {
            ...value.data,
            value: formattedValue,
            displayValue,
          },
          copyData: copyPayload,
          allowOverlay: value.allowOverlay,
          readonly: value.readonly,
        };

        onFinishedEditing(newCell, movement);
      }
    },
    [
      onFinishedEditing,
      commitCurrentText,
      initialValue,
      value.data,
      value.kind,
      value.allowOverlay,
      value.readonly,
    ],
  );

  useCommitOnUnmount(finishedRef, commitCurrentText);

  const handleClear = useCallback(() => {
    if (value.data.nullable) {
      commit(null);
    }
  }, [value.data.nullable, commit]);

  // Resize handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("resize-handle")) {
        isResizing = true;
        setIsManuallyResized(true); // Mark as manually resized
        startX = e.clientX;
        startY = e.clientY;
        startWidth = container.offsetWidth;
        startHeight = container.offsetHeight;
        e.preventDefault();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const newWidth = Math.max(MIN_CONTAINER_WIDTH, Math.min(MAX_CONTAINER_WIDTH, startWidth + deltaX));
      const newHeight = Math.max(
        MIN_TEXTAREA_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT,
        Math.min(MAX_TEXTAREA_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT, startHeight + deltaY)
      );

      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      isResizing = false;
    };

    container.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-popover border border-border rounded-xl shadow-lg click-outside-ignore"
      style={{
        width: `${size.width}px`,
        height: `${size.height}px`,
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

      <div className="flex-1 overflow-auto p-2">
        <textarea
          ref={textareaRef}
          defaultValue={initialValue}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.select();
          }}
          onChange={handleTextareaChange}
          className={cn(
            "w-full h-full text-xs font-mono bg-transparent resize-none outline-none",
          )}
          placeholder={value.data.nullable ? "NULL" : ""}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 sticky bottom-0 bg-popover">
        <div className="flex-1">
          Enter to save, Shift+Enter for new line, Esc to cancel
        </div>
        {value.data.nullable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleClear}
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

export const TextMultiLineCellEditorWithProps = Object.assign(
  TextMultiLineCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
