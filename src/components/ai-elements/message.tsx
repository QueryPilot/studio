/**
 * Message Component
 *
 * Displays a single chat message with role-based styling.
 * Uses Streamdown for smooth AI streaming markdown rendering.
 */

import * as React from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { IconUser, IconRobot } from "@tabler/icons-react";
import type { MessageProps } from "./types";

export function Message({ role, children, className }: MessageProps) {
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  return (
    <div
      data-slot="message"
      data-role={role}
      className={cn(
        "group flex gap-3",
        isUser && "flex-row-reverse",
        className,
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full select-text",
          isUser && "bg-primary/10 text-primary",
          isAssistant && "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? (
          <IconUser className="h-4 w-4" />
        ) : (
          <IconRobot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 space-y-2 overflow-hidden",
          isUser && "text-right",
        )}
      >
        <div
          className={cn(
            "inline-block rounded-lg px-3 py-2 text-sm select-text",
            isUser && "bg-primary text-primary-foreground",
            isAssistant && "bg-muted text-foreground",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ============ Sub-components ============

export interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to render content as markdown */
  markdown?: boolean;
  /** Content to render - string for markdown, ReactNode for custom */
  children: React.ReactNode;
}

/**
 * Message content with Streamdown for AI streaming support
 */
export function MessageContent({
  children,
  className,
  markdown = true,
  ...props
}: MessageContentProps) {
  // If not markdown or children is not a string, render as-is
  if (!markdown || typeof children !== "string") {
    return (
      <div
        data-slot="message-content"
        className={cn("text-inherit", className)}
        {...props}
      >
        {children}
      </div>
    );
  }

  // Render markdown content with Streamdown
  return (
    <div
      data-slot="message-content"
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-1 prose-p:leading-relaxed",
        "prose-headings:mt-3 prose-headings:mb-1",
        "prose-ul:my-1 prose-ol:my-1",
        "prose-li:my-0.5",
        "prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent",
        className,
      )}
      {...props}
    >
      <Streamdown>{children}</Streamdown>
    </div>
  );
}
