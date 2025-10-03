import { useState, useMemo } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface FunctionSelectorProps {
  value: string;
  onChange: (value: string) => void;
  availableFunctions?: string[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function FunctionSelector({
  value,
  onChange,
  availableFunctions = [],
  disabled = false,
  className,
  placeholder = "Select function...",
}: FunctionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Parse function names to extract base name and arguments
  const functionData = useMemo(() => {
    return availableFunctions.map((func) => {
      const match = func.match(/^([^(]+)(\(.*\))?$/);
      const baseName = match?.[1] || func;
      const args = match?.[2] || "()";
      return {
        full: func,
        name: baseName,
        args: args,
        searchText: func.toLowerCase(),
      };
    });
  }, [availableFunctions]);

  // Filter functions based on search
  const filteredFunctions = useMemo(() => {
    if (!search) return functionData;
    const searchLower = search.toLowerCase();
    return functionData.filter((f) => f.searchText.includes(searchLower));
  }, [functionData, search]);

  const selectedFunction = functionData.find((f) => f.full === value);

  const displayValue = selectedFunction ? (
    <span className="font-mono text-xs truncate block">
      {value.length > 40 ? `${value.substring(0, 40)}...` : value}
    </span>
  ) : (
    <span className="text-muted-foreground text-xs">{placeholder}</span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          title={value || undefined}
          className={cn(
            "!h-7 !px-2 !py-1 w-full bg-transparent border-0 outline-none text-left",
            "flex items-center justify-between gap-1 min-w-0",
            "focus-visible:ring-1 focus-visible:ring-primary rounded-none",
            "hover:bg-muted/50 transition-colors",
            disabled && "cursor-not-allowed opacity-60",
            className,
          )}
        >
          <div className="flex-1 min-w-0 overflow-hidden">
            {displayValue}
          </div>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              placeholder="Search functions..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <CommandList>
            <CommandEmpty>No functions found.</CommandEmpty>
            <CommandGroup>
              {filteredFunctions.slice(0, 50).map((func) => (
                <CommandItem
                  key={func.full}
                  value={func.full}
                  onSelect={() => {
                    onChange(func.full);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "font-mono text-xs",
                    value === func.full && "bg-primary/20 hover:bg-primary/30"
                  )}
                >
                  <span>
                    {func.name}
                    <span className="text-muted-foreground">{func.args}</span>
                  </span>
                </CommandItem>
              ))}
              {filteredFunctions.length > 50 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  ...and {filteredFunctions.length - 50} more
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}