import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Column {
  name: string;
  db_type: string;
}

interface ColumnSelectorProps {
  value: string[];
  onChange: (columns: string[]) => void;
  availableColumns: Column[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const ColumnSelector = memo(function ColumnSelector({
  value,
  onChange,
  availableColumns,
  placeholder = "Select columns...",
  className,
  disabled = false,
}: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggleColumn = (columnName: string) => {
    if (disabled) return;
    if (value.includes(columnName)) {
      onChange(value.filter((c) => c !== columnName));
    } else {
      onChange([...value, columnName]);
    }
  };

  const moveColumn = (columnName: string, direction: "up" | "down") => {
    if (disabled) return;
    const index = value.indexOf(columnName);
    if (index === -1) return;

    const newValue = [...value];
    const newIndex = direction === "up" ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= value.length) return;

    [newValue[index], newValue[newIndex]] = [
      newValue[newIndex],
      newValue[index],
    ];
    onChange(newValue);
  };

  const filteredColumns = availableColumns.filter(
    (col) =>
      col.name.toLowerCase().includes(search.toLowerCase()) ||
      col.db_type.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedColumns = value
    .map((name) => availableColumns.find((c) => c.name === name))
    .filter(Boolean) as Column[];

  const unselectedColumns = filteredColumns.filter(
    (col) => !value.includes(col.name),
  );

  return (
    <Popover open={open && !disabled} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "justify-between text-xs px-2 outline-none focus:ring-0 h-7",
            disabled && "opacity-60 cursor-not-allowed",
            className,
          )}
        >
          <span className="truncate">
            {value.length > 0
              ? value.length > 3
                ? `${value.slice(0, 3).join(", ")}, and ${
                    value.length - 3
                  } more cols`
                : value.join(", ")
              : placeholder}
          </span>
          <ChevronDown className="ml-1 h-2.5 w-2.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="space-y-2">
          <Input
            placeholder="Search columns..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="h-7 text-xs outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          <ScrollArea className="h-64">
            <div className="space-y-3">
              {/* Selected Columns */}
              {selectedColumns.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Selected columns ({selectedColumns.length})
                  </div>
                  <div className="rounded-md border p-1">
                    <div className="space-y-0.5">
                      {selectedColumns.map((column, index) => (
                        <div
                          key={column.name}
                          className="flex items-center gap-2 p-1 rounded hover:bg-muted/50 text-xs cursor-pointer"
                          onClick={(e) => {
                            // Only toggle if not clicking on the up/down buttons
                            if (!(e.target as HTMLElement).closest('button')) {
                              toggleColumn(column.name);
                            }
                          }}
                        >
                          <Checkbox
                            checked={true}
                            onCheckedChange={() => {
                              toggleColumn(column.name);
                            }}
                            className="h-3.5 w-3.5 pointer-events-none"
                          />
                          <span className="flex-1 whitespace-nowrap select-none">
                            {column.name}
                            <span className="text-muted-foreground ml-1">
                              ({column.db_type})
                            </span>
                          </span>
                          <div className="flex gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-4 w-4"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveColumn(column.name, "up");
                              }}
                              disabled={index === 0}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-4 w-4"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveColumn(column.name, "down");
                              }}
                              disabled={index === value.length - 1}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Available Columns */}
              {unselectedColumns.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Available columns ({unselectedColumns.length})
                  </div>
                  <div className="rounded-md border p-1">
                    <div className="space-y-0.5">
                      {unselectedColumns.map((column) => (
                        <div
                          key={column.name}
                          className="flex items-center gap-2 p-1 rounded hover:bg-muted/50 text-xs cursor-pointer"
                          onClick={() => {
                            toggleColumn(column.name);
                          }}
                        >
                          <Checkbox checked={false} className="h-3.5 w-3.5 pointer-events-none" />
                          <span className="flex-1 whitespace-nowrap select-none">
                            {column.name}
                            <span className="text-muted-foreground ml-1">
                              ({column.db_type})
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {selectedColumns.length === 0 &&
                unselectedColumns.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    {search ? "No matching columns" : "No columns available"}
                  </div>
                )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
});
