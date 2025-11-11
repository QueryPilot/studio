import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { invoke } from "@tauri-apps/api/core";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Bot, User, Settings, Loader2 } from "lucide-react";
import { useAIStore } from "@/stores/aiStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { AutoResizeTextarea } from "./AutoResizeTextarea";
import { ModelSelector } from "./ModelSelector";
import { MentionAutocomplete, type MentionItem } from "./MentionAutocomplete";
import { DefaultChatTransport } from "ai";
import { TextPart } from "./PartRenders/TextPart";
import { AssistantMessageParts } from "./PartRenders/AssistantMessageParts";
import { AI_SIDECAR_URL } from "@/config/constants";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

export function AIAssistantSidebar() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );
  const selectedSchema = useWorkspaceSelectionStore((state) => state.schema);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Hardcoded sidecar URL - matches the port in sidecar constants
  const sidecarUrl = AI_SIDECAR_URL;
  const [isConfigured, setIsConfigured] = useState(false);
  const [sidecarReady, setSidecarReady] = useState(false);
  const [initializingMessage, setInitializingMessage] = useState(
    "Checking AI sidecar...",
  );
  const {
    selectedProvider,
    activeModel,
    defaultModels,
    configuredProviders,
    isInitialized,
    providers,
  } = useAIStore();
  const { openPreferences } = usePreferencesStore();
  const [input, setInput] = useState("");

  // Helper function to find provider for a given model
  const getProviderForModel = useCallback(
    (model: string): string => {
      const provider = providers.find((p) => p.models.includes(model));
      return provider?.name || selectedProvider;
    },
    [providers, selectedProvider],
  );

  // Track current provider based on active model (not just default provider)
  const [currentProvider, setCurrentProvider] = useState<string>(() =>
    getProviderForModel(activeModel),
  );

  // Mention autocomplete state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });

  // Update currentProvider when activeModel changes
  useEffect(() => {
    if (activeModel && providers.length > 0) {
      const correctProvider = getProviderForModel(activeModel);
      if (correctProvider !== currentProvider) {
        setCurrentProvider(correctProvider);
      }
    }
  }, [activeModel, providers, getProviderForModel, currentProvider]);

  // Poll sidecar status until ready
  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;
    let attemptCount = 0;
    const maxAttempts = 20; // 10 seconds max (20 * 500ms)

    const checkSidecarStatus = async () => {
      try {
        const status: { configLoaded: boolean; status: string } = await invoke(
          "get_sidecar_status",
        );

        if (!isMounted) return;

        if (status.configLoaded) {
          setSidecarReady(true);
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          console.log("✅ Sidecar is ready with configuration");
        } else {
          attemptCount++;
          if (attemptCount >= maxAttempts) {
            setInitializingMessage("Sidecar is taking longer than expected...");
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
          } else {
            setInitializingMessage(
              `Waiting for sidecar configuration... (${attemptCount}/${maxAttempts})`,
            );
          }
        }
      } catch (error) {
        if (!isMounted) return;

        attemptCount++;
        if (attemptCount < maxAttempts) {
          setInitializingMessage(
            `Connecting to sidecar... (${attemptCount}/${maxAttempts})`,
          );
        } else {
          console.error("Failed to check sidecar status:", error);
          setInitializingMessage("Failed to connect to AI sidecar");
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      }
    };

    // Start polling
    void checkSidecarStatus();
    pollInterval = setInterval(() => {
      void checkSidecarStatus();
    }, 500);

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []); // Start polling on mount

  // Check configuration
  useEffect(() => {
    // Check if ANY provider is configured (not just current one)
    // Show "Configuration Required" ONLY if NO providers are configured
    const hasAnyConfigured = configuredProviders.length > 0;

    if (hasAnyConfigured && isInitialized) {
      setIsConfigured(true);
    } else {
      setIsConfigured(false);
    }
  }, [configuredProviders, isInitialized]);

  // Initialize useChat hook from AI SDK UI
  const currentModel =
    activeModel || defaultModels[currentProvider] || "gpt-5-2025-08-07";

  // Memoize transport configuration to prevent re-initialization on every render
  const chatTransport = useMemo(() => {
    console.log("🔄 Creating new chat transport with:", {
      sidecarUrl,
      currentModel,
      currentProvider,
      connectionId,
      selectedDatabase,
      selectedSchema,
    });
    return new DefaultChatTransport({
      api: `${sidecarUrl}/chat`,
      body: {
        model: currentModel,
        provider: currentProvider,
      },
      headers: {
        "X-Connection-Id": connectionId || "",
        "X-Connection-Database": selectedDatabase || "",
        "X-Connection-Schema": selectedSchema || "",
      },
    });
  }, [
    sidecarUrl,
    currentModel,
    currentProvider,
    connectionId,
    selectedDatabase,
    selectedSchema,
  ]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: chatTransport,
    onError: (error) => {
      console.error("AI Chat Error:", error);
      toast.error(error.message || "Failed to get AI response");
    },
    onFinish: ({
      message: finishedMessage,
      messages: updatedMessages,
      ...event
    }) => {
      console.log("✅ AI Message finished:", {
        message: finishedMessage,
        messages: updatedMessages,
        event,
      });
      console.log("Message parts:", finishedMessage.parts);
      console.log(
        "Full message object:",
        JSON.stringify(finishedMessage, null, 2),
      );
    },
  });

  // Debug: Log messages when they change
  useEffect(() => {
    console.log("📨 Messages updated:", messages.length, messages);
  }, [messages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Handle @mention detection
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPosition = e.target.selectionStart;

      // Check for @ mention
      const textBeforeCursor = value.substring(0, cursorPosition);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex !== -1 && cursorPosition > atIndex) {
        const query = textBeforeCursor.substring(atIndex + 1);
        // Only show mentions if @ is at start or preceded by whitespace
        const charBeforeAt =
          atIndex > 0 ? textBeforeCursor[atIndex - 1] || " " : " ";
        if (/\s/.test(charBeforeAt) || atIndex === 0) {
          setMentionQuery(query);
          setShowMentions(true);

          // Calculate position for autocomplete popup
          const textarea = e.target;
          const rect = textarea.getBoundingClientRect();
          setMentionPosition({
            top: rect.bottom + 5,
            left: rect.left,
          });
        } else {
          setShowMentions(false);
        }
      } else {
        setShowMentions(false);
      }

      setInput(value);
    },
    [setInput],
  );

  const handleMentionSelect = useCallback((item: MentionItem) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const value = textarea.value;
    const cursorPosition = textarea.selectionStart;

    // Find the @ symbol before cursor
    const textBeforeCursor = value.substring(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      // Replace from @ to cursor with mention
      const mention = `@${item.type}/${item.label}`;
      const newValue =
        value.substring(0, atIndex) +
        mention +
        " " +
        value.substring(cursorPosition);

      // Update input via useChat
      const syntheticEvent = {
        target: { value: newValue },
      } as React.ChangeEvent<HTMLTextAreaElement>;
      setInput(syntheticEvent.target.value);

      // Move cursor after mention
      setTimeout(() => {
        const newPosition = atIndex + mention.length + 1;
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
      }, 0);
    }

    setShowMentions(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't handle shortcuts if mention popup is open
      if (showMentions) {
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void sendMessage({
          text: textareaRef.current?.value || "",
        });
        if (textareaRef.current) {
          textareaRef.current.value = "";
        }
      }
    },
    [sendMessage, showMentions],
  );

  // Show configuration/initialization prompt
  if (!isConfigured || !sidecarReady) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              AI Assistant
            </p>
            <h2 className="text-xs font-medium text-foreground">
              {!sidecarReady ? "Initializing..." : "Configuration Required"}
            </h2>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-sm">
            <div className="flex justify-center">
              <div className="rounded-full bg-muted p-3">
                {!sidecarReady ? (
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                ) : (
                  <Settings className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">
                {!sidecarReady
                  ? "Starting AI Assistant"
                  : "Configure AI Assistant"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {!sidecarReady
                  ? initializingMessage
                  : "Please configure your AI provider and model in Preferences."}
              </p>
            </div>
            {sidecarReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  openPreferences("ai");
                }}
              >
                <Settings className="mr-2 h-4 w-4" />
                Open Settings
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5 gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            AI Assistant
          </p>
          <h2 className="truncate text-xs font-medium text-foreground">
            {selectedProvider} · {currentModel}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {(status === "streaming" || status === "submitted") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={stop}
              aria-label="Stop generation"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-3 mb-4">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium mb-1">Ask me anything</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                I can help you explore your database schema, write queries, and
                analyze your data.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={message.id || index}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {message.role === "assistant" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {message.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <AssistantMessageParts message={message} />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.parts.map((part) => {
                      if (part.type === "text") {
                        return (
                          <TextPart
                            key={`${message.id}-text`}
                            id={message.id}
                            content={part.text}
                          />
                        );
                      }
                      return "";
                    })}
                  </p>
                )}
              </div>
              {message.role === "user" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t px-4 py-3">
        {error && (
          <p className="mb-2 text-xs text-destructive select-text">
            {error.message}
          </p>
        )}
        <form
          onSubmit={() => {
            void sendMessage({
              text: input,
            });
            if (textareaRef.current) {
              textareaRef.current.value = "";
            }
          }}
          className="space-y-2"
        >
          {/* Model Selector */}
          <div className="flex items-center justify-between pb-2 border-b">
            <ModelSelector
              onModelChange={(provider, model) => {
                // Update current provider when model changes
                setCurrentProvider(provider);
                toast.success(`Switched to ${model} (${provider})`);
              }}
            />
            <span className="text-xs text-muted-foreground">
              {messages.length} {messages.length === 1 ? "message" : "messages"}
            </span>
          </div>

          {/* Growing Textarea with @mentions */}
          <div className="relative">
            <AutoResizeTextarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your database... Type @ to mention tables/views"
              disabled={status === "streaming" || status === "submitted"}
              minRows={2}
              maxRows={10}
            />

            {/* @mention Autocomplete */}
            {showMentions && connectionId && (
              <MentionAutocomplete
                connectionId={connectionId}
                query={mentionQuery}
                position={mentionPosition}
                onSelect={handleMentionSelect}
                onClose={() => {
                  setShowMentions(false);
                }}
              />
            )}
          </div>
          <div className="flex justify-between items-center">
            <p className="text-[10px] text-muted-foreground">
              Press{" "}
              {typeof navigator !== "undefined" &&
              navigator.userAgent.includes("Mac")
                ? "Cmd"
                : "Ctrl"}
              +Enter to send
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={
                  status === "streaming" ||
                  status === "submitted" ||
                  !textareaRef.current?.value.trim()
                }
              >
                {status === "streaming" || status === "submitted" ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Thinking…
                  </>
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
