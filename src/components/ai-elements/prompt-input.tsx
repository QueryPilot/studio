/**
 * Prompt Input Component
 *
 * Chat input field with submit functionality.
 * Replaces Vercel AI Elements prompt-input component.
 * Simplified for MVP - no file attachments.
 */

import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IconSend, IconLoader2 } from "@tabler/icons-react";
import type { PromptInputProps } from "./types";

export function PromptInput({
  onSubmit,
  disabled = false,
  placeholder = "Type a message...",
  className,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmedValue = value.trim();
    if (!trimmedValue || disabled || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(trimmedValue);
      setValue("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [value, disabled, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);

      // Auto-resize textarea
      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    },
    []
  );

  const isDisabled = disabled || isSubmitting;
  const canSubmit = value.trim().length > 0 && !isDisabled;

  return (
    <div
      data-slot="prompt-input"
      className={cn(
        "relative flex items-end gap-2 rounded-lg border bg-background p-2",
        isDisabled && "opacity-60",
        className
      )}
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        className="min-h-[40px] max-h-[200px] flex-1 resize-none border-0 bg-transparent p-2 focus-visible:ring-0"
        rows={1}
      />

      <Button
        type="button"
        size="icon"
        variant={canSubmit ? "default" : "ghost"}
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="shrink-0"
      >
        {isSubmitting ? (
          <IconLoader2 className="h-4 w-4 animate-spin" />
        ) : (
          <IconSend className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

// ============ Sub-components ============

export type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Container for additional prompt input actions (e.g., model selector)
 */
export function PromptInputActions({
  children,
  className,
  ...props
}: PromptInputActionsProps) {
  return (
    <div
      data-slot="prompt-input-actions"
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}
