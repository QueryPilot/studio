import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { CellRendererProps } from "../types";

export const EnumCell = memo(function EnumCell({
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
  const selectRef = useRef<HTMLSelectElement>(null);

  const enumValue =
    value?.value_type === "Enum" ? String(value.value ?? "") : "";
  const enumOptions = column.metadata?.enum_values || [];

  useEffect(() => {
    if (isEditing) {
      setEditValue(enumValue);
      setTimeout(() => selectRef.current?.focus(), 0);
    }
  }, [isEditing, enumValue]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    onEdit({
      value_type: "Enum",
      value: newValue === "" ? null : newValue,
      db_type: value?.db_type || "ENUM",
      is_truncated: false,
      metadata: { enum_values: enumOptions },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEdit({
        value_type: "Enum",
        value: editValue === "" ? null : editValue,
        db_type: value?.db_type || "ENUM",
        is_truncated: false,
        metadata: { enum_values: enumOptions },
      });
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
      <select
        ref={selectRef}
        value={editValue}
        onChange={handleChange}
        onBlur={() => onCancelEdit()}
        onKeyDown={handleKeyDown}
        className="w-full h-full px-2 border-0 outline-none bg-background appearance-none"
      >
        <option value="">NULL</option>
        {enumOptions.map((option: string) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  const getColorForValue = (val: string): string => {
    if (!val) return "";

    // Generate consistent color based on value hash
    let hash = 0;
    for (let i = 0; i < val.length; i++) {
      hash = val.charCodeAt(i) + ((hash << 5) - hash);
    }

    const colors = [
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
      "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    ];

    const idx = Math.abs(hash) % colors.length;
    return colors[idx] ?? "";
  };

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default truncate",
        isSelected ? "bg-accent/50" : "",
        isHovered && !isSelected ? "bg-muted/50" : "",
        column.editable !== false ? "cursor-pointer" : "",
      )}
      title={enumValue || "NULL"}
    >
      {enumValue ? (
        <span
          className={cn(
            "px-2 py-0.5 rounded-md text-xs font-medium inline-flex items-center gap-1",
            getColorForValue(enumValue) || "",
          )}
        >
          {`${enumValue}`}
          {column.editable !== false && (
            <ChevronDown className="h-3 w-3 opacity-50" />
          )}
        </span>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
