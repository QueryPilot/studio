import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FileJson } from "lucide-react";
import type { CellRendererProps } from "../types";

export const JsonCell = memo(function JsonCell({
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

  const jsonValue = value?.value_type === "Json" ? value.value : null;

  const formatJson = (val: any): string => {
    if (val === null || val === undefined) return "";

    try {
      if (typeof val === "string") {
        const parsed = JSON.parse(val);
        return JSON.stringify(parsed);
      }
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  };

  const prettyJson = (val: any): string => {
    if (val === null || val === undefined) return "";

    try {
      if (typeof val === "string") {
        const parsed = JSON.parse(val);
        return JSON.stringify(parsed, null, 2);
      }
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  };

  const displayValue = formatJson(jsonValue);
  const truncatedDisplay =
    displayValue.length > 50
      ? displayValue.substring(0, 50) + "..."
      : displayValue;

  useEffect(() => {
    if (isEditing) {
      setEditValue(prettyJson(jsonValue));
      setIsValid(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.select();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(
            textareaRef.current.scrollHeight,
            300,
          )}px`;
        }
      }, 0);
    }
  }, [isEditing, jsonValue]);

  const validateJson = (val: string): boolean => {
    if (val === "") return true;

    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setIsValid(validateJson(newValue));

    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`;
  };

  const handleSave = () => {
    if (!isValid) {
      onCancelEdit();
      return;
    }

    if (editValue === "") {
      onEdit({
        value_type: "Json",
        value: null,
        db_type: value?.db_type || "JSON",
        is_truncated: false,
      });
    } else {
      try {
        const parsed = JSON.parse(editValue);
        onEdit({
          value_type: "Json",
          value: parsed,
          db_type: value?.db_type || "JSON",
          is_truncated: false,
        });
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
          "w-full min-h-[60px] max-h-[300px] p-2 border-0 outline-none bg-background font-mono text-xs resize-y",
          !isValid && "text-destructive",
        )}
        placeholder="Enter JSON (Ctrl+Enter to save)"
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
      title={prettyJson(jsonValue)}
    >
      {jsonValue !== null ? (
        <>
          <FileJson className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs truncate">{truncatedDisplay}</span>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
