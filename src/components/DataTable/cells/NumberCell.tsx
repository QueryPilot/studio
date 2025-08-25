import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CellRendererProps } from "../types";

export const NumberCell = memo(function NumberCell({
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

  const isInteger = value?.value_type === "Integer";
  const isDecimal = value?.value_type === "Decimal";
  const numberValue = isInteger || isDecimal ? value.value : null;

  const formatNumber = (val: any): string => {
    if (val === null || val === undefined) return "";

    if (isInteger) {
      return Number(val).toLocaleString();
    }

    if (isDecimal && value?.metadata) {
      const scale = value.metadata.scale || 2;
      return Number(val).toFixed(scale);
    }

    return String(val);
  };

  const displayValue = formatNumber(numberValue);

  useEffect(() => {
    if (isEditing) {
      setEditValue(numberValue !== null ? String(numberValue) : "");
      setIsValid(true);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing, numberValue]);

  const validateNumber = (val: string): boolean => {
    if (val === "") return true;

    if (isInteger) {
      return /^-?\d+$/.test(val);
    }

    if (isDecimal) {
      return /^-?\d*\.?\d*$/.test(val);
    }

    return false;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setIsValid(validateNumber(newValue));
  };

  const handleSave = () => {
    if (!isValid) {
      onCancelEdit();
      return;
    }

    if (editValue === "") {
      onEdit({
        value_type: value?.value_type || "Integer",
        value: null,
        db_type: value?.db_type || "INTEGER",
        is_truncated: false,
      });
    } else if (isInteger) {
      onEdit({
        value_type: "Integer",
        value: parseInt(editValue, 10),
        db_type: value?.db_type || "INTEGER",
        is_truncated: false,
      });
    } else if (isDecimal) {
      onEdit({
        value_type: "Decimal",
        value: parseFloat(editValue),
        db_type: value?.db_type || "DECIMAL",
        is_truncated: false,
        metadata: value?.metadata,
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
        type="text"
        value={editValue}
        onChange={handleChange}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full h-full px-2 border-0 outline-none bg-background text-right",
          !isValid && "text-destructive",
        )}
        placeholder={isInteger ? "Enter integer" : "Enter decimal"}
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm text-right cursor-default tabular-nums truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-text",
      )}
      title={displayValue}
    >
      {numberValue !== null ? (
        displayValue
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
