/**
 * AI Elements
 *
 * Custom chat UI primitives for the AI Panel.
 * These components replace Vercel AI Elements which could not be installed
 * due to registry issues (shimmer component not found).
 *
 * Components use ACP types from @/types/acp and follow shadcn/ui patterns.
 */

// Core components
export { Conversation, type ConversationProps } from "./conversation";
export { Message, MessageContent, type MessageContentProps } from "./message";
export { PromptInput, PromptInputActions, type PromptInputActionsProps } from "./prompt-input";
export { Reasoning } from "./reasoning";
export { Tool, type ToolProps } from "./tool";
export { CodeBlock } from "./code-block";
export { Loader, TypingIndicator, type LoaderProps, type TypingIndicatorProps } from "./loader";

// Types
export * from "./types";
