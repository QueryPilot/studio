import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Calendar, Clock } from "lucide-react";

interface DateCellProps {
  value: string | Date;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    db_type: string;
    nullable?: boolean;
  };
}

export function DateCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: DateCellProps) {
  const [editValue, setEditValue] = useState(() => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 19);
    return String(value);
  });
  const [isValid, setIsValid] = useState(true);

  const getInputType = () => {
    const dbType = columnMeta?.db_type?.toLowerCase() || "";
    if (dbType.includes("timestamp") || dbType.includes("datetime")) {
      return "datetime-local";
    }
    if (dbType.includes("time")) {
      return "time";
    }
    return "date";
  };

  const validateDate = useCallback((val: string) => {
    if (val === "" && columnMeta?.nullable) return true;
    if (val === "") return false;
    
    try {
      const date = new Date(val);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateDate(newValue);
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

  const formatDisplayValue = (val: string | Date) => {
    if (!val) return "NULL";
    
    try {
      const date = val instanceof Date ? val : new Date(val);
      if (isNaN(date.getTime())) return String(val);
      
      const dbType = columnMeta?.db_type?.toLowerCase() || "";
      
      if (dbType.includes("time") && !dbType.includes("timestamp")) {
        return date.toLocaleTimeString();
      }
      if (dbType.includes("timestamp") || dbType.includes("datetime")) {
        return date.toLocaleString();
      }
      return date.toLocaleDateString();
    } catch {
      return String(val);
    }
  };

  const getIcon = () => {
    const dbType = columnMeta?.db_type?.toLowerCase() || "";
    if (dbType.includes("time")) {
      return <Clock className="h-3 w-3" />;
    }
    return <Calendar className="h-3 w-3" />;
  };

  if (!isEditing) {
    const displayValue = formatDisplayValue(value);
    return (
      <div className="px-2 py-1 text-xs flex items-center gap-1 truncate" title={String(value)}>
        {displayValue === "NULL" ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          <>
            <span className="text-muted-foreground">{getIcon()}</span>
            <span>{displayValue}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <Input
      type={getInputType()}
      value={editValue}
      onChange={(e) => { handleChange(e.target.value); }}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-7 text-xs border-0 bg-transparent",
        !isValid && "border-red-500 bg-red-50 dark:bg-red-900/20"
      )}
      placeholder={columnMeta?.nullable ? "NULL" : undefined}
      autoFocus
    />
  );
}