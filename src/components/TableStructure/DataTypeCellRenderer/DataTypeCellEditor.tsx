import React, { useEffect, useMemo, useRef, useState } from "react";
import { type DataTypeCell, POSTGRES_STANDARD_TYPES } from "./types";
import { Command as CommandPrimitive } from "cmdk";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { IconCheck } from '@tabler/icons-react';
import { cn } from "@/lib/cn";

interface DataTypeCellEditorProps {
  value: DataTypeCell;
  onFinishedEditing: (
    newValue?: DataTypeCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const DataTypeCellEditor: React.FC<DataTypeCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const customTypes = value.data.customTypes;

  const allTypes = useMemo(
    () => [...POSTGRES_STANDARD_TYPES, ...(customTypes ?? [])],
    [customTypes],
  );

  const [inputValue, setInputValue] = useState("");
  const [hasTyped, setHasTyped] = useState(false);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-select text when editor opens
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, input.value.length);
      }
    }, 50); // Small delay to ensure input is mounted
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const handleSelect = async (selectedValue: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const newCell: DataTypeCell = {
      kind: value.kind,
      data: {
        ...value.data,
        value: selectedValue,
      },
      copyData: selectedValue,
      allowOverlay: value.allowOverlay,
      readonly: value.readonly,
    };

    await new Promise((r) => window.requestAnimationFrame(r));
    onFinishedEditing(newCell);
  };

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    setHasTyped(true);
  };

  // Show all types initially, filter only after user starts typing
  const filteredTypes = hasTyped
    ? allTypes.filter((type) =>
        type.toLowerCase().includes(inputValue.toLowerCase()),
      )
    : allTypes;

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          {value.data.columnName || "Unknown Column"}
        </span>
        {value.data.value && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {value.data.value}
          </span>
        )}
      </div>

      <div className="flex items-center flex-1">
        <Command className="w-full border-0 shadow-none">
          <div className="flex items-center border-b">
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder="Search for a data type..."
              value={inputValue}
              onValueChange={handleInputChange}
              className={cn(
                "h-full w-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono",
                "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onKeyDown={(e) => {
                if (finishedRef.current) return;

                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSelect(inputValue);
                } else if (e.key === "Escape") {
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
                  const newCell: DataTypeCell = {
                    kind: value.kind,
                    data: {
                      ...value.data,
                      value: inputValue,
                    },
                    copyData: inputValue,
                    allowOverlay: value.allowOverlay,
                    readonly: value.readonly,
                  };
                  onFinishedEditing(newCell, movement);
                }
              }}
            />
          </div>
          <CommandList className="max-h-[200px]">
            <CommandGroup>
              {filteredTypes.length === 0 && inputValue && (
                <CommandItem
                  value={inputValue}
                  onSelect={() => handleSelect(inputValue)}
                  className="text-xs font-mono flex items-center justify-between"
                >
                  <div className="text-xs text-muted-foreground">
                    Using "{inputValue}"
                  </div>
                </CommandItem>
              )}
              {filteredTypes.map((type) => {
                const isSelected = type === inputValue;
                return (
                  <CommandItem
                    key={type}
                    value={type}
                    onSelect={() => handleSelect(type)}
                    className="text-xs font-mono flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">{type}</div>
                    <IconCheck
                      className={cn(
                        "h-3 w-3",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );
};

export const DataTypeCellEditorWithProps = Object.assign(DataTypeCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
