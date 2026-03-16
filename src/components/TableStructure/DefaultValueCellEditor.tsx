import React, { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";
import { type DefaultValueCustomCell } from "./types";

interface DefaultValueCellEditorProps {
  value: DefaultValueCustomCell;
  onFinishedEditing: (
    newValue?: DefaultValueCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const DEFAULT_SUGGESTIONS: Array<{ label: string; value: string }> = [
  { label: "NULL", value: "NULL" },
  { label: "now()", value: "now()" },
  { label: "current_timestamp", value: "current_timestamp" },
  { label: "uuid_generate_v4()", value: "uuid_generate_v4()" },
  { label: "gen_random_uuid()", value: "gen_random_uuid()" },
  { label: "true", value: "true" },
  { label: "false", value: "false" },
  { label: "''", value: "''" },
];

const normalizeValue = (value: string | null): string =>
  value?.trim() ?? "";

export const DefaultValueCellEditor: React.FC<DefaultValueCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value ?? "";
  const [text, setText] = useState(initialValue);
  const finishedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const originalValueRef = useRef(normalizeValue(value.data.value));

  const buildCell = useCallback(
    (nextValue: string | null): DefaultValueCustomCell => ({
      kind: value.kind,
      data: {
        ...value.data,
        value: nextValue,
      },
      copyData: nextValue ?? "NULL",
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

    if (!normalized || normalized.toUpperCase() === "NULL") {
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

      if (!normalized || normalized.toUpperCase() === "NULL") {
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
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Always commit on Enter (don't check defaultPrevented as CodeMirror may have set it)
        e.preventDefault();
        e.stopPropagation();
        commitCurrent();
      }
    };

    // Use capture phase to intercept before CodeMirror
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [commitWithMovement, commitCurrent, onFinishedEditing]);

  useCommitOnUnmount(finishedRef, commitCurrent);

  // Ensure CodeEditor gets focus after the grid overlay finishes mounting.
  // The CodeEditor's built-in autoFocus fires at 100ms which can race with
  // the overlay container taking focus. This secondary attempt at 200ms
  // guarantees the editor wins.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const cm = containerRef.current?.querySelector<HTMLElement>(".cm-content");
      if (cm && document.activeElement !== cm) {
        cm.focus();
      }
    }, 200);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-popover shadow-lg click-outside-ignore min-w-[320px] max-w-[640px] w-max"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        <span className="text-[10px] font-medium text-foreground/80">
          Default for {value.data.columnName ?? "column"}
        </span>
        {value.data.dbType && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {value.data.dbType}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-border/50">
        {DEFAULT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground/80 hover:bg-muted"
            onClick={() => setText(suggestion.value)}
          >
            {suggestion.label}
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
          minHeight="160px"
          maxHeight="320px"
          placeholder="e.g. now(), uuid_generate_v4(), NULL"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1 shrink-0 bg-popover border-t border-border/50">
        <div className="flex-1">Enter to save, Shift+Enter for new line, Esc to cancel</div>
      </div>
    </div>
  );
};

export const DefaultValueCellEditorWithProps = Object.assign(
  DefaultValueCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
