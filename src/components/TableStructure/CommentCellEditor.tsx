import React, { useCallback, useRef } from "react";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";
import { type CommentCustomCell } from "./types";

interface CommentCellEditorProps {
  value: CommentCustomCell;
  onFinishedEditing: (
    newValue?: CommentCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const CommentCellEditor: React.FC<CommentCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value ?? "";
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originalValueRef = useRef(initialValue);

  const buildCell = useCallback(
    (nextValue: string | null): CommentCustomCell => ({
      kind: value.kind,
      data: {
        ...value.data,
        value: nextValue,
      },
      copyData: nextValue ?? "",
      allowOverlay: value.allowOverlay,
      readonly: value.readonly,
    }),
    [value],
  );

  const commitCurrent = useCallback(() => {
    const text = originalValueRef.current;
    if (text === initialValue) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      finishedRef.current = true;
      onFinishedEditing(buildCell(null));
      return;
    }

    finishedRef.current = true;
    onFinishedEditing(buildCell(text));
  }, [buildCell, initialValue, onFinishedEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (finishedRef.current) return;

      originalValueRef.current = textareaRef.current?.value ?? "";

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrent();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        finishedRef.current = true;

        const text = originalValueRef.current;
        if (text === initialValue) {
          onFinishedEditing(undefined, movement);
          return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
          onFinishedEditing(buildCell(null), movement);
          return;
        }

        onFinishedEditing(buildCell(text), movement);
      }
    },
    [buildCell, commitCurrent, initialValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrent);

  return (
    <div className="flex flex-col bg-popover shadow-lg click-outside-ignore min-w-[320px] max-w-[640px] w-max">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        <span className="text-[10px] font-medium text-foreground/80">
          Comment for {value.data.columnName ?? "column"}
        </span>
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
          onChange={(e) => {
            originalValueRef.current = e.target.value;
          }}
          className="w-full text-xs bg-transparent resize outline-none min-h-[80px] max-h-[400px]"
          rows={Math.min(10, Math.max(3, initialValue.split("\n").length))}
          placeholder="Add a comment"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
        <div className="flex-1">Enter to save, Shift+Enter for new line, Esc to cancel</div>
      </div>
    </div>
  );
};

export const CommentCellEditorWithProps = Object.assign(CommentCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
