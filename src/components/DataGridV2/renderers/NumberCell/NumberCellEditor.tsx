import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Key } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NumberCustomCell } from "./types";
import { isMeaningful, isValidNumberText, normalizeValue } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface NumberCellEditorProps {
  value: NumberCustomCell;
  onFinishedEditing: (
    newValue?: NumberCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const NumberCellEditor: React.FC<NumberCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialText = useMemo(() => value.data.value ?? "", [value.data.value]);
  const [isValid, setIsValid] = useState(() =>
    isValidNumberText(
      initialText,
      value.data.precision,
      value.data.scale,
      value.data.dbType,
    ),
  );
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);
  const precision = value.data.precision;
  const scale = value.data.scale;

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  const commit = useCallback(
    (nextRaw: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextRaw == null ? "NULL" : nextRaw;

      const newCell: NumberCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextRaw,
        },
        copyData,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const commitCurrentValue = useCallback(() => {
    const text = inputRef.current?.value ?? "";

    // Check if value actually changed (compare raw text with initial)
    const hasChanged = text !== initialText;

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    const normalized = normalizeValue(text);
    if (!normalized) {
      if (nullable) {
        commit(null);
      } else {
        commit("");
      }
    } else {
      commit(normalized);
    }
  }, [commit, nullable, initialText, onFinishedEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitCurrentValue();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        finishedRef.current = true;

        // Commit the current text value before moving
        const normalized = normalizeValue(text);
        const committedValue: string | null = !normalized
          ? nullable
            ? null
            : ""
          : normalized;

        const newCell: NumberCustomCell = {
          kind: value.kind,
          data: {
            ...value.data,
            value: committedValue,
          },
          copyData: committedValue == null ? "NULL" : committedValue,
          allowOverlay: value.allowOverlay,
          readonly: value.readonly,
        };

        onFinishedEditing(newCell, movement);
      }
    },
    [commitCurrentValue, onFinishedEditing, value, nullable],
  );

  const handleChange = (next: string) => {
    setIsValid(isValidNumberText(next, precision, scale, value.data.dbType));
  };

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  // Build validation hint
  const validationHint = useMemo(() => {
    if (precision != null && scale != null) {
      return `DECIMAL(${precision},${scale}): max ${
        precision - scale
      } integer, ${scale} decimal digits`;
    } else if (precision != null) {
      return `Max ${precision} digits`;
    } else if (scale != null) {
      return `Max ${scale} decimal places`;
    }
    return undefined;
  }, [precision, scale]);

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
      <div className="flex items-center flex-1 relative px-2">
        <input
          ref={inputRef}
          className={cn(
            "h-full w-full bg-transparent text-xs font-mono outline-none",
            !isMeaningful(initialText) ? "italic text-muted-foreground" : "",
            !isValid
              ? "border-b border-destructive focus:border-destructive"
              : "",
          )}
          spellCheck={false}
          defaultValue={initialText}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            handleChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={nullable ? "NULL" : undefined}
          aria-invalid={!isValid}
        />
        {nullable && (
          <Button
            variant="ghost"
            className="h-5 w-5 p-0 absolute right-2 top-1/2 -translate-y-1/2"
            title="Clear (NULL)"
            onClick={handleClear}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Validation hint */}
      {!isValid && validationHint && (
        <div className="px-2 pb-1 text-[10px] text-destructive leading-tight">
          {validationHint}
        </div>
      )}
    </div>
  );
};

export const NumberCellEditorWithProps = Object.assign(NumberCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
