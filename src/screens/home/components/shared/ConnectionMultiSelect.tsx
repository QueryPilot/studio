"use client";

import * as React from "react";
import { IconSearch, IconChevronDown, IconX, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { StoredConnection } from "@/types/connection";

interface ConnectionMultiSelectProps {
  value: string[];
  onChange: (connectionIds: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const ConnectionMultiSelect = ({
  value,
  onChange,
  placeholder = "Search connections...",
  className,
  disabled = false,
}: ConnectionMultiSelectProps) => {
  const [open, setOpen] = React.useState(false);
  const connections = useConnectionStore((s) => s.connections);

  const selectedConnections = React.useMemo(() => {
    return value
      .map((id) => connections.find((c) => c.profile.id === id))
      .filter((c): c is StoredConnection => c !== undefined);
  }, [value, connections]);

  const handleToggle = (connectionId: string) => {
    if (disabled) return;
    if (value.includes(connectionId)) {
      onChange(value.filter((id) => id !== connectionId));
    } else {
      onChange([...value, connectionId]);
    }
  };

  const handleRemove = (connectionId: string) => {
    if (disabled) return;
    onChange(value.filter((id) => id !== connectionId));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex items-center justify-between w-full h-8 px-2 rounded-md border border-input",
                "bg-input/20 dark:bg-input/30 text-xs",
                "focus:border-ring focus:ring-[2px] focus:ring-ring/30 outline-none",
                "transition-colors",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <IconSearch className="h-3.5 w-3.5" />
                <span>{placeholder}</span>
              </div>
              <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          }
        />
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search connections..." className="h-8 text-xs" />
            <CommandList className="max-h-[250px]">
              <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
                No connections found.
              </CommandEmpty>
              <CommandGroup>
                {connections.map((connection) => {
                  const isSelected = value.includes(connection.profile.id);
                  const logo = getDatabaseLogo(connection.profile.db_type);

                  return (
                    <CommandItem
                      key={connection.profile.id}
                      value={`${connection.profile.name} ${connection.profile.host} ${connection.profile.database}`}
                      onSelect={() => handleToggle(connection.profile.id)}
                      className="flex items-center gap-3 py-2 cursor-pointer"
                    >
                      <div
                        className={cn(
                          "flex items-center justify-center w-4 h-4 rounded border transition-colors",
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input"
                        )}
                      >
                        {isSelected && <IconCheck className="h-3 w-3" />}
                      </div>
                      <img src={logo} alt="" className="w-5 h-5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {connection.profile.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {connection.profile.host}:{connection.profile.port}
                          {connection.profile.database && ` / ${connection.profile.database}`}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedConnections.length > 0 && (
        <div className="space-y-1 border border-border/40 rounded-lg p-2 max-h-[200px] overflow-y-auto">
          {selectedConnections.map((connection) => {
            const logo = getDatabaseLogo(connection.profile.db_type);

            return (
              <div
                key={connection.profile.id}
                className="flex items-center gap-3 p-2 rounded-md bg-accent/30 hover:bg-accent/50 transition-colors group"
              >
                <img src={logo} alt="" className="w-5 h-5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">
                    {connection.profile.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {connection.profile.host}:{connection.profile.port}
                    {connection.profile.database && ` / ${connection.profile.database}`}
                  </div>
                </div>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(connection.profile.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                  >
                    <IconX className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {value.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {value.length} connection{value.length !== 1 ? "s" : ""} selected
        </div>
      )}
    </div>
  );
};

export { ConnectionMultiSelect };
export type { ConnectionMultiSelectProps };
