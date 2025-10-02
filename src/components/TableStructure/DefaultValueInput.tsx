import { memo, useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

// PostgreSQL raw type names with appropriate default suggestions
const TYPE_DEFAULTS = {
  // Integer types
  int2: ["NULL"],
  int4: ["NULL", "nextval('sequence_name')"],
  int8: ["NULL", "nextval('sequence_name')"],
  // Numeric types
  numeric: ["NULL"],
  float4: ["NULL"],
  float8: ["NULL"],
  // String types
  varchar: ["NULL", "''"],
  text: ["NULL", "''"],
  char: ["NULL", "''"],
  bpchar: ["NULL", "''"],
  // Date/Time types
  timestamp: ["NULL", "CURRENT_TIMESTAMP", "now()"],
  timestamptz: ["NULL", "CURRENT_TIMESTAMP", "now()"],
  date: ["NULL", "CURRENT_DATE", "now()::date"],
  time: ["NULL", "CURRENT_TIME"],
  timetz: ["NULL", "CURRENT_TIME"],
  interval: ["NULL", "'1 day'", "'1 hour'", "'1 minute'"],
  // Boolean
  bool: ["NULL", "true", "false"],
  boolean: ["NULL", "true", "false"],
  // UUID
  uuid: ["NULL", "gen_random_uuid()"],
  // JSON
  json: ["NULL", "'{}'", "'[]'"],
  jsonb: ["NULL", "'{}'", "'[]'"],
  // Network types
  inet: ["NULL", "'127.0.0.1'", "'0.0.0.0'"],
  cidr: ["NULL", "'192.168.0.0/16'", "'10.0.0.0/8'"],
  macaddr: ["NULL"],
  macaddr8: ["NULL"],
  // Bit types
  bit: ["NULL", "'0'", "'1'"],
  // Geometric types
  point: ["NULL", "'(0,0)'"],
  // Money
  money: ["NULL", "'$0.00'"],
};

// Only show NULL as generic default - don't suggest inappropriate values
const GENERIC_DEFAULTS = ["NULL"];

interface DefaultValueInputProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  columnType?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  enumValues?: string[]; // Enum values for enum types
  typeCategory?: string; // Type category (enum, domain, etc.)
}

export const DefaultValueInput = memo(function DefaultValueInput({
  value,
  onChange,
  columnType,
  disabled = false,
  placeholder = "NULL",
  className,
  enumValues,
  typeCategory,
}: DefaultValueInputProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");

  // Update inputValue when value prop changes
  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Get appropriate defaults based on column type
  const defaults = useMemo(() => {
    // For enum types, show enum values
    if (typeCategory === "enum" && enumValues && enumValues.length > 0) {
      return ["NULL", ...enumValues.map((v) => `'${v}'`)];
    }

    if (!columnType) return GENERIC_DEFAULTS;

    // Use the raw type directly (it's already like int4, text, etc.)
    const baseType = columnType.toLowerCase();

    // Check for exact match first
    if (TYPE_DEFAULTS[baseType as keyof typeof TYPE_DEFAULTS]) {
      return TYPE_DEFAULTS[baseType as keyof typeof TYPE_DEFAULTS];
    }

    // Check for array types (start with _)
    if (baseType.startsWith("_")) {
      return ["NULL", "'{}'"];
    }

    // Check for range types
    if (baseType.includes("range") || baseType.includes("multirange")) {
      return ["NULL"];
    }

    // Check for custom/enum types - only NULL is safe
    return GENERIC_DEFAULTS;
  }, [columnType, enumValues, typeCategory]);

  const handleSelect = (defaultValue: string) => {
    onChange(defaultValue === "NULL" ? null : defaultValue);
    setInputValue(defaultValue);
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    // Convert "NULL" string to actual null
    onChange(newValue === "" || newValue === "NULL" ? null : newValue);
  };

  return (
    <div className="flex items-center relative">
      <Input
        value={inputValue}
        onChange={handleInputChange}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          "!h-7 !px-2 !py-1 !pr-5 border-0 !text-xs font-mono text-ellipsis",
          "focus-visible:ring-1 focus-visible:ring-primary rounded-none !bg-transparent",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      />
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-muted absolute right-0"
            >
              <ChevronDown className="h-3 w-3 text-foreground/80 dark:text-foreground/65" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto min-w-[150px] max-w-[400px] p-1"
            align="end"
          >
            <div className="space-y-0.5">
              {typeCategory === "enum" &&
                enumValues &&
                enumValues.length > 0 && (
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Enum Values
                  </div>
                )}
              {defaults.map((def) => (
                <Button
                  key={def}
                  variant={inputValue === def ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    handleSelect(def);
                  }}
                  className="w-full justify-start h-7 text-xs px-2 font-mono"
                >
                  {def}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
});
