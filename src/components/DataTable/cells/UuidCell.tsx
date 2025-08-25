import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Key } from "lucide-react";
import type { CellRendererProps } from "../types";

export const UuidCell = memo(function UuidCell({
  value,
  isSelected,
  isEditing,
  isHovered,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onCopy,
  column,
}: CellRendererProps) {
  const [editValue, setEditValue] = useState("");
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const uuidValue =
    value?.value_type === "Uuid" ? String(value.value ?? "") : "";

  const validateUuid = (val: string): boolean => {
    if (val === "") return true;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(val);
  };

  useEffect(() => {
    if (isEditing) {
      setEditValue(uuidValue);
      setIsValid(true);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing, uuidValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toLowerCase();
    setEditValue(newValue);
    setIsValid(validateUuid(newValue));
  };

  const handleSave = () => {
    if (!isValid) {
      onCancelEdit();
      return;
    }

    if (editValue === "") {
      onEdit({
        value_type: "Uuid",
        value: null,
        db_type: value?.db_type || "UUID",
        is_truncated: false,
      });
    } else {
      onEdit({
        value_type: "Uuid",
        value: editValue.toLowerCase(),
        db_type: value?.db_type || "UUID",
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

  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy();
  };

  const formatDisplay = (uuid: string): string => {
    if (!uuid) return "";
    return uuid.toLowerCase();
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
          "w-full h-full px-2 border-0 outline-none bg-background font-mono text-xs",
          !isValid && "text-destructive",
        )}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default group",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-text",
      )}
      title={uuidValue}
    >
      {uuidValue ? (
        <>
          <Key className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs truncate">
            {formatDisplay(uuidValue)}
          </span>
          <button
            onClick={handleCopyClick}
            className="opacity-0 group-hover:opacity-100 ml-auto text-xs text-muted-foreground hover:text-foreground transition-opacity"
            title="Copy UUID"
          >
            Copy
          </button>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
