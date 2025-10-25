import React, { useState, useRef, useEffect, useCallback } from "react";
import type { TextSingleLineCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface TextSingleLineCellEditorProps {
  value: TextSingleLineCustomCell;
  onFinishedEditing: (
    newValue?: TextSingleLineCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TextSingleLineCellEditor: React.FC<
  TextSingleLineCellEditorProps
> = ({ value, onFinishedEditing }) => {
  const initialValue = value.data.value || "";
  const [text, setText] = useState<string>(initialValue);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: TextSingleLineCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
        },
        copyData: nextValue ?? "NULL",
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
      commit(trimmed || text);
    }
  }, [commit, text, value.data.nullable]);

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

  return (
    <div className="w-full h-full flex items-center relative click-outside-ignore z-50">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        maxLength={value.data.maxLength}
        className={cn(
          "h-8 w-full bg-transparent py-1 px-2 text-xs outline-none",
          !value.data.value ? "italic text-muted-foreground" : "",
          { "pr-8": value.data.nullable },
        )}
        placeholder={value.data.nullable ? "NULL" : ""}
      />
      {value.data.nullable && (
        <Button
          variant="ghost"
          className="h-5 w-5 p-0 absolute right-2 top-1/2 -translate-y-1/2"
          onClick={handleClear}
          title="Clear (NULL)"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

export const TextSingleLineCellEditorWithProps = Object.assign(
  TextSingleLineCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
