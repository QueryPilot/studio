import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Column {
  name: string;
  db_type?: string;
}

interface ConstraintInputProps {
  value: string | null | undefined;
  onChange: (value?: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isNew?: boolean;
  className?: string;
  label?: string;
  availableColumns?: Column[];
}

export function ConstraintInput({
  value,
  onChange,
  placeholder = "expression",
  disabled = false,
  isNew = false,
  className,
  label = "Check Constraint",
  availableColumns = [],
}: ConstraintInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [isOpen]);

  // Get the current word being typed
  const getCurrentWord = useMemo(() => {
    if (!textareaRef.current) return "";
    const text = localValue;
    const position = cursorPosition;

    // Find word boundaries
    let start = position;
    while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
      start--;
    }

    let end = position;
    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
      end++;
    }

    return text.substring(start, end);
  }, [localValue, cursorPosition]);

  // Filter suggestions based on current word
  const filteredSuggestions = useMemo(() => {
    const word = getCurrentWord.toLowerCase();
    if (!word) return availableColumns;

    return availableColumns.filter((col) =>
      col.name.toLowerCase().startsWith(word),
    );
  }, [getCurrentWord, availableColumns]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && localValue !== (value || "")) {
      onChange(localValue || null);
    }
  };

  const insertColumnName = (columnName: string) => {
    if (!textareaRef.current) return;

    const text = localValue;
    const position = cursorPosition;

    // Find word boundaries to replace
    let start = position;
    while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
      start--;
    }

    let end = position;
    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
      end++;
    }

    // Replace the current word with the column name
    const newValue =
      text.substring(0, start) + columnName + text.substring(end);
    setLocalValue(newValue);

    // Set cursor position after the inserted column name
    const newPosition = start + columnName.length;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(newPosition, newPosition);
        textareaRef.current.focus();
      }
    }, 0);

    setShowSuggestions(false);
    setSelectedSuggestion(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1,
        );
        return;
      } else if (e.key === "Tab" || e.key === "Enter") {
        if (showSuggestions && filteredSuggestions[selectedSuggestion]) {
          e.preventDefault();
          insertColumnName(filteredSuggestions[selectedSuggestion].name);
          return;
        }
      }
    }

    if (e.key === "Escape") {
      if (showSuggestions) {
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedSuggestion(0);
      } else {
        e.preventDefault();
        setLocalValue(value || "");
        setIsOpen(false);
      }
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onChange(localValue || null);
      setIsOpen(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    setCursorPosition(e.target.selectionStart);

    // Show suggestions if typing a word
    const currentChar = newValue[e.target.selectionStart - 1];
    const prevChar = newValue[e.target.selectionStart - 2];

    // Show suggestions when starting to type a word or continuing to type
    if (
      /[a-zA-Z_]/.test(currentChar) ||
      (currentChar &&
        /[a-zA-Z0-9_]/.test(currentChar) &&
        (!prevChar || /[\s\(\),=<>!]/.test(prevChar)))
    ) {
      setShowSuggestions(true);
      setSelectedSuggestion(0);
    } else if (/[\s\(\),=<>!]/.test(currentChar)) {
      setShowSuggestions(false);
    }
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    setCursorPosition((e.target as HTMLTextAreaElement).selectionStart);
    setShowSuggestions(false);
  };

  const displayValue = value || "";
  const truncatedValue =
    displayValue.length > 20
      ? `${displayValue.substring(0, 20)}...`
      : displayValue;

  return (
    <Popover open={isOpen && !disabled} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "!h-7 !px-2 !py-1 w-full bg-transparent border-0 outline-none font-mono text-xs text-left",
            "focus-visible:ring-1 focus-visible:ring-primary rounded-none",
            "hover:bg-muted/50 transition-colors",
            disabled && "cursor-not-allowed opacity-60",
            isNew && "placeholder:text-muted-foreground/50",
            className,
          )}
        >
          <span
            className={cn(!value && "text-muted-foreground/50")}
            title={displayValue || undefined}
          >
            {value ? truncatedValue : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-2"
        align="center"
        side="bottom"
        sideOffset={2}
      >
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-medium">
            {label}
          </div>
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={localValue}
              onChange={handleTextareaChange}
              onClick={handleTextareaClick}
              onKeyDown={handleKeyDown}
              placeholder="e.g., age >= 18 AND age <= 120"
              className="min-h-[80px] max-h-[200px] font-mono text-xs resize-y"
              disabled={disabled}
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                <ScrollArea className="max-h-[150px]">
                  <div className="space-y-0.5">
                    {filteredSuggestions.map((col, index) => (
                      <button
                        key={col.name}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted",
                          index === selectedSuggestion && "bg-muted",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertColumnName(col.name);
                        }}
                        onMouseEnter={() => {
                          setSelectedSuggestion(index);
                        }}
                      >
                        <span className="font-mono">{col.name}</span>
                        {col.db_type && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {col.db_type}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          {availableColumns.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs text-muted-foreground">Columns:</span>
              {availableColumns.slice(0, 5).map((col) => (
                <Badge
                  key={col.name}
                  variant="outline"
                  className="text-xs cursor-pointer hover:bg-muted"
                  onClick={() => {
                    if (textareaRef.current) {
                      const pos = textareaRef.current.selectionStart;
                      const text = localValue;
                      const newValue =
                        text.slice(0, pos) + col.name + text.slice(pos);
                      setLocalValue(newValue);
                      setTimeout(() => {
                        if (textareaRef.current) {
                          const newPos = pos + col.name.length;
                          textareaRef.current.setSelectionRange(newPos, newPos);
                          textareaRef.current.focus();
                        }
                      }, 0);
                    }
                  }}
                >
                  {col.name}
                </Badge>
              ))}
              {availableColumns.length > 5 && (
                <span className="text-xs text-muted-foreground">
                  +{availableColumns.length - 5} more
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Tab</kbd> or{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Enter</kbd> to
            autocomplete,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
              Ctrl+Enter
            </kbd>{" "}
            to apply,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> to
            cancel
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
