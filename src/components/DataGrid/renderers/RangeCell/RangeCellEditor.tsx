import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type { RangeCustomCell, Bounds } from "./types";
import {
  parseRange,
  formatRange,
  getElementType,
  isValidRangeValue,
  isValidRange,
  getPlaceholder,
} from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RangeCellEditorProps {
  value: RangeCustomCell;
  onFinishedEditing: (
    newValue?: RangeCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const RangeCellEditor: React.FC<RangeCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );
  const parsed = useMemo(() => parseRange(initialValue), [initialValue]);
  const elementType = useMemo(
    () => value.data.elementType ?? getElementType(value.data.kind),
    [value.data.elementType, value.data.kind],
  );

  const [lower, setLower] = useState(parsed.lower ?? "");
  const [upper, setUpper] = useState(parsed.upper ?? "");
  const [lowerEmpty, setLowerEmpty] = useState(parsed.lower === null);
  const [upperEmpty, setUpperEmpty] = useState(parsed.upper === null);
  const [lowerInclusive, setLowerInclusive] = useState(parsed.lowerInclusive);
  const [upperInclusive, setUpperInclusive] = useState(parsed.upperInclusive);

  const finishedRef = useRef(false);
  const lowerInputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;
  const placeholders = useMemo(
    () => getPlaceholder(elementType),
    [elementType],
  );

  // Validation state
  const lowerValid = useMemo(
    () => lowerEmpty || isValidRangeValue(lower, elementType),
    [lower, lowerEmpty, elementType],
  );
  const upperValid = useMemo(
    () => upperEmpty || isValidRangeValue(upper, elementType),
    [upper, upperEmpty, elementType],
  );
  const rangeValid = useMemo(() => {
    const lowerVal = lowerEmpty ? null : lower || null;
    const upperVal = upperEmpty ? null : upper || null;
    const bounds: Bounds = `${lowerInclusive ? "[" : "("}${
      upperInclusive ? "]" : ")"
    }`;
    return isValidRange(lowerVal, upperVal, bounds, elementType);
  }, [
    lower,
    upper,
    lowerEmpty,
    upperEmpty,
    lowerInclusive,
    upperInclusive,
    elementType,
  ]);

  const isValid = lowerValid && upperValid && rangeValid;

  const getCurrentValue = useCallback(() => {
    const lowerVal = lowerEmpty ? null : lower.trim() || null;
    const upperVal = upperEmpty ? null : upper.trim() || null;
    const bounds: Bounds = `${lowerInclusive ? "[" : "("}${
      upperInclusive ? "]" : ")"
    }`;
    return formatRange(lowerVal, upperVal, bounds);
  }, [lower, upper, lowerEmpty, upperEmpty, lowerInclusive, upperInclusive]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: RangeCustomCell = {
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
    const currentValue = getCurrentValue();
    const hasChanged = currentValue !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!isValid) {
      // Don't commit invalid values
      return;
    }

    // If both are empty, commit as null (if nullable) or empty range
    if (lowerEmpty && upperEmpty) {
      if (nullable) {
        commit(null);
      } else {
        commit("empty");
      }
      return;
    }

    commit(currentValue);
  }, [
    commit,
    getCurrentValue,
    initialValue,
    isValid,
    lowerEmpty,
    upperEmpty,
    nullable,
    onFinishedEditing,
  ]);

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
        // Allow normal tab behavior between fields
      }
    },
    [commitCurrentValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  // Preview text
  const previewText = useMemo(() => {
    if (lowerEmpty && upperEmpty) return "empty";
    const lowerStr = lowerEmpty ? "" : lower || "";
    const upperStr = upperEmpty ? "" : upper || "";
    const lb = lowerInclusive ? "[" : "(";
    const ub = upperInclusive ? "]" : ")";
    return `${lb}${lowerStr},${upperStr}${ub}`;
  }, [lower, upper, lowerEmpty, upperEmpty, lowerInclusive, upperInclusive]);

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

      {/* Lower bound */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-[10px] text-muted-foreground w-20">
            Lower bound
          </Label>
          <Select
            value={lowerInclusive ? "inclusive" : "exclusive"}
            onValueChange={(v) => {
              if (v) {
                setLowerInclusive(v === "inclusive");
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="click-outside-ignore">
              <SelectItem value="inclusive">[ inclusive</SelectItem>
              <SelectItem value="exclusive">( exclusive</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 ml-auto">
            <Checkbox
              id="lower-empty"
              checked={lowerEmpty}
              onCheckedChange={(checked) => {
                setLowerEmpty(checked);
              }}
              className="h-3 w-3"
            />
            <Label
              htmlFor="lower-empty"
              className="text-[10px] text-muted-foreground"
            >
              Unbounded
            </Label>
          </div>
        </div>
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={lowerInputRef}
          className={cn(
            "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded",
            !lowerValid ? "border-destructive" : "border-border/50",
            lowerEmpty && "opacity-50",
          )}
          disabled={lowerEmpty}
          value={lower}
          onChange={(e) => {
            setLower(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholders.lower}
          autoFocus
        />
      </div>

      {/* Upper bound */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-[10px] text-muted-foreground w-20">
            Upper bound
          </Label>
          <Select
            value={upperInclusive ? "inclusive" : "exclusive"}
            onValueChange={(v) => {
              setUpperInclusive(v === "inclusive");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="click-outside-ignore">
              <SelectItem value="inclusive">] inclusive</SelectItem>
              <SelectItem value="exclusive">) exclusive</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 ml-auto">
            <Checkbox
              id="upper-empty"
              checked={upperEmpty}
              onCheckedChange={(checked) => {
                setUpperEmpty(checked);
              }}
              className="h-3 w-3"
            />
            <Label
              htmlFor="upper-empty"
              className="text-[10px] text-muted-foreground"
            >
              Unbounded
            </Label>
          </div>
        </div>
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded",
            !upperValid ? "border-destructive" : "border-border/50",
            upperEmpty && "opacity-50",
          )}
          disabled={upperEmpty}
          value={upper}
          onChange={(e) => {
            setUpper(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholders.upper}
        />
      </div>

      {/* Preview and actions */}
      <div className="px-2 py-1.5 flex items-center gap-2">
        <div className="flex-1">
          <span className="text-[10px] text-muted-foreground">Preview: </span>
          <code className="text-[10px] font-mono">{previewText}</code>
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
      {!isValid && (
        <div className="px-2 pb-1 text-[10px] text-destructive leading-tight">
          {!lowerValid && "Invalid lower bound. "}
          {!upperValid && "Invalid upper bound. "}
          {lowerValid && upperValid && !rangeValid && "Lower must be ≤ upper."}
        </div>
      )}
    </div>
  );
};

export const RangeCellEditorWithProps = Object.assign(RangeCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
