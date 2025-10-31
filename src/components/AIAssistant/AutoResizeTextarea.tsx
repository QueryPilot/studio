import type { KeyboardEvent } from "react";
import { useEffect, useRef, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxRows?: number;
  minRows?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const AutoResizeTextarea = forwardRef<
  HTMLTextAreaElement,
  AutoResizeTextareaProps
>(({ maxRows = 10, minRows = 1, className, value, ...props }, ref) => {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || localRef;

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = "auto";

    // Calculate line height
    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseInt(styles.lineHeight);

    // Calculate min and max heights
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    // Set new height within bounds
    const newHeight = Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight,
    );
    textarea.style.height = `${newHeight}px`;

    // Enable scroll if content exceeds maxRows
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  // Resize on value change
  useEffect(() => {
    resize();
  }, [value]);

  // Resize on mount
  useEffect(() => {
    resize();
  }, []);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-all",
        className,
      )}
      style={{
        minHeight: `${minRows * 1.5}rem`,
        overflowY: "hidden",
      }}
      {...props}
    />
  );
});

AutoResizeTextarea.displayName = "AutoResizeTextarea";
