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
import {
  useAIContextWithSchema,
  serializeAIContext,
  enrichMentionsFromMessage,
  findConnectionFromMentions,
} from "@/hooks/useAIContext";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  IconWand,
  IconTrash,
  IconTable,
  IconEye,
  IconCode,
  IconPlus,
  IconMessage,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import type { ToolCall as ToolCallType } from "@/types/acp";
import {
  parseCommandsProgressive,
  stripCommands,
} from "@/utils/aiCommandParser";
import { CommandList } from "./CommandCard";
import { QueryBlock } from "./QueryBlock";
import { useAiCommandPermissionStore } from "@/stores/aiCommandPermissionStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { tableStreamingService } from "@/services/tableStreamingService";

// ============================================================================
// Types
// ============================================================================

interface AIPanelProps {
  connectionId?: string;
  onClose?: () => void;
  className?: string;
}

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
    mcpAvailable,
    recentSessions,
    sendMessage,
    startSession,
    warmupAgent,
    cancelGeneration,
    newConversation,
    loadSession,
    loadRecentSessions,
    deleteSession,
  } = useAcpStore();

  // Get AI context with schema data for current workspace
  const aiContext = useAIContextWithSchema();

  // Get open tabs for @ mention autocomplete
  const panelContents = useWorkbenchStore(
    (s): Map<string, PanelContent> => s.panelContents,
  );
  const openTabs = useMemo(() => {
    const tabs: Array<{
      id: string;
      name: string;
      type: string;
      panelId: string;
    }> = [];
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Load recent sessions on mount and when connection changes
  // Sessions are filtered by connectionId for workspace-specific history
  useEffect(() => {
    void loadRecentSessions(connectionId);
  }, [loadRecentSessions, connectionId]);

  // Proactively warmup agent on mount and when switching agents
  // This creates a session immediately so sending messages is instant
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  useEffect(() => {
    // Only warmup if we have an installed agent and no active session
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    if (agent?.installed && !activeSession && !isWarmingUp) {
      void warmupAgent(connectionId);
    }
  }, [selectedAgentId, availableAgents, activeSession, isWarmingUp, warmupAgent, connectionId]);

  // Warmup when user starts typing (if no active session)
  const handleStartTyping = useCallback(() => {
    if (!activeSession && !isWarmingUp) {
      void warmupAgent(connectionId);
    }
  }, [activeSession, isWarmingUp, warmupAgent, connectionId]);

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

      // Enrich @ mentions with full table details (columns, etc.)
      const enrichedMentions = await enrichMentionsFromMessage(
        content,
        aiContext,
      );

      // Build context with enriched mentions
      const contextWithMentions = {
        ...aiContext,
        mentions: enrichedMentions,
      };
      const contextJson = serializeAIContext(contextWithMentions);

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

  // Permission store for command approval
  const resetPermissions = useAiCommandPermissionStore((s) => s.reset);

  const handleNewConversation = useCallback(() => {
    newConversation();
    resetPermissions();
    focusInput();
  }, [newConversation, resetPermissions, focusInput]);

  const handleLoadSession = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId);
    },
    [loadSession],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId);
    },
    [deleteSession],
  );

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
      data-slot="ai-panel"
      className={cn(
        "flex flex-col h-full min-h-0 bg-background overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <PanelHeader
        onClose={onClose}
        onNewConversation={handleNewConversation}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
        activeSession={activeSession}
        recentSessions={recentSessions}
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

      {/* MCP Warning Banner */}
      {!mcpAvailable && activeSession && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Database tools unavailable. Build MCP sidecar:{" "}
            <code className="bg-muted px-1 rounded">
              cargo build -p querypilot-mcp
            </code>
          </span>
        </div>
      )}

      {/* Messages Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        <div className="flex flex-col min-h-full">
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
              hasInstalledAgents={hasInstalledAgents}
              onExampleClick={(prompt) => {
                setInputValue(prompt);
                inputRef.current?.focus();
              }}
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
        onStartTyping={handleStartTyping}
        isStreaming={isStreaming}
        isWarmingUp={isWarmingUp}
        canSend={canSend}
        disabled={!hasInstalledAgents}
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
  onClose?: () => void;
  onNewConversation: () => void;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  activeSession: { id: string; title: string } | null;
  recentSessions: Array<{
    id: string;
    title: string;
    updatedAt: number;
    agentId: string;
  }>;
}

function PanelHeader({
  onClose,
  onNewConversation,
  onLoadSession,
  onDeleteSession,
  activeSession,
  recentSessions,
}: PanelHeaderProps) {
  // Filter out current session from history
  const otherSessions = recentSessions.filter(
    (s) => s.id !== activeSession?.id,
  );

  return (
    <div className="flex items-center gap-1 border-b px-3 py-2 bg-background/50">
      {/* Session History Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-md hover:bg-accent transition-colors"
            >
              <IconSparkles className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-medium truncate max-w-[160px]">
                {activeSession?.title ?? "AI Assistant"}
              </span>
              <IconChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        />
        <DropdownMenuContent align="start" className="w-64">
          {/* New Conversation */}
          <DropdownMenuItem onClick={onNewConversation} className="gap-2">
            <IconPlus className="h-4 w-4" />
            <span className="text-[12px]">New conversation</span>
          </DropdownMenuItem>

          {/* Recent Sessions */}
          {otherSessions.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                  Recent
                </DropdownMenuLabel>
                {otherSessions.slice(0, 10).map((session) => (
                  <DropdownMenuItem
                    key={session.id}
                    onClick={() => {
                      onLoadSession(session.id);
                    }}
                    className="group gap-2 pr-1"
                  >
                    <IconMessage className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate">
                        {session.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(session.updatedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onDeleteSession(session.id);
                      }}
                      onPointerDown={(e) => {
                        // Prevent DropdownMenuItem from handling this click
                        e.stopPropagation();
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <IconTrash className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* New conversation shortcut */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onNewConversation}
              className="text-muted-foreground hover:text-foreground"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <TooltipContent side="bottom">New conversation</TooltipContent>
      </Tooltip>

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

/** Format timestamp as relative time (e.g., "2 hours ago") */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
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

// SQL-like languages that should render as QueryBlock
const QUERY_LANGUAGES = new Set([
  "sql",
  "postgresql",
  "postgres",
  "pgsql",
  "mysql",
  "sqlite",
  "mssql",
  "tsql",
  "plpgsql",
  "mongodb",
  "mongo",
  "redis",
]);

function MessageBubble({
  role,
  content,
  thinking,
  toolCalls,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  // Get AI context for resolving @ mentions to connections
  const aiContext = useAIContextWithSchema();

  // Get focused connection as fallback for QueryBlock context
  const getFocusedConnection = useWorkspaceBundleStore(
    (s) => s.getFocusedConnection,
  );
  const focusedConnection = getFocusedConnection();

  // Resolve connection from @ mentions in the message content
  // Falls back to focused connection if no mention is found
  const resolvedConnection = useMemo(() => {
    if (isUser || !content) {
      return focusedConnection
        ? { id: focusedConnection.id, name: focusedConnection.profile.name }
        : null;
    }

    // Try to find connection from @ mentions in the assistant's message
    const mentionMatch = findConnectionFromMentions(content, aiContext);
    if (mentionMatch) {
      return {
        id: mentionMatch.connectionId,
        name: mentionMatch.connectionName,
      };
    }

    // Fall back to focused connection
    return focusedConnection
      ? { id: focusedConnection.id, name: focusedConnection.profile.name }
      : null;
  }, [content, isUser, aiContext, focusedConnection]);

  // Parse commands from assistant messages
  const parsedCommands = useMemo(() => {
    if (isUser || !content) return { complete: [], incomplete: false };
    return parseCommandsProgressive(content);
  }, [content, isUser]);

  // Strip commands from content for display
  const displayContent = useMemo(() => {
    if (isUser || !content) return content;
    return stripCommands(content);
  }, [content, isUser]);

  // Handle query execution from QueryBlock
  const handleQueryRun = useCallback(
    async (query: string, connectionId: string) => {
      console.log("[QueryBlock] handleQueryRun called", {
        query: query.slice(0, 50),
        connectionId,
      });
      try {
        const store = useWorkspaceScreenStore.getState();

        // Set active connection and ensure workspace is initialized
        console.log(
          "[QueryBlock] Current activeConnectionId:",
          store.activeConnectionId,
        );
        let activeConnectionId = store.activeConnectionId;
        if (!activeConnectionId || activeConnectionId !== connectionId) {
          console.log("[QueryBlock] Switching connection to:", connectionId);
          store.setActiveConnection(connectionId);
          activeConnectionId = connectionId;
        }

        if (!store.workspaces.has(activeConnectionId)) {
          console.log(
            "[QueryBlock] Initializing workspace for:",
            activeConnectionId,
          );
          store.initWorkspace(activeConnectionId);
        }

        const panelId = store.getActivePanelId();
        console.log("[QueryBlock] Active panel ID:", panelId);
        if (!panelId) {
          console.error("[QueryBlock] No panel found for query execution");
          return;
        }

        // Generate tab title from query
        const cleanedQuery = query.trim();
        const tabTitle =
          cleanedQuery.slice(0, 30) + (cleanedQuery.length > 30 ? "..." : "");

        // Create the tab with the query content
        console.log("[QueryBlock] Creating tab in panel:", panelId);
        const tabId = store.addTab(panelId, {
          type: "query",
          connectionId,
          title: tabTitle,
          payload: { sql: cleanedQuery },
        });

        console.log("[QueryBlock] Tab created:", tabId);
        if (!tabId) {
          console.error("[QueryBlock] Failed to create tab");
          return;
        }

        // Focus the panel and tab to make sure they're visible
        store.setActivePanel(panelId);
        store.setActiveTab(panelId, tabId);

        // Execute the query using streaming service
        const queryToExecute = cleanedQuery.replace(/;\s*$/, "");
        console.log(
          "[QueryBlock] Executing query:",
          queryToExecute.slice(0, 50),
        );
        await tableStreamingService.streamQuery(
          connectionId,
          tabId,
          queryToExecute,
          2500, // pageSize
          () => {}, // Progress callback
          (error) => {
            console.error("[QueryBlock] Query execution error:", error);
          },
        );
        console.log("[QueryBlock] Query execution complete");
      } catch (err) {
        console.error("[QueryBlock] Failed to execute query:", err);
      }
    },
    [],
  );

  // Custom Streamdown components to render QueryBlock for SQL code blocks
  const streamdownComponents = useMemo(
    () => ({
      // Override the pre element to detect SQL code blocks
      pre: ({
        children,
        ...props
      }: React.HTMLAttributes<HTMLPreElement> & {
        children?: React.ReactNode;
      }) => {
        // Check if this pre contains a code element with a query language
        // Streamdown renders code blocks as: <pre><code className="language-xxx">...</code></pre>
        if (children && typeof children === "object" && "props" in children) {
          const codeProps = children.props as {
            className?: string;
            children?: React.ReactNode;
          };
          const className = codeProps.className ?? "";

          // Extract language from className (e.g., "language-sql" -> "sql")
          const langMatch = className.match(/language-(\w+)/);
          const language = langMatch?.[1]?.toLowerCase() ?? "";

          // If it's a query language, render as QueryBlock
          if (QUERY_LANGUAGES.has(language)) {
            // Extract the code content - handle string, array, or other React children
            let codeContent = "";
            const childContent = codeProps.children;
            if (typeof childContent === "string") {
              codeContent = childContent;
            } else if (typeof childContent === "number") {
              codeContent = childContent.toString();
            } else if (Array.isArray(childContent)) {
              // Join array elements, filtering to strings/numbers
              codeContent = childContent
                .filter(
                  (c): c is string | number =>
                    typeof c === "string" || typeof c === "number",
                )
                .map((c) => (typeof c === "number" ? c.toString() : c))
                .join("");
            }

            return (
              <QueryBlock
                query={codeContent}
                language={language}
                connectionId={resolvedConnection?.id}
                connectionName={resolvedConnection?.name}
                onRun={handleQueryRun}
              />
            );
          }
        }

        // For non-query code blocks, render the default pre
        return <pre {...props}>{children}</pre>;
      },
    }),
    [resolvedConnection, handleQueryRun],
  );

  return (
    <div
      className={cn(
        "group px-3 py-3 transition-colors",
        isUser && "bg-primary/5 border-l-3 border-primary",
      )}
    >
      <div className="max-w-full mx-auto">
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
          {displayContent ? (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "prose-p:my-1 prose-p:leading-normal",
                "prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:text-sm",
                "prose-ul:my-1.5 prose-ol:my-1.5",
                "prose-li:my-0",
                "prose-pre:my-1.5 prose-pre:p-2 prose-pre:rounded-md prose-pre:bg-muted prose-pre:text-[11px] prose-pre:leading-tight",
                "prose-code:text-[11px] prose-code:font-medium prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted",
                "prose-code:before:content-none prose-code:after:content-none",
                "text-[12px] leading-normal",
              )}
            >
              <Streamdown
                className="select-text"
                components={streamdownComponents}
              >
                {displayContent}
              </Streamdown>
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

          {/* AI Commands */}
          {!isUser && parsedCommands.complete.length > 0 && (
            <CommandList commands={parsedCommands.complete} />
          )}

          {/* Incomplete command indicator */}
          {!isUser && parsedCommands.incomplete && isStreaming && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <IconLoader2 className="h-3 w-3 animate-spin" />
              <span>Command loading...</span>
            </div>
          )}
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
          <p className="whitespace-pre-wrap text-[12px] text-muted-foreground leading-relaxed select-text">
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
  hasInstalledAgents: boolean;
  onExampleClick?: (prompt: string) => void;
}

function EmptyState({
  isLoading,
  hasInstalledAgents,
  onExampleClick,
}: EmptyStateProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] py-16 px-8">
        <IconLoader2 className="h-8 w-8 text-muted-foreground/40 animate-spin mb-4" />
        <p className="text-[13px] text-muted-foreground">
          Discovering AI agents...
        </p>
      </div>
    );
  }

  if (!hasInstalledAgents) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] py-16 px-8 text-center">
        <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
          <IconSparkles className="h-6 w-6 text-muted-foreground/50" />
        </div>
        <h3 className="text-sm font-medium mb-1">No AI agents installed</h3>
        <p className="text-[12px] text-muted-foreground max-w-[240px] mb-4">
          Select an agent below to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] py-12 px-8 text-center">
      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-4">
        <IconSparkles className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-sm font-medium mb-2">How can I help?</h3>
      <p className="text-[12px] text-muted-foreground max-w-[260px] mb-6">
        I can write queries, explain schemas, optimize SQL, and help you
        understand your data.
      </p>

      {/* Example prompts */}
      <div className="w-full max-w-[280px] space-y-2">
        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium mb-2">
          Try asking
        </p>
        {[
          "Show me the largest tables",
          "Write a query to find duplicates",
          "Explain the schema for @users",
        ].map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onExampleClick?.(prompt)}
            className="w-full text-left px-3 py-2 rounded-md border border-dashed border-border/60 text-[11px] text-muted-foreground hover:border-primary/40 hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
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
  onStartTyping: () => void;
  isStreaming: boolean;
  isWarmingUp: boolean;
  canSend: boolean;
  disabled: boolean;
  aiContext: AIContext;
  openTabs: Array<{ id: string; name: string; type: string; panelId: string }>;
}

const InputArea = ({
  value,
  onChange,
  onSubmit,
  onKeyDown: parentOnKeyDown,
  onCancel,
  onStartTyping,
  isStreaming,
  isWarmingUp,
  canSend,
  disabled,
  aiContext,
  openTabs,
}: InputAreaProps & { ref?: React.Ref<HTMLTextAreaElement> }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
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
        const hasSchemaSupport = ["PostgreSQL", "SQLServer"].includes(
          conn.dbType,
        );
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

      // Trigger warmup when user starts typing (empty -> non-empty)
      if (value.length === 0 && newValue.length > 0) {
        onStartTyping();
      }

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
    [value, onChange, onStartTyping],
  );

  // Insert selected mention
  const insertMention = useCallback(
    (suggestion: MentionSuggestion) => {
      const mention = formatMention(
        suggestion.type,
        suggestion.name,
        suggestion.schema,
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
    [value, mentionStart, onChange],
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
    [showMentions, suggestions, selectedIndex, insertMention, parentOnKeyDown],
  );

  const placeholder = disabled
    ? "No AI agent available"
    : isWarmingUp
      ? "Starting agent... you can type now"
      : "Ask anything... use @ to mention tables";

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
    <div className="p-1.5">
      {/* Unified Input Container */}
      <div
        className={cn(
          "relative rounded-xl border-2 bg-background transition-all duration-200",
          isFocused
            ? "border-primary shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.1)]"
            : "border-border hover:border-border/80",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {/* @ Mention Autocomplete Dropdown */}
        {showMentions && suggestions.length > 0 && (
          <div
            ref={mentionListRef}
            className="absolute bottom-full left-0 mb-2 w-80 max-h-64 overflow-y-auto rounded-xl border-2 border-border bg-popover shadow-lg z-50"
          >
            <div className="p-1">
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.type}-${suggestion.name}-${suggestion.breadcrumb}`}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] rounded-lg",
                    "transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => {
                    insertMention(suggestion);
                  }}
                  onMouseEnter={() => {
                    setSelectedIndex(index);
                  }}
                >
                  {getMentionIcon(suggestion.type)}
                  <span className="font-medium truncate">
                    {suggestion.name}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {suggestion.breadcrumb}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Textarea */}
        <Textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          placeholder={placeholder}
          disabled={disabled || isStreaming}
          className={cn(
            "min-h-[48px] max-h-[160px] w-full resize-none border-0 bg-transparent",
            "px-4 pt-3 pb-2 text-[13px] placeholder:text-muted-foreground/50",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
          rows={1}
        />

        {/* Footer inside the input container */}
        <div className="flex items-center gap-1 px-2 pb-2">
          <AgentSelector />
          <ModelSelector />
          <div className="flex-1" />

          {/* Keyboard hint */}
          {!isStreaming && canSend && (
            <span className="text-[10px] text-muted-foreground/50 mr-2 hidden sm:inline">
              ↵ to send
            </span>
          )}

          {isStreaming ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-8 px-3 text-[11px] gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <IconPlayerStop className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              variant={canSend ? "default" : "ghost"}
              size="icon"
              disabled={!canSend}
              onClick={onSubmit}
              className={cn(
                "h-8 w-8 rounded-lg transition-all",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              <IconSend className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
