"use client";

import * as React from "react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const TagInput = ({
  value,
  onChange,
  placeholder = "Type to add...",
  className,
  disabled = false,
}: TagInputProps) => {
  const [inputValue, setInputValue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const newTag = inputValue.trim().toLowerCase();
      if (!value.includes(newTag)) {
        onChange([...value, newTag]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    if (disabled) return;
    onChange(value.filter((tag) => tag !== tagToRemove));
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-2 py-1.5 min-h-[32px] w-full rounded-md border border-input bg-input/20 dark:bg-input/30 transition-colors",
        "focus-within:border-ring focus-within:ring-[2px] focus-within:ring-ring/30",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium",
            "bg-primary/10 text-primary border border-primary/20"
          )}
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="hover:bg-primary/20 rounded-sm transition-colors"
            >
              <IconX className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        className={cn(
          "flex-1 min-w-[80px] bg-transparent outline-none text-xs placeholder:text-muted-foreground",
          disabled && "cursor-not-allowed"
        )}
      />
    </div>
  );
};

export { TagInput };
export type { TagInputProps };
