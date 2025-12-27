import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTrash, IconChevronDown } from "@tabler/icons-react";

// Common data types for batch type change
const COMMON_DATA_TYPES = [
  "text",
  "varchar(255)",
  "integer",
  "bigint",
  "smallint",
  "boolean",
  "timestamp",
  "timestamptz",
  "date",
  "time",
  "numeric",
  "decimal",
  "float",
  "double precision",
  "uuid",
  "json",
  "jsonb",
];

interface BatchActionsToolbarProps {
  selectedCount: number;
  onDeleteSelected: () => void;
  onSetNullable: (value: "YES" | "NO") => void;
  onSetType: (dataType: string) => void;
  disabled?: boolean;
}

export const BatchActionsToolbar = memo(function BatchActionsToolbar({
  selectedCount,
  onDeleteSelected,
  onSetNullable,
  onSetType,
  disabled = false,
}: BatchActionsToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {selectedCount} selected
      </span>

      <Button
        size="sm"
        variant="ghost"
        onClick={onDeleteSelected}
        disabled={disabled}
        className="h-6 text-xs px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <IconTrash className="h-3 w-3 mr-1" />
        Delete
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-6 rounded-md px-2"
        >
          Nullable
          <IconChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onSetNullable("YES")}>
            <span className="text-green-600 dark:text-green-400 font-medium">
              YES
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSetNullable("NO")}>
            <span className="text-red-600 dark:text-red-400 font-medium">
              NO
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-6 rounded-md px-2"
        >
          Type
          <IconChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {COMMON_DATA_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onClick={() => onSetType(type)}
              className="font-mono text-xs"
            >
              {type}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
});
