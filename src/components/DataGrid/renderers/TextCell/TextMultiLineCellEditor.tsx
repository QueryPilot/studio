import React, { useRef, useCallback, useEffect } from "react";
import type { TextMultiLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { computeArrayStringsFromText } from "../../utils/arrayFormat";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useNavigationStore } from "../../stores/navigationStore";

interface TextMultiLineCellEditorProps {
  value: TextMultiLineCustomCell;
  onFinishedEditing: (
    newValue?: TextMultiLineCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TextMultiLineCellEditor: React.FC<TextMultiLineCellEditorProps> =
  ({ value, onFinishedEditing }) => {
    // Get navigation state for type-to-edit support
    const editTrigger = useNavigationStore((s) => s.editTrigger);
    const initialChar = useNavigationStore((s) => s.initialChar);

    // Determine initial value based on edit trigger
    const isTypeReplace = editTrigger === 'type-replace' && initialChar;
    const initialValue = isTypeReplace ? initialChar : (value.data.value || "");

    const finishedRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const initialValueRef = useRef(isTypeReplace ? initialChar : value.data.value);

    // Extract column metadata for header
    const { columnName, isPrimaryKey, dbType } = value.data;

    // Position cursor at end for type-to-edit mode
    useEffect(() => {
      if (isTypeReplace && textareaRef.current) {
        const len = initialChar.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    }, [isTypeReplace, initialChar]);

    const handleTextareaChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        initialValueRef.current = e.target.value;
      },
      [],
    );

    const commit = useCallback(
      (nextValue: string | null) => {
        if (finishedRef.current) return;
        finishedRef.current = true;

        let formattedValue = nextValue;
        let displayValue = value.data.displayValue;

        if (value.data.formatDisplayMode === "array-inline") {
          const { inline } = computeArrayStringsFromText(nextValue);
          formattedValue = inline;
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

      // Check if value actually changed (compare with original value)
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
          // Enter saves, Shift+Enter adds newline
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

          // Check if value actually changed
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
            const { inline } = computeArrayStringsFromText(committedValue);
            formattedValue = inline;
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

    return (
      <div className="flex flex-col gdg-editor-shell click-outside-ignore min-w-[300px] max-w-[600px] w-max">
        {/* Header with column info */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50 shrink-0">
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

        <div className="p-2">
          <textarea
            ref={textareaRef}
            defaultValue={initialValue}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              // Don't select all in type-replace mode - cursor already positioned
              if (!isTypeReplace) {
                e.target.select();
              }
            }}
            onChange={handleTextareaChange}
            className={cn(
              "w-full text-xs font-mono bg-transparent resize outline-none",
              "min-h-[60px] max-h-[400px]",
            )}
            rows={Math.min(10, Math.max(3, initialValue.split("\n").length))}
            placeholder={value.data.nullable ? "NULL" : ""}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
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
