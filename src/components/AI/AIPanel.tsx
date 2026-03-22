/**
 * AI Panel Component
 *
 * Refined chat panel for AI agents with Cursor-like UX.
 * Features: persistent input focus, mode toggle, model selection, smooth streaming.
 */

import {
  Fragment,
  useCallback,
  useState,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useAcpStore } from "@/stores/acpStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  useAIContextWithSchema,
  serializeAIContext,
  enrichMentionsFromMessage,
  findConnectionFromMentions,
} from "@/hooks/useAIContext";
import { LexicalInput, type LexicalInputHandle } from "./mention";
import type { AIContext } from "@/types/aiContext";
import { AgentSelector } from "./AgentSelector";
import { CompactModelPicker } from "./CompactModelPicker";
import { ModelSelector } from "./ModelSelector";
import { ImagePreviewPopover } from "./ImagePreviewPopover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  IconFileText,
  IconCheck,
  IconClock,
  IconWand,
  IconTrash,
  IconTable,
  IconEye,
  IconPlus,
  IconMessage,
  IconArrowDown,
  IconPhoto,
  IconCopy,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { writeClipboardText } from "@/lib/clipboard";
import { Streamdown } from "streamdown";
import type { ToolCall as ToolCallType } from "@/types/acp";
import { parseCommandsProgressive } from "@/utils/aiCommandParser";
import { parseMentions, stripMentionIds } from "@/utils/mentionParser";
import { CommandList } from "./CommandCard";
import { QueryBlock } from "./QueryBlock";
import { buildFallbackQueryRunCommands } from "./sqlFallbackActions";
import { useAiCommandPermissionStore } from "@/stores/aiCommandPermissionStore";
import { useByokStore } from "@/stores/byokStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { executeCommand } from "@/services/aiCommandExecutor";

import { eventBus, type AIGenerateSqlPayload } from "@/services/eventBus";
import type {
  ParsedCommand,
  QueryRunParams,
  QueryRunResult,
} from "@/types/aiCommands";
import type {
  AssistantFlowSegment,
  AssistantBlockV2,
  AcpMessage,
  ContentBlock,
  QueuedMessage,
} from "@/types/acp";
import {
  type PreparedImage,
  resizeImage,
  validateImageFile,
  extractImagesFromPaste,
  extractImagesFromDrop,
  revokeImagePreviews,
  MAX_IMAGES,
} from "@/utils/imageUtils";
import {
  isReadOnlyStatement,
  buildCorrectionPrompt,
  MAX_CORRECTION_ATTEMPTS,
} from "@/utils/selfCorrection";
import {
  getFocusedTabContextSnapshot,
  type FocusedTabContextSnapshot,
} from "@/services/focusedTabContext";

// ============================================================================
// Types
// ============================================================================

interface AIPanelProps {
  connectionId?: string;
  onClose?: () => void;
  className?: string;
}

const INTERNAL_EXECUTION_FEEDBACK_PREFIX = "[[QP_INTERNAL_EXECUTION_FEEDBACK]]";

function isInternalExecutionFeedback(content: string): boolean {
  return content.trimStart().startsWith(INTERNAL_EXECUTION_FEEDBACK_PREFIX);
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
    streamingFlow,
    streamingPlan,
    currentMode,
    availableSessionCommands,
    activeSession,
    availableAgents,
    isLoadingAgents,
    isWarmingUp,
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

  const messageQueue = useAcpStore((s) => s.messageQueue);
  const queuePaused = useAcpStore((s) => s.queuePaused);
  const dequeueMessage = useAcpStore((s) => s.dequeueMessage);
  const popQueueToInput = useAcpStore((s) => s.popQueueToInput);
  const resumeQueue = useAcpStore((s) => s.resumeQueue);

  // Get AI context with schema data for current workspace
  const aiContext = useAIContextWithSchema();

  // Get open tabs for @ mention autocomplete
  const openTabFingerprints = useWorkbenchStore(
    useShallow((state) => {
      const fingerprints: string[] = [];
      state.panelContents.forEach((panel, panelId) => {
        panel.tabIds.forEach((tabId) => {
          const metadata = panel.metadata?.[tabId];
          fingerprints.push(
            [
              tabId,
              metadata?.title ?? tabId,
              metadata?.type ?? "unknown",
              panelId,
              metadata?.connectionId ?? "",
            ].join("\u0000"),
          );
        });
      });
      return fingerprints;
    }),
  );
  const connections = useConnectionStore((s) => s.connections);
  const openTabs = useMemo(() => {
    return openTabFingerprints.map((fingerprint) => {
      const [
        id = "",
        name = "",
        type = "unknown",
        panelId = "",
        connectionId = "",
      ] = fingerprint.split("\u0000");
      const connection = connectionId
        ? connections.find((item) => item.profile.id === connectionId)
        : undefined;

      return {
        id,
        name,
        type,
        panelId,
        connectionId: connectionId || undefined,
        connectionName: connection?.profile.name,
      };
    });
  }, [openTabFingerprints, connections]);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attachedContext, setAttachedContext] =
    useState<FocusedTabContextSnapshot | null>(null);
  const inputRef = useRef<LexicalInputHandle>(null);
  const [pendingImages, setPendingImages] = useState<PreparedImage[]>([]);

  // Consume pending prompt from external triggers (e.g. "Fix with AI")
  const pendingPrompt = useAcpStore((s) => s.pendingPrompt);
  useEffect(() => {
    if (pendingPrompt) {
      setInputValue(pendingPrompt);
      inputRef.current?.setText(pendingPrompt);
      useAcpStore.setState({ pendingPrompt: null });
      // Auto-attach the focused tab so the agent gets full context
      const snapshot = getFocusedTabContextSnapshot();
      if (snapshot) {
        setAttachedContext(snapshot);
      }
      // Focus input after a tick so Lexical can settle
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [pendingPrompt]);

  const handleAddImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (pendingImages.length >= MAX_IMAGES) {
          setError(`Maximum ${MAX_IMAGES} images per message.`);
          break;
        }
        const validationError = validateImageFile(file);
        if (validationError) {
          setError(validationError);
          continue;
        }
        try {
          const prepared = await resizeImage(file);
          setPendingImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev;
            return [...prev, prepared];
          });
        } catch {
          setError("Failed to process image.");
        }
      }
    },
    [pendingImages.length],
  );

  const handleRemoveImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Load recent sessions on mount and when connection changes
  // Sessions are filtered by connectionId for workspace-specific history
  useEffect(() => {
    void loadRecentSessions(connectionId);
  }, [loadRecentSessions, connectionId]);

  // Proactively warmup agent on mount and when switching agents
  // This creates a session immediately so sending messages is instant
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const runtimeMode = useByokStore((s) => s.runtimeMode);
  const byokMessages = useByokStore((s) => s.messages);
  const byokIsStreaming = useByokStore((s) => s.isStreaming);
  const byokStreamingContent = useByokStore((s) => s.streamingContent);
  const byokError = useByokStore((s) => s.error);
  const byokSession = useByokStore((s) => s.session);
  const byokActiveToolCalls = useByokStore((s) => s.activeToolCalls);
  const byokSendMessage = useByokStore((s) => s.sendMessage);
  const byokCancelGeneration = useByokStore((s) => s.cancelGeneration);
  const byokClearHistory = useByokStore((s) => s.clearHistory);
  const isByok = runtimeMode === "byok";
  const effectiveIsStreaming = isByok ? byokIsStreaming : isStreaming;

  useEffect(() => {
    if (isByok) return; // BYOK doesn't need warmup
    // Only warmup if we have an installed agent and no active session
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    if (agent?.installed && !activeSession && !isWarmingUp) {
      void warmupAgent(connectionId);
    }
  }, [
    isByok,
    selectedAgentId,
    availableAgents,
    activeSession,
    isWarmingUp,
    warmupAgent,
    connectionId,
  ]);

  // Warmup when user starts typing (if no active session)
  const handleStartTyping = useCallback(() => {
    if (isByok) return;
    if (!activeSession && !isWarmingUp) {
      void warmupAgent(connectionId);
    }
  }, [isByok, activeSession, isWarmingUp, warmupAgent, connectionId]);

  const getScrollViewport = useCallback((): HTMLDivElement | null => {
    const root = scrollAreaRef.current;
    if (!root) return null;
    const viewport = root.querySelector('[data-slot="scroll-area-viewport"]');
    return viewport instanceof HTMLDivElement ? viewport : null;
  }, []);

  const scrollViewportToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const viewport = getScrollViewport();
      if (!viewport) return;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    },
    [getScrollViewport],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      scrollViewportToBottom(behavior);
      setStickToBottom(true);
      setShowJumpToLatest(false);
    },
    [scrollViewportToBottom],
  );

  // Track whether user is reading older content; only autoscroll when near bottom.
  useEffect(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nearBottom = distanceFromBottom <= 80;
      setStickToBottom(nearBottom);
      setShowJumpToLatest(!nearBottom);
    };

    handleScroll();
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [
    getScrollViewport,
    messages.length,
    byokMessages.length,
    effectiveIsStreaming,
  ]);

  useEffect(() => {
    if (!stickToBottom) return;
    scrollViewportToBottom(effectiveIsStreaming ? "auto" : "smooth");
  }, [
    messages,
    byokMessages,
    streamingContent,
    byokStreamingContent,
    streamingThinking,
    activeToolCalls,
    byokActiveToolCalls,
    stickToBottom,
    effectiveIsStreaming,
    scrollViewportToBottom,
  ]);

  // Maintain focus after actions (retries if ref not yet mounted)
  const focusInput = useCallback(() => {
    const tryFocus = (attempts: number) => {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        } else if (attempts > 0) {
          tryFocus(attempts - 1);
        }
      });
    };
    tryFocus(10);
  }, []);

  useEffect(() => {
    const handleGenerateSql = (payload: AIGenerateSqlPayload) => {
      const seedLines = [
        "Generate a SQL query for this request:",
        payload.connectionId ? `Connection: ${payload.connectionId}` : null,
        payload.database ? `Database: ${payload.database}` : null,
        payload.schema ? `Schema: ${payload.schema}` : null,
        "- Goal:",
      ].filter((line): line is string => Boolean(line));

      setInputValue((current) =>
        current.trim() ? current : seedLines.join("\n"),
      );
      focusInput();
    };

    eventBus.on("ai:generate-sql", handleGenerateSql);
    return () => {
      eventBus.off("ai:generate-sql", handleGenerateSql);
    };
  }, [focusInput]);

  useEffect(() => {
    const handleOpenWithContext = () => {
      const snapshot = getFocusedTabContextSnapshot();
      setAttachedContext(snapshot);
      focusInput();
    };

    eventBus.on("ai:open-with-context", handleOpenWithContext);
    return () => {
      eventBus.off("ai:open-with-context", handleOpenWithContext);
    };
  }, [focusInput]);

  // Focus input on mount and when streaming ends
  useEffect(() => {
    if (!effectiveIsStreaming) {
      focusInput();
    }
  }, [effectiveIsStreaming, focusInput]);

  const buildContextJsonWithAttachment = useCallback(
    (context: AIContext): string => {
      const serialized = serializeAIContext(context);
      if (!attachedContext) {
        return serialized;
      }

      try {
        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        parsed.focusedTabAttachment = attachedContext;
        return JSON.stringify(parsed, null, 2);
      } catch {
        return serialized;
      }
    },
    [attachedContext],
  );

  const autoFeedbackDepthRef = useRef(0);
  const sentAutoFeedbackSignaturesRef = useRef<Set<string>>(new Set());
  const autoFeedbackInFlightRef = useRef(false);

  const buildByokRuntimeContext = useCallback(() => {
    const focusedConn = useWorkspaceBundleStore
      .getState()
      .getFocusedConnection();
    const focusedSnapshot = getFocusedTabContextSnapshot();

    const toolContext = {
      connectionId: focusedSnapshot?.connectionId ?? focusedConn?.id ?? "",
      getEditorContext: () => ({
        connectionId: focusedSnapshot?.connectionId ?? focusedConn?.id ?? null,
        database:
          focusedSnapshot?.database ?? focusedConn?.profile.database ?? null,
        schema: focusedSnapshot?.schema ?? null,
        editorContent:
          focusedSnapshot?.editor.selection ??
          focusedSnapshot?.editor.fullText ??
          null,
      }),
    };

    const schemaJson = buildContextJsonWithAttachment(aiContext);
    const schemaContext = {
      databaseType: focusedConn?.profile.db_type,
      schemaJson,
    };

    return { toolContext, schemaContext };
  }, [aiContext, buildContextJsonWithAttachment]);

  const handleAutoQueryBatchResult = useCallback(
    async (batchResult: string) => {
      if (!batchResult || !/\bquery\.run\b/.test(batchResult)) return;
      if (isByok && !byokSession) return;
      if (autoFeedbackInFlightRef.current) return;
      if (autoFeedbackDepthRef.current >= 2) return;

      const signature = hashString(batchResult);
      if (sentAutoFeedbackSignaturesRef.current.has(signature)) return;
      sentAutoFeedbackSignaturesRef.current.add(signature);

      const internalPrompt = `${INTERNAL_EXECUTION_FEEDBACK_PREFIX}
Use the execution results below to continue answering the user's latest request.
- If evidence is sufficient, provide the final report now.
- If more data is required, emit additional query.run actions only.
- Do not output raw standalone SQL text.
- Do not use filesystem/code-editing tools (Read/Write/Edit/Grep/Glob).

${batchResult}`;

      autoFeedbackInFlightRef.current = true;
      autoFeedbackDepthRef.current += 1;

      try {
        if (isByok) {
          if (!byokSession) return;
          const { toolContext, schemaContext } = buildByokRuntimeContext();
          await byokSendMessage(internalPrompt, toolContext, schemaContext);
          return;
        }

        if (!activeSession && !isWarmingUp) {
          await startSession(connectionId);
        }

        const contextJson = buildContextJsonWithAttachment(aiContext);
        await sendMessage(internalPrompt, contextJson);
      } catch (err) {
        sentAutoFeedbackSignaturesRef.current.delete(signature);
        autoFeedbackDepthRef.current = Math.max(
          0,
          autoFeedbackDepthRef.current - 1,
        );
        console.error("Failed to send auto execution feedback:", err);
      } finally {
        autoFeedbackInFlightRef.current = false;
      }
    },
    [
      isByok,
      byokSession,
      byokSendMessage,
      buildByokRuntimeContext,
      activeSession,
      isWarmingUp,
      startSession,
      connectionId,
      buildContextJsonWithAttachment,
      aiContext,
      sendMessage,
    ],
  );

  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content) return;

    autoFeedbackDepthRef.current = 0;
    sentAutoFeedbackSignaturesRef.current.clear();
    autoFeedbackInFlightRef.current = false;

    setError(null);
    setInputValue("");
    inputRef.current?.clear();

    // Capture and clear pending images
    const imagesToSend = pendingImages.map((img) => ({
      data: img.data,
      mimeType: img.mimeType,
    }));
    revokeImagePreviews(pendingImages);
    setPendingImages([]);

    focusInput();
    scrollToBottom("auto");

    try {
      if (isByok) {
        // BYOK path: route through AI SDK
        if (!byokSession) {
          setError("Configure and connect a provider first.");
          setInputValue(content);
          inputRef.current?.setText(content);
          return;
        }
        const { toolContext, schemaContext } = buildByokRuntimeContext();

        await byokSendMessage(content, toolContext, schemaContext);
        return;
      }

      // Existing ACP flow
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
      const contextJson = buildContextJsonWithAttachment(contextWithMentions);

      await sendMessage(
        content,
        contextJson,
        imagesToSend.length > 0 ? imagesToSend : undefined,
      );
    } catch (err) {
      console.error("Failed to send:", err);
      setError(err instanceof Error ? err.message : "Failed to send message");
      setInputValue(content); // Restore input on error
      inputRef.current?.setText(content);
    }
  }, [
    inputValue,
    isByok,
    byokSession,
    byokSendMessage,
    pendingImages,
    activeSession,
    isWarmingUp,
    connectionId,
    aiContext,
    buildContextJsonWithAttachment,
    buildByokRuntimeContext,
    sendMessage,
    startSession,
    focusInput,
    scrollToBottom,
  ]);

  // Self-correction: track attempts per query to avoid infinite loops
  const correctionAttemptsRef = useRef<Map<string, number>>(new Map());
  const [correctingQuery, setCorrectingQuery] = useState<string | null>(null);

  const handleQueryError = useCallback(
    async (query: string, errorMessage: string) => {
      // Safety gate: only auto-correct read-only statements
      if (!isReadOnlyStatement(query)) return;

      const attempts = correctionAttemptsRef.current.get(query) ?? 0;
      if (attempts >= MAX_CORRECTION_ATTEMPTS) return;

      const nextAttempt = attempts + 1;
      correctionAttemptsRef.current.set(query, nextAttempt);
      setCorrectingQuery(query);

      const correctionPrompt = buildCorrectionPrompt(
        query,
        errorMessage,
        nextAttempt,
      );

      try {
        if (!activeSession && !isWarmingUp) {
          await startSession(connectionId);
        }

        const contextJson = serializeAIContext(aiContext);
        await sendMessage(correctionPrompt, contextJson);
      } catch (err) {
        console.error("Failed to send correction prompt:", err);
      } finally {
        setCorrectingQuery(null);
      }
    },
    [
      activeSession,
      isWarmingUp,
      connectionId,
      aiContext,
      sendMessage,
      startSession,
    ],
  );

  const handleCancel = useCallback(() => {
    if (isByok) {
      byokCancelGeneration();
    } else {
      void cancelGeneration();
    }
    focusInput();
  }, [isByok, byokCancelGeneration, cancelGeneration, focusInput]);

  const handlePopQueueToInput = useCallback(
    (id: string) => {
      const item = popQueueToInput(id);
      if (item) {
        setInputValue(item.content);
        inputRef.current?.setText(item.content);
        if (item.images && item.images.length > 0) {
          setPendingImages(
            item.images.map((img) => {
              const binary = atob(img.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++)
                bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: img.mimeType });
              return {
                id: crypto.randomUUID(),
                data: img.data,
                mimeType: img.mimeType,
                previewUrl: URL.createObjectURL(blob),
              };
            }),
          );
        }
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      }
    },
    [popQueueToInput, setInputValue, setPendingImages],
  );

  // Permission store for command approval
  const resetPermissions = useAiCommandPermissionStore((s) => s.reset);

  const handleNewConversation = useCallback(() => {
    if (isByok) {
      byokClearHistory();
    } else {
      newConversation();
      resetPermissions();
    }
    autoFeedbackDepthRef.current = 0;
    sentAutoFeedbackSignaturesRef.current.clear();
    autoFeedbackInFlightRef.current = false;
    setAttachedContext(null);
    focusInput();
    scrollToBottom("auto");
  }, [
    isByok,
    byokClearHistory,
    newConversation,
    resetPermissions,
    setAttachedContext,
    focusInput,
    scrollToBottom,
  ]);

  const handleLoadSession = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId);
      scrollToBottom("auto");
    },
    [loadSession, scrollToBottom],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId);
    },
    [deleteSession],
  );

  // Derived state
  const displayError = error || (isByok ? byokError : streamingError);
  const installedAgents = useMemo(
    () => availableAgents.filter((a) => a.installed),
    [availableAgents],
  );
  const hasInstalledAgents = installedAgents.length > 0;
  const hasMessages = isByok
    ? byokMessages.length > 0 || byokIsStreaming
    : messages.length > 0 || isStreaming;
  const canSend =
    (inputValue.trim().length > 0 || pendingImages.length > 0) &&
    (hasInstalledAgents || (isByok && byokSession !== null));

  return (
    <div
      data-slot="ai-panel"
      className={cn(
        "relative flex flex-col h-full min-h-0 bg-background overflow-hidden rounded-xl",
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
        currentMode={currentMode}
        availableCommandCount={availableSessionCommands.length}
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
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        <div className="flex flex-col min-h-full">
          {isByok ? (
            <ByokMessageList
              messages={byokMessages}
              isStreaming={byokIsStreaming}
              streamingContent={byokStreamingContent}
              activeToolCalls={byokActiveToolCalls}
              onCommandBatchResult={handleAutoQueryBatchResult}
            />
          ) : hasMessages ? (
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              activeToolCalls={activeToolCalls}
              streamingFlow={streamingFlow}
              streamingPlan={streamingPlan}
              onQueryError={handleQueryError}
              correctingQuery={correctingQuery}
              onCommandBatchResult={handleAutoQueryBatchResult}
            />
          ) : (
            <EmptyState
              isLoading={isLoadingAgents}
              hasInstalledAgents={hasInstalledAgents}
              onExampleClick={(prompt) => {
                setInputValue(prompt);
                inputRef.current?.setText(prompt);
                inputRef.current?.focus();
              }}
            />
          )}
          <div className="h-4" />
        </div>
      </ScrollArea>

      {showJumpToLatest && hasMessages && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="pointer-events-auto h-7 gap-1.5 text-[11px]"
            onClick={() => {
              scrollToBottom("smooth");
            }}
          >
            <IconArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </Button>
        </div>
      )}

      <MessageQueue
        queue={messageQueue}
        paused={queuePaused}
        onRemove={dequeueMessage}
        onPopToInput={handlePopQueueToInput}
        onResume={resumeQueue}
      />

      {/* Input Area */}
      <InputArea
        ref={inputRef}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSend}
        onCancel={handleCancel}
        onNewConversation={handleNewConversation}
        onStartTyping={handleStartTyping}
        isStreaming={effectiveIsStreaming}
        isWarmingUp={isWarmingUp}
        canSend={canSend}
        disabled={!hasInstalledAgents && !isByok}
        isByok={isByok}
        byokSession={byokSession !== null}
        aiContext={aiContext}
        openTabs={openTabs}
        attachedContext={attachedContext}
        onRemoveAttachedContext={() => {
          setAttachedContext(null);
        }}
        pendingImages={pendingImages}
        onAddImages={handleAddImages}
        onRemoveImage={handleRemoveImage}
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
  currentMode: string | null;
  availableCommandCount: number;
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
  currentMode,
  availableCommandCount,
  recentSessions,
}: PanelHeaderProps) {
  // Filter out current session from history
  const otherSessions = recentSessions.filter(
    (s) => s.id !== activeSession?.id,
  );

  return (
    <div className="flex items-center gap-1 border-b px-3 py-1 bg-background/50">
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
              size="icon-sm"
              onClick={onNewConversation}
              className="text-muted-foreground hover:text-foreground"
            >
              <IconPlus className="h-4! w-4!" />
            </Button>
          }
        />
        <TooltipContent side="bottom">New conversation</TooltipContent>
      </Tooltip>

      {currentMode && (
        <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          mode: {currentMode}
        </span>
      )}

      {availableCommandCount > 0 && (
        <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {availableCommandCount} cmds
        </span>
      )}

      {onClose && (
        <Button
          variant="ghost"
          onClick={onClose}
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <IconX className="h-4! w-4!" />
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
    assistantFlow?: AssistantFlowSegment[];
    assistantBlocks?: AssistantBlockV2[];
    images?: AcpMessage["images"];
    cancelled?: boolean;
    attachedTab?: AcpMessage["attachedTab"];
  }>;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  activeToolCalls: ToolCallType[];
  streamingFlow: AssistantFlowSegment[];
  streamingPlan: Array<{ id: string; description: string; status: string }>;
  onQueryError?: (query: string, errorMessage: string) => void;
  correctingQuery?: string | null;
  onCommandBatchResult?: (batchResult: string) => void;
}

function MessageList({
  messages,
  isStreaming,
  streamingContent,
  streamingThinking,
  activeToolCalls,
  streamingFlow,
  streamingPlan,
  onQueryError,
  correctingQuery,
  onCommandBatchResult,
}: MessageListProps) {
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (msg) =>
          !(msg.role === "user" && isInternalExecutionFeedback(msg.content)),
      ),
    [messages],
  );

  const latestAssistantMessageId = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const candidate = visibleMessages[index];
      if (candidate?.role === "assistant") {
        return candidate.id;
      }
    }
    return null;
  }, [visibleMessages]);

  return (
    <div className="flex flex-col">
      {visibleMessages.map((msg) => {
        const isLatestAssistantMessage =
          msg.role === "assistant" && msg.id === latestAssistantMessageId;

        return (
          <Fragment key={msg.id}>
            <MessageBubble
              role={msg.role}
              content={msg.content}
              thinking={msg.thinking}
              toolCalls={msg.toolCalls}
              assistantFlow={msg.assistantFlow}
              assistantBlocks={msg.assistantBlocks}
              images={msg.images}
              cancelled={msg.cancelled}
              attachedTab={msg.attachedTab}
              onQueryError={onQueryError}
              correctingQuery={correctingQuery}
              onCommandBatchResult={
                isLatestAssistantMessage ? onCommandBatchResult : undefined
              }
            />
          </Fragment>
        );
      })}

      {/* Streaming Message */}
      {isStreaming && (
        <>
          <MessageBubble
            role="assistant"
            content={streamingContent}
            thinking={streamingThinking}
            toolCalls={activeToolCalls}
            assistantFlow={streamingFlow}
            assistantBlocks={streamingFlow}
            planSteps={streamingPlan}
            isStreaming
            onQueryError={onQueryError}
            correctingQuery={correctingQuery}
          />
        </>
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
  assistantFlow?: AssistantFlowSegment[];
  assistantBlocks?: AssistantBlockV2[];
  planSteps?: Array<{ id: string; description: string; status: string }>;
  isStreaming?: boolean;
  images?: AcpMessage["images"];
  cancelled?: boolean;
  attachedTab?: AcpMessage["attachedTab"];
  onQueryError?: (query: string, errorMessage: string) => void;
  correctingQuery?: string | null;
  onCommandBatchResult?: (batchResult: string) => void;
}

type MessageContentSegment =
  | { kind: "text"; key: string; text: string }
  | { kind: "commands"; key: string; commands: ParsedCommand[] }
  | { kind: "tool-call"; key: string; call: ToolCallType }
  | {
      kind: "resource";
      key: string;
      block: Exclude<ContentBlock, { type: "text" }>;
    }
  | {
      kind: "plan";
      key: string;
      steps: Array<{ id: string; description: string; status: string }>;
    }
  | { kind: "error"; key: string; message: string }
  | { kind: "incomplete-command"; key: string };

function sanitizeTextSegment(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function hasRenderableText(text: string): boolean {
  return text.trim().length > 0;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function splitTextIntoSegments(
  text: string,
  keyPrefix: string,
  isStreaming: boolean,
): MessageContentSegment[] {
  const segments: MessageContentSegment[] = [];
  const parsed = parseCommandsProgressive(text);
  const completeCommands = [...parsed.complete].sort(
    (a, b) => a.startIndex - b.startIndex,
  );

  let endOfRenderableText = text.length;
  if (
    isStreaming &&
    parsed.incomplete &&
    parsed.incompleteStart !== undefined
  ) {
    endOfRenderableText = Math.min(endOfRenderableText, parsed.incompleteStart);
  }

  const commandsInRange = completeCommands.filter(
    (cmd) => cmd.endIndex <= endOfRenderableText,
  );

  let cursor = 0;
  let pendingCommandGroup: ParsedCommand[] = [];

  const flushCommands = () => {
    if (pendingCommandGroup.length === 0) return;
    const firstCommand = pendingCommandGroup[0];
    if (!firstCommand) return;
    segments.push({
      kind: "commands",
      key: `${keyPrefix}-commands-${firstCommand.id}`,
      commands: pendingCommandGroup,
    });
    pendingCommandGroup = [];
  };

  for (const command of commandsInRange) {
    const rawText = text.slice(cursor, command.startIndex);
    if (hasRenderableText(rawText)) {
      flushCommands();
      segments.push({
        kind: "text",
        key: `${keyPrefix}-text-${cursor}`,
        text: sanitizeTextSegment(rawText),
      });
    }
    pendingCommandGroup.push(command);
    cursor = command.endIndex;
  }

  const trailingText = text.slice(cursor, endOfRenderableText);
  if (hasRenderableText(trailingText)) {
    flushCommands();
    segments.push({
      kind: "text",
      key: `${keyPrefix}-text-${cursor}`,
      text: sanitizeTextSegment(trailingText),
    });
  } else {
    flushCommands();
  }

  if (isStreaming && parsed.incomplete) {
    segments.push({
      kind: "incomplete-command",
      key: `${keyPrefix}-incomplete-${parsed.incompleteStart ?? "tail"}`,
    });
  }

  return segments;
}

function appendSqlFallbackSegments(options: {
  segments: MessageContentSegment[];
  text: string;
  keyPrefix: string;
  isStreaming: boolean;
  connections: AIContext["connections"];
  defaultConnectionId?: string | null;
}): MessageContentSegment[] {
  const {
    segments,
    text,
    keyPrefix,
    isStreaming,
    connections,
    defaultConnectionId,
  } = options;

  if (isStreaming) return segments;
  if (!text.trim()) return segments;
  if (segments.some((segment) => segment.kind === "commands")) {
    return segments;
  }

  const commands = buildFallbackQueryRunCommands({
    text,
    connections,
    defaultConnectionId,
    commandIdPrefix: `${keyPrefix}-sql`,
  });

  if (commands.length === 0) {
    return segments;
  }

  const textHash = hashString(text);

  return [
    ...segments,
    {
      kind: "text",
      key: `${keyPrefix}-sql-fallback-note-${textHash}`,
      text: "_Converted raw SQL into executable `query.run` actions and ran them automatically._",
    },
    {
      kind: "commands",
      key: `${keyPrefix}-sql-fallback-commands-${textHash}`,
      commands,
    },
  ];
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

function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return node.toString();
  if (Array.isArray(node)) return node.map(extractTextFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: React.ReactNode };
    return extractTextFromNode(props.children);
  }
  return "";
}

function findCodeNode(
  node: React.ReactNode,
): { className: string; content: string } | null {
  if (!node) return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findCodeNode(child);
      if (result) return result;
    }
    return null;
  }

  if (typeof node === "object" && "props" in node) {
    const props = node.props as {
      className?: string;
      children?: React.ReactNode;
    };
    const className = props.className ?? "";
    if (className.includes("language-")) {
      return {
        className,
        content: extractTextFromNode(props.children),
      };
    }
    return findCodeNode(props.children);
  }

  return null;
}

function MessageBubble({
  role,
  content,
  thinking,
  toolCalls,
  assistantFlow,
  assistantBlocks,
  planSteps,
  isStreaming,
  images,
  cancelled,
  attachedTab,
  onQueryError,
  correctingQuery,
  onCommandBatchResult,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Get AI context for resolving @ mentions to connections
  const aiContext = useAIContextWithSchema();

  // Get focused connection as fallback for QueryBlock context
  const getFocusedConnection = useWorkspaceBundleStore(
    (s) => s.getFocusedConnection,
  );
  const focusedConnection = getFocusedConnection();

  // Parse @ mentions from user messages for badge display
  const mentionBadges = useMemo(() => {
    if (!isUser || !content) return [];
    const mentions = parseMentions(content);
    // Deduplicate by raw text
    const seen = new Set<string>();
    return mentions.filter((m) => {
      if (seen.has(m.raw)) return false;
      seen.add(m.raw);
      return true;
    });
  }, [isUser, content]);

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

  // Build message flow segments so text, tool calls, and command blocks render
  // exactly in streaming order.
  const messageSegments = useMemo<MessageContentSegment[]>(() => {
    if (isUser) {
      if (!content) return [];
      return splitTextIntoSegments(stripMentionIds(content), "user", false);
    }

    const orderedBlocks = assistantBlocks ?? assistantFlow;
    if (orderedBlocks && orderedBlocks.length > 0) {
      const segments: MessageContentSegment[] = [];
      orderedBlocks.forEach((segment, index) => {
        if (segment.type === "text" || segment.type === "action") {
          const text = segment.type === "text" ? segment.text : segment.text;
          const textSegments = splitTextIntoSegments(
            text,
            `flow-${index}`,
            Boolean(isStreaming) && index === orderedBlocks.length - 1,
          );
          segments.push(...textSegments);
          return;
        }

        if (segment.type === "toolStatus") {
          segments.push({
            kind: "tool-call",
            key: `flow-tool-${segment.call.id}-${index}`,
            call: segment.call,
          });
          return;
        }

        if (segment.type === "resource") {
          segments.push({
            kind: "resource",
            key: `flow-resource-${index}`,
            block: segment.block,
          });
          return;
        }

        if (segment.type === "plan") {
          segments.push({
            kind: "plan",
            key: `flow-plan-${index}`,
            steps: segment.steps,
          });
          return;
        }

        segments.push({
          kind: "error",
          key: `flow-error-${index}`,
          message: segment.message,
        });
      });

      if (segments.length > 0) {
        return appendSqlFallbackSegments({
          segments,
          text: content,
          keyPrefix: "flow",
          isStreaming: Boolean(isStreaming),
          connections: aiContext.connections,
          defaultConnectionId: resolvedConnection?.id ?? null,
        });
      }
    }

    if (!content) {
      if (toolCalls && toolCalls.length > 0) {
        return toolCalls.map((call, index) => ({
          kind: "tool-call" as const,
          key: `fallback-only-tool-${call.id}-${index}`,
          call,
        }));
      }
      return [];
    }

    const fallback = splitTextIntoSegments(
      content,
      "assistant",
      Boolean(isStreaming),
    );
    if (toolCalls && toolCalls.length > 0) {
      fallback.push(
        ...toolCalls.map((call, index) => ({
          kind: "tool-call" as const,
          key: `fallback-tool-${call.id}-${index}`,
          call,
        })),
      );
    }
    return appendSqlFallbackSegments({
      segments: fallback,
      text: content,
      keyPrefix: "assistant",
      isStreaming: Boolean(isStreaming),
      connections: aiContext.connections,
      defaultConnectionId: resolvedConnection?.id ?? null,
    });
  }, [
    content,
    isUser,
    assistantFlow,
    assistantBlocks,
    isStreaming,
    toolCalls,
    aiContext.connections,
    resolvedConnection?.id,
  ]);

  // Handle query execution from QueryBlock
  const handleQueryRun = useCallback(
    async (query: string, connectionId: string) => {
      try {
        const command: ParsedCommand<QueryRunParams> = {
          id: `query-block-${crypto.randomUUID()}`,
          name: "query.run",
          params: {
            connectionId,
            query,
          },
          approval: "auto",
          raw: "query-block-run",
          startIndex: 0,
          endIndex: 0,
          confidence: "high",
        };

        const execution = await executeCommand(command);
        if (!execution.success) {
          if (onQueryError) {
            onQueryError(query, execution.error);
          }
          return;
        }

        const queryResult = execution.data as QueryRunResult & {
          error?: string;
        };
        if (!queryResult.success && queryResult.error && onQueryError) {
          onQueryError(query, queryResult.error);
        }
      } catch (err) {
        // Trigger self-correction for read-only query failures
        if (onQueryError) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          onQueryError(query, errorMessage);
        }
      }
    },
    [onQueryError],
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
        const codeNode = findCodeNode(children);
        if (codeNode) {
          const langMatch = codeNode.className.match(
            /language-([a-zA-Z0-9_-]+)/,
          );
          const language = langMatch?.[1]?.toLowerCase() ?? "";
          if (QUERY_LANGUAGES.has(language)) {
            return (
              <QueryBlock
                query={codeNode.content}
                language={language}
                connectionId={resolvedConnection?.id}
                connectionName={resolvedConnection?.name}
                onRun={handleQueryRun}
                isCorrecting={correctingQuery === codeNode.content}
              />
            );
          }
        }

        // For non-query code blocks, render the default pre
        return <pre {...props}>{children}</pre>;
      },
    }),
    [resolvedConnection, handleQueryRun, correctingQuery],
  );

  return (
    <div
      className={cn(
        "group relative px-3 py-3 transition-colors",
        isUser && "bg-primary/5 border-l-3 border-primary",
      )}
    >
      {isUser && content && (
        <button
          type="button"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={() => {
            void writeClipboardText(content);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          }}
        >
          {copied ? (
            <IconCheck className="h-3 w-3 text-green-500" />
          ) : (
            <IconCopy className="h-3 w-3" />
          )}
        </button>
      )}
      <div className="max-w-full mx-auto">
        {/* Content */}
        <div className="space-y-2">
          {/* Mention Badges */}
          {isUser && mentionBadges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {mentionBadges.map((mention) => (
                <span
                  key={mention.raw}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {mention.type === "tab" ? (
                    <IconFileText className="h-2.5 w-2.5" />
                  ) : (
                    <IconTable className="h-2.5 w-2.5" />
                  )}
                  {mention.schema
                    ? `${mention.schema}.${mention.name}`
                    : mention.name}
                </span>
              ))}
            </div>
          )}

          {/* Attached Tab Badge */}
          {isUser && attachedTab && (
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <IconFileText className="h-2.5 w-2.5" />
                {attachedTab.title ?? attachedTab.tabId}
              </span>
            </div>
          )}

          {/* Image Thumbnails */}
          {isUser && images && images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, idx) => (
                <ImagePreviewPopover
                  key={idx}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={`Attached image ${idx + 1}`}
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={`Attached image ${idx + 1}`}
                    className="max-h-[120px] max-w-[200px] object-cover"
                  />
                </ImagePreviewPopover>
              ))}
            </div>
          )}

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

          {/* ACP Plan */}
          {planSteps && planSteps.length > 0 && <PlanBlock steps={planSteps} />}

          {/* Message Content Flow (text + command blocks in original order) */}
          {messageSegments.length > 0 ? (
            <div className="space-y-2">
              {messageSegments.map((segment) => {
                if (segment.kind === "text") {
                  return (
                    <div
                      key={segment.key}
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
                        {segment.text}
                      </Streamdown>
                    </div>
                  );
                }

                if (segment.kind === "commands") {
                  return (
                    <div
                      key={segment.key}
                      className="rounded-lg border border-border/60 bg-muted/20 p-2"
                    >
                      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Commands
                      </div>
                      <CommandList
                        commands={segment.commands}
                        onBatchResult={
                          isStreaming ? undefined : onCommandBatchResult
                        }
                        allowAutoExecute={!isStreaming}
                      />
                    </div>
                  );
                }

                if (segment.kind === "tool-call") {
                  return (
                    <InlineToolCallEvent
                      key={segment.key}
                      call={segment.call}
                    />
                  );
                }

                if (segment.kind === "resource") {
                  return (
                    <AssistantResourceBlock
                      key={segment.key}
                      block={segment.block}
                    />
                  );
                }

                if (segment.kind === "plan") {
                  return <PlanBlock key={segment.key} steps={segment.steps} />;
                }

                if (segment.kind === "error") {
                  return (
                    <div
                      key={segment.key}
                      className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive"
                    >
                      {segment.message}
                    </div>
                  );
                }

                return (
                  <div
                    key={segment.key}
                    className="flex items-center gap-2 text-xs text-muted-foreground py-1"
                  >
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                    <span>Command loading...</span>
                  </div>
                );
              })}
            </div>
          ) : isStreaming && !thinking ? (
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
          {cancelled && (
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground italic">
              <IconPlayerStop className="h-3 w-3" />
              <span>Response cancelled</span>
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

interface PlanBlockProps {
  steps: Array<{ id: string; description: string; status: string }>;
}

function PlanBlock({ steps }: PlanBlockProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        Plan
      </div>
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 text-[11px]">
            {step.status === "running" ? (
              <IconLoader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
            ) : step.status === "completed" ? (
              <IconCheck className="h-3 w-3 shrink-0 text-green-500" />
            ) : step.status === "failed" ? (
              <IconX className="h-3 w-3 shrink-0 text-destructive" />
            ) : (
              <IconClock className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "truncate",
                step.status === "completed" &&
                  "text-muted-foreground line-through",
              )}
            >
              {step.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantResourceBlock({
  block,
}: {
  block: Exclude<ContentBlock, { type: "text" }>;
}) {
  if (block.type === "image") {
    return (
      <ImagePreviewPopover
        src={`data:${block.mimeType};base64,${block.data}`}
        alt="Assistant resource image"
      >
        <img
          src={`data:${block.mimeType};base64,${block.data}`}
          alt="Assistant resource image"
          className="max-h-[180px] max-w-[320px] rounded border border-border/60 object-cover"
        />
      </ImagePreviewPopover>
    );
  }

  if (block.type === "resourceLink") {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]">
        <span className="text-muted-foreground">Resource:</span>{" "}
        <a
          href={block.uri}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          {block.title ?? block.uri}
        </a>
      </div>
    );
  }

  if (block.type === "resource") {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Resource Payload
        </div>
        <pre className="max-h-48 overflow-auto text-[10px] text-muted-foreground whitespace-pre-wrap">
          {JSON.stringify({ uri: block.uri, content: block.content }, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
      {`Audio resource (${block.mimeType})`}
    </div>
  );
}

function getToolCallStatusText(status: ToolCallType["status"]): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}

/**
 * Parse a bash tool call to detect `querypilot agent <capability>` invocations.
 * Returns the capability name and parsed JSON params (if piped via echo), or null.
 */
function parseQueryPilotShellCall(input: Record<string, unknown>): {
  capability: string;
  params: Record<string, unknown> | null;
} | null {
  // Claude Code may use various keys for the shell command
  const command =
    typeof input.command === "string"
      ? input.command
      : typeof input.cmd === "string"
        ? input.cmd
        : typeof input.input === "string"
          ? input.input
          : typeof input.raw === "string"
            ? input.raw
            : null;
  if (!command) {
    // Fallback: scan all string values for querypilot invocation
    const strValues = Object.values(input).filter(
      (v): v is string => typeof v === "string",
    );
    const found = strValues.find((v) =>
      /(?:[\w/\\.-]*querypilot|QUERYPILOT_CLI_PATH)\s+agent\s+[\w.]+/i.test(v),
    );
    if (!found) return null;
    return parseQueryPilotShellCall({ command: found });
  }

  // Match querypilot invocations:
  // - querypilot agent <cap>
  // - $QUERYPILOT_CLI_PATH agent <cap>
  // - /absolute/path/to/querypilot agent <cap>
  const match = command.match(
    /(?:[\w/\\.-]*querypilot(?:\.exe)?|\$\{?QUERYPILOT_CLI_PATH\}?)\s+agent\s+([\w.]+)/i,
  );
  if (!match?.[1]) return null;

  const capability: string = match[1];

  // Try to extract JSON from piped echo: echo '{...}' | querypilot ...
  let params: Record<string, unknown> | null = null;
  const pipeIdx = command.indexOf("|");
  if (pipeIdx > 0) {
    const lhs = command.slice(0, pipeIdx).trim();
    // Extract JSON from echo '...' or echo "..." or echo {...}
    const jsonMatch = lhs.match(/echo\s+['"]*(\{[\s\S]*\})['"]*$/);
    if (jsonMatch) {
      try {
        params = JSON.parse(jsonMatch[1]!) as Record<string, unknown>;
      } catch {
        // Not valid JSON — ignore
      }
    }
  }

  return { capability, params };
}

function InlineToolCallEvent({ call }: { call: ToolCallType }) {
  const [expanded, setExpanded] = useState(false);
  const connections = useConnectionStore((s) => s.connections);
  const lowerName = call.name.toLowerCase();
  const isFilesystemTool =
    lowerName === "read" ||
    lowerName === "write" ||
    lowerName === "edit" ||
    lowerName === "multiedit" ||
    lowerName === "grep" ||
    lowerName === "glob" ||
    lowerName.includes("__read") ||
    lowerName.includes("__write") ||
    lowerName.includes("__edit") ||
    lowerName.includes("__multiedit") ||
    lowerName.includes("__grep") ||
    lowerName.includes("__glob");

  const detailText = (
    call.error ??
    (typeof call.output === "string"
      ? call.output
      : call.output !== undefined
        ? JSON.stringify(call.output)
        : "")
  ).toLowerCase();
  const deniedByPolicy =
    call.status === "failed" &&
    (detailText.includes("execution denied") ||
      detailText.includes("permission") ||
      detailText.includes("cancelled"));

  // Avoid surfacing noisy blocked filesystem tool attempts in DB-assistant UX.
  if (isFilesystemTool && deniedByPolicy) {
    return null;
  }

  // Detect querypilot CLI calls wrapped in bash/terminal tool
  const isBashLike =
    lowerName === "bash" ||
    lowerName === "terminal" ||
    lowerName === "shell" ||
    lowerName === "execute" ||
    lowerName.includes("bash") ||
    lowerName.includes("terminal") ||
    lowerName.includes("shell");
  // Try parsing input first, then fall back to parsing the tool name itself
  // (Claude Code's second ToolCall event sets `name` to the full command string)
  const qpCall =
    (isBashLike ? parseQueryPilotShellCall(call.input) : null) ??
    (lowerName.includes("querypilot")
      ? parseQueryPilotShellCall({ command: call.name })
      : null);

  const statusText = getToolCallStatusText(call.status);
  const resultText =
    call.error ??
    (call.output !== undefined
      ? typeof call.output === "string"
        ? call.output
        : JSON.stringify(call.output, null, 2)
      : null);

  // Render enriched view for QueryPilot CLI calls
  if (qpCall) {
    const allParams = qpCall.params
      ? Object.entries(qpCall.params).filter(
          ([k]) => k !== "version" && k !== "requestId",
        )
      : null;
    // Separate query from other params for special rendering
    const queryParam = allParams?.find(([k]) => k === "query")?.[1];
    const queryText = typeof queryParam === "string" ? queryParam : null;
    const metaParams =
      allParams?.filter(([k]) => k !== "query" && k !== "params") ?? [];
    // If params has a nested params object, extract its entries too
    const nestedParams = qpCall.params?.params;
    if (
      nestedParams &&
      typeof nestedParams === "object" &&
      !Array.isArray(nestedParams)
    ) {
      for (const [k, v] of Object.entries(
        nestedParams as Record<string, unknown>,
      )) {
        if (k !== "query" && k !== "version" && k !== "requestId") {
          metaParams.push([k, v]);
        }
      }
      // Extract query from nested params if not found at top level
      if (
        !queryText &&
        typeof (nestedParams as Record<string, unknown>).query === "string"
      ) {
        // re-assign via let
      }
    }
    const finalQuery =
      queryText ??
      (typeof (qpCall.params?.params as Record<string, unknown> | undefined)
        ?.query === "string"
        ? ((qpCall.params!.params as Record<string, unknown>).query as string)
        : null);
    const hasDetails = !!finalQuery || metaParams.length > 0;

    return (
      <div className="select-text rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* Header row */}
            <div className="flex items-center gap-1.5">
              {call.status === "running" ? (
                <IconLoader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              ) : call.status === "completed" ? (
                <IconCheck className="h-3 w-3 shrink-0 text-green-500" />
              ) : call.status === "failed" ? (
                <IconX className="h-3 w-3 shrink-0 text-destructive" />
              ) : (
                <IconClock className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="text-[11px] font-mono font-semibold text-foreground/90">
                {qpCall.capability}
              </span>
              {call.description && (
                <span className="text-[10px] text-muted-foreground truncate">
                  — {call.description}
                </span>
              )}
              {hasDetails && (
                <button
                  onClick={() => {
                    setExpanded((v) => !v);
                  }}
                  className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {expanded ? (
                    <IconChevronDown className="h-2.5 w-2.5" />
                  ) : (
                    <IconChevronRight className="h-2.5 w-2.5" />
                  )}
                  {expanded ? "Hide" : "Details"}
                </button>
              )}
            </div>

            {/* Meta params as inline badges */}
            {metaParams.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {metaParams.map(([key, value]) => {
                  let displayValue =
                    typeof value === "string"
                      ? value
                      : JSON.stringify(value);

                  // Resolve connectionId to human-readable connection name
                  if (key === "connectionId" && typeof value === "string") {
                    const conn = connections.find(
                      (c) => c.profile.id === value,
                    );
                    if (conn) {
                      displayValue = conn.profile.name;
                    }
                  }

                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                    >
                      <span className="font-medium">
                        {key === "connectionId" ? "connection" : key}:
                      </span>
                      <span className="max-w-[180px] truncate">
                        {displayValue}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Query as code block */}
            {hasDetails && expanded && finalQuery && (
              <div className="group/code relative mt-1.5">
                <button
                  onClick={() => {
                    void writeClipboardText(finalQuery);
                  }}
                  className="absolute top-1 right-1 opacity-0 group-hover/code:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground"
                  title="Copy query"
                >
                  <IconCopy className="h-3 w-3" />
                </button>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted border border-border/40 px-2.5 py-2 text-[11px] leading-relaxed font-mono text-foreground/85 whitespace-pre-wrap break-all">
                  {finalQuery}
                </pre>
              </div>
            )}

            {/* Non-query expanded params */}
            {hasDetails && expanded && !finalQuery && metaParams.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {metaParams.map(([key, value]) => (
                  <div key={key} className="flex gap-1.5 text-[10px]">
                    <span className="shrink-0 font-medium text-muted-foreground">
                      {key}:
                    </span>
                    <span className="text-foreground/80 break-all">
                      {typeof value === "string"
                        ? value.length > 300
                          ? value.slice(0, 300) + "…"
                          : value
                        : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Result / Error output */}
            {resultText &&
              (call.status === "completed" || call.status === "failed") && (
                <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground whitespace-pre-wrap select-text">
                  {resultText.length > 1000
                    ? `${resultText.slice(0, 1000)}\n… (truncated)`
                    : resultText}
                </pre>
              )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="select-text rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="flex items-start gap-2">
        {call.status === "running" ? (
          <IconLoader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : call.status === "completed" ? (
          <IconCheck className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
        ) : call.status === "failed" ? (
          <IconX className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <IconClock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <IconWand className="h-2.5 w-2.5" />
            <span>Agent Action</span>
          </div>
          <div className="truncate text-[11px] font-medium text-foreground/90">
            {call.name}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {call.description ? call.description : statusText}
          </div>
          {resultText &&
            (call.status === "completed" || call.status === "failed") && (
              <pre className="mt-1 max-h-36 overflow-auto rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground whitespace-pre-wrap">
                {resultText.length > 1000
                  ? `${resultText.slice(0, 1000)}\n… (truncated)`
                  : resultText}
              </pre>
            )}
        </div>
      </div>
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
// Message Queue
// ============================================================================

interface MessageQueueProps {
  queue: QueuedMessage[];
  paused: boolean;
  onRemove: (id: string) => void;
  onPopToInput: (id: string) => void;
  onResume: () => void;
}

function MessageQueue({
  queue,
  paused,
  onRemove,
  onPopToInput,
  onResume,
}: MessageQueueProps) {
  if (queue.length === 0) return null;

  return (
    <div className="border-t px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">
          Queued ({queue.length})
        </span>
        {paused && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-amber-500 font-medium">
              Paused
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onResume}
              className="h-5 px-1.5 text-[11px]"
            >
              Resume
            </Button>
          </div>
        )}
      </div>
      {queue.map((item) => (
        <div
          key={item.id}
          className="group flex items-start gap-2 rounded-md border bg-muted/50 px-2.5 py-1.5 cursor-pointer hover:bg-muted/80 transition-colors"
          onClick={() => {
            onPopToInput(item.id);
          }}
          title="Click to edit"
        >
          <span className="flex-1 truncate text-xs">
            {item.content.length > 120
              ? item.content.slice(0, 120) + "\u2026"
              : item.content}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Remove from queue"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Input Area with @ Mention Autocomplete (via Lexical)
// ============================================================================

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onNewConversation: () => void;
  onStartTyping: () => void;
  isStreaming: boolean;
  isWarmingUp: boolean;
  canSend: boolean;
  disabled: boolean;
  isByok: boolean;
  byokSession: boolean;
  aiContext: AIContext;
  openTabs: Array<{
    id: string;
    name: string;
    type: string;
    panelId: string;
    connectionId?: string;
    connectionName?: string;
  }>;
  attachedContext: FocusedTabContextSnapshot | null;
  onRemoveAttachedContext: () => void;
  pendingImages: PreparedImage[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
}

const InputArea = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  onNewConversation,
  onStartTyping,
  isStreaming,
  isWarmingUp,
  canSend,
  disabled,
  isByok,
  byokSession,
  aiContext,
  openTabs,
  attachedContext,
  onRemoveAttachedContext,
  pendingImages,
  onAddImages,
  onRemoveImage,
  ref,
}: InputAreaProps & { ref?: React.Ref<LexicalInputHandle> }) => {
  const localRef = useRef<LexicalInputHandle>(null);
  const inputRef =
    (ref as React.RefObject<LexicalInputHandle | null>) ?? localRef;
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Paste handler — extract images from native ClipboardEvent (used by LexicalInput PastePlugin)
  const handleNativePaste = useCallback(
    (e: ClipboardEvent) => {
      const files = extractImagesFromPaste(e);
      if (files.length > 0) {
        e.preventDefault();
        onAddImages(files);
      }
    },
    [onAddImages],
  );

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      dragCounterRef.current = 0;
      const files = extractImagesFromDrop(e.nativeEvent);
      if (files.length > 0) {
        onAddImages(files);
      }
    },
    [onAddImages],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  // Forward ref behavior
  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  // Handle input change from LexicalInput (plain text)
  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
      onStartTyping();
    },
    [onChange, onStartTyping],
  );

  const placeholder =
    isByok && !byokSession
      ? "Configure a provider in Settings \u2192 AI"
      : disabled
        ? "No AI agent available"
        : isWarmingUp
          ? "Starting agent... you can type now"
          : "Ask anything... use @ to mention tables";

  return (
    <div
      className="p-1.5"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Unified Input Container */}
      <div
        className={cn(
          "relative rounded-lg border-2 bg-background transition-all duration-200",
          isDragOver
            ? "border-dashed border-primary/50"
            : isFocused
              ? "border-primary shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.1)]"
              : "border-border hover:border-border/80",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/5 pointer-events-none">
            <div className="flex items-center gap-2 text-xs text-primary/70">
              <IconPhoto className="h-4 w-4" />
              <span>Drop image here</span>
            </div>
          </div>
        )}

        {/* Pending image thumbnails */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {pendingImages.map((img) => (
              <div key={img.id} className="relative group/thumb">
                <ImagePreviewPopover src={img.previewUrl} alt="Pending image">
                  <img
                    src={img.previewUrl}
                    alt="Pending"
                    className="h-10 w-10 rounded object-cover"
                  />
                </ImagePreviewPopover>
                <button
                  type="button"
                  onClick={() => {
                    onRemoveImage(img.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                >
                  <IconX className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {pendingImages.length >= MAX_IMAGES && (
              <div className="flex items-center px-1 text-[10px] text-muted-foreground">
                Max {MAX_IMAGES}
              </div>
            )}
          </div>
        )}

        {attachedContext && (
          <div className="px-3 pt-2">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
              <IconFileText className="h-3 w-3" />
              <span className="max-w-[240px] truncate">
                Attached: {attachedContext.title ?? attachedContext.tabId}
              </span>
              <button
                type="button"
                onClick={onRemoveAttachedContext}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Remove attached context"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Lexical rich-text input with inline @ mentions */}
        <div
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
        >
          <LexicalInput
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onSubmit={onSubmit}
            onNewConversation={onNewConversation}
            onPaste={handleNativePaste}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "border-0 bg-transparent",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
            )}
            aiContext={aiContext}
            openTabs={openTabs}
            focusedConnectionId={aiContext.focusedConnectionId ?? undefined}
          />
        </div>

        {/* Footer inside the input container */}
        <div className="flex items-center gap-1 p-1 px-1.5">
          <AgentSelector />
          {isByok ? <CompactModelPicker /> : <ModelSelector />}
          <div className="flex-1" />

          {/* Keyboard hint removed — button is self-explanatory */}

          {isStreaming && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-6 px-2 text-[11px] gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <IconPlayerStop className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          <Button
            variant={canSend ? "default" : "ghost"}
            size="icon"
            disabled={!canSend}
            onClick={onSubmit}
            className={cn(
              "h-6 w-6 rounded-md transition-all",
              canSend
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <IconSend className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// BYOK Message List
// ============================================================================

interface ByokMessageListProps {
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          toolName?: string;
          toolCallId?: string;
          input?: unknown;
          output?: unknown;
        }>;
  }>;
  isStreaming: boolean;
  streamingContent: string;
  activeToolCalls: Array<{ id: string; name: string; status: string }>;
  onCommandBatchResult?: (batchResult: string) => void;
}

const byokProseClasses = cn(
  "prose prose-sm dark:prose-invert max-w-none",
  "prose-p:my-1 prose-p:leading-normal",
  "prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:text-sm",
  "prose-ul:my-1.5 prose-ol:my-1.5",
  "prose-li:my-0",
  "prose-pre:my-1.5 prose-pre:p-2 prose-pre:rounded-md prose-pre:bg-muted prose-pre:text-[11px] prose-pre:leading-tight",
  "prose-code:text-[11px] prose-code:font-medium prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted",
  "prose-code:before:content-none prose-code:after:content-none",
  "text-[12px] leading-normal",
);

/**
 * Extract the display string from a ToolResultOutput.
 * AI SDK v6 wraps tool results as { type: 'text'|'json'|..., value: ... }.
 * Falls back to JSON.stringify for unknown shapes.
 */
function extractToolResultValue(output: unknown): string | null {
  if (output === undefined || output === null) return null;
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    const typed = output as Record<string, unknown>;
    // ToolResultOutput { type: 'execution-denied', reason?: string }
    if (typed.type === "execution-denied") {
      return `Execution denied${typeof typed.reason === "string" ? `: ${typed.reason}` : ""}`;
    }
    // ToolResultOutput { type: 'text'|'json'|'error-text'|'error-json'|'content', value: ... }
    if ("value" in typed) {
      if (typeof typed.value === "string") return typed.value;
      return JSON.stringify(typed.value, null, 2);
    }
  }
  return JSON.stringify(output, null, 2);
}

function ByokToolCallInline({
  name,
  output,
}: {
  name: string;
  output?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const resultStr = extractToolResultValue(output);
  const hasResult = resultStr !== null;
  const isLong = hasResult && resultStr.length > 120;

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 my-1">
      <div className="flex items-center gap-2">
        <IconCheck className="h-3 w-3 shrink-0 text-green-500" />
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <IconWand className="h-2.5 w-2.5" />
          <span>Tool</span>
        </div>
        <span className="text-[11px] font-mono font-medium text-foreground/90">
          {name}
        </span>
        {hasResult && isLong && (
          <button
            onClick={() => {
              setExpanded((v) => !v);
            }}
            className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconEye className="h-2.5 w-2.5" />
            {expanded ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {hasResult && (!isLong || expanded) && (
        <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-muted/40 px-2 py-1.5 text-[10px] leading-tight text-muted-foreground whitespace-pre-wrap break-all">
          {resultStr.length > 2000
            ? resultStr.slice(0, 2000) + "\n… (truncated)"
            : resultStr}
        </pre>
      )}
    </div>
  );
}

function ByokMessageList({
  messages,
  isStreaming,
  streamingContent,
  activeToolCalls,
  onCommandBatchResult,
}: ByokMessageListProps) {
  const aiContext = useAIContextWithSchema();
  const getFocusedConnection = useWorkspaceBundleStore(
    (s) => s.getFocusedConnection,
  );
  const focusedConnection = getFocusedConnection();

  // Build a map of toolCallId → output from tool-role messages
  const toolResultMap = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const msg of messages) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "tool-result" && part.toolCallId) {
            map.set(part.toolCallId, part.output);
          }
        }
      }
    }
    return map;
  }, [messages]);

  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.role === "assistant") {
        return index;
      }
    }
    return -1;
  }, [messages]);

  const renderByokTextSegments = useCallback(
    (
      text: string,
      keyPrefix: string,
      streaming: boolean,
      onBatchResult?: (batchResult: string) => void,
    ) => {
      const baseSegments = splitTextIntoSegments(text, keyPrefix, streaming);
      const segments = appendSqlFallbackSegments({
        segments: baseSegments,
        text,
        keyPrefix,
        isStreaming: streaming,
        connections: aiContext.connections,
        defaultConnectionId: focusedConnection?.id ?? null,
      });

      return segments.map((segment) => {
        if (segment.kind === "text") {
          return (
            <div key={segment.key} className={byokProseClasses}>
              <Streamdown className="select-text">{segment.text}</Streamdown>
            </div>
          );
        }

        if (segment.kind === "commands") {
          return (
            <div
              key={segment.key}
              className="rounded-lg border border-border/60 bg-muted/20 p-2"
            >
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Actions
              </div>
              <CommandList
                commands={segment.commands}
                onBatchResult={streaming ? undefined : onBatchResult}
                allowAutoExecute={!streaming}
              />
            </div>
          );
        }

        return (
          <div
            key={segment.key}
            className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
          >
            <IconLoader2 className="h-3 w-3 animate-spin" />
            <span>Action loading...</span>
          </div>
        );
      });
    },
    [aiContext.connections, focusedConnection?.id],
  );

  return (
    <div className="flex flex-col">
      {messages.map((msg, idx) => {
        // Skip tool-role messages (results are shown inline with tool-call)
        if (msg.role === "tool") return null;

        if (msg.role === "user") {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : msg.content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("");
          if (isInternalExecutionFeedback(text)) {
            return null;
          }
          return (
            <div
              key={`user-${idx}`}
              className="group px-3 py-3 bg-primary/5 border-l-3 border-primary"
            >
              {renderByokTextSegments(
                stripMentionIds(text),
                `byok-user-${idx}`,
                false,
              )}
            </div>
          );
        }

        // Assistant message — render text and tool-call parts in order
        if (msg.role === "assistant") {
          const parts =
            typeof msg.content === "string"
              ? [{ type: "text" as const, text: msg.content }]
              : msg.content;

          const textParts = parts.filter((p) => p.type === "text");
          const toolCallParts = parts.filter((p) => p.type === "tool-call");
          const text = textParts.map((p) => p.text).join("");
          const batchResultHandler =
            idx === latestAssistantIndex ? onCommandBatchResult : undefined;

          return (
            <div key={`assistant-${idx}`} className="group px-3 py-3">
              {text.trim().length > 0 &&
                renderByokTextSegments(
                  text,
                  `byok-assistant-${idx}`,
                  false,
                  batchResultHandler,
                )}
              {toolCallParts.length > 0 && (
                <div className="space-y-1 mt-1">
                  {toolCallParts.map((tc) => (
                    <ByokToolCallInline
                      key={tc.toolCallId ?? tc.toolName}
                      name={tc.toolName ?? "unknown"}
                      output={toolResultMap.get(tc.toolCallId ?? "")}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        }

        // Other roles (system, etc.) — render as text
        const text =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
        return text ? (
          <div key={`${msg.role}-${idx}`} className="group px-3 py-3">
            {renderByokTextSegments(text, `byok-other-${idx}`, false)}
          </div>
        ) : null;
      })}

      {/* Live tool call indicators during streaming */}
      {activeToolCalls.length > 0 && (
        <div className="px-3 py-1.5 space-y-1">
          {activeToolCalls.map((tc) => (
            <div
              key={tc.id}
              className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                {tc.status === "calling" ? (
                  <IconLoader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                ) : tc.status === "complete" ? (
                  <IconCheck className="h-3 w-3 shrink-0 text-green-500" />
                ) : (
                  <IconX className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <IconWand className="h-2.5 w-2.5" />
                  <span>Tool</span>
                </div>
                <span className="text-[11px] font-mono font-medium text-foreground/90">
                  {tc.name}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {tc.status === "calling" ? "Running..." : tc.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isStreaming && streamingContent && (
        <div className="group px-3 py-3">
          {renderByokTextSegments(streamingContent, "byok-streaming", true)}
        </div>
      )}

      {isStreaming && !streamingContent && activeToolCalls.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:300ms]" />
          </div>
          <span className="text-[11px] text-muted-foreground">Thinking...</span>
        </div>
      )}
    </div>
  );
}
