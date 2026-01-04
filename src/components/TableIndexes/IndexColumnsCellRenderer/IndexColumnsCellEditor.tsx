import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { IndexColumnsCell } from "./types";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconChevronUp,
  IconChevronDown,
} from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "@/components/ui/command";

interface IndexColumnsCellEditorProps {
  value: IndexColumnsCell;
  onFinishedEditing: (
    newValue?: IndexColumnsCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IndexColumnsCellEditor: React.FC<IndexColumnsCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const commandRef = useRef<HTMLDivElement>(null);
  const {
    requiresRecreate,
    columns: initialColumns,
    availableColumns,
  } = value.data;

  // Local state for editing
  const [selectedColumns, setSelectedColumns] =
    useState<string[]>(initialColumns);
  const [showConfirm, setShowConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeValue, setActiveValue] = useState("");

  // Filter available columns based on search query
  const filteredColumns = useMemo(() => {
    if (!searchQuery.trim()) return availableColumns;
    return availableColumns.filter((col) =>
      col.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableColumns, searchQuery]);

  // Keep activeValue in sync with filtered options
  useEffect(() => {
    if (filteredColumns.length === 0) {
      setActiveValue("");
      return;
    }
    if (!filteredColumns.includes(activeValue)) {
      setActiveValue(filteredColumns[0] ?? "");
    }
  }, [activeValue, filteredColumns]);

  // Check if there are actual changes
  const hasChanges = useCallback(() => {
    if (selectedColumns.length !== initialColumns.length) return true;
    return selectedColumns.some((col, idx) => col !== initialColumns[idx]);
  }, [selectedColumns, initialColumns]);

  useEffect(() => {
    // Focus the command container for keyboard navigation
    if (!showConfirm) {
      const timer = setTimeout(() => {
        commandRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [showConfirm]);

  const applyChange = useCallback(
    async (newColumns: string[]) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: IndexColumnsCell = {
        kind: value.kind,
        data: {
          ...value.data,
          columns: newColumns,
        },
        copyData: newColumns.join(", "),
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      await new Promise((r) => window.requestAnimationFrame(r));
      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleToggleColumn = useCallback((columnName: string) => {
    setSelectedColumns((prev) => {
      if (prev.includes(columnName)) {
        // Remove column (but don't allow removing the last one)
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== columnName);
      } else {
        // Add column at the end
        return [...prev, columnName];
      }
    });
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setSelectedColumns((prev) => {
      const newArr = [...prev];
      const prevItem = newArr[index - 1];
      const currItem = newArr[index];
      if (prevItem !== undefined && currItem !== undefined) {
        newArr[index - 1] = currItem;
        newArr[index] = prevItem;
      }
      return newArr;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setSelectedColumns((prev) => {
      if (index >= prev.length - 1) return prev;
      const newArr = [...prev];
      const currItem = newArr[index];
      const nextItem = newArr[index + 1];
      if (currItem !== undefined && nextItem !== undefined) {
        newArr[index] = nextItem;
        newArr[index + 1] = currItem;
      }
      return newArr;
    });
  }, []);

  const handleRemoveColumn = useCallback((index: number) => {
    setSelectedColumns((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSave = useCallback(() => {
    if (finishedRef.current) return;

    // Must have at least one column
    if (selectedColumns.length === 0) return;

    // If no changes, just close
    if (!hasChanges()) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // If requires recreate and there are changes, show confirmation
    if (requiresRecreate) {
      setShowConfirm(true);
    } else {
      void applyChange(selectedColumns);
    }
  }, [
    selectedColumns,
    hasChanges,
    requiresRecreate,
    applyChange,
    onFinishedEditing,
  ]);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleConfirmContinue = useCallback(() => {
    void applyChange(selectedColumns);
  }, [selectedColumns, applyChange]);

  const handleConfirmCancel = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (showConfirm) {
          handleConfirmCancel();
        } else {
          handleCancel();
        }
      } else if (e.key === "Enter" && !showConfirm) {
        // Enter to toggle the highlighted column
        e.preventDefault();
        e.stopPropagation();
        if (activeValue) {
          handleToggleColumn(activeValue);
        }
      } else if (e.key === "Tab" && !showConfirm) {
        e.preventDefault();
        e.stopPropagation();
        // Save on tab if there are changes
        if (hasChanges() && selectedColumns.length > 0) {
          if (requiresRecreate) {
            setShowConfirm(true);
          } else {
            void applyChange(selectedColumns);
          }
        } else {
          handleCancel();
        }
      }
    },
    [
      showConfirm,
      handleConfirmCancel,
      handleCancel,
      hasChanges,
      selectedColumns,
      requiresRecreate,
      applyChange,
      activeValue,
      handleToggleColumn,
    ],
  );

  // Render confirmation dialog for existing indexes
  if (showConfirm) {
    return (
      <div
        className="w-full h-full flex flex-col relative click-outside-ignore z-50 bg-popover border shadow-lg min-w-[320px]"
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
            Changing index columns will drop and recreate this index.
          </p>
          <div className="mt-2 text-xs">
            <div className="text-muted-foreground">From:</div>
            <div className="font-mono text-foreground mt-0.5">
              {initialColumns.join(", ")}
            </div>
            <div className="text-muted-foreground mt-1.5">To:</div>
            <div className="font-mono text-foreground mt-0.5">
              {selectedColumns.join(", ")}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/50 bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleConfirmCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleConfirmContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // Render column selection editor
  return (
    <div
      className="w-full h-full flex flex-col relative click-outside-ignore z-50 bg-popover border shadow-lg min-w-[320px]"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50 shrink-0">
        <span className="text-[11px] font-medium text-foreground/80">
          Index Columns
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {selectedColumns.length} selected
        </span>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Selected columns section */}
        {selectedColumns.length > 0 && (
          <div className="flex flex-col border-b border-border/50">
            <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/30 sticky top-0 z-10">
              Selected
            </div>
            <div>
              {selectedColumns.map((col, index) => (
                <div
                  key={col}
                  className="flex items-center gap-1 px-2 py-1 hover:bg-muted/50 group"
                >
                  <span className="text-[10px] text-muted-foreground w-4 text-center">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs flex-1 truncate">{col}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => {
                        handleMoveUp(index);
                      }}
                      disabled={index === 0}
                    >
                      <IconChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => {
                        handleMoveDown(index);
                      }}
                      disabled={index === selectedColumns.length - 1}
                    >
                      <IconChevronDown className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => {
                        handleRemoveColumn(index);
                      }}
                      disabled={selectedColumns.length <= 1}
                    >
                      <IconX className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Column selector */}
        <div className="flex flex-col">
          <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/30 sticky top-0 z-10 border-b border-border/50">
            Available Columns
          </div>
          <Command
            ref={commandRef}
            className="w-full border-0 shadow-none rounded-none"
            value={activeValue}
            onValueChange={setActiveValue}
            shouldFilter={false}
          >
            <CommandInput
              placeholder="Search columns..."
              className="h-8 border-b border-border/50"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList className="max-h-none">
              <CommandEmpty className="py-3 text-xs text-muted-foreground">
                No columns found
              </CommandEmpty>
              <CommandGroup>
                {filteredColumns.map((col) => {
                  const isSelected = selectedColumns.includes(col);
                  return (
                    <CommandItem
                      key={col}
                      value={col}
                      onSelect={() => {
                        handleToggleColumn(col);
                      }}
                      className="text-xs font-medium flex items-center justify-between"
                    >
                      <span className="font-mono">{col}</span>
                      <IconCheck
                        className={cn(
                          "h-3 w-3",
                          isSelected ? "opacity-100 text-primary" : "opacity-0",
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

      {/* Sticky footer with actions */}
      <div className="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-border/50 bg-background shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={selectedColumns.length === 0}
          className="h-7 text-xs"
        >
          Save
        </Button>
      </div>
    </div>
  );
};

export const IndexColumnsCellEditorWithProps = Object.assign(
  IndexColumnsCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);

export default IndexColumnsCellEditorWithProps;
