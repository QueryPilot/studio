import React, { useRef, useCallback, useEffect } from "react";
import type {
  TextMultiLineCustomCell,
  TextSingleLineCustomCell,
} from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { IconTrash, IconKey, IconLink } from "@tabler/icons-react";
import { computeArrayStringsFromText } from "../../utils/arrayFormat";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useNavigationStore } from "../../stores/navigationStore";
import { Textarea } from "@/components/ui/textarea";

type TextCellEditorValue = TextSingleLineCustomCell | TextMultiLineCustomCell;

export interface TextCellEditorProps<T extends TextCellEditorValue> {
  value: T;
  onFinishedEditing: (
    newValue?: T,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const isSingleLineCell = (
  cell: TextCellEditorValue,
): cell is TextSingleLineCustomCell => cell.data.kind === "text-single-cell";

const isMultiLineCell = (
  cell: TextCellEditorValue,
): cell is TextMultiLineCustomCell => cell.data.kind === "text-multi-cell";

export function TextCellEditor<T extends TextCellEditorValue>({
  value,
  onFinishedEditing,
}: TextCellEditorProps<T>) {
  // Debug: Log what the editor receives
  console.log('[TextCellEditor] Received cell:', {
    kind: value.kind,
    dataKind: value.data?.kind,
    dataValue: value.data?.value,
    hasDataValue: 'value' in (value.data || {}),
    fullData: value.data,
  });

  // Get navigation state for type-to-edit support
  const editTrigger = useNavigationStore((s) => s.editTrigger);
  const initialChar = useNavigationStore((s) => s.initialChar);

  // Determine initial value based on edit trigger
  const isTypeReplace = editTrigger === "type-replace" && initialChar;
  const initialValue = isTypeReplace ? initialChar : value.data.value ?? "";
  const originalValue = value.data.value ?? "";

  console.log('[TextCellEditor] Computed values:', {
    isTypeReplace,
    initialChar,
    initialValue,
    originalValue,
  });

  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentValueRef = useRef(initialValue);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType, nullable } = value.data;
  const isForeignKey = isSingleLineCell(value)
    ? Boolean(value.data.isForeignKey)
    : false;
  const maxLength = isSingleLineCell(value) ? value.data.maxLength : undefined;

  // Position cursor at end for type-to-edit mode
  useEffect(() => {
    if (isTypeReplace && textareaRef.current) {
      const len = initialChar.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isTypeReplace, initialChar]);

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      currentValueRef.current = e.target.value;
    },
    [],
  );

  const buildCell = useCallback(
    (nextValue: string | null): TextCellEditorValue => {
      if (isMultiLineCell(value)) {
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

        return {
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
      }

      return {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
        },
        copyData: nextValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
    },
    [value],
  );

  const commit = useCallback(
    (
      nextValue: string | null,
      movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
    ) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell = buildCell(nextValue);
      onFinishedEditing(newCell as T, movement);
    },
    [buildCell, onFinishedEditing],
  );

  const getCommittedValue = useCallback(
    (text: string): string | null => {
      const trimmed = text.trim();
      if (!trimmed && nullable) return null;
      return trimmed || text;
    },
    [nullable],
  );

  const commitCurrentText = useCallback(() => {
    const text = currentValueRef.current;
    const hasChanged = text !== originalValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    commit(getCommittedValue(text));
  }, [commit, getCommittedValue, originalValue, onFinishedEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (finishedRef.current) return;

      currentValueRef.current = textareaRef.current?.value ?? "";

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrentText();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];

        const hasChanged = currentValueRef.current !== originalValue;
        if (!hasChanged) {
          finishedRef.current = true;
          onFinishedEditing(undefined, movement);
          return;
        }

        commit(getCommittedValue(currentValueRef.current), movement);
      }
    },
    [
      commitCurrentText,
      commit,
      getCommittedValue,
      originalValue,
      onFinishedEditing,
    ],
  );

  useCommitOnUnmount(finishedRef, commitCurrentText);

  // Debug: log what's being rendered
  console.log('[TextCellEditor] Rendering textarea with:', {
    defaultValue: initialValue,
    valueLength: initialValue.length,
  });

  const handleClear = useCallback(() => {
    if (nullable) {
      commit(null);
    }
  }, [nullable, commit]);

  return (
    <div className="flex flex-col gdg-editor-shell click-outside-ignore max-w-[600px] min-w-[300px]">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50 shrink-0">
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

      <Textarea
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
        maxLength={maxLength}
        className={cn(
          "w-full text-xs font-mono bg-transparent resize outline-none border-none focus-visible:ring-0 focus-visible:ring-offset-0",
          "min-h-[60px] max-h-[400px]",
        )}
        rows={Math.min(10, Math.max(3, initialValue.split("\n").length))}
        placeholder={nullable ? "NULL" : ""}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
        <div className="flex-1">
          Enter to save, Shift+Enter for new line, Esc to cancel
        </div>
        {nullable && (
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
}
