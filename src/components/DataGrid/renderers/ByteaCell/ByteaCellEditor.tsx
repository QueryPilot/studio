import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  IconTrash,
  IconKey,
  IconUpload,
  IconDownload,
} from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { ByteaCustomCell, ByteaDisplayMode } from "./types";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  formatHexDump,
  formatFileSize,
  isValidBase64,
  isValidHex,
  readFileAsBase64,
  downloadBytes,
} from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ByteaCellEditorProps {
  value: ByteaCustomCell;
  onFinishedEditing: (
    newValue?: ByteaCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const ByteaCellEditor: React.FC<ByteaCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );

  const [base64Value, setBase64Value] = useState(initialValue);
  const [displayMode, setDisplayMode] = useState<ByteaDisplayMode>("hex");
  const [inputValue, setInputValue] = useState(() => {
    if (!initialValue) return "";
    const bytes = base64ToBytes(initialValue);
    return bytesToHex(bytes);
  });

  const finishedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Computed values
  const bytes = useMemo(() => base64ToBytes(base64Value), [base64Value]);
  const size = bytes.length;

  // Hex dump for display
  const hexDump = useMemo(() => {
    if (bytes.length === 0) return [];
    return formatHexDump(bytes.slice(0, 256)); // Limit to first 256 bytes
  }, [bytes]);

  const isValid = useMemo(() => {
    if (!inputValue) return true;
    switch (displayMode) {
      case "base64":
        return isValidBase64(inputValue);
      case "hex":
        return isValidHex(inputValue);
      case "ascii":
        return true; // ASCII input is always valid
    }
  }, [inputValue, displayMode]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData =
        nextValue == null
          ? "NULL"
          : `[BINARY: ${formatFileSize(base64ToBytes(nextValue).length)}]`;

      const newCell: ByteaCustomCell = {
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
    const hasChanged = base64Value !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!isValid) {
      return;
    }

    commit(base64Value || null);
  }, [commit, base64Value, initialValue, isValid, onFinishedEditing]);

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
    },
    [commitCurrentValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newInput = e.target.value;
    setInputValue(newInput);

    // Parse based on display mode
    try {
      switch (displayMode) {
        case "base64":
          if (isValidBase64(newInput)) {
            setBase64Value(newInput);
          }
          break;
        case "hex":
          if (isValidHex(newInput)) {
            const hexBytes = hexToBytes(newInput.replace(/\s/g, ""));
            setBase64Value(bytesToBase64(hexBytes));
          }
          break;
        case "ascii":
          const encoder = new TextEncoder();
          const asciiBytes = encoder.encode(newInput);
          setBase64Value(bytesToBase64(asciiBytes));
          break;
      }
    } catch {
      // Invalid input, don't update base64Value
    }
  };

  const handleModeChange = (mode: ByteaDisplayMode) => {
    setDisplayMode(mode);

    if (!base64Value) {
      setInputValue("");
      return;
    }

    const currentBytes = base64ToBytes(base64Value);
    switch (mode) {
      case "base64":
        setInputValue(base64Value);
        break;
      case "hex":
        setInputValue(bytesToHex(currentBytes));
        break;
      case "ascii":
        const decoder = new TextDecoder("utf-8", { fatal: false });
        setInputValue(decoder.decode(currentBytes));
        break;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fileBase64 = await readFileAsBase64(file);
      setBase64Value(fileBase64);

      const fileBytes = base64ToBytes(fileBase64);
      switch (displayMode) {
        case "base64":
          setInputValue(fileBase64);
          break;
        case "hex":
          setInputValue(bytesToHex(fileBytes));
          break;
        case "ascii":
          const decoder = new TextDecoder("utf-8", { fatal: false });
          setInputValue(decoder.decode(fileBytes));
          break;
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }

    // Reset file input
    e.target.value = "";
  };

  const handleDownload = () => {
    if (!bytes.length) return;
    downloadBytes(bytes, `data_${Date.now()}.bin`);
  };

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 min-w-[450px]">
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
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border/30">
        <span className="text-[10px] text-muted-foreground">Edit as:</span>
        <Select
          value={displayMode}
          onValueChange={(value) => {
            handleModeChange(value as ByteaDisplayMode);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hex">Hex</SelectItem>
            <SelectItem value="base64">Base64</SelectItem>
            <SelectItem value="ascii">ASCII</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5 gap-1"
          onClick={() => fileInputRef.current?.click()}
          title="Upload file"
        >
          <IconUpload className="h-3 w-3" />
          Upload
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5 gap-1"
          onClick={handleDownload}
          disabled={!bytes.length}
          title="Download as file"
        >
          <IconDownload className="h-3 w-3" />
          Download
        </Button>
      </div>

      {/* Input area */}
      <div className="relative">
        <textarea
          className={cn(
            "w-full h-24 bg-transparent text-xs font-mono outline-none p-2 resize-none",
            !isValid && "border-l-2 border-l-destructive",
          )}
          spellCheck={false}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            displayMode === "hex"
              ? "48 65 6C 6C 6F"
              : displayMode === "base64"
              ? "SGVsbG8="
              : "Hello"
          }
          autoFocus
        />
      </div>

      {/* Hex dump preview */}
      {hexDump.length > 0 && (
        <div className="px-2 py-1 border-t border-border/30 max-h-32 overflow-auto">
          <span className="text-[9px] text-muted-foreground block mb-1">
            Hex dump (first 256 bytes):
          </span>
          <pre className="text-[9px] font-mono text-muted-foreground">
            {hexDump.join("\n")}
          </pre>
        </div>
      )}

      {/* Footer */}
      <div className="px-2 py-1 flex items-center gap-2 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">
          {formatFileSize(size)}
          {size > 256 && ` (showing first 256 bytes)`}
        </span>
        <span className="text-[9px] text-muted-foreground ml-auto">
          Ctrl+Enter to save
        </span>
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

      {/* Validation error */}
      {!isValid && (
        <div className="px-2 pb-1 text-[10px] text-destructive leading-tight">
          Invalid {displayMode === "base64" ? "Base64" : "hex"} format
        </div>
      )}
    </div>
  );
};

export const ByteaCellEditorWithProps = Object.assign(ByteaCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
