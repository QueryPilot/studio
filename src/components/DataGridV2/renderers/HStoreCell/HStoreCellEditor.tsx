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
  const initial = useMemo(
    () => hstoreToEditorText(value.data.value),
    [value.data.value],
  );

  const [text, setText] = useState<string>(initial);
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const normalizationPreview = useMemo(
    () => normalizeHstoreEditorText(text),
    [text],
  );

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

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
    const trimmed = text.trim();
    if (!trimmed && nullable) {
      commit(null);
    } else {
      commit(trimmed);
    }
  }, [commit, nullable, text]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (finishedRef.current) return;

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
      onFinishedEditing(value, movement);
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
    <div className="w-full h-full flex flex-col gap-2 p-2 click-outside-ignore">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className={cn(
          "flex-1 min-h-[120px] w-full resize-none bg-transparent text-xs font-mono leading-5 outline-none",
          text.trim().length === 0 ? "italic text-muted-foreground" : "",
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
          {normalizationPreview.hasDuplicateKeys && (
            <span className="text-[10px] text-muted-foreground/80">
              Duplicate keys detected; keeping the last value for each key
              (removed
              {` ${normalizationPreview.duplicatesRemoved} duplicate${
                normalizationPreview.duplicatesRemoved === 1 ? "" : "s"
              }`}
              ).
            </span>
          )}
          {normalizationPreview.parseErrors && (
            <span className="text-[10px] text-destructive/80">
              Some lines could not be parsed; they will be saved as typed.
            </span>
          )}
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
  );
};

export const HStoreCellEditorWithProps = Object.assign(HStoreCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
