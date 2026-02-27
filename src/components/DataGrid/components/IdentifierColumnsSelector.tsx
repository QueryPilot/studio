import { useMemo } from "react";
import { IconCheck, IconKey } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface IdentifierColumnsSelectorProps {
  open: boolean;
  tableName: string;
  availableColumns: string[];
  selectedColumns: string[];
  onOpen: () => void;
  onToggleColumn: (column: string) => void;
  onClear: () => void;
  onCancel: () => void;
  triggerClassName?: string;
}

const sortColumns = (columns: string[]): string[] =>
  [...columns].sort((a, b) => a.localeCompare(b));

export function IdentifierColumnsSelector({
  open,
  tableName,
  availableColumns,
  selectedColumns,
  onOpen,
  onToggleColumn,
  onClear,
  onCancel,
  triggerClassName,
}: IdentifierColumnsSelectorProps) {
  const availableSet = useMemo(() => new Set(availableColumns), [availableColumns]);
  const selectedSet = useMemo(
    () => new Set(selectedColumns.filter((column) => availableSet.has(column))),
    [availableSet, selectedColumns],
  );
  const selectedSorted = useMemo(
    () => sortColumns(Array.from(selectedSet)),
    [selectedSet],
  );
  const unselectedSorted = useMemo(
    () =>
      sortColumns(
        availableColumns.filter((column) => !selectedSet.has(column)),
      ),
    [availableColumns, selectedSet],
  );
  const orderedColumns = useMemo(
    () => [...selectedSorted, ...unselectedSorted],
    [selectedSorted, unselectedSorted],
  );
  const selectedCount = selectedSorted.length;
  const triggerLabel = useMemo(() => {
    if (selectedCount === 0) return "Select Identifier";
    if (selectedCount === 1) return selectedSorted[0] ?? "Select Identifier";
    const first = selectedSorted[0] ?? "Identifier";
    return `${first} +${selectedCount - 1}`;
  }, [selectedCount, selectedSorted]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpen();
          return;
        }
        onCancel();
      }}
    >
      <PopoverTrigger
        className={cn(
          "inline-flex items-center h-6 gap-1 px-2 rounded-md text-[11px] font-medium hover:bg-accent",
          triggerClassName,
          selectedCount > 0 &&
            "text-primary border border-primary/35 bg-primary/10 hover:bg-primary/15",
        )}
      >
        <IconKey className="h-3 w-3" />
        <span className="max-w-[180px] truncate">{triggerLabel}</span>
        {selectedCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-primary/35 bg-primary/15 px-1 text-[10px] leading-none text-primary">
            {selectedCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-[420px] p-0 gap-0"
      >
        <div className="border-b px-3 py-2">
          <div className="text-xs font-medium">Select Identifier Columns</div>
          <div className="text-[11px] text-muted-foreground">
            {selectedCount > 0
              ? `${selectedCount} selected for ${tableName}`
              : `Select one or more columns for ${tableName}`}
          </div>
        </div>

        <div className="border-b bg-muted/20 px-3 py-2">
          {selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedSorted.slice(0, 6).map((column) => (
                <span
                  key={column}
                  className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                >
                  {column}
                </span>
              ))}
              {selectedCount > 6 && (
                <span className="text-[10px] text-muted-foreground">
                  +{selectedCount - 6} more
                </span>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              No columns selected
            </div>
          )}
        </div>

        <Command className="rounded-none border-0 p-0" shouldFilter>
          <CommandInput placeholder="Search columns..." />
          <CommandList className="max-h-64">
            <CommandEmpty>No matching columns.</CommandEmpty>
            <CommandGroup>
              {orderedColumns.map((column) => {
                const selected = selectedSet.has(column);
                return (
                  <CommandItem
                    key={column}
                    value={column}
                    keywords={[column]}
                    onSelect={() => {
                      onToggleColumn(column);
                    }}
                    className={cn("gap-2", selected && "bg-primary/10 text-primary")}
                  >
                    <span className="flex-1 min-w-0 truncate font-mono text-xs">
                      {column}
                    </span>
                    <IconCheck
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        <div className="flex items-center justify-end gap-1.5 border-t px-2 py-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onClear}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onCancel}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
