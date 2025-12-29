import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";
import { type CheckConstraintCustomCell } from "./types";

interface CheckConstraintCellEditorProps {
  value: CheckConstraintCustomCell;
  onFinishedEditing: (
    newValue?: CheckConstraintCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const stripCheckWrapper = (raw: string): string => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^CHECK\s*\((.*)\)$/is);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
};

const normalizeValue = (value: string | null): string =>
  stripCheckWrapper(value ?? "");

export const CheckConstraintCellEditor: React.FC<
  CheckConstraintCellEditorProps
> = ({ value, onFinishedEditing }) => {
  const initialValue = normalizeValue(value.data.value);
  const [text, setText] = useState(initialValue);
  const finishedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const originalValueRef = useRef(normalizeValue(value.data.value));

  const templates = useMemo(() => {
    const column = value.data.columnName ?? "column";
    return [
      { label: "> 0", template: `${column} > 0` },
      { label: ">= 0", template: `${column} >= 0` },
      { label: "!= ''", template: `${column} <> ''` },
      { label: "IS NOT NULL", template: `${column} IS NOT NULL` },
      { label: "IN (…) ", template: `${column} IN (...)` },
    ];
  }, [value.data.columnName]);

  const buildCell = useCallback(
    (nextValue: string | null): CheckConstraintCustomCell => ({
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

  const commitValue = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedEditing(buildCell(nextValue));
    },
    [buildCell, onFinishedEditing],
  );

  const commitCurrent = useCallback(() => {
    const normalized = normalizeValue(text);
    if (normalized === originalValueRef.current) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!normalized) {
      commitValue(null);
      return;
    }

    commitValue(normalized);
  }, [commitValue, onFinishedEditing, text]);

  const commitWithMovement = useCallback(
    (movement: readonly [-1 | 0 | 1, -1 | 0 | 1]) => {
      const normalized = normalizeValue(text);
      if (normalized === originalValueRef.current) {
        finishedRef.current = true;
        onFinishedEditing(undefined, movement);
        return;
      }

      finishedRef.current = true;

      if (!normalized) {
        onFinishedEditing(buildCell(null), movement);
        return;
      }

      onFinishedEditing(buildCell(normalized), movement);
    },
    [buildCell, onFinishedEditing, text],
  );

  const handleEnter = useCallback(() => {
    if (finishedRef.current) return true;
    commitCurrent();
    return true;
  }, [commitCurrent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) return;
      if (!containerRef.current?.contains(document.activeElement)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        commitWithMovement(movement);
      } else if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrent();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitWithMovement, commitCurrent, onFinishedEditing]);

  useCommitOnUnmount(finishedRef, commitCurrent);

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-popover shadow-lg click-outside-ignore min-w-[320px] max-w-[720px] w-max"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        <span className="text-[10px] font-medium text-foreground/80">
          Check for {value.data.columnName ?? "column"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-border/50">
        {templates.map((template) => (
          <button
            key={template.label}
            type="button"
            className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground/80 hover:bg-muted"
            onClick={() => setText(template.template)}
          >
            {template.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[10px] ml-auto"
          onClick={() => setText("")}
        >
          Clear
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        <CodeEditor
          value={text}
          onChange={setText}
          onEnter={handleEnter}
          language="sql"
          autoFocus={true}
          lineNumbers={false}
          height="100%"
          minHeight="180px"
          maxHeight="360px"
          placeholder="e.g. column_value > 0"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
        <div className="flex-1">Enter to save, Shift+Enter for new line, Esc to cancel</div>
      </div>
    </div>
  );
};

export const CheckConstraintCellEditorWithProps = Object.assign(
  CheckConstraintCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
