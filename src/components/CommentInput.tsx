import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

interface CommentInputProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isNew?: boolean;
  className?: string;
}

export function CommentInput({
  value,
  onChange,
  placeholder = "Column description",
  disabled = false,
  isNew = false,
  className,
}: CommentInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
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

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && localValue !== (value || "")) {
      onChange(localValue || null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setLocalValue(value || "");
      setIsOpen(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onChange(localValue || null);
      setIsOpen(false);
    }
  };

  const displayValue = value || "";
  const truncatedValue = displayValue.length > 30
    ? `${displayValue.substring(0, 30)}...`
    : displayValue;

  return (
    <Popover open={isOpen && !disabled} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "!h-7 !px-2 !py-1 w-full bg-transparent border-0 outline-none text-xs text-left italic",
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
        className="w-[400px] p-3"
        align="end"
        side="bottom"
        sideOffset={2}
      >
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-medium">
            Comment / Description
          </div>
          <Textarea
            ref={textareaRef}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the purpose of this column..."
            className="min-h-[80px] max-h-[200px] text-xs resize-y"
            disabled={disabled}
          />
          <div className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+Enter</kbd> to apply,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> to cancel
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}