import React, { useState, useRef, useEffect, useCallback } from "react";
import type { IndexUniqueCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface IndexUniqueCellEditorProps {
  value: IndexUniqueCell;
  onFinishedEditing: (
    newValue?: IndexUniqueCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IndexUniqueCellEditor: React.FC<IndexUniqueCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const commandRef = useRef<HTMLDivElement>(null);
  const { requiresRecreate } = value.data;

  // Show confirmation dialog only for existing indexes that require recreate
  const [showConfirm, setShowConfirm] = useState(requiresRecreate);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    // Focus the command container for keyboard navigation when not showing confirm
    if (!showConfirm || confirmed) {
      const timer = setTimeout(() => {
        commandRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [showConfirm, confirmed]);

  const handleSelect = useCallback(
    async (newValue: "YES" | "NO") => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: IndexUniqueCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: newValue,
        },
        copyData: newValue,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      await new Promise((r) => window.requestAnimationFrame(r));
      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleContinue = useCallback(() => {
    setConfirmed(true);
    setShowConfirm(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        onFinishedEditing(value, movement);
      }
    },
    [onFinishedEditing, value],
  );

  // Render confirmation dialog for existing indexes
  if (showConfirm && !confirmed) {
    return (
      <div
        className="w-full h-full flex flex-col relative click-outside-ignore z-50 bg-popover border shadow-lg min-w-[280px]"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50">
          <IconAlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 flex-shrink-0" />
          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Recreate Required
          </span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Changing uniqueness will drop and recreate this index.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/50 bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // Render YES/NO toggle selection
  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          Unique
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {value.data.value}
        </span>
      </div>

      <div className="flex items-center flex-1">
        <Command
          ref={commandRef}
          className="w-full border-0 shadow-none"
          onKeyDown={handleKeyDown}
        >
          <CommandList className="max-h-[200px]">
            <CommandGroup>
              <CommandItem
                value="YES"
                onSelect={() => handleSelect("YES")}
                className="text-xs font-medium flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">
                    YES
                  </span>
                </div>
                <IconCheck
                  className={cn(
                    "h-3 w-3",
                    value.data.value === "YES" ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
              <CommandItem
                value="NO"
                onSelect={() => handleSelect("NO")}
                className="text-xs font-medium flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400">NO</span>
                </div>
                <IconCheck
                  className={cn(
                    "h-3 w-3",
                    value.data.value === "NO" ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );
};

export const IndexUniqueCellEditorWithProps = Object.assign(
  IndexUniqueCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);

export default IndexUniqueCellEditorWithProps;
