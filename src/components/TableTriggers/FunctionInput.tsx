import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FunctionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  availableFunctions?: string[];
}

export function FunctionInput({
  value,
  onChange,
  placeholder = "function_name()",
  disabled = false,
  className,
  availableFunctions = [],
}: FunctionInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        inputRef.current.value.length,
        inputRef.current.value.length,
      );
    }
  }, [isOpen]);

  // Filter suggestions based on current input
  const filteredSuggestions = useMemo(() => {
    const searchTerm = localValue.toLowerCase();
    if (!searchTerm) return availableFunctions.slice(0, 10);

    return availableFunctions
      .filter((func) => func.toLowerCase().includes(searchTerm))
      .slice(0, 10);
  }, [localValue, availableFunctions]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && localValue !== value) {
      onChange(localValue);
    }
  };

  const selectFunction = (funcName: string) => {
    setLocalValue(funcName);
    setShowSuggestions(false);
    setSelectedSuggestion(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        if (filteredSuggestions[selectedSuggestion]) {
          e.preventDefault();
          selectFunction(filteredSuggestions[selectedSuggestion]);
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
      onChange(localValue);
      setIsOpen(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    setShowSuggestions(true);
    setSelectedSuggestion(0);
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
            Trigger Function
          </div>
          <div className="relative">
            <Input
              ref={inputRef}
              value={localValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setShowSuggestions(true);
              }}
              placeholder="Type or select function..."
              className="font-mono !text-xs"
              disabled={disabled}
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                <ScrollArea className="max-h-[150px]">
                  <div className="space-y-0.5">
                    {filteredSuggestions.map((func, index) => (
                      <button
                        key={func}
                        className={cn(
                          "flex w-full items-center rounded px-2 py-1 text-xs hover:bg-muted font-mono",
                          index === selectedSuggestion && "bg-muted",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectFunction(func);
                        }}
                        onMouseEnter={() => {
                          setSelectedSuggestion(index);
                        }}
                      >
                        {func}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          {availableFunctions.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs text-muted-foreground">Functions:</span>
              {availableFunctions.slice(0, 5).map((func) => (
                <Badge
                  key={func}
                  variant="outline"
                  className="text-xs cursor-pointer hover:bg-muted font-mono"
                  onClick={() => {
                    setLocalValue(func);
                    setShowSuggestions(false);
                    // Focus back on input so user can confirm with Ctrl+Enter
                    setTimeout(() => {
                      inputRef.current?.focus();
                    }, 0);
                  }}
                >
                  {func.length > 30 ? `${func.substring(0, 30)}...` : func}
                </Badge>
              ))}
              {availableFunctions.length > 5 && (
                <span className="text-xs text-muted-foreground">
                  +{availableFunctions.length - 5} more
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Tab</kbd> or{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Enter</kbd> to
            autocomplete,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+Enter</kbd> to
            apply,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> to
            cancel
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
