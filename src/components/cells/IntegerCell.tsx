import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface IntegerCellProps {
  value: string | number;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    db_type: string;
    nullable?: boolean;
  };
}

export function IntegerCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: IntegerCellProps) {
  const [editValue, setEditValue] = useState(String(value || ""));
  const [isValid, setIsValid] = useState(true);

  const validateInteger = useCallback((val: string) => {
    if (val === "" && columnMeta?.nullable) return true;
    if (val === "") return false;
    
    const regex = /^-?\d+$/;
    if (!regex.test(val)) return false;
    
    // Check ranges for specific integer types
    const dbType = columnMeta?.db_type?.toUpperCase() || "";
    try {
      if (dbType.includes("SMALLINT")) {
        const num = BigInt(val);
        return num >= -32768n && num <= 32767n;
      }
      if (dbType.includes("INT") && !dbType.includes("BIGINT")) {
        const num = BigInt(val);
        return num >= -2147483648n && num <= 2147483647n;
      }
      // BIGINT - just check it's a valid BigInt
      BigInt(val);
      return true;
    } catch {
      return false;
    }
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateInteger(newValue);
    setIsValid(valid);
    
    if (valid && onChange) {
      onChange(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEditComplete) {
      onEditComplete();
    }
  };

  const formatDisplayValue = (val: string | number) => {
    if (val === null || val === undefined || val === "") return "NULL";
    
    // Add thousand separators for display
    const numStr = String(val);
    return numStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  if (!isEditing) {
    const displayValue = formatDisplayValue(value);
    return (
      <div className="px-2 py-1 text-xs font-mono text-right truncate" title={String(value)}>
        {displayValue === "NULL" ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          displayValue
        )}
      </div>
    );
  }

  return (
    <Input
      type="text"
      value={editValue}
      onChange={(e) => { handleChange(e.target.value); }}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-6 text-xs font-mono text-right border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0",
        !isValid && "border-red-500 bg-red-50 dark:bg-red-900/20"
      )}
      placeholder={columnMeta?.nullable ? "NULL" : undefined}
      autoFocus
    />
  );
}