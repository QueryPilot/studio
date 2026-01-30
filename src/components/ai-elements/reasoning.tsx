/**
 * Reasoning Component
 *
 * Displays AI thinking/reasoning in a collapsible block.
 * Replaces Vercel AI Elements reasoning component.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { IconBrain, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { ReasoningProps } from "./types";

export function Reasoning({
  content,
  collapsible = true,
  defaultExpanded = false,
  className,
}: ReasoningProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!content) return null;

  const toggleExpanded = () => {
    if (collapsible) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div
      data-slot="reasoning"
      className={cn(
        "rounded-md border border-dashed border-muted-foreground/30 bg-muted/30",
        className
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={toggleExpanded}
        disabled={!collapsible}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground",
          collapsible && "cursor-pointer hover:bg-muted/50",
          !collapsible && "cursor-default"
        )}
      >
        <IconBrain className="h-3.5 w-3.5" />
        <span className="font-medium">Thinking</span>
        {collapsible && (
          <span className="ml-auto">
            {isExpanded ? (
              <IconChevronDown className="h-3.5 w-3.5" />
            ) : (
              <IconChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </button>

      {/* Content */}
      {(isExpanded || !collapsible) && (
        <div className="border-t border-dashed border-muted-foreground/30 px-3 py-2">
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}
