import React, { useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Key } from "lucide-react";
import { cn } from "@/lib/cn";
import type { HStoreCustomCell } from "./types";
import { hstoreToEditorText, normalizeHstoreEditorText } from "./hstoreFormat";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface HStoreCellEditorProps {
  value: HStoreCustomCell;
  onFinishedEditing: (
    newValue?: HStoreCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const HStoreCellEditor: React.FC<HStoreCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;
  const initial = useMemo(
    () => hstoreToEditorText(value.data.value),
    [value.data.value],
  );

  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originalValueRef = useRef(initial);

  const commit = useCallback(
    (nextRaw: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const normalization = normalizeHstoreEditorText(nextRaw);
      const canonical = normalization.normalized;
      const finalValue =
        canonical == null && !nullable && nextRaw !== null ? "" : canonical;
      const copyData = finalValue ?? "NULL";

      const newCell: HStoreCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: finalValue,
        },
        copyData,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [nullable, onFinishedEditing, value],
  );

  const commitCurrentText = useCallback(() => {
    const text = textareaRef.current?.value ?? "";

    // Check if value actually changed
    const hasChanged = text !== originalValueRef.current;

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    const trimmed = text.trim();
    if (!trimmed && nullable) {
      commit(null);
    } else {
      commit(trimmed);
    }
  }, [commit, nullable, initial, onFinishedEditing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (finishedRef.current) return;

    // Update the ref with current textarea value before processing keyboard events
    originalValueRef.current = textareaRef.current?.value ?? "";

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();

      commitCurrentText();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;

      // Commit the current text value before moving
      const text = textareaRef.current?.value ?? "";
      const trimmed = text.trim();
      const committedValue: string | null = !trimmed && nullable ? null : trimmed;

      const normalization = normalizeHstoreEditorText(committedValue);
      const canonical = normalization.normalized;
      const finalValue =
        canonical == null && !nullable && committedValue !== null
          ? ""
          : canonical;

      const newCell: HStoreCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: finalValue,
        },
        copyData: finalValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleSave = () => {
    commitCurrentText();
  };

  useCommitOnUnmount(finishedRef, commitCurrentText);

  return (
    <div className="w-full h-full flex flex-col click-outside-ignore">
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

      {/* Editor content */}
      <div className="flex-1 flex flex-col gap-2 p-2">
        <textarea
          ref={textareaRef}
          defaultValue={initial}
          autoFocus
          onFocus={(e) => e.target.select()}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex-1 min-h-[120px] w-full resize-none bg-transparent text-xs font-mono leading-5 outline-none",
            initial.trim().length === 0 ? "italic text-muted-foreground" : "",
          )}
          placeholder={
            nullable
              ? `"key"=>"value",\n"another"=>"next",`
              : `"key"=>"value",\n"another"=>"next",`
          }
        />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <span>Enter to save · Shift+Enter for newline · Esc to cancel</span>
        </div>
        <div className="flex items-center gap-2">
          {nullable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              title="Clear (NULL)"
              onClick={handleClear}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2"
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
};

export const HStoreCellEditorWithProps = Object.assign(HStoreCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
