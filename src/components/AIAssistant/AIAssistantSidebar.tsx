import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  IconAdjustments,
  IconCheck,
  IconLoader,
  IconRefresh,
  IconCopy,
  IconMessagePlus,
  IconHistory,
} from "@tabler/icons-react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useAIChat } from "@/hooks/useAIChat";
import { useAIChatStore } from "@/stores/aiChatStore";
import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { checkSidecarHealth } from "@/services/aiService";
import {
  useConversation,
  useConversationMessages,
} from "@/hooks/usePersistedChat";
import { db } from "@/lib/db/conversations";
import { ConversationList } from "@/components/AIChat/ConversationList";
import { ToolCallCard } from "@/components/AIChat/ToolCallCard";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useWorkspaceContext } from "@/hooks/useWorkspaceContext";
import { AI_SIDECAR_URL } from "@/config/constants";
import { writeClipboardText } from "@/lib/clipboard";

import {
  MessageAction,
  MessageActions,
} from "@/components/ai-elements/message";

// Helper function to convert tool names to friendly names
function getFriendlyToolName(toolName: string): string {
  const nameMap: Record<string, string> = {
    list_tables: "List Tables",
    describe_table: "Describe Table",
    execute_query: "Execute Query",
    list_databases: "List Databases",
    get_table_schema: "Get Table Schema",
    find_documents: "Find Documents",
    get_collection_schema: "Get Collection Schema",
    scan_keys: "Scan Keys",
    get_key: "Get Key Value",
  };

  return nameMap[toolName] || toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Helper function to map tool state to ToolCallCard status
function mapToolState(state: string): "pending" | "success" | "error" {
  switch (state) {
    case "in-progress":
      return "pending";
    case "output-available":
      return "success";
    case "output-error":
      return "error";
    default:
      return "pending";
  }
}
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { MessageResponse } from "@/components/ai-elements/message";

import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

export function AIAssistantSidebar() {
  const { openPreferences } = usePreferencesStore();
  const {
    selectedProvider,
    selectedModel,
    availableProviders,
    configuredProviders,
    setProvider,
    setModel,
    loadProviders,
    getProviderEnabledModels,
  } = useAIChatStore();

  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [sidecarHealthy, setSidecarHealthy] = useState<boolean | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [inputText, setInputText] = useState("");
  const [showConversationList, setShowConversationList] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string>(
    () => crypto.randomUUID()
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const {
    messages,
    regenerate,
    status: chatStatus,
    connectionContext,
    providerContext,
    sendMessage,
  } = useAIChat({
    onError: (err) => {
      toast.error("Chat Error", {
        description: err.message,
      });
    },
  });

  // Conversation persistence hooks
  const { conversation, updateTitle } = useConversation({
    conversationId: currentConversationId,
    connectionId: connectionContext.connectionId,
    title: "New Conversation",
  });

  const {
    messages: persistedMessages,
    addMessage: addPersistedMessage,
  } = useConversationMessages(currentConversationId);

  // Track if we've synced the initial messages from in-memory to database
  const syncedRef = useRef(false);

  // Initialize sidecar health check and load providers on mount
  useEffect(() => {
    const initialize = async () => {
      setIsInitializing(true);

      // IconCheck sidecar health
      const healthy = await checkSidecarHealth();
      setSidecarHealthy(healthy);

      if (!healthy) {
        toast.warning("AI Sidecar Unavailable", {
          description: "The AI service is not running. Please check settings.",
        });
        setIsInitializing(false);
        return;
      }

      // Load providers and check configuration
      await loadProviders();

      setIsInitializing(false);
    };

    void initialize();
  }, [loadProviders]);

  // Auto-select a configured provider if none is selected
  useEffect(() => {
    if (
      configuredProviders.length > 0 &&
      !selectedProvider &&
      availableProviders.length > 0
    ) {
      logger.info(
        "[AIAssistantSidebar] Auto-selecting configured provider:",
        configuredProviders[0],
      );
      const firstConfigured = availableProviders.find((p) =>
        configuredProviders.includes(p.name),
      );
      if (firstConfigured) {
        setProvider(firstConfigured.name);
        if (firstConfigured.models.length > 0) {
          setModel(firstConfigured.models[0]?.id || "");
        }
      }
    }
  }, [
    configuredProviders,
    selectedProvider,
    availableProviders,
    setProvider,
    setModel,
  ]);

  // Sync messages to database and auto-generate titles
  useEffect(() => {
    const syncMessages = async () => {
      // Skip if no messages or already synced
      if (messages.length === 0 || syncedRef.current) return;

      try {
        // Find new messages that aren't in persisted messages
        const persistedIds = new Set(persistedMessages.map((m) => m.id));
        const newMessages = messages.filter((m) => !persistedIds.has(m.id));

        // Add new messages to database
        for (const message of newMessages) {
          await addPersistedMessage({
            id: message.id,
            role: message.role,
            content: message.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as any).text)
              .join("\n"),
            parts: message.parts,
          });
        }

        // Auto-generate title from first user message
        if (
          messages.length > 0 &&
          conversation?.title === "New Conversation"
        ) {
          const firstUserMessage = messages.find((m) => m.role === "user");
          if (firstUserMessage) {
            const textPart = firstUserMessage.parts.find(
              (p) => p.type === "text",
            ) as any;
            if (textPart?.text) {
              const title = textPart.text.slice(0, 50);
              await updateTitle(title);
            }
          }
        }

        syncedRef.current = true;
      } catch (error) {
        logger.error("[AIAssistantSidebar] Failed to sync messages:", error);
      }
    };

    void syncMessages();
  }, [
    messages,
    persistedMessages,
    addPersistedMessage,
    conversation,
    updateTitle,
  ]);

  // Reset sync flag when conversation changes
  useEffect(() => {
    syncedRef.current = false;
  }, [currentConversationId]);

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = message.files.length > 0;

    if (!(hasText || hasAttachments)) {
      return;
    }

    try {
      await sendMessage({
        text: message.text,
        files: message.files,
      });
      // Clear input after successful send
      setInputText("");
    } catch (error) {
      logger.error("[AIAssistantSidebar] Failed to send message:", error);
      toast.error("Failed to send message", {
        description: "Please try again.",
      });
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    // Set the suggestion text in the input instead of immediately sending
    setInputText(suggestion);
  };

  const handleNewConversation = useCallback(async () => {
    const newId = crypto.randomUUID();
    await db.conversations.add({
      id: newId,
      connectionId: connectionContext.connectionId,
      title: "New Conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    setCurrentConversationId(newId);
    syncedRef.current = false;
  }, [connectionContext.connectionId]);

  const handleSelectConversation = useCallback(async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    syncedRef.current = false;
    // TODO: Load messages from database and set them in the AI chat
    // This would require extending useAIChat to accept initial messages
  }, []);

  // Fetch context-aware suggestions from sidecar
  const workspaceContext = useWorkspaceContext(connectionContext.connectionId);
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const response = await fetch(`${AI_SIDECAR_URL}/suggestions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ context: workspaceContext }),
        });

        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
        } else {
          // Fallback to default suggestions
          setSuggestions(
            connectionContext.hasConnection
              ? [
                  "Explain the structure of my database tables",
                  "Generate a query to find all records from last week",
                  "Help me optimize this query for better performance",
                  "Show me how to create a new table",
                ]
              : [
                  "How do I connect to a database?",
                  "What databases are supported?",
                  "Explain SQL query basics",
                  "How do I create a new connection?",
                ]
          );
        }
      } catch (error) {
        logger.error("[AIAssistantSidebar] Failed to fetch suggestions:", error);
        // Fallback to default suggestions
        setSuggestions(
          connectionContext.hasConnection
            ? ["Explain the structure of my database tables"]
            : ["How do I connect to a database?"]
        );
      }
    };

    void fetchSuggestions();
  }, [connectionContext.hasConnection, connectionContext.connectionId, workspaceContext]);

  // Show loading state during initialization
  if (isInitializing) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">AI Assistant</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              openPreferences("ai");
            }}
            title="AI Settings"
          >
            <IconAdjustments className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-xs font-medium">Initializing AI Assistant...</p>
            <p className="text-xs">
              Checking AI service status and loading providers.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show empty state if no provider/model or sidecar unavailable
  if (sidecarHealthy === false) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">AI Assistant</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              openPreferences("ai");
            }}
            title="AI Settings"
          >
            <IconAdjustments className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-xs font-medium">AI Service Unavailable</p>
            <p className="text-xs">
              The AI sidecar is not running or unreachable. Make sure the
              service is started and configured properly.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                openPreferences("ai");
              }}
            >
              Open IconSettings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // IconCheck if the selected provider has an API key configured on the sidecar
  const isProviderActuallyConfigured =
    selectedProvider && configuredProviders.includes(selectedProvider);

  // Debug logging
  logger.info("[AIAssistantSidebar] Debug:", {
    selectedProvider,
    selectedModel,
    configuredProviders,
    isProviderActuallyConfigured,
    hasProvider: providerContext.hasProvider,
    inputTextLength: inputText.length,
  });

  if (!providerContext.hasProvider || !isProviderActuallyConfigured) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">AI Assistant</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              openPreferences("ai");
            }}
            title="AI Settings"
          >
            <IconAdjustments className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-xs font-medium">No AI Provider Configured</p>
            <p className="text-xs">
              {selectedProvider && !isProviderActuallyConfigured
                ? `${selectedProvider} is selected but has no API key configured. Configure an API key in settings to start using the AI assistant.`
                : "Configure an AI provider and API key in settings to start using the AI assistant."}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                openPreferences("ai");
              }}
            >
              Configure AI Provider
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-2 py-1.5 border-b">
        <h2 className="text-base font-semibold">AI Assistant</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewConversation}
            title="New Conversation"
          >
            <IconMessagePlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowConversationList(!showConversationList)}
            title={showConversationList ? "Hide History" : "Show History"}
          >
            <IconHistory className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              openPreferences("ai");
            }}
            title="AI Settings"
          >
            <IconAdjustments className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main chat area */}
      <div className="relative flex size-full flex-col overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Conversation list sidebar */}
          {showConversationList && (
            <>
              <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
                <ConversationList
                  connectionId={connectionContext.connectionId}
                  onSelectConversation={handleSelectConversation}
                />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {/* Chat panel */}
          <ResizablePanel defaultSize={showConversationList ? 70 : 100}>
            <div className="relative flex size-full flex-col overflow-hidden">
              <Conversation className="overflow-hidden">
                <ConversationContent className="gap-2 p-2 overflow-hidden">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center text-muted-foreground space-y-2 max-w-sm">
                  <p className="text-xs font-medium">
                    Start a conversation with AI
                  </p>
                  <p className="text-xs">
                    {connectionContext.hasConnection
                      ? `Connected to ${
                          connectionContext.database || "database"
                        }. Ask questions about your data or get help with queries.`
                      : "No active connection. Ask general questions about databases and SQL."}
                  </p>
                </div>
              </div>
            )}
            {messages.map((message, messageIndex) => (
              <Message from={message.role} key={message.id} className="py-1">
                <MessageContent className="max-w-full overflow-hidden text-xs px-3 py-2">
                  {message.parts.map((part, i) => {
                    const isLastMessage = messageIndex === messages.length - 1;

                    // Handle tool invocation parts (type is "tool-{toolName}")
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as any;
                      const toolName = part.type.replace("tool-", "");
                      return (
                        <ToolCallCard
                          key={`${message.id}-${i}`}
                          toolName={toolName}
                          friendlyName={getFriendlyToolName(toolName)}
                          status={mapToolState(toolPart.state)}
                          input={toolPart.input || {}}
                          output={toolPart.output}
                          error={toolPart.errorText}
                        />
                      );
                    }

                    switch (part.type) {
                      case "text":
                        return (
                          <Fragment key={`${message.id}-${i}`}>
                            <MessageResponse className="!text-xs">
                              {part.text}
                            </MessageResponse>

                            {message.role === "assistant" && isLastMessage && (
                              <MessageActions>
                                <MessageAction
                                  onClick={() => regenerate()}
                                  label="Retry"
                                >
                                  <IconRefresh className="size-3" />
                                </MessageAction>
                                <MessageAction
                                  onClick={() =>
                                    void writeClipboardText(part.text)
                                  }
                                  label="Copy"
                                >
                                  <IconCopy className="size-3" />
                                </MessageAction>
                              </MessageActions>
                            )}
                          </Fragment>
                        );
                      case "reasoning":
                        return (
                          <Reasoning
                            key={`${message.id}-${i}`}
                            className="w-full max-w-full overflow-x-auto text-xs"
                            isStreaming={
                              chatStatus === "streaming" &&
                              i === message.parts.length - 1 &&
                              message.id === messages.at(-1)?.id
                            }
                          >
                            <ReasoningTrigger className="text-xs" />
                            <ReasoningContent className="max-w-full overflow-x-auto text-xs">
                              {part.text}
                            </ReasoningContent>
                          </Reasoning>
                        );
                      default:
                        return null;
                    }
                  })}
                </MessageContent>
              </Message>
            ))}
            {chatStatus === "submitted" && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <IconLoader className="size-3 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Suggestions */}
        {messages.length === 0 && (
          <div className="px-2">
            <Suggestions>
              {suggestions.slice(0, 4).map((suggestion) => (
                <Suggestion
                  key={suggestion}
                  onClick={() => {
                    handleSuggestionClick(suggestion);
                  }}
                  suggestion={suggestion}
                />
              ))}
            </Suggestions>
          </div>
        )}

        {/* Input area */}
        <div className="p-2">
          <PromptInput
            multiple
            onSubmit={handlePromptSubmit}
            className="rounded-lg"
          >
            <PromptInputHeader className="p-0">
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
            </PromptInputHeader>

            <PromptInputBody>
              <PromptInputTextarea
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                }}
                placeholder={
                  connectionContext.hasConnection
                    ? "Ask about your database..."
                    : "Ask me anything..."
                }
              />
            </PromptInputBody>

            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <ModelSelector
                  onOpenChange={setModelSelectorOpen}
                  open={modelSelectorOpen}
                >
                  <ModelSelectorTrigger
                    render={
                      <PromptInputButton>
                        {selectedProvider && (
                          <ModelSelectorLogo provider={selectedProvider} />
                        )}
                        {selectedModel && (
                          <ModelSelectorName>{selectedModel}</ModelSelectorName>
                        )}
                      </PromptInputButton>
                    }
                  />

                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>

                      {availableProviders
                        .filter((provider) =>
                          configuredProviders.includes(provider.name),
                        )
                        .map((provider) => {
                          const enabledModels = getProviderEnabledModels(
                            provider.name,
                          );
                          const filteredModels = provider.models.filter((m) =>
                            enabledModels.includes(m.id),
                          );

                          // Skip provider if no enabled models
                          if (filteredModels.length === 0) return null;

                          return (
                            <ModelSelectorGroup
                              key={provider.name}
                              heading={provider.name}
                            >
                              {filteredModels.map((model) => (
                                <ModelSelectorItem
                                  key={model.id}
                                  value={model.id}
                                  onSelect={() => {
                                    setProvider(provider.name);
                                    setModel(model.id);
                                    setModelSelectorOpen(false);
                                  }}
                                >
                                  <ModelSelectorLogo provider={provider.name} />
                                  <ModelSelectorName>
                                    {model.name}
                                  </ModelSelectorName>
                                  {selectedProvider === provider.name &&
                                    selectedModel === model.id && (
                                      <IconCheck className="ml-auto size-4" />
                                    )}
                                </ModelSelectorItem>
                              ))}
                            </ModelSelectorGroup>
                          );
                        })}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              </PromptInputTools>

              <PromptInputSubmit
                disabled={!inputText.trim()}
                status={chatStatus}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
