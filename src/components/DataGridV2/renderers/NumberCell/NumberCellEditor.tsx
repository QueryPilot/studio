import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NumberCustomCell } from "./types";
import { isMeaningful, isValidNumberText, normalizeValue } from "./utils";

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
  const [text, setText] = useState(initialText);
  const [isValid, setIsValid] = useState(() => isValidNumberText(initialText));
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

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
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        finishedRef.current = true;
        onFinishedEditing(value, movement);
      }
    },
    [commit, nullable, onFinishedEditing, text, value],
  );

  const handleChange = (next: string) => {
    setText(next);
    setIsValid(isValidNumberText(next));
  };

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  return (
    <div className="w-full h-full flex items-center gap-1 px-2 click-outside-ignore">
      <input
        ref={inputRef}
        className={cn(
          "h-[31px] w-full bg-transparent text-xs font-mono outline-none leading-6",
          !isMeaningful(text) ? "italic text-muted-foreground" : "",
          !isValid
            ? "border-b border-destructive focus:border-destructive"
            : "",
        )}
        spellCheck={false}
        value={text}
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
          className="h-6 w-6 p-0 z-50"
          title="Clear"
          onClick={handleClear}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

export const NumberCellEditorWithProps = Object.assign(NumberCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
