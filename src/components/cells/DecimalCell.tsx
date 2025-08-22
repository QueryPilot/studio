import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DecimalCellProps {
  value: string | number;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    db_type: string;
    precision?: number;
    scale?: number;
    nullable?: boolean;
  };
}

export function DecimalCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: DecimalCellProps) {
  const [editValue, setEditValue] = useState(String(value || ""));
  const [isValid, setIsValid] = useState(true);

  const validateDecimal = useCallback((val: string) => {
    if (val === "" && columnMeta?.nullable) return true;
    if (val === "") return false;
    
    const regex = /^-?\d+(\.\d+)?$/;
    if (!regex.test(val)) return false;
    
    // Check precision and scale if available
    if (columnMeta?.precision && columnMeta?.scale !== undefined) {
      const parts = val.split(".");
      const integerDigits = parts[0].replace("-", "").length;
      const decimalDigits = parts[1]?.length || 0;
      
      const maxIntegerDigits = columnMeta.precision - columnMeta.scale;
      return integerDigits <= maxIntegerDigits && decimalDigits <= columnMeta.scale;
    }
    
    // Basic validation for floating point
    try {
      parseFloat(val);
      return true;
    } catch {
      return false;
    }
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateDecimal(newValue);
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
    
    const numStr = String(val);
    const num = parseFloat(numStr);
    
    if (isNaN(num)) return numStr;
    
    // Format with appropriate decimal places
    if (columnMeta?.scale !== undefined) {
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: columnMeta.scale,
      });
    }
    
    return num.toLocaleString();
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