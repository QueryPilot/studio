import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { IconKey } from "@tabler/icons-react";
import { type BooleanCustomCell } from "./types";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface BooleanCellEditorProps {
  value: BooleanCustomCell;
  onFinishedEditing: (
    newValue?: BooleanCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const BooleanCellEditor: React.FC<BooleanCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value;
  const initialStringValue =
    initialValue == null ? "null" : initialValue.toString();
  const normalizedInitial = initialValue ?? null;

  const [inputValue, setInputValue] = useState("");
  const [activeValue, setActiveValue] = useState(initialStringValue);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  const options = useMemo(
    () => [
      { value: "null", label: "NULL", className: "text-muted-foreground" },
      {
        value: "true",
        label: "TRUE",
        className: "text-green-600 dark:text-green-400 font-medium",
      },
      {
        value: "false",
        label: "FALSE",
        className: "text-red-600 dark:text-red-400 font-medium",
      },
    ],
    [],
  );

  // Auto-focus when editor mounts (double-click activated)
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;
    const needle = inputValue.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle),
    );
  }, [inputValue, options]);

  const toBooleanValue = (selectedValue: string): boolean | null => {
    switch (selectedValue) {
      case "true":
        return true;
      case "false":
        return false;
      default:
        return null;
    }
  };

  const commitSelection = useCallback(
    (selectedValue: string, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const boolValue = toBooleanValue(selectedValue);

      const newCell: BooleanCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: boolValue,
        },
        copyData: boolValue === null ? "NULL" : String(boolValue),
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      if (movement) {
        onFinishedEditing(newCell, movement);
      } else {
        onFinishedEditing(newCell);
      }
    },
    [onFinishedEditing, value],
  );

  const commitCurrentValue = useCallback(() => {
    if (!activeValue) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    const boolValue = toBooleanValue(activeValue);
    const hasChanged = boolValue !== normalizedInitial;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    commitSelection(activeValue);
  }, [activeValue, commitSelection, normalizedInitial, onFinishedEditing]);

  const handleValueChange = useCallback(
    (v: string) => {
      if (finishedRef.current) return;
      commitSelection(v);
    },
    [commitSelection],
  );

  const resolveSelection = useCallback(() => {
    if (
      activeValue &&
      filteredOptions.some((opt) => opt.value === activeValue)
    ) {
      return activeValue;
    }
    if (inputValue && filteredOptions.length > 0)
      return filteredOptions[0]?.value ?? "";
    return activeValue;
  }, [activeValue, filteredOptions, inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
      const selectedValue = resolveSelection();
      if (!selectedValue) {
        onFinishedEditing(undefined, movement);
        return;
      }
      const boolValue = toBooleanValue(selectedValue);
      if (boolValue === normalizedInitial) {
        onFinishedEditing(undefined, movement);
        return;
      }
      commitSelection(selectedValue, movement);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const selectedValue = resolveSelection();
      if (selectedValue) {
        commitSelection(selectedValue);
      }
    }
  };

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 gdg-editor-shell">
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

      {/* Inline selection */}
      <div className="flex items-center">
        <Command
          className="w-full h-auto max-h-[240px] border-0 rounded-none shadow-none p-0"
          shouldFilter={false}
          value={activeValue}
          onValueChange={setActiveValue}
        >
          <div className="flex items-center border-b relative">
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder="Filter values..."
              value={inputValue}
              onValueChange={setInputValue}
              className="h-full w-full bg-transparent py-1.5 px-2 text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              onKeyDown={handleKeyDown}
            />
          </div>
          <CommandList className="min-h-0 max-h-[200px]">
            <CommandGroup>
              {filteredOptions.length === 0 && (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  No matches found
                </div>
              )}
              {filteredOptions.map((option) => {
                const isCurrent = option.value === initialStringValue;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-checked={isCurrent}
                    onSelect={handleValueChange}
                    className="text-xs flex items-center justify-between"
                  >
                    <span className={option.className}>{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="px-2 py-1 border-t border-border/50 bg-muted/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              ↑↓ navigate · Enter select · Esc cancel
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
};

// Extend the component with static properties
export const BooleanCellEditorWithProps = Object.assign(BooleanCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
