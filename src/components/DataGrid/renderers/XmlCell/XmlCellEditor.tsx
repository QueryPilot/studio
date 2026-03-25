import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  IconTrash,
  IconKey,
  IconCode,
  IconAlignLeft,
} from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { XmlCustomCell } from "./types";
import { validateXml, formatXml, minifyXml, countLines } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface XmlCellEditorProps {
  value: XmlCustomCell;
  onFinishedEditing: (
    newValue?: XmlCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const XmlCellEditor: React.FC<XmlCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );

  const [xmlValue, setXmlValue] = useState(initialValue);
  const [validation, setValidation] = useState(() => validateXml(initialValue));

  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  const lineCount = useMemo(() => countLines(xmlValue), [xmlValue]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: XmlCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
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
    const currentValue = xmlValue.trim() || null;
    const hasChanged = currentValue !== (initialValue.trim() || null);

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Validate before commit
    const result = validateXml(currentValue);
    if (!result.isValid) {
      // Still allow commit with warning, as some use cases may need partial XML
      // But update validation state
      setValidation(result);
    }

    commit(currentValue);
  }, [commit, xmlValue, initialValue, onFinishedEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrentValue();
      }
      // Allow regular Enter for newlines
    },
    [commitCurrentValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setXmlValue(newValue);
    setValidation(validateXml(newValue));
  };

  const handleFormat = () => {
    const formatted = formatXml(xmlValue);
    setXmlValue(formatted);
    if (textareaRef.current) {
      textareaRef.current.value = formatted;
    }
  };

  const handleMinify = () => {
    const minified = minifyXml(xmlValue);
    setXmlValue(minified);
    if (textareaRef.current) {
      textareaRef.current.value = minified;
    }
  };

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 min-w-[400px] gdg-editor-shell">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
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

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5 gap-1"
          onClick={handleFormat}
          title="Format XML"
        >
          <IconAlignLeft className="h-3 w-3" />
          Format
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5 gap-1"
          onClick={handleMinify}
          title="Minify XML"
        >
          <IconCode className="h-3 w-3" />
          Minify
        </Button>
        <div className="flex-1" />
        <span className="text-[9px] text-muted-foreground">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        {validation.isValid ? (
          <span className="text-[9px] text-green-600">✓ Valid</span>
        ) : (
          <span className="text-[9px] text-destructive">✗ Invalid</span>
        )}
      </div>

      {/* Editor */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          className={cn(
            "w-full h-48 bg-transparent text-xs font-mono outline-none p-2 resize-none",
            !validation.isValid && "border-l-2 border-l-destructive",
          )}
          spellCheck={false}
          defaultValue={initialValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="<root>...</root>"
          autoFocus
        />
      </div>

      {/* Validation error */}
      {!validation.isValid && validation.error && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/10 leading-tight">
          {validation.errorLine && (
            <span className="font-medium">Line {validation.errorLine}: </span>
          )}
          {validation.error}
        </div>
      )}

      {/* Footer */}
      <div className="px-2 py-1 flex items-center gap-2 border-t border-border/30">
        <span className="text-[9px] text-muted-foreground">
          Ctrl+Enter to save, Esc to cancel
        </span>
        <div className="flex-1" />
        {nullable && (
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            title="Clear (NULL)"
            onClick={handleClear}
          >
            <IconTrash className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const XmlCellEditorWithProps = Object.assign(XmlCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
