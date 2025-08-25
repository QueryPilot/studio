import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FileCode } from "lucide-react";
import type { CellRendererProps } from "../types";

export const XmlCell = memo(function XmlCell({
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

  const xmlValue = value?.value_type === "Xml" ? value.value : null;

  const formatXml = (val: any): string => {
    if (val === null || val === undefined) return "";
    return String(val);
  };

  const prettyXml = (val: any): string => {
    if (val === null || val === undefined) return "";

    const str = String(val);

    // Basic XML formatting
    try {
      let formatted = "";
      let indent = 0;
      const lines = str.split(/>\s*</);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";

        if (i === 0) {
          formatted = line;
        } else {
          formatted += ">\n" + "  ".repeat(indent) + "<" + line;
        }

        if (/^\/\w/.test(line)) {
          indent--;
        } else if (!/\/$/.test(line)) {
          indent++;
        }
      }

      return formatted;
    } catch {
      return str;
    }
  };

  const displayValue = formatXml(xmlValue);
  const truncatedDisplay =
    displayValue.length > 50
      ? displayValue.substring(0, 50) + "..."
      : displayValue;

  useEffect(() => {
    if (isEditing) {
      setEditValue(prettyXml(xmlValue));
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
  }, [isEditing, xmlValue]);

  const validateXml = (val: string): boolean => {
    if (val === "") return true;

    // Basic XML validation - check for matching tags
    const openTags = val.match(/<(\w+)(?:\s[^>]*)?>/g) || [];
    const closeTags = val.match(/<\/(\w+)>/g) || [];

    if (openTags.length === 0 && closeTags.length === 0) {
      return false; // No valid XML tags found
    }

    return true; // Basic validation passed
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setIsValid(validateXml(newValue));

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
        value_type: "Xml",
        value: null,
        db_type: value?.db_type || "XML",
        is_truncated: false,
      });
    } else {
      onEdit({
        value_type: "Xml",
        value: editValue,
        db_type: value?.db_type || "XML",
        is_truncated: false,
      });
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
        placeholder="Enter XML (Ctrl+Enter to save)"
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
      title={prettyXml(xmlValue)}
    >
      {xmlValue !== null ? (
        <>
          <FileCode className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs truncate">{truncatedDisplay}</span>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
