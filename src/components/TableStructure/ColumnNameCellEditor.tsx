import React, { useRef, useCallback, useEffect } from "react";
import { type ColumnNameCustomCell } from "./types";
import { IconKey, IconLink } from "@tabler/icons-react";

interface ColumnNameCellEditorProps {
  value: ColumnNameCustomCell;
  onFinishedEditing: (
    newValue?: ColumnNameCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const ColumnNameCellEditor: React.FC<ColumnNameCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalValueRef = useRef(value.data.name);

  // Focus and select text when editor opens
  useEffect(() => {
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, input.value.length);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const commit = useCallback(
    (nextValue: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const trimmedValue = nextValue.trim();

      // If value unchanged, cancel edit
      if (trimmedValue === value.data.name) {
        onFinishedEditing(undefined);
        return;
      }

      const newCell: ColumnNameCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          name: trimmedValue,
        },
        copyData: trimmedValue,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const text = inputRef.current?.value ?? "";
      commit(text);
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;

      const text = inputRef.current?.value ?? "";
      const trimmedValue = text.trim();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];

      // If value unchanged, just move
      if (trimmedValue === value.data.name) {
        onFinishedEditing(undefined, movement);
        return;
      }

      const newCell: ColumnNameCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          name: trimmedValue,
        },
        copyData: trimmedValue,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  // Commit on blur/unmount
  useEffect(() => {
    const input = inputRef.current;
    return () => {
      if (!finishedRef.current && input) {
        const text = input.value;
        commit(text);
      }
    };
  }, [commit]);

  const { isPrimaryKey, isForeignKey } = value.data;

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        {isForeignKey && (
          <IconLink className="h-3 w-3 text-blue-600 dark:text-blue-400" />
        )}
        <span className="text-[10px] font-medium text-foreground/80">
          Column Name
        </span>
      </div>

      {/* Input field */}
      <div className="flex items-center flex-1">
        <input
          ref={inputRef}
          type="text"
          defaultValue={value.data.name}
          autoFocus
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            originalValueRef.current = e.target.value;
          }}
          className="w-full h-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono"
          placeholder="column_name"
        />
      </div>
    </div>
  );
};

export const ColumnNameCellEditorWithProps = Object.assign(ColumnNameCellEditor, {
  disablePadding: true,
  disableStyling: false,
});

export default ColumnNameCellEditorWithProps;
