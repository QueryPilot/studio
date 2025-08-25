import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CellRendererProps } from "../types";

export const StringCell = memo(function StringCell({
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
  const inputRef = useRef<HTMLInputElement>(null);

  const stringValue =
    value?.value_type === "Text" ? String(value.value ?? "") : "";
  const isLongText = stringValue.length > 100;

  useEffect(() => {
    if (isEditing) {
      setEditValue(stringValue);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing, stringValue]);

  const handleSave = () => {
    onEdit({
      value_type: "Text",
      value: editValue,
      db_type: value?.db_type || "TEXT",
      is_truncated: false,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
    if (isLongText) {
      return (
        <textarea
          ref={inputRef as any}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="w-full h-full p-1 border-0 outline-none resize-none bg-background"
          rows={3}
        />
      );
    }

    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="w-full h-full px-2 border-0 outline-none bg-background"
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm truncate cursor-default",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-text",
      )}
      title={stringValue}
    >
      {stringValue || <span className="text-muted-foreground">NULL</span>}
    </div>
  );
});
