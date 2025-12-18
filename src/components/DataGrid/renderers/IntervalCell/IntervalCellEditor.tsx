import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type { IntervalCustomCell, IntervalParts } from "./types";
import {
  parseInterval,
  formatInterval,
  INTERVAL_PRESETS,
  EMPTY_INTERVAL,
} from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface IntervalCellEditorProps {
  value: IntervalCustomCell;
  onFinishedEditing: (
    newValue?: IntervalCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IntervalCellEditor: React.FC<IntervalCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );
  const parsedInitial = useMemo(
    () => parseInterval(initialValue),
    [initialValue],
  );

  const [parts, setParts] = useState<IntervalParts>(parsedInitial);

  const finishedRef = useRef(false);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  const getCurrentValue = useCallback(() => {
    return formatInterval(parts);
  }, [parts]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: IntervalCustomCell = {
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

    commit(currentValue);
  }, [commit, getCurrentValue, initialValue, onFinishedEditing]);

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
      }
    },
    [commitCurrentValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const updatePart = (key: keyof IntervalParts, value: number | boolean) => {
    setParts((prev) => ({ ...prev, [key]: value }));
  };

  const handlePreset = (presetValue: string) => {
    setParts(parseInterval(presetValue));
  };

  const handleReset = () => {
    setParts({ ...EMPTY_INTERVAL });
  };

  // Preview text
  const previewText = useMemo(() => formatInterval(parts), [parts]);

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 min-w-[300px]">
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

      {/* Date components */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-[10px] text-muted-foreground">Date</Label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[9px] text-muted-foreground">Years</Label>
            <input
              type="number"
              min="0"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.years}
              onChange={(e) =>
                updatePart("years", Math.max(0, parseInt(e.target.value) || 0))
              }
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Months</Label>
            <input
              type="number"
              min="0"
              max="11"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.months}
              onChange={(e) =>
                updatePart(
                  "months",
                  Math.max(0, Math.min(11, parseInt(e.target.value) || 0)),
                )
              }
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Days</Label>
            <input
              type="number"
              min="0"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.days}
              onChange={(e) =>
                updatePart("days", Math.max(0, parseInt(e.target.value) || 0))
              }
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* Time components */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-[10px] text-muted-foreground">Time</Label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[9px] text-muted-foreground">Hours</Label>
            <input
              type="number"
              min="0"
              max="23"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.hours}
              onChange={(e) =>
                updatePart(
                  "hours",
                  Math.max(0, Math.min(23, parseInt(e.target.value) || 0)),
                )
              }
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Minutes</Label>
            <input
              type="number"
              min="0"
              max="59"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.minutes}
              onChange={(e) =>
                updatePart(
                  "minutes",
                  Math.max(0, Math.min(59, parseInt(e.target.value) || 0)),
                )
              }
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Seconds</Label>
            <input
              type="number"
              min="0"
              max="59.999999"
              step="0.001"
              className={cn(
                "w-full bg-transparent text-xs font-mono outline-none px-1 py-0.5 border rounded border-border/50",
              )}
              value={parts.seconds}
              onChange={(e) =>
                updatePart(
                  "seconds",
                  Math.max(0, Math.min(59.999999, parseFloat(e.target.value) || 0)),
                )
              }
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
      </div>

      {/* Negative toggle */}
      <div className="px-2 py-1.5 border-b border-border/30 flex items-center gap-2">
        <Switch
          id="negative"
          checked={parts.negative}
          onCheckedChange={(checked) => updatePart("negative", checked)}
          className="h-4 w-7"
        />
        <Label htmlFor="negative" className="text-[10px]">
          Negative interval
        </Label>
      </div>

      {/* Quick presets */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <Label className="text-[10px] text-muted-foreground mb-1 block">
          Quick presets
        </Label>
        <div className="flex flex-wrap gap-1">
          {INTERVAL_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              variant="outline"
              size="sm"
              className="h-5 text-[10px] px-1.5"
              onClick={() => handlePreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[10px] px-1.5"
            onClick={handleReset}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Preview and actions */}
      <div className="px-2 py-1.5 flex items-center gap-2">
        <div className="flex-1">
          <span className="text-[10px] text-muted-foreground">Output: </span>
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
    </div>
  );
};

export const IntervalCellEditorWithProps = Object.assign(IntervalCellEditor, {
  disablePadding: true,
  disableStyling: false,
});

