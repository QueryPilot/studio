/**
 * RedisDbFilterDropdown.tsx
 *
 * A compact multi-select dropdown for filtering which Redis databases
 * are visible in the sidebar. Placed in the connection header row,
 * similar to SchemaDropdown for SQL connections.
 */

import { useState, useCallback } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
} from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RedisDatabaseInfo {
  db: number;
  keys: number;
  expires: number;
}

interface RedisDbFilterDropdownProps {
  databases: RedisDatabaseInfo[];
  visibleDbs: Set<number>;
  onVisibleDbsChange: (dbs: Set<number>) => void;
  totalDbs: number;
  isLoading?: boolean;
}

export function RedisDbFilterDropdown({
  databases,
  visibleDbs,
  onVisibleDbsChange,
  totalDbs,
  isLoading,
}: RedisDbFilterDropdownProps) {
  const [open, setOpen] = useState(false);

  const toggleDb = useCallback(
    (db: number) => {
      const next = new Set(visibleDbs);
      if (next.has(db)) {
        // Don't allow deselecting all
        if (next.size > 1) {
          next.delete(db);
        }
      } else {
        next.add(db);
      }
      onVisibleDbsChange(next);
    },
    [visibleDbs, onVisibleDbsChange]
  );

  const selectAll = useCallback(() => {
    onVisibleDbsChange(new Set(databases.map((d) => d.db)));
  }, [databases, onVisibleDbsChange]);

  const selectNone = useCallback(() => {
    // Keep at least db0
    const firstDb = databases[0]?.db ?? 0;
    onVisibleDbsChange(new Set([firstDb]));
  }, [databases, onVisibleDbsChange]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            disabled={isLoading}
            className="text-xs h-5 px-1.5 justify-between min-w-[50px] max-w-[80px] border-0 hover:bg-muted/80 bg-muted/50 rounded"
          >
            {isLoading ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <span className="truncate text-muted-foreground">
                  {visibleDbs.size}/{totalDbs} dbs
                </span>
                <IconChevronDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
              </>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-[200px] p-0" align="start">
        <div className="p-2">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[11px] text-muted-foreground">
              Select databases
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={selectAll}
              >
                All
              </button>
              <span className="text-[10px] text-muted-foreground">/</span>
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={selectNone}
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-[240px] overflow-y-auto space-y-0.5">
            {databases.map((dbInfo) => {
              const isSelected = visibleDbs.has(dbInfo.db);
              return (
                <button
                  key={dbInfo.db}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-muted transition-colors text-left",
                    isSelected && "bg-muted/50"
                  )}
                  onClick={() => toggleDb(dbInfo.db)}
                >
                  <IconCheck
                    className={cn(
                      "h-3 w-3 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span
                    className={cn(
                      "flex-1",
                      !isSelected && "text-muted-foreground"
                    )}
                  >
                    db{dbInfo.db}
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      isSelected
                        ? "text-muted-foreground"
                        : "text-muted-foreground/50"
                    )}
                  >
                    {dbInfo.keys} keys
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
