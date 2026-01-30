/**
 * AI Elements Types
 *
 * Adapter types mapping ACP protocol types to what AI Elements components expect.
 * Since we couldn't install Vercel AI Elements, these custom components use
 * the ACP types directly with minimal adapters.
 */

import type { AcpMessage, ToolCall } from "@/types/acp";

// ============ Message Types ============

export type MessageRole = AcpMessage["role"];

export interface MessageProps {
  role: MessageRole;
  children: React.ReactNode;
  className?: string;
}

// ============ Tool Types ============

export type ToolStatus = ToolCall["status"];

export interface ToolState {
  status: ToolStatus;
}

/**
 * Map ACP tool status to display-friendly state
 */
export const mapToolStatus = (
  status: ToolStatus
): "pending" | "running" | "completed" | "failed" => {
  return status;
};

/**
 * Get tool status display text
 */
export const getToolStatusText = (status: ToolStatus): string => {
  const mapping: Record<ToolStatus, string> = {
    pending: "Preparing...",
    running: "Running...",
    completed: "Completed",
    failed: "Failed",
  };
  return mapping[status];
};

// ============ Prompt Input Types ============

export interface PromptInputProps {
  onSubmit: (content: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// ============ Reasoning Types ============

export interface ReasoningProps {
  content: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

// ============ Code Block Types ============

export interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}
