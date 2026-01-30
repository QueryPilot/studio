/**
 * Tool Component
 *
 * Displays tool call status and results.
 * Replaces Vercel AI Elements tool component.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  IconTool,
  IconLoader2,
  IconCheck,
  IconX,
  IconClock,
} from "@tabler/icons-react";
import type { ToolCall } from "@/types/acp";
import { getToolStatusText } from "./types";

export interface ToolProps {
  toolCall: ToolCall;
  className?: string;
}

export function Tool({ toolCall, className }: ToolProps) {
  const { name, status, input, output } = toolCall;

  return (
    <div
      data-slot="tool"
      data-status={status}
      className={cn(
        "rounded-md border bg-muted/30 text-xs",
        status === "failed" && "border-destructive/50 bg-destructive/10",
        status === "completed" && "border-green-500/30 bg-green-500/5",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <ToolStatusIcon status={status} />
        <span className="font-medium">{name}</span>
        <span className="ml-auto text-muted-foreground">
          {getToolStatusText(status)}
        </span>
      </div>

      {/* Input (collapsed by default for brevity) */}
      {Object.keys(input).length > 0 && (
        <ToolSection title="Input">
          <pre className="overflow-x-auto text-[10px]">
            {JSON.stringify(input, null, 2)}
          </pre>
        </ToolSection>
      )}

      {/* Output (if completed) */}
      {status === "completed" && output !== undefined && (
        <ToolSection title="Output">
          <pre className="overflow-x-auto text-[10px]">
            {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
          </pre>
        </ToolSection>
      )}
    </div>
  );
}

// ============ Sub-components ============

interface ToolStatusIconProps {
  status: ToolCall["status"];
}

function ToolStatusIcon({ status }: ToolStatusIconProps) {
  const iconClass = "h-3.5 w-3.5";

  switch (status) {
    case "pending":
      return <IconClock className={cn(iconClass, "text-muted-foreground")} />;
    case "running":
      return (
        <IconLoader2 className={cn(iconClass, "animate-spin text-primary")} />
      );
    case "completed":
      return <IconCheck className={cn(iconClass, "text-green-500")} />;
    case "failed":
      return <IconX className={cn(iconClass, "text-destructive")} />;
    default:
      return <IconTool className={cn(iconClass, "text-muted-foreground")} />;
  }
}

interface ToolSectionProps {
  title: string;
  children: ReactNode;
}

function ToolSection({ title, children }: ToolSectionProps) {
  return (
    <div className="border-t border-border/50 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
        {title}
      </div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}
