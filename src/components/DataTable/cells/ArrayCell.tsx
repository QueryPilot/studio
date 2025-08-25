import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { List } from "lucide-react";
import type { CellRendererProps } from "../types";

export const ArrayCell = memo(function ArrayCell({
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const arrayValue = value?.value_type === "Array" ? value.value : null;

  const formatArray = (val: any): string => {
    if (val === null || val === undefined) return "";

    if (Array.isArray(val)) {
      return JSON.stringify(val);
    }

    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return JSON.stringify(parsed);
        }
      } catch {
        // If it's not valid JSON, treat as string representation
      }
    }

    return String(val);
  };

  const prettyArray = (val: any): string => {
    if (val === null || val === undefined) return "";

    if (Array.isArray(val)) {
      return JSON.stringify(val, null, 2);
    }

    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return JSON.stringify(parsed, null, 2);
        }
      } catch {
        return val;
      }
    }

    return String(val);
  };

  const displayValue = formatArray(arrayValue);
  const truncatedDisplay =
    displayValue.length > 50
      ? displayValue.substring(0, 50) + "..."
      : displayValue;

  const getLength = (): number => {
    if (!arrayValue) return 0;

    if (Array.isArray(arrayValue)) {
      return arrayValue.length;
    }

    if (typeof arrayValue === "string") {
      try {
        const parsed = JSON.parse(arrayValue);
        if (Array.isArray(parsed)) {
          return parsed.length;
        }
      } catch {
        // Not valid JSON
      }
    }

    return 0;
  };

  useEffect(() => {
    if (isEditing) {
      setEditValue(prettyArray(arrayValue));
      setIsValid(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.select();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(
            textareaRef.current.scrollHeight,
            200,
          )}px`;
        }
      }, 0);
    }
  }, [isEditing, arrayValue]);

  const validateArray = (val: string): boolean => {
    if (val === "") return true;

    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed);
    } catch {
      return false;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setIsValid(validateArray(newValue));

    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const handleSave = () => {
    if (!isValid) {
      onCancelEdit();
      return;
    }

    if (editValue === "") {
      onEdit({
        value_type: "Array",
        value: null,
        db_type: value?.db_type || "ARRAY",
        is_truncated: false,
      });
    } else {
      try {
        const parsed = JSON.parse(editValue);
        if (Array.isArray(parsed)) {
          onEdit({
            value_type: "Array",
            value: parsed,
            db_type: value?.db_type || "ARRAY",
            is_truncated: false,
          });
        }
      } catch {
        onCancelEdit();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
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
      <textarea
        ref={textareaRef}
        value={editValue}
        onChange={handleChange}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full min-h-[40px] max-h-[200px] p-2 border-0 outline-none bg-background font-mono text-xs resize-y",
          !isValid && "text-destructive",
        )}
        placeholder="Enter array JSON (Ctrl+Enter to save)"
      />
    );
  }

  const length = getLength();

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-text",
      )}
      title={prettyArray(arrayValue)}
    >
      {arrayValue !== null ? (
        <>
          <List className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">[{length}]</span>
          <span className="font-mono text-xs truncate">{truncatedDisplay}</span>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
