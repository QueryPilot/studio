import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Code, FileText } from "lucide-react";

interface JsonCellProps {
  value: string | object;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    nullable?: boolean;
  };
}

export function JsonCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: JsonCellProps) {
  const [editValue, setEditValue] = useState(() => {
    if (!value) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  });
  const [isValid, setIsValid] = useState(true);
  const [isFormatted, setIsFormatted] = useState(false);

  const validateJson = useCallback((val: string) => {
    if (val === "" && columnMeta?.nullable) return true;
    if (val === "") return false;
    
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, [columnMeta]);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    const valid = validateJson(newValue);
    setIsValid(valid);
    
    if (valid && onChange) {
      onChange(newValue);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(editValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditValue(formatted);
      setIsFormatted(true);
      if (onChange) {
        onChange(formatted);
      }
    } catch {
      // Invalid JSON, don't format
    }
  };

  const handleMinify = () => {
    try {
      const parsed = JSON.parse(editValue);
      const minified = JSON.stringify(parsed);
      setEditValue(minified);
      setIsFormatted(false);
      if (onChange) {
        onChange(minified);
      }
    } catch {
      // Invalid JSON, don't minify
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey && onEditComplete) {
      onEditComplete();
    }
  };

  const formatDisplayValue = (val: string | object) => {
    if (!val) return "NULL";
    
    try {
      const jsonObj = typeof val === "string" ? JSON.parse(val) : val;
      
      // For display, show a compact preview
      const jsonStr = JSON.stringify(jsonObj);
      if (jsonStr.length > 100) {
        return jsonStr.substring(0, 97) + "...";
      }
      return jsonStr;
    } catch {
      return String(val);
    }
  };

  if (!isEditing) {
    const displayValue = formatDisplayValue(value);
    return (
      <div className="px-2 py-1 text-xs flex items-center gap-1 truncate" title={typeof value === "string" ? value : JSON.stringify(value, null, 2)}>
        {displayValue === "NULL" ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          <>
            <Code className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="font-mono">{displayValue}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-1 space-y-2">
      <div className="flex items-center gap-1">
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">JSON Editor</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={handleFormat}
          disabled={!isValid}
          className="h-6 px-2 text-xs"
        >
          Format
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleMinify}
          disabled={!isValid}
          className="h-6 px-2 text-xs"
        >
          Minify
        </Button>
      </div>
      <Textarea
        value={editValue}
        onChange={(e) => { handleChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        className={cn(
          "text-xs font-mono min-h-[100px] resize-y",
          !isValid && "border-red-500 bg-red-50 dark:bg-red-900/20"
        )}
        placeholder={columnMeta?.nullable ? "null" : "{}"}
        autoFocus
      />
      {!isValid && (
        <div className="text-xs text-red-600 dark:text-red-400">
          Invalid JSON format
        </div>
      )}
    </div>
  );
}