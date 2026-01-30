/**
 * Loader Component
 *
 * Loading indicators for AI responses.
 * Replaces Vercel AI Elements loader component.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Loader variant
   * @default "dots"
   */
  variant?: "dots" | "spinner" | "pulse";
}

export function Loader({ variant = "dots", className, ...props }: LoaderProps) {
  return (
    <div
      data-slot="loader"
      data-variant={variant}
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      {variant === "dots" && <DotsLoader />}
      {variant === "spinner" && <SpinnerLoader />}
      {variant === "pulse" && <PulseLoader />}
    </div>
  );
}

// ============ Loader Variants ============

function DotsLoader() {
  return (
    <div className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </div>
  );
}

function SpinnerLoader() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function PulseLoader() {
  return (
    <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-muted-foreground/50" />
  );
}

// ============ Typing Indicator ============

export type TypingIndicatorProps = React.HTMLAttributes<HTMLSpanElement>;

/**
 * Blinking cursor for streaming text
 */
export function TypingIndicator({ className, ...props }: TypingIndicatorProps) {
  return (
    <span
      data-slot="typing-indicator"
      className={cn("inline-block animate-pulse", className)}
      {...props}
    >
      |
    </span>
  );
}
