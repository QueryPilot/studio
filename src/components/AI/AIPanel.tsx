/**
 * AI Panel Component
 *
 * Refined chat panel for AI agents with Cursor-like UX.
 * Features: persistent input focus, mode toggle, model selection, smooth streaming.
 */

import {
  useCallback,
  useState,
  useMemo,
  useEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import { useAcpStore } from "@/stores/acpStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import type { PanelContent } from "@/types/workbench";
import { useAIContextWithSchema, serializeAIContext } from "@/hooks/useAIContext";
import { getMentionAtCursor, formatMention } from "@/utils/mentionParser";
import type { AIContext } from "@/types/aiContext";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconX,
  IconSend,
  IconPlayerStop,
  IconSparkles,
  IconAlertTriangle,
  IconLoader2,
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconTerminal2,
  IconFileText,
  IconSearch,
  IconCheck,
  IconClock,
  IconMessages,
  IconWand,
  IconTrash,
  IconTable,
  IconEye,
  IconCode,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import type { ToolCall as ToolCallType } from "@/types/acp";

// ============================================================================
// Types
// ============================================================================

interface AIPanelProps {
  connectionId?: string;
  onClose?: () => void;
  className?: string;
}

type PanelMode = "agent" | "chat";

// ============================================================================
// Main Component
// ============================================================================

export function AIPanel({ connectionId, onClose, className }: AIPanelProps) {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    streamingError,
    activeToolCalls,
    activeSession,
    availableAgents,
    isLoadingAgents,
    isWarmingUp,
    selectedAgentId,
    sendMessage,
    startSession,
    warmupAgent,
    cancelGeneration,
  } = useAcpStore();

  // Get AI context with schema data for current workspace
  const aiContext = useAIContextWithSchema();

  // Get open tabs for @ mention autocomplete
  const panelContents = useWorkbenchStore(
    (s): Map<string, PanelContent> => s.panelContents
  );
  const openTabs = useMemo(() => {
    const tabs: Array<{ id: string; name: string; type: string; panelId: string }> = [];
    panelContents.forEach((panel: PanelContent, panelId: string) => {
      panel.tabIds.forEach((tabId: string) => {
        const meta = panel.metadata?.[tabId];
        tabs.push({
          id: tabId,
          name: meta?.title ?? tabId,
          type: meta?.type ?? "unknown",
          panelId,
        });
      });
    });
    return tabs;
  }, [panelContents]);

  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PanelMode>("agent");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Pre-warm agent on mount
  useEffect(() => {
    if (!selectedAgentId || activeSession || isWarmingUp || isLoadingAgents) {
      return;
    }
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    if (agent?.installed) {
      void warmupAgent(connectionId).catch(console.error);
    }
  }, [
    selectedAgentId,
    activeSession,
    isWarmingUp,
    isLoadingAgents,
    availableAgents,
    warmupAgent,
    connectionId,
  ]);

  // Auto-scroll on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingThinking, activeToolCalls]);

  // Maintain focus after actions
  const focusInput = useCallback(() => {
    // Small delay to ensure DOM updates are complete
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Focus input on mount and when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      focusInput();
    }
  }, [isStreaming, focusInput]);

  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;

    setError(null);
    setInputValue("");
    focusInput();

    try {
      if (!activeSession && !isWarmingUp) {
        await startSession(connectionId);
      }

      // Build context JSON with connection info and schema data
      // TODO: Add @ mention parsing and detailed object info
      const contextJson = serializeAIContext(aiContext);

      await sendMessage(content, contextJson);
    } catch (err) {
      console.error("Failed to send:", err);
      setError(err instanceof Error ? err.message : "Failed to send message");
      setInputValue(content); // Restore input on error
    }
  }, [
    inputValue,
    isStreaming,
    activeSession,
    isWarmingUp,
    connectionId,
    aiContext,
    sendMessage,
    startSession,
    focusInput,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleCancel = useCallback(() => {
    void cancelGeneration();
    focusInput();
  }, [cancelGeneration, focusInput]);

  const handleClearChat = useCallback(() => {
    // TODO: Implement clear chat functionality
    focusInput();
  }, [focusInput]);

  // Derived state
  const displayError = error || streamingError;
  const installedAgents = useMemo(
    () => availableAgents.filter((a) => a.installed),
    [availableAgents],
  );
  const hasInstalledAgents = installedAgents.length > 0;
  const hasMessages = messages.length > 0 || isStreaming;
  const canSend =
    inputValue.trim().length > 0 && !isStreaming && hasInstalledAgents;

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background/95 backdrop-blur-sm",
        className,
      )}
    >
      {/* Header */}
      <PanelHeader
        mode={mode}
        onModeChange={setMode}
        onClose={onClose}
        onClear={handleClearChat}
        hasMessages={hasMessages}
      />

      {/* Error Banner */}
      {displayError && (
        <ErrorBanner
          error={displayError}
          onDismiss={() => {
            setError(null);
          }}
        />
      )}

      {/* Messages Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="flex flex-col">
          {hasMessages ? (
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              activeToolCalls={activeToolCalls}
            />
          ) : (
            <EmptyState
              isLoading={isLoadingAgents}
              isWarmingUp={isWarmingUp}
              hasInstalledAgents={hasInstalledAgents}
              mode={mode}
            />
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <InputArea
        ref={inputRef}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSend}
        onKeyDown={handleKeyDown}
        onCancel={handleCancel}
        isStreaming={isStreaming}
        isWarmingUp={isWarmingUp}
        canSend={canSend}
        disabled={!hasInstalledAgents}
        mode={mode}
        aiContext={aiContext}
        openTabs={openTabs}
      />
    </div>
  );
}

// ============================================================================
// Header Component
// ============================================================================

interface PanelHeaderProps {
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onClose?: () => void;
  onClear: () => void;
  hasMessages: boolean;
}

function PanelHeader({
  mode,
  onModeChange,
  onClose,
  onClear,
  hasMessages,
}: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1.5 bg-background/50">
      {/* Mode Toggle */}
      <div className="flex items-center rounded-md bg-muted/50 p-0.5">
        <button
          type="button"
          onClick={() => {
            onModeChange("agent");
          }}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-all",
            mode === "agent"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <IconWand className="h-3 w-3" />
          Agent
        </button>
        <button
          type="button"
          onClick={() => {
            onModeChange("chat");
          }}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-all",
            mode === "chat"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <IconMessages className="h-3 w-3" />
          Chat
        </button>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      {hasMessages && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onClear}
                className="text-muted-foreground hover:text-foreground"
              >
                <IconTrash className="h-3 w-3" />
              </Button>
            }
          />
          <TooltipContent side="bottom">Clear chat</TooltipContent>
        </Tooltip>
      )}

      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <IconX className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Error Banner
// ============================================================================

interface ErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2">
      <IconAlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
      <span className="flex-1 text-[11px] text-destructive">{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-destructive/70 hover:text-destructive"
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

// ============================================================================
// Message List
// ============================================================================

interface MessageListProps {
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    thinking?: string;
    toolCalls?: ToolCallType[];
  }>;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  activeToolCalls: ToolCallType[];
}

function MessageList({
  messages,
  isStreaming,
  streamingContent,
  streamingThinking,
  activeToolCalls,
}: MessageListProps) {
  return (
    <div className="flex flex-col">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          role={msg.role}
          content={msg.content}
          thinking={msg.thinking}
          toolCalls={msg.toolCalls}
        />
      ))}

      {/* Streaming Message */}
      {isStreaming && (
        <MessageBubble
          role="assistant"
          content={streamingContent}
          thinking={streamingThinking}
          toolCalls={activeToolCalls}
          isStreaming
        />
      )}
    </div>
  );
}

// ============================================================================
// Message Bubble
// ============================================================================

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: ToolCallType[];
  isStreaming?: boolean;
}

function MessageBubble({
  role,
  content,
  thinking,
  toolCalls,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  return (
    <div
      className={cn(
        "group px-4 py-3 transition-colors",
        isUser && "bg-primary/10",
      )}
    >
      <div className="max-w-2xl mx-auto">
        {/* Content */}
        <div className="space-y-2">
          {/* Thinking Block */}
          {thinking && (
            <ThinkingBlock
              content={thinking}
              expanded={thinkingExpanded || !!isStreaming}
              onToggle={() => {
                setThinkingExpanded(!thinkingExpanded);
              }}
            />
          )}

          {/* Tool Calls */}
          {toolCalls && toolCalls.length > 0 && (
            <ToolCallList calls={toolCalls} />
          )}

          {/* Message Content */}
          {content ? (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "prose-p:my-1.5 prose-p:leading-relaxed",
                "prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold",
                "prose-ul:my-2 prose-ol:my-2",
                "prose-li:my-0.5",
                "prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-muted",
                "prose-code:text-[13px] prose-code:font-medium",
                "prose-code:before:content-none prose-code:after:content-none",
                "text-[13px] leading-relaxed",
              )}
            >
              <Streamdown className="select-text">{content}</Streamdown>
            </div>
          ) : isStreaming &&
            !thinking &&
            (!toolCalls || toolCalls.length === 0) ? (
            <div className="flex items-center gap-2 py-1">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] text-muted-foreground">
                Thinking...
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Thinking Block
// ============================================================================

interface ThinkingBlockProps {
  content: string;
  expanded: boolean;
  onToggle: () => void;
}

function ThinkingBlock({ content, expanded, onToggle }: ThinkingBlockProps) {
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <IconBrain className="h-3.5 w-3.5" />
        <span className="font-medium">Reasoning</span>
        <span className="ml-auto">
          {expanded ? (
            <IconChevronDown className="h-3 w-3" />
          ) : (
            <IconChevronRight className="h-3 w-3" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-dashed border-muted-foreground/20 px-3 py-2">
          <p className="whitespace-pre-wrap text-[12px] text-muted-foreground leading-relaxed">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tool Call List
// ============================================================================

interface ToolCallListProps {
  calls: ToolCallType[];
}

function ToolCallList({ calls }: ToolCallListProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {calls.map((call) => (
        <ToolCallBadge key={call.id} call={call} />
      ))}
    </div>
  );
}

interface ToolCallBadgeProps {
  call: ToolCallType;
}

function ToolCallBadge({ call }: ToolCallBadgeProps) {
  const { name, status } = call;

  const Icon = useMemo(() => {
    // Determine icon based on tool name
    const lowerName = name.toLowerCase();
    if (lowerName.includes("read") || lowerName.includes("file")) {
      return IconFileText;
    }
    if (
      lowerName.includes("search") ||
      lowerName.includes("glob") ||
      lowerName.includes("grep")
    ) {
      return IconSearch;
    }
    if (
      lowerName.includes("bash") ||
      lowerName.includes("terminal") ||
      lowerName.includes("exec")
    ) {
      return IconTerminal2;
    }
    return IconWand;
  }, [name]);

  const statusIcon = useMemo(() => {
    switch (status) {
      case "pending":
        return <IconClock className="h-2.5 w-2.5 text-muted-foreground" />;
      case "running":
        return (
          <IconLoader2 className="h-2.5 w-2.5 animate-spin text-primary" />
        );
      case "completed":
        return <IconCheck className="h-2.5 w-2.5 text-green-500" />;
      case "failed":
        return <IconX className="h-2.5 w-2.5 text-destructive" />;
      default:
        return null;
    }
  }, [status]);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium",
        status === "running" && "border-primary/30 bg-primary/5",
        status === "completed" && "border-green-500/30 bg-green-500/5",
        status === "failed" && "border-destructive/30 bg-destructive/5",
        status === "pending" && "border-border bg-muted/50",
      )}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-foreground/80">{name}</span>
      {statusIcon}
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

interface EmptyStateProps {
  isLoading: boolean;
  isWarmingUp: boolean;
  hasInstalledAgents: boolean;
  mode: PanelMode;
}

function EmptyState({
  isLoading,
  isWarmingUp,
  hasInstalledAgents,
  mode,
}: EmptyStateProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-8">
        <IconLoader2 className="h-8 w-8 text-muted-foreground/40 animate-spin mb-4" />
        <p className="text-[13px] text-muted-foreground">
          Discovering AI agents...
        </p>
      </div>
    );
  }

  if (!hasInstalledAgents) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
        <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
          <IconSparkles className="h-6 w-6 text-muted-foreground/50" />
        </div>
        <h3 className="text-sm font-medium mb-1">No AI agents installed</h3>
        <p className="text-[12px] text-muted-foreground max-w-[240px] mb-4">
          Select an agent from the dropdown above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      {isWarmingUp ? (
        <>
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mb-4">
            <IconLoader2 className="h-6 w-6 text-amber-500 animate-spin" />
          </div>
          <h3 className="text-sm font-medium mb-1">Preparing agent...</h3>
          <p className="text-[12px] text-muted-foreground max-w-[240px]">
            You can start typing while the agent initializes.
          </p>
        </>
      ) : (
        <>
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mb-4">
            <IconSparkles className="h-6 w-6 text-amber-500" />
          </div>
          <h3 className="text-sm font-medium mb-1">
            {mode === "agent" ? "Agent Mode" : "Chat Mode"}
          </h3>
          <p className="text-[12px] text-muted-foreground max-w-[240px]">
            {mode === "agent"
              ? "I can help write queries, explain schemas, and analyze your database."
              : "Ask me anything about SQL, databases, or your data."}
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Input Area with @ Mention Autocomplete
// ============================================================================

interface MentionSuggestion {
  type: "table" | "view" | "function" | "tab";
  name: string;
  schema?: string;
  /** Breadcrumb like "connName › schema" or "connName › database" */
  breadcrumb: string;
  connectionId?: string;
}

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
  isStreaming: boolean;
  isWarmingUp: boolean;
  canSend: boolean;
  disabled: boolean;
  mode: PanelMode;
  aiContext: AIContext;
  openTabs: Array<{ id: string; name: string; type: string; panelId: string }>;
}

const InputArea = ({
  value,
  onChange,
  onSubmit,
  onKeyDown: parentOnKeyDown,
  onCancel,
  isStreaming,
  isWarmingUp,
  canSend,
  disabled,
  mode,
  aiContext,
  openTabs,
}: InputAreaProps & { ref?: React.Ref<HTMLTextAreaElement> }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // Build suggestions from context - ALL connections in workspace
  const suggestions = useMemo((): MentionSuggestion[] => {
    const items: MentionSuggestion[] = [];
    const filter = mentionFilter.toLowerCase();

    // Check if filtering for tabs specifically
    if (filter.startsWith("tab:")) {
      const tabFilter = filter.slice(4);
      openTabs.forEach((tab) => {
        if (tab.name.toLowerCase().includes(tabFilter)) {
          items.push({
            type: "tab",
            name: tab.name,
            breadcrumb: tab.type,
          });
        }
      });
      return items;
    }

    // Add tables, views, functions from ALL connections
    aiContext.connections.forEach((conn) => {
      conn.schemas.forEach((schema) => {
        // For DBs without schema support (MySQL, MariaDB, SQLite), show just connection name
        // For PostgreSQL, SQL Server - show connName › schema
        const hasSchemaSupport = ["PostgreSQL", "SQLServer"].includes(conn.dbType);
        const breadcrumb = hasSchemaSupport
          ? `${conn.name} › ${schema.name}`
          : conn.name;

        schema.tables.forEach((table) => {
          if (table.toLowerCase().includes(filter)) {
            items.push({
              type: "table",
              name: table,
              schema: schema.name,
              breadcrumb,
              connectionId: conn.id,
            });
          }
        });

        schema.views.forEach((view) => {
          if (view.toLowerCase().includes(filter)) {
            items.push({
              type: "view",
              name: view,
              schema: schema.name,
              breadcrumb,
              connectionId: conn.id,
            });
          }
        });

        schema.functions.forEach((func) => {
          if (func.toLowerCase().includes(filter)) {
            items.push({
              type: "function",
              name: func,
              schema: schema.name,
              breadcrumb,
              connectionId: conn.id,
            });
          }
        });
      });
    });

    // Add tabs
    openTabs.forEach((tab) => {
      if (tab.name.toLowerCase().includes(filter)) {
        items.push({
          type: "tab",
          name: tab.name,
          breadcrumb: tab.type,
        });
      }
    });

    return items.slice(0, 12); // Limit suggestions
  }, [aiContext, openTabs, mentionFilter]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [value]);

  // Forward ref behavior
  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  // Handle input change and detect @ mentions
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      onChange(newValue);

      // Check for @ mention at cursor
      const mention = getMentionAtCursor(newValue, cursorPos);
      if (mention) {
        setShowMentions(true);
        setMentionFilter(mention.prefix);
        setMentionStart(mention.start);
        setSelectedIndex(0); // Reset selection when filter changes
      } else {
        setShowMentions(false);
        setMentionFilter("");
      }
    },
    [onChange]
  );

  // Insert selected mention
  const insertMention = useCallback(
    (suggestion: MentionSuggestion) => {
      const mention = formatMention(
        suggestion.type,
        suggestion.name,
        suggestion.schema
      );
      const before = value.slice(0, mentionStart);
      const cursorPos = inputRef.current?.selectionStart ?? value.length;
      const after = value.slice(cursorPos);

      const newValue = before + mention + " " + after;
      onChange(newValue);
      setShowMentions(false);

      // Focus and set cursor position after mention
      requestAnimationFrame(() => {
        const pos = mentionStart + mention.length + 1;
        inputRef.current?.setSelectionRange(pos, pos);
        inputRef.current?.focus();
      });
    },
    [value, mentionStart, onChange]
  );

  // Handle keyboard navigation in mentions
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentions && suggestions.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
            return;
          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
            return;
          case "Enter":
          case "Tab": {
            e.preventDefault();
            const selected = suggestions[selectedIndex];
            if (selected) {
              insertMention(selected);
            }
            return;
          }
          case "Escape":
            e.preventDefault();
            setShowMentions(false);
            return;
        }
      }

      // Pass to parent handler
      parentOnKeyDown(e);
    },
    [showMentions, suggestions, selectedIndex, insertMention, parentOnKeyDown]
  );

  const placeholder = disabled
    ? "No AI agent available"
    : isWarmingUp
      ? "Agent starting... you can type now"
      : mode === "agent"
        ? "Ask the agent... use @ to mention tables"
        : "Ask a question... use @ to mention objects";

  const getMentionIcon = (type: MentionSuggestion["type"]) => {
    switch (type) {
      case "table":
        return <IconTable className="h-3.5 w-3.5 text-blue-500" />;
      case "view":
        return <IconEye className="h-3.5 w-3.5 text-purple-500" />;
      case "function":
        return <IconCode className="h-3.5 w-3.5 text-green-500" />;
      case "tab":
        return <IconFileText className="h-3.5 w-3.5 text-orange-500" />;
    }
  };

  return (
    <div className="border-t bg-background/80 backdrop-blur-sm">
      {/* Input Container */}
      <div className="p-3">
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-lg border bg-background transition-all",
            "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10",
            disabled && "opacity-50",
          )}
        >
          {/* @ Mention Autocomplete Dropdown */}
          {showMentions && suggestions.length > 0 && (
            <div
              ref={mentionListRef}
              className="absolute bottom-full left-0 mb-1 w-80 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
            >
              <div className="py-1">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.type}-${suggestion.name}-${suggestion.breadcrumb}`}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                      "hover:bg-accent transition-colors",
                      index === selectedIndex && "bg-accent"
                    )}
                    onClick={() => { insertMention(suggestion); }}
                    onMouseEnter={() => { setSelectedIndex(index); }}
                  >
                    {getMentionIcon(suggestion.type)}
                    <span className="font-medium truncate">{suggestion.name}</span>
                    <span className="flex-1" />
                    <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                      {suggestion.breadcrumb}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Textarea
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isStreaming}
            className={cn(
              "min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent",
              "px-3 py-3 text-[13px] placeholder:text-muted-foreground/60",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
            )}
            rows={1}
          />
        </div>

        {/* Footer - Agent & Model Selectors + Send/Stop */}
        <div className="flex items-center gap-2 mt-2 px-1">
          <AgentSelector />
          <ModelSelector />
          <div className="flex-1" />
          {isStreaming ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={onCancel}
              className="h-7 px-3 text-[11px] gap-1.5"
            >
              <IconPlayerStop className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={canSend ? "default" : "ghost"}
                    size="icon-sm"
                    disabled={!canSend}
                    onClick={onSubmit}
                    className={cn(
                      "transition-all",
                      canSend && "bg-primary hover:bg-primary/90",
                    )}
                  >
                    <IconSend className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="top">
                Send message{" "}
                <kbd className="ml-1 text-[10px] opacity-60">↵</kbd>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};
