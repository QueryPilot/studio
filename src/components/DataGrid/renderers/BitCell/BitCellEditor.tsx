import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { BitCustomCell, BitDisplayMode } from "./types";
import {
  isValidBinary,
  isValidBitLength,
  binaryToHex,
  binaryToDecimal,
  parseInputValue,
  countSetBits,
  formatBinaryDisplay,
} from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BitCellEditorProps {
  value: BitCustomCell;
  onFinishedEditing: (
    newValue?: BitCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const BitCellEditor: React.FC<BitCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );

  const [binaryValue, setBinaryValue] = useState(initialValue);
  const [displayMode, setDisplayMode] = useState<BitDisplayMode>("binary");
  const [inputValue, setInputValue] = useState(initialValue);

  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);
  const expectedLength = value.data.length;
  const isFixedLength =
    value.data.kind === "bit-cell" && expectedLength !== undefined;
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Validation
  const isValidInput = useMemo(() => {
    if (!binaryValue) return true;
    const validBinary = isValidBinary(binaryValue);
    const validLength =
      !isFixedLength || isValidBitLength(binaryValue, expectedLength);
    return validBinary && validLength;
  }, [binaryValue, isFixedLength, expectedLength]);

  // Stats
  const setBits = useMemo(() => countSetBits(binaryValue), [binaryValue]);
  const totalBits = binaryValue.length;

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : `B'${nextValue}'`;

      const newCell: BitCustomCell = {
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
    const currentValue = binaryValue.trim() || null;
    const hasChanged = currentValue !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!isValidInput) {
      // Don't commit invalid values
      return;
    }

    commit(currentValue);
  }, [commit, binaryValue, initialValue, isValidInput, onFinishedEditing]);

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
        commitCurrentValue();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        finishedRef.current = true;

        if (!isValidInput) {
          onFinishedEditing(undefined, movement);
          return;
        }

        const currentValue = binaryValue.trim() || null;
        const newCell: BitCustomCell = {
          kind: value.kind,
          data: {
            ...value.data,
            value: currentValue,
          },
          copyData: currentValue == null ? "NULL" : `B'${currentValue}'`,
          allowOverlay: value.allowOverlay,
          readonly: value.readonly,
        };

        onFinishedEditing(newCell, movement);
      }
    },
    [commitCurrentValue, onFinishedEditing, value, binaryValue, isValidInput],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value;
    setInputValue(newInput);

    // Parse based on display mode
    const parsed = parseInputValue(newInput, displayMode);
    if (parsed !== null) {
      setBinaryValue(parsed);
    } else if (newInput.trim() === "") {
      setBinaryValue("");
    }
  };

  const handleModeChange = (mode: BitDisplayMode) => {
    setDisplayMode(mode);

    // Update input display based on new mode
    if (!binaryValue) {
      setInputValue("");
      return;
    }

    switch (mode) {
      case "binary":
        setInputValue(binaryValue);
        break;
      case "hex":
        setInputValue(binaryToHex(binaryValue));
        break;
      case "decimal":
        setInputValue(binaryToDecimal(binaryValue));
        break;
    }
  };

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 min-w-[320px] gdg-editor-shell">
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

      {/* Mode selector and input */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-muted-foreground">Input as:</span>
          <Select
            value={displayMode}
            onValueChange={(value) => {
              handleModeChange(value as BitDisplayMode);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="binary">Binary</SelectItem>
              <SelectItem value="hex">Hex</SelectItem>
              <SelectItem value="decimal">Decimal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          className={cn(
            "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded",
            !isValidInput ? "border-destructive" : "border-border/50",
          )}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            displayMode === "binary"
              ? "10101010"
              : displayMode === "hex"
              ? "AA"
              : "170"
          }
          autoFocus
        />
      </div>

      {/* Binary visualization */}
      {binaryValue && (
        <div className="px-2 py-1.5 border-b border-border/30">
          <span className="text-[10px] text-muted-foreground block mb-1">
            Binary view:
          </span>
          <code className="text-[10px] font-mono block break-all">
            {formatBinaryDisplay(binaryValue, 8)}
          </code>
        </div>
      )}

      {/* Stats and actions */}
      <div className="px-2 py-1.5 flex items-center gap-2">
        <div className="flex-1 text-[10px] text-muted-foreground">
          {totalBits > 0 && (
            <>
              {totalBits} bits, {setBits} set (
              {Math.round((setBits / totalBits) * 100)}%)
            </>
          )}
          {isFixedLength && expectedLength && (
            <span className="ml-2">(expected: {expectedLength})</span>
          )}
        </div>
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
      {!isValidInput && (
        <div className="px-2 pb-1 text-[10px] text-destructive leading-tight">
          {!isValidBinary(binaryValue) &&
            "Invalid binary string (only 0 and 1 allowed). "}
          {isFixedLength &&
            !isValidBitLength(binaryValue, expectedLength) &&
            `Expected ${expectedLength} bits, got ${totalBits}.`}
        </div>
      )}
    </div>
  );
};

export const BitCellEditorWithProps = Object.assign(BitCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
