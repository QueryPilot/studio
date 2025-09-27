import { memo, useEffect, useState, useRef, useMemo } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";
import { databaseService } from "@/services/databaseService";

interface TypeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  connectionId?: string;
  disabled?: boolean;
  className?: string;
}

// Simple in-memory cache for column types per connection
const ColumnTypeCache = new Map<string, string[]>();

// Clear cache after 5 minutes to allow for database changes
setInterval(() => {
  ColumnTypeCache.clear();
}, 5 * 60 * 1000);

export const TypeSelector = memo(function TypeSelector({
  value,
  onChange,
  connectionId,
  disabled = false,
  className,
}: TypeSelectorProps) {
  const [types, setTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const cacheKeyRef = useRef<string | null>(null);

  // Load column types from database
  useEffect(() => {
    if (connectionId && connectionId !== cacheKeyRef.current && !isLoading) {
      setIsLoading(true);
      cacheKeyRef.current = connectionId;

      // Check cache first
      const cachedTypes = ColumnTypeCache.get(connectionId);
      if (cachedTypes) {
        setTypes(cachedTypes);
        setIsLoading(false);
        return;
      }

      databaseService
        .getSupportedColumnTypes(connectionId)
        .then((loadedTypes) => {
          setTypes(loadedTypes);
          // Cache the result
          ColumnTypeCache.set(connectionId, loadedTypes);
        })
        .catch((err: unknown) => {
          console.error("Failed to load column types:", err);
          // Fallback to basic types on error
          const fallbackTypes = [
            "text",
            "integer",
            "boolean",
            "timestamp",
            "json",
            "uuid",
          ];
          setTypes(fallbackTypes);
          ColumnTypeCache.set(connectionId, fallbackTypes);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [connectionId, isLoading]);

  // Most commonly used PostgreSQL types
  const commonTypes = [
    "int4",
    "int8",
    "text",
    "varchar",
    "boolean",
    "timestamptz",
    "timestamp",
    "date",
    "uuid",
    "json",
    "jsonb",
    "numeric",
  ];

  // Group types
  const groupedTypes = useMemo(() => {
    const common = types.filter((t) => commonTypes.includes(t));

    // Separate user-defined/enum types from others
    const userDefined = types.filter(
      (t) =>
        !commonTypes.includes(t) &&
        !t.startsWith("_") && // Not array types
        !t.includes("range") && // Not range types
        ![
          "int2",
          "int4",
          "int8",
          "float4",
          "float8",
          "numeric",
          "text",
          "varchar",
          "char",
          "bpchar",
          "boolean",
          "bool",
          "bit",
          "varbit",
          "timestamp",
          "timestamptz",
          "date",
          "time",
          "timetz",
          "interval",
          "uuid",
          "json",
          "jsonb",
          "xml",
          "inet",
          "cidr",
          "macaddr",
          "macaddr8",
          "money",
          "bytea",
          "tsvector",
          "tsquery",
          "point",
          "line",
          "lseg",
          "box",
          "path",
          "polygon",
          "circle",
          "oid",
          "regproc",
          "regprocedure",
          "regoper",
          "regoperator",
          "regclass",
          "regtype",
          "regrole",
          "regnamespace",
          "regconfig",
          "regdictionary",
        ].includes(t),
    );

    const others = types.filter(
      (t) => !commonTypes.includes(t) && !userDefined.includes(t),
    );

    return { common, userDefined, others };
  }, [types]);

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={disabled ? undefined : setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "justify-between text-xs font-mono px-1.5 h-7 w-full",
            "hover:bg-transparent focus:bg-transparent border-0",
            disabled && "opacity-60 cursor-not-allowed",
            className,
          )}
        >
          <span className="truncate">{value || "Select type..."}</span>
          <ChevronDown className="ml-1 h-2.5 w-2.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[200px] max-w-[320px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search types..."
            className="h-7 !text-xs ring-primary ring-1 rounded-md outline-none w-full"
          />
          <CommandList className="max-h-64">
            <CommandEmpty className="text-xs text-muted-foreground text-center py-2">
              No types found
            </CommandEmpty>

            {/* Common types */}
            {groupedTypes.common.length > 0 && (
              <CommandGroup heading="Common types">
                {groupedTypes.common.map((type) => (
                  <CommandItem
                    key={type}
                    value={type}
                    onSelect={() => {
                      onChange(type);
                      setOpen(false);
                    }}
                    className="text-xs font-mono"
                  >
                    <span className="truncate w-full">{type}</span>
                    <Check
                      className={cn(
                        "mr-2 h-3 w-3",
                        value === type ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* User-defined/Enum types */}
            {groupedTypes.userDefined.length > 0 && (
              <CommandGroup heading="User-defined / Enum types">
                {groupedTypes.userDefined.map((type) => (
                  <CommandItem
                    key={type}
                    value={type}
                    onSelect={() => {
                      onChange(type);
                      setOpen(false);
                    }}
                    className="text-xs font-mono text-foreground/80 dark:text-foreground/70"
                  >
                    <span className="truncate w-full">{type}</span>
                    <Check
                      className={cn(
                        "mr-2 h-3 w-3",
                        value === type ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Other types */}
            {groupedTypes.others.length > 0 && (
              <CommandGroup heading="Other types">
                {groupedTypes.others.map((type) => (
                  <CommandItem
                    key={type}
                    value={type}
                    onSelect={() => {
                      onChange(type);
                      setOpen(false);
                    }}
                    className="text-xs font-mono text-foreground/80 dark:text-foreground/70"
                  >
                    <span className="truncate w-full">{type}</span>
                    <Check
                      className={cn(
                        "mr-2 h-3 w-3",
                        value === type ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
