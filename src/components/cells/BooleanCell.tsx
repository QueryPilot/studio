import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface BooleanCellProps {
  value: string | boolean;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    nullable?: boolean;
  };
}

export function BooleanCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: BooleanCellProps) {
  // Convert various boolean representations to boolean
  const getBooleanValue = (val: string | boolean | null | undefined) => {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "boolean") return val;
    
    const str = String(val).toLowerCase();
    return str === "true" || str === "1" || str === "yes" || str === "on";
  };

  const [editValue, setEditValue] = useState(() => getBooleanValue(value));

  const handleChange = (checked: boolean) => {
    setEditValue(checked);
    if (onChange) {
      onChange(String(checked));
    }
    if (onEditComplete) {
      onEditComplete();
    }
  };

  const displayValue = getBooleanValue(value);

  if (!isEditing) {
    return (
      <div className="px-2 py-1 text-xs flex items-center">
        {displayValue === null ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          <div className={cn(
            "px-2 py-1 rounded text-xs font-medium",
            displayValue 
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
          )}>
            {displayValue ? "TRUE" : "FALSE"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 py-1 flex items-center">
      <Switch
        checked={editValue || false}
        onCheckedChange={handleChange}
        size="sm"
      />
      <span className="ml-2 text-xs">
        {editValue ? "TRUE" : "FALSE"}
      </span>
    </div>
  );
}