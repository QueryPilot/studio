import React, { useRef, useCallback, useEffect } from "react";
import type { TriggerNameCustomCell } from "./types";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";

interface TriggerNameCellEditorProps {
  value: TriggerNameCustomCell;
  onFinishedEditing: (
    newValue?: TriggerNameCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const TriggerNameCellEditor: React.FC<TriggerNameCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentValueRef = useRef(value.data.name);

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

      if (trimmedValue === value.data.name || trimmedValue === "") {
        onFinishedEditing(undefined);
        return;
      }

      const newCell: TriggerNameCustomCell = {
        kind: value.kind,
        data: { ...value.data, name: trimmedValue },
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

    // Convert space to underscore
    if (e.key === " ") {
      e.preventDefault();
      const input = e.currentTarget;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value =
        input.value.slice(0, start) + "_" + input.value.slice(end);
      input.setSelectionRange(start + 1, start + 1);
      currentValueRef.current = input.value;
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit(inputRef.current?.value ?? "");
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      const text = inputRef.current?.value ?? "";
      const trimmed = text.trim();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];

      if (trimmed === value.data.name || trimmed === "") {
        onFinishedEditing(undefined, movement);
        return;
      }

      const newCell: TriggerNameCustomCell = {
        kind: value.kind,
        data: { ...value.data, name: trimmed },
        copyData: trimmed,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
      onFinishedEditing(newCell, movement);
    }
  };

  const commitCurrent = useCallback(() => {
    commit(currentValueRef.current);
  }, [commit]);

  useCommitOnUnmount(finishedRef, commitCurrent);

  return (
    <div className="flex flex-col click-outside-ignore z-50 bg-popover border shadow-lg min-w-[200px] max-w-[400px] w-max">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        <span className="text-[10px] font-medium text-foreground/80">
          Trigger Name
        </span>
      </div>
      <div className="flex items-center flex-1">
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          type="text"
          defaultValue={value.data.name}
          autoFocus
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            currentValueRef.current = e.target.value;
          }}
          className="w-full h-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono"
          placeholder="trigger_name"
        />
      </div>
    </div>
  );
};

export const TriggerNameCellEditorWithProps = Object.assign(TriggerNameCellEditor, {
  disablePadding: true,
  disableStyling: false,
});

export default TriggerNameCellEditorWithProps;
