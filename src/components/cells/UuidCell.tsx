import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw, Hash } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

interface UuidCellProps {
  value: string;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    nullable?: boolean;
  };
}

export function UuidCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: UuidCellProps) {
  const [editValue, setEditValue] = useState(value || "");
  const [isValid, setIsValid] = useState(true);

  const validateUuid = useCallback((val: string) => {
    if (val === "" && columnMeta?.nullable) return true;
    if (val === "") return false;
    
    // UUID v4 regex pattern
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(val);
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateUuid(newValue);
    setIsValid(valid);
    
    if (valid && onChange) {
      onChange(newValue);
    }
  };

  const handleGenerateUuid = () => {
    const newUuid = uuidv4();
    setEditValue(newUuid);
    setIsValid(true);
    if (onChange) {
      onChange(newUuid);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEditComplete) {
      onEditComplete();
    }
  };

  if (!isEditing) {
    const displayValue = value || "NULL";
    return (
      <div className="px-2 py-1 text-xs flex items-center gap-1 truncate font-mono" title={value}>
        {displayValue === "NULL" ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          <>
            <Hash className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span>{displayValue}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 p-1">
      <Input
        type="text"
        value={editValue}
        onChange={(e) => { handleChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-7 text-xs font-mono border-0 bg-transparent flex-1",
          !isValid && "border-red-500 bg-red-50 dark:bg-red-900/20"
        )}
        placeholder={columnMeta?.nullable ? "NULL" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
        autoFocus
      />
      <Button
        size="sm"
        variant="outline"
        onClick={handleGenerateUuid}
        className="h-7 px-2"
        title="Generate UUID"
      >
        <RefreshCw className="h-3 w-3" />
      </Button>
    </div>
  );
}