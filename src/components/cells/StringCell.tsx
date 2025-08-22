import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface StringCellProps {
  value: string;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    character_maximum_length?: number;
    nullable?: boolean;
  };
  className?: string;
}

export function StringCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
  className,
}: StringCellProps) {
  const [editValue, setEditValue] = useState(value || "");
  const [isValid, setIsValid] = useState(true);

  const validateString = useCallback((val: string) => {
    if (val === "" && !columnMeta?.nullable) {
      return false;
    }
    
    if (columnMeta?.character_maximum_length && val.length > columnMeta.character_maximum_length) {
      return false;
    }
    
    return true;
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateString(newValue);
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

  if (!isEditing) {
    const displayValue = value === null || value === undefined ? "NULL" : value;
    return (
      <div className={cn("px-2 py-1 text-xs truncate", className)} title={displayValue}>
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
        "h-6 text-xs border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0",
        !isValid && "border-red-500 bg-red-50 dark:bg-red-900/20"
      )}
      placeholder={columnMeta?.nullable ? "NULL" : undefined}
      maxLength={columnMeta?.character_maximum_length}
      autoFocus
    />
  );
}