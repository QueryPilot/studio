import { Button } from "@/components/ui/button";
import {
  SlidersVertical,
  CheckIcon,
  Loader,
  RefreshCcwIcon,
  CopyIcon,
} from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useAIChat } from "@/hooks/useAIChat";
import { useAIChatStore } from "@/stores/aiChatStore";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { checkSidecarHealth } from "@/services/aiService";

import {
  MessageAction,
  MessageActions,
} from "@/components/ai-elements/message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
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
  } = useAIChatStore();

  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [sidecarHealthy, setSidecarHealthy] = useState<boolean | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [inputText, setInputText] = useState("");

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

  // Initialize sidecar health check and load providers on mount
  useEffect(() => {
    const initialize = async () => {
      setIsInitializing(true);

      // Check sidecar health
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
      console.log(
        "[AIAssistantSidebar] Auto-selecting configured provider:",
        configuredProviders[0],
      );
      const firstConfigured = availableProviders.find((p) =>
        configuredProviders.includes(p.name),
      );
      if (firstConfigured) {
        setProvider(firstConfigured.name);
        if (firstConfigured.models.length > 0) {
          setModel(firstConfigured.models[0] || "");
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
      console.error("[AIAssistantSidebar] Failed to send message:", error);
      toast.error("Failed to send message", {
        description: "Please try again.",
      });
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    // Set the suggestion text in the input instead of immediately sending
    setInputText(suggestion);
  };

  // Context-aware suggestions
  const suggestions = connectionContext.hasConnection
    ? [
        "Explain the structure of my database tables",
        "Generate a query to find all records from last week",
        "Help me optimize this query for better performance",
        "Show me how to create a new table",
        "What are the relationships between my tables?",
      ]
    : [
        "How do I connect to a database?",
        "What databases are supported?",
        "Explain SQL query basics",
        "How do I create a new connection?",
      ];

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
            <SlidersVertical className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-sm font-medium">Initializing AI Assistant...</p>
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
            <SlidersVertical className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-sm font-medium">AI Service Unavailable</p>
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
              Open Settings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Check if the selected provider has an API key configured on the sidecar
  const isProviderActuallyConfigured =
    selectedProvider && configuredProviders.includes(selectedProvider);

  // Debug logging
  console.log("[AIAssistantSidebar] Debug:", {
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
            <SlidersVertical className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-3 max-w-md">
            <p className="text-sm font-medium">No AI Provider Configured</p>
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
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            openPreferences("ai");
          }}
          title="AI Settings"
        >
          <SlidersVertical className="h-4 w-4" />
        </Button>
      </div>

      {/* Main chat area */}
      <div className="relative flex size-full flex-col overflow-hidden">
        <Conversation className="overflow-hidden">
          <ConversationContent className="gap-2 p-2 overflow-hidden">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center text-muted-foreground space-y-2 max-w-sm">
                  <p className="text-sm font-medium">
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
                        <Tool key={`${message.id}-${i}`}>
                          <ToolHeader
                            state={toolPart.state}
                            title={toolName}
                            type={part.type as `tool-${string}`}
                          />
                          <ToolContent>
                            <ToolInput input={toolPart.input} />
                            {toolPart.state === "output-available" &&
                              toolPart.output && (
                                <ToolOutput
                                  output={toolPart.output}
                                  errorText={undefined}
                                />
                              )}
                            {toolPart.state === "output-error" && (
                              <ToolOutput
                                output={undefined}
                                errorText={
                                  toolPart.errorText || "Tool execution failed"
                                }
                              />
                            )}
                          </ToolContent>
                        </Tool>
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
                                  <RefreshCcwIcon className="size-3" />
                                </MessageAction>
                                <MessageAction
                                  onClick={() =>
                                    navigator.clipboard.writeText(part.text)
                                  }
                                  label="Copy"
                                >
                                  <CopyIcon className="size-3" />
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
                <Loader className="size-3 animate-spin" />
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
                  <ModelSelectorTrigger asChild>
                    <PromptInputButton>
                      {selectedProvider && (
                        <ModelSelectorLogo provider={selectedProvider} />
                      )}
                      {selectedModel && (
                        <ModelSelectorName>{selectedModel}</ModelSelectorName>
                      )}
                    </PromptInputButton>
                  </ModelSelectorTrigger>

                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>

                      {availableProviders
                        .filter((provider) =>
                          configuredProviders.includes(provider.name)
                        )
                        .map((provider) => (
                          <ModelSelectorGroup
                            key={provider.name}
                            heading={provider.name}
                          >
                            {provider.models.map((model) => (
                              <ModelSelectorItem
                                key={model}
                                value={model}
                                onSelect={() => {
                                  setProvider(provider.name);
                                  setModel(model);
                                  setModelSelectorOpen(false);
                                }}
                              >
                                <ModelSelectorLogo provider={provider.name} />
                                <ModelSelectorName>{model}</ModelSelectorName>
                                {selectedProvider === provider.name &&
                                  selectedModel === model && (
                                    <CheckIcon className="ml-auto size-4" />
                                  )}
                              </ModelSelectorItem>
                            ))}
                          </ModelSelectorGroup>
                        ))}
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
    </div>
  );
}
