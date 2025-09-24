import { useState, useCallback, useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  getAIProviders,
  createSession,
  sendChatMessage,
  listSessionMessages,
  type AISession,
} from "@/services/opencodeService";
import { type Message, type TableMention } from "./types";
import { useAIStore } from "@/stores/aiStore";

interface ChatAssistantProps {
  connectionId: string;
}

export function ChatAssistant({
  connectionId: _connectionId,
}: ChatAssistantProps) {
  const selectedModel = useAIStore((s) => s.selectedModel);
  const setSelectedModel = useAIStore((s) => s.setSelectedModel);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_providers, setProviders] = useState<
    {
      id: string;
      name: string;
      models: { id: string; name?: string }[];
      default_model?: string;
    }[]
  >([]);
  const [currentSession, setCurrentSession] = useState<AISession | null>(null);
  const [_versions, setVersions] = useState<{
    opencode?: string;
    codex?: string;
    _source?: "cli" | "manifest";
  }>({});

  // Load providers and set default model
  useEffect(() => {
    if (!isTauri()) return;

    const loadProviders = async () => {
      try {
        const providerList = await getAIProviders();
        setProviders(providerList);

        // Set default model: first provider's default or first model
        if (!selectedModel && providerList.length > 0) {
          const firstProvider = providerList[0];
          if (firstProvider) {
            const candidate =
              firstProvider.default_model ?? firstProvider.models[0]?.id ?? "";
            if (candidate) {
              const qualified: string = candidate.includes("/")
                ? candidate
                : `${firstProvider.id}/${candidate}`;
              setSelectedModel(qualified);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load providers:", error);
      }
    };

    void loadProviders();
  }, [selectedModel, setSelectedModel]);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<Array<{ tool: string; version?: string; source?: string }>>(
      "get_ai_sidecar_versions",
    )
      .then((list) => {
        const map: { [k: string]: string | undefined } = {};
        let src: "cli" | "manifest" | undefined;
        list.forEach((it) => {
          if (it.version) map[it.tool] = it.version;
          if (!src && (it.source === "cli" || it.source === "manifest")) {
            src = it.source;
          }
        });
        setVersions({
          opencode: map["opencode"],
          codex: map["codex"],
          _source: src,
        });
        const oc = map["opencode"] || "-";
        const cx = map["codex"] || "-";
        console.info(
          `[AI] sidecars: opencode=${oc} codex=${cx} source=${
            src ?? "unknown"
          }`,
        );
      })
      .catch(() => {
        /* ignore for now */
      });
  }, []);

  const handleSendMessage = useCallback(
    async (content: string, mentions: TableMention[]) => {
      // Ensure we have a session id without racing double-creation
      const ensureSessionId = async (): Promise<string | null> => {
        if (currentSession?.id) return currentSession.id;
        const s = await createSession();
        if (s?.id) {
          setCurrentSession(s);
          return s.id;
        }
        return null;
      };

      const sessionId = await ensureSessionId();
      if (!sessionId) {
        console.error("No session available");
        return;
      }

      // Add user message to UI
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
        mentions: mentions.length > 0 ? mentions : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Create assistant message placeholder
      const assistantMessageId = (Date.now() + 1).toString();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        model: selectedModel,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      try {
        // Send message to OpenCode with streaming
        await sendChatMessage(
          sessionId,
          content,
          selectedModel,
          (chunk) => {
            // Update assistant message with streamed content
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: msg.content + chunk }
                  : msg,
              ),
            );
          },
          () => {
            setIsLoading(false);
            // Fallback: if no streamed text arrived, fetch latest assistant message
            void (async () => {
              try {
                const hist = await listSessionMessages(sessionId);
                const last = [...hist]
                  .reverse()
                  .find((m) => m.role === "assistant" && m.content);
                if (last?.content) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId && msg.content.length === 0
                        ? {
                            ...msg,
                            content: last.content,
                            model: last.model ?? msg.model,
                          }
                        : msg,
                    ),
                  );
                }
              } catch (e) {
                console.error("Failed to backfill assistant message:", e);
              }
            })();
          },
        );
      } catch (error) {
        console.error("Failed to send message:", error);
        setIsLoading(false);

        // Show error message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content:
                    "Sorry, I encountered an error processing your message.",
                }
              : msg,
          ),
        );
      }
    },
    [selectedModel, currentSession],
  );

  const handleSessionChange = useCallback((session: AISession) => {
    setCurrentSession(session);
    // Clear messages when switching sessions
    setMessages([]);
  }, []);

  // Load messages whenever session changes
  useEffect(() => {
    if (!isTauri()) return;
    const sid = currentSession?.id;
    if (!sid) return;
    // placeholder for future streaming cancellation
    let _cancelled = false;
    void _cancelled;
    void (async () => {
      try {
        const raw = await listSessionMessages(sid);
        const mapped: Message[] = raw.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
          model: m.model,
        }));
        setMessages(mapped);
      } catch (e) {
        console.error("Failed to load session messages:", e);
      }
    })();
    return () => {
      _cancelled = true;
    };
  }, [currentSession?.id]);

  return (
    <div className="flex flex-col h-full bg-background">
      <ChatHeader
        selectedSession={currentSession}
        onSessionChange={handleSessionChange}
        onSettingsClick={() => {}}
      />

      <ChatMessages messages={messages} isLoading={isLoading} />

      <ChatInput
        onSendMessage={handleSendMessage}
        disabled={isLoading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}
