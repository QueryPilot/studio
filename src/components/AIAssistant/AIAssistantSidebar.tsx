import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { aiService, type AIMessage, type AISessionSummary } from "@/services/ai/aiService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { History, Plus } from "lucide-react";

interface UIMessage extends AIMessage {
  isStreaming?: boolean;
  isLocal?: boolean;
}

export function AIAssistantSidebar() {
  const [sessions, setSessions] = useState<AISessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionsPopoverOpen, setSessionsPopoverOpen] = useState(false);

  const currentSession = useMemo(() => {
    if (!currentSessionId) return null;
    return sessions.find((session) => session.id === currentSessionId) ?? null;
  }, [sessions, currentSessionId]);

  const refreshSessions = useCallback(async () => {
    const existing = await aiService.listSessions();

    if (existing.length === 0) {
      const created = await aiService.createSession("New Session");
      if (created) {
        setSessions([created]);
        setCurrentSessionId(created.id);
      }
      return;
    }

    setSessions(existing);
    setCurrentSessionId((prev) => {
      if (prev) {
        return prev;
      }
      return existing[0]?.id ?? null;
    });
  }, []);

  const refreshHistory = useCallback(
    async (sessionId?: string) => {
      const activeId = sessionId ?? currentSessionId;
      if (!activeId) return;

      const history = await aiService.getHistory(activeId);
      setMessages(history);
      const latestTimestamp = history[history.length - 1]?.createdAt ?? Date.now();
      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeId
            ? {
                ...session,
                messageCount: history.length,
                updatedAt: latestTimestamp,
              }
            : session,
        ),
      );
    },
    [currentSessionId],
  );

  useEffect(() => {
    void refreshSessions();
    return () => {
      aiService.dispose();
    };
  }, [refreshSessions]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    void refreshHistory(currentSessionId);
  }, [currentSessionId, refreshHistory]);

  useEffect(() => {
    const offChunk = aiService.on("chunk", (payload) => {
      if (payload.session_id !== currentSessionId) {
        return;
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: `${last.content}${payload.content}`,
            },
          ];
        }

        const streamingMessage: UIMessage = {
          id: `assistant-stream-${Date.now()}`,
          role: "assistant",
          content: payload.content,
          createdAt: Date.now(),
          isStreaming: true,
        };
        return [...prev, streamingMessage];
      });
    });

    const offComplete = aiService.on("complete", (payload) => {
      if (payload.session_id !== currentSessionId) {
        return;
      }
      setIsStreaming(false);
      void refreshHistory(payload.session_id);
    });

    const offError = aiService.on("error", (payload) => {
      if (payload.session_id !== currentSessionId) {
        return;
      }
      setIsStreaming(false);
      setErrorMessage(payload.message);
      toast.error(payload.message);
    });

    return () => {
      offChunk();
      offComplete();
      offError();
    };
  }, [currentSessionId, refreshHistory]);

  const handleSend = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("No AI session selected");
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const localMessage: UIMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      isLocal: true,
    };

    setMessages((prev) => [...prev, localMessage]);
    setInput("");
    setIsStreaming(true);
    setErrorMessage(null);

    try {
      await aiService.sendMessage(currentSessionId, trimmed);
    } catch (error) {
      setIsStreaming(false);
      setErrorMessage("Failed to send message");
      toast.error("Failed to send message");
      console.error(error);
    }
  }, [currentSessionId, input]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleSessionChange = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    setErrorMessage(null);
    setIsStreaming(false);
    setSessionsPopoverOpen(false);
  }, []);

  const startNewSession = useCallback(async () => {
    const session = await aiService.createSession();
    if (!session) {
      toast.error("Failed to create session");
      return;
    }

    setSessions((prev) => [session, ...prev]);
    handleSessionChange(session.id);
  }, [handleSessionChange]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5 gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            AI Assistant
          </p>
          <h2 className="truncate text-xs font-medium text-foreground">
            {currentSession?.title ?? "Untitled session"}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Popover open={sessionsPopoverOpen} onOpenChange={setSessionsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Session history"
                disabled={sessions.length === 0}
                className="h-8 w-8"
              >
                <History className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search sessions" />
                <CommandList>
                  <CommandEmpty>No sessions found.</CommandEmpty>
                  <CommandGroup heading="Sessions">
                    {sessions.map((session) => (
                      <CommandItem
                        key={session.id}
                        value={session.id}
                        onSelect={() => { handleSessionChange(session.id); }}
                      >
                        <span className="truncate">{session.title}</span>
                        {session.messageCount > 0 && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {session.messageCount}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={startNewSession}
            aria-label="Start new session"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted",
                message.isStreaming && "border border-dashed border-primary/40",
              )}
            >
              <p className="whitespace-pre-wrap leading-relaxed">
                {message.content}
              </p>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask a question about your database to get started.
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="border-t px-4 py-3">
        {errorMessage && (
          <p className="mb-2 text-xs text-destructive">{errorMessage}</p>
        )}
        <Textarea
          value={input}
          onChange={(event) => { setInput(event.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your database schema, queries, or data…"
          disabled={isStreaming}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={handleSend} disabled={isStreaming || !input.trim()}>
            {isStreaming ? "Thinking…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
