import React, { useRef, useEffect, useCallback } from "react";
import type { TriggerEnabledCustomCell } from "./types";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface TriggerEnabledCellEditorProps {
  value: TriggerEnabledCustomCell;
  onFinishedEditing: (
    newValue?: TriggerEnabledCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const TriggerEnabledCellEditor: React.FC<TriggerEnabledCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const commandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      commandRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const handleSelect = useCallback(
    async (newValue: "YES" | "NO") => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: TriggerEnabledCustomCell = {
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

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          Enabled
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

export const TriggerEnabledCellEditorWithProps = Object.assign(
  TriggerEnabledCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);

export default TriggerEnabledCellEditorWithProps;
