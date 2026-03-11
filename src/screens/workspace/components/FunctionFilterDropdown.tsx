/**
 * FunctionFilterDropdown.tsx
 *
 * A compact dropdown to toggle between showing user-created functions only
 * or all functions (including system/plugin functions).
 * Uses DropdownMenu (base-ui Menu) to avoid nested trigger conflicts
 * with the ContextMenuTrigger wrapping the sidebar section header.
 */

import {
  IconCheck,
  IconFilter,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FunctionFilterMode = "user" | "all";

const FILTER_OPTIONS: { value: FunctionFilterMode; label: string }[] = [
  { value: "user", label: "User Created" },
  { value: "all", label: "All Functions" },
];

interface FunctionFilterDropdownProps {
  value: FunctionFilterMode;
  onChange: (mode: FunctionFilterMode) => void;
}

export function FunctionFilterDropdown({
  value,
  onChange,
}: FunctionFilterDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="p-1 mr-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={`Filter: ${value === "user" ? "User Created" : "All Functions"}`}
          >
            <IconFilter className={cn(
              "h-3.5 w-3.5",
              value === "all" && "text-primary",
            )} />
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={4}>
        {FILTER_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            <IconCheck
              className={cn(
                "h-3 w-3 mr-1 shrink-0",
                value === option.value ? "opacity-100" : "opacity-0",
              )}
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
