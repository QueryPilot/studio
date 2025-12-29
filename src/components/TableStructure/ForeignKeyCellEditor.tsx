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
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";
import { type ForeignKeyCustomCell } from "./types";

interface ForeignKeyCellEditorProps {
  value: ForeignKeyCustomCell;
  onFinishedEditing: (
    newValue?: ForeignKeyCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const buildLabel = (table: string, column: string) => `${table}.${column}`;

export const ForeignKeyCellEditor: React.FC<ForeignKeyCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const suggestions = value.data.suggestions ?? [];
  const initialValue = value.data.value ?? "";
  const [inputValue, setInputValue] = useState(initialValue);
  const [activeValue, setActiveValue] = useState("");
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalValueRef = useRef(initialValue);

  useEffect(() => {
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, input.value.length);
      }
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const normalizedInput = inputValue.trim();

  const filteredSuggestions = useMemo(() => {
    if (!normalizedInput) return suggestions;
    const lower = normalizedInput.toLowerCase();
    return suggestions.filter((item) => {
      const label = buildLabel(item.table, item.column).toLowerCase();
      return (
        label.includes(lower) ||
        item.table.toLowerCase().includes(lower) ||
        item.column.toLowerCase().includes(lower) ||
        item.type.toLowerCase().includes(lower)
      );
    });
  }, [normalizedInput, suggestions]);

  const optionValues = useMemo(() => {
    if (filteredSuggestions.length === 0) {
      return normalizedInput ? [normalizedInput] : [];
    }
    return filteredSuggestions.map((item) => buildLabel(item.table, item.column));
  }, [filteredSuggestions, normalizedInput]);

  useEffect(() => {
    if (optionValues.length === 0) {
      setActiveValue("");
      return;
    }
    if (!optionValues.includes(activeValue)) {
      setActiveValue(optionValues[0]);
    }
  }, [activeValue, optionValues]);

  const buildCell = useCallback(
    (nextValue: string): ForeignKeyCustomCell => ({
      kind: value.kind,
      data: {
        ...value.data,
        value: nextValue,
      },
      copyData: nextValue,
      allowOverlay: value.allowOverlay,
      readonly: value.readonly,
    }),
    [value],
  );

  const commitValue = useCallback(
    (nextValue: string, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const trimmed = nextValue.trim();
      if (trimmed === originalValueRef.current) {
        onFinishedEditing(undefined, movement);
        return;
      }

      onFinishedEditing(buildCell(trimmed), movement);
    },
    [buildCell, onFinishedEditing],
  );

  const commitCurrent = useCallback(() => {
    if (finishedRef.current) return;
    const trimmed = inputValue.trim();
    if (trimmed === originalValueRef.current) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }
    finishedRef.current = true;
    onFinishedEditing(buildCell(trimmed));
  }, [buildCell, inputValue, onFinishedEditing]);

  useCommitOnUnmount(finishedRef, commitCurrent);

  const handleSelect = async (selectedValue: string) => {
    if (finishedRef.current) return;
    const trimmed = selectedValue.trim();
    if (trimmed === originalValueRef.current) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }
    finishedRef.current = true;
    const newCell = buildCell(trimmed);
    await new Promise((r) => window.requestAnimationFrame(r));
    onFinishedEditing(newCell);
  };

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        <span className="text-[11px] font-medium text-foreground/80">
          Foreign key for {value.data.columnName || "column"}
        </span>
        {normalizedInput && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {normalizedInput}
          </span>
        )}
      </div>

      <div className="flex items-center flex-1">
        <Command
          className="w-full border-0 rounded-none shadow-none"
          shouldFilter={false}
          value={activeValue}
          onValueChange={setActiveValue}
        >
          <div className="flex items-center border-b">
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder="Search table.column"
              value={inputValue}
              onValueChange={setInputValue}
              className={cn(
                "h-full w-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono",
                "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onKeyDown={(e) => {
                if (finishedRef.current) return;

                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  const nextValue =
                    activeValue && activeValue !== "no-suggestions"
                      ? activeValue
                      : inputValue;
                  if (nextValue.trim()) {
                    void handleSelect(nextValue);
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  finishedRef.current = true;
                  onFinishedEditing(undefined);
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  e.stopPropagation();
                  const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
                    ? [-1, 0]
                    : [1, 0];
                  commitValue(inputValue, movement);
                }
              }}
            />
          </div>
          <CommandList className="max-h-[240px]">
            <CommandGroup>
              {filteredSuggestions.length === 0 && normalizedInput && (
                <CommandItem
                  value={normalizedInput}
                  onSelect={() => handleSelect(normalizedInput)}
                  className="text-xs font-mono flex items-center justify-between"
                >
                  <div className="text-xs text-muted-foreground">
                    Use "{normalizedInput}"
                  </div>
                </CommandItem>
              )}
              {filteredSuggestions.length === 0 && !normalizedInput && (
                <CommandItem
                  value="no-suggestions"
                  disabled
                  className="text-xs font-mono text-muted-foreground"
                >
                  No foreign key targets found
                </CommandItem>
              )}
              {filteredSuggestions.map((item) => {
                const label = buildLabel(item.table, item.column);
                return (
                  <CommandItem
                    key={`${item.table}.${item.column}`}
                    value={label}
                    onSelect={() => handleSelect(label)}
                    className="text-xs font-mono flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span>{label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {item.type}
                    </span>
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

export const ForeignKeyCellEditorWithProps = Object.assign(
  ForeignKeyCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
