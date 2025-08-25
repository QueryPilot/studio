import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import type { CellRendererProps } from "../types";

export const DateCell = memo(function DateCell({
  value,
  isSelected,
  isEditing,
  isHovered,
  onEdit,
  onStartEdit,
  onCancelEdit,
  column,
}: CellRendererProps) {
  const [editValue, setEditValue] = useState("");
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDate = value?.value_type === "Date";
  const isDateTime = value?.value_type === "DateTime";
  const isTime = value?.value_type === "Time";
  const dateValue = isDate || isDateTime || isTime ? value.value : null;

  const formatDate = (val: any): string => {
    if (!val) return "";

    try {
      const date = new Date(val);

      if (isTime) {
        return date.toLocaleTimeString();
      }

      if (isDateTime) {
        return date.toLocaleString();
      }

      return date.toLocaleDateString();
    } catch {
      return String(val);
    }
  };

  const displayValue = formatDate(dateValue);

  const getInputType = (): string => {
    if (isTime) return "time";
    if (isDateTime) return "datetime-local";
    return "date";
  };

  const formatForInput = (val: any): string => {
    if (!val) return "";

    try {
      const date = new Date(val);

      if (isTime) {
        return date.toTimeString().slice(0, 8);
      }

      if (isDateTime) {
        return date.toISOString().slice(0, 16);
      }

      return date.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  };

  useEffect(() => {
    if (isEditing) {
      setEditValue(formatForInput(dateValue));
      setIsValid(true);
      setTimeout(() => inputRef.current?.showPicker?.(), 100);
    }
  }, [isEditing, dateValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setIsValid(newValue === "" || !isNaN(Date.parse(newValue)));
  };

  const handleSave = () => {
    if (!isValid) {
      onCancelEdit();
      return;
    }

    if (editValue === "") {
      onEdit({
        value_type: value?.value_type || "Date",
        value: null,
        db_type: value?.db_type || "DATE",
        is_truncated: false,
      });
    } else {
      const date = new Date(editValue);
      onEdit({
        value_type: value?.value_type || "Date",
        value: date.toISOString(),
        db_type: value?.db_type || "DATE",
        is_truncated: false,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      onCancelEdit();
    }
  };

  const handleDoubleClick = () => {
    if (column.editable !== false) {
      onStartEdit();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={getInputType()}
        value={editValue}
        onChange={handleChange}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full h-full px-2 border-0 outline-none bg-background",
          !isValid && "text-destructive",
        )}
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-text",
      )}
      title={displayValue}
    >
      {dateValue !== null ? (
        <>
          {(isDate || isDateTime) && (
            <CalendarIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          <span className="truncate">{displayValue}</span>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
