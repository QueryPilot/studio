/**
 * Conversation Component
 *
 * Container for chat messages with auto-scroll behavior.
 * Replaces Vercel AI Elements conversation component.
 */

import * as React from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Auto-scroll to bottom when new content is added
   * @default true
   */
  autoScroll?: boolean;
}

export function Conversation({
  children,
  className,
  autoScroll = true,
  ...props
}: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const childCount = React.Children.count(children);

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [autoScroll, childCount]);

  return (
    <ScrollArea className={cn("flex-1", className)} {...props}>
      <div className="flex flex-col gap-4 p-4">
        {children}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
