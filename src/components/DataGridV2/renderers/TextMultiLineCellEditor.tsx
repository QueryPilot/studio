import React, { useState, useRef, useEffect, useCallback } from "react";
import type { TextMultiLineCustomCell } from "./TextMultiLineCellRenderer";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface TextMultiLineCellEditorProps {
  value: TextMultiLineCustomCell;
  onFinishedEditing: (
    newValue?: TextMultiLineCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TextMultiLineCellEditor: React.FC<
  TextMultiLineCellEditorProps
> = ({ value, onFinishedEditing }) => {
  const initialValue = value.data.value || "";
  const [text, setText] = useState<string>(initialValue);
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();

      // Auto-resize
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        400,
      )}px`;
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);

    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 400)}px`;
  };

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: TextMultiLineCustomCell = {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed && value.data.nullable) {
        commit(null);
      } else {
        commit(text);
      }
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

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

  return (
    <div className="w-full h-full click-outside-ignore pt-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex-1 w-full text-xs font-mono bg-transparent resize-none outline-none p-2 pt-0",
        )}
        placeholder={value.data.nullable ? "NULL" : ""}
      />
      <div className="text-xs text-muted-foreground bg-background rounded-none p-1 px-2 mt-2 flex items-center justify-between">
        <span className="font-bold">Ctrl</span>+
        <span className="font-bold">Enter</span> to save,{" "}
        <span className="font-bold">Esc</span> to cancel
        {value.data.nullable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleClear}
            title="Clear (NULL)"
          >
            <XIcon className="h-3 w-3 mr-1" />
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
