import React, { useState, useRef, useEffect, useCallback } from "react";
import type { TextMultiLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Trash2, Key } from "lucide-react";
import { computeArrayStringsFromText } from "../../utils/arrayFormat";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

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
  const [text, setText] = useState<string>(initialValue);
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({
    width: 400,
    height: 100, // Start with minimum height
  });

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  // Auto-resize based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Simple approach: just adjust height when text changes
    const adjustHeight = () => {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(100, Math.min(600, scrollHeight + 40)); // 40px for padding and footer

      setSize((prev) => {
        // Only update if height actually changed significantly
        if (Math.abs(newHeight - prev.height) > 5) {
          return { ...prev, height: newHeight };
        }
        return prev;
      });

      textarea.style.height = `${scrollHeight}px`;
    };

    // Use setTimeout to ensure this runs after the DOM has updated
    const timeoutId = setTimeout(adjustHeight, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [text]);

  // Handle container resize (for manual resizing)
  useEffect(() => {
    const container = containerRef.current;
    const textarea = textareaRef.current;
    if (!container || !textarea) return;

    const handleResize = () => {
      // When container is manually resized, adjust textarea height to fit content
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${scrollHeight}px`;
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

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
    const trimmed = text.trim();
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else {
      commit(text);
    }
  }, [commit, text, value.data.nullable]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (finishedRef.current) return;

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
      onFinishedEditing(value, movement);
    }
  };

  useCommitOnUnmount(finishedRef, commitCurrentText);

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

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

      const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));
      const newHeight = Math.max(100, Math.min(600, startHeight + deltaY));

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
      className="flex flex-col bg-popover border border-border rounded-lg shadow-lg click-outside-ignore"
      style={{
        width: `${size.width}px`,
        height: `${size.height}px`,
        position: "relative",
      }}
    >
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
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

      <div className="flex-1 overflow-hidden p-2">
        <textarea
          ref={textareaRef}
          value={text}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full text-xs font-mono bg-transparent resize-none outline-none overflow-hidden",
          )}
          placeholder={value.data.nullable ? "NULL" : ""}
          style={{
            minHeight: "60px", // Ensure minimum usable height
            maxHeight: "560px", // Leave space for footer (600px - 40px)
          }}
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
            <Trash2 className="h-3 w-3 mr-1" />
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
