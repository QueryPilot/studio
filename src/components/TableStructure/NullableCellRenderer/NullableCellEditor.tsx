import React, { useEffect, useRef } from "react";
import { type NullableCell } from "./types";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { IconCheck } from '@tabler/icons-react';

interface NullableCellEditorProps {
  value: NullableCell;
  onFinishedEditing: (
    newValue?: NullableCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const NullableCellEditor: React.FC<NullableCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const commandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the command container for keyboard navigation
    const timer = setTimeout(() => {
      commandRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSelect = async (newValue: "YES" | "NO") => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const newCell: NullableCell = {
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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  };

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          {value.data.columnName || "Nullable"}
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

export const NullableCellEditorWithProps = Object.assign(NullableCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
