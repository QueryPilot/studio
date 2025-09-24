import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChatMessage } from "./ChatMessage";
import type { Message } from "./types";
import { Button } from "@/components/ui/button";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// opener kept previously for fallback; unused after backend-only open
import {
  ensureOpencodeServer,
  beginAnthropicOAuth,
  exchangeAnthropicCode,
  setAnthropicOAuth,
  verifyOpencodeAuth,
} from "@/services/opencodeService";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [requesting, setRequesting] = useState(false);
  const [isLoginActive, setIsLoginActive] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pendingUrlRef = useRef<string | null>(null);
  const verifierRef = useRef<string>("");
  const { toast } = useToast();

  // Check auth status on mount
  useEffect(() => {
    if (!isTauri()) return;

    const checkAuth = async () => {
      try {
        const authenticated = await invoke<boolean>(
          "ai_opencode_is_authenticated",
        );
        setIsAuthed(authenticated);
      } catch (error) {
        console.error("Failed to check auth status:", error);
      }
    };

    void checkAuth();
  }, []);

  const allItems = [...messages];
  // Show loading indicator when isLoading is true but no assistant message exists yet
  // This happens before the assistant message placeholder is created
  const lastMessage = messages[messages.length - 1];
  const showLoadingIndicator =
    isLoading && (!lastMessage || lastMessage.role !== "assistant");

  if (showLoadingIndicator) {
    allItems.push({
      id: "loading",
      role: "assistant" as const,
      content: "",
      timestamp: new Date(),
    });
  }

  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 8,
    getItemKey: (index) => allItems[index]?.id ?? String(index),
    // Measure real row heights to prevent overlap when content wraps
    measureElement: (el: Element | null) =>
      (el as HTMLElement | null)?.getBoundingClientRect().height || 0,
  });

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        virtualizer.scrollToIndex(allItems.length - 1, { align: "end" });
        // Re-measure the last row after content changes (helps during streaming)
        const el = parentRef.current?.querySelector(
          `[data-index="${allItems.length - 1}"]`,
        ) as HTMLElement | null;
        if (el) virtualizer.measureElement(el);
      }, 0);
    }
  }, [messages.length, allItems.length, virtualizer]);

  // Listen for login URL events from backend
  useEffect(() => {
    if (!isTauri()) return;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        // Initial auth state
        try {
          const authed = await invoke<boolean>("ai_opencode_is_authenticated");
          setIsAuthed(authed);
        } catch (err) {
          console.warn("[AI] auth check failed", err);
        }

        // Listen for login started
        const unlistenStarted = await listen(
          "ai:opencode-login-started",
          () => {
            console.info("[AI] opencode login started");
            setIsLoginActive(true);
          },
        );
        unlisteners.push(unlistenStarted);

        // Listen for intermediate auth URL (may change); UI just displays
        const unlistenUrl = await listen(
          "ai:opencode-login-url",
          (e: { payload?: unknown }) => {
            const payload = e.payload as Record<string, unknown> | undefined;
            const url =
              typeof payload?.url === "string" ? payload.url : undefined;

            console.info("[AI] event ai:opencode-login-url", payload);
            if (!url) return;

            pendingUrlRef.current = url;
            setAuthUrl(url);
          },
        );
        unlisteners.push(unlistenUrl);

        // Listen to the final latest URL from backend (debounced/opened server-side)
        const unlistenLatestUrl = await listen(
          "ai:opencode-login-url-latest",
          (e: { payload?: { url?: string } }) => {
            const url = e.payload?.url;
            if (url) {
              pendingUrlRef.current = url;
              setAuthUrl(url);
            }
          },
        );
        unlisteners.push(unlistenLatestUrl);

        // Listen for login status (success / failed)
        const unlistenStatus = await listen(
          "ai:opencode-login-status",
          (e: { payload?: { status?: string } }) => {
            const status = e.payload?.status;
            if (status === "success") {
              toast({
                title: "Authenticated with Claude",
                description: "Login successful.",
              });
              setIsAuthed(true);
              setIsLoginActive(false);
              setAuthUrl(null);
            } else if (status === "failed") {
              toast({
                title: "Authorization failed",
                description: "Please retry sign-in.",
                variant: "destructive",
              });
              setIsLoginActive(false);
              setAuthUrl(null);
              pendingUrlRef.current = null;
            }
          },
        );
        unlisteners.push(unlistenStatus);

        // Listen for login lines (for debugging)
        const unlistenLines = await listen(
          "ai:opencode-login-line",
          (e: { payload?: { stream?: string; line?: string } }) => {
            const payload = e.payload || {};
            console.info("[AI] login stream", payload.stream, payload.line);
          },
        );
        unlisteners.push(unlistenLines);
      } catch (err) {
        console.warn("[AI] failed to attach event listener", err);
      }
    })();

    return () => {
      unlisteners.forEach((fn) => {
        fn();
      });
    };
  }, [toast]);

  // Removed old poll-based helper; now we verify via SDK + auth ls

  if (messages.length === 0 && !isLoading) {
    if (isAuthed) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2 max-w-md">
            <h3 className="text-lg font-medium text-foreground/80">
              How can I help you today?
            </h3>
            <p className="text-sm text-muted-foreground">
              Ask me about your database, SQL queries, or use @ to mention
              specific tables
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-2 max-w-md">
          <h3 className="text-lg font-medium text-foreground/80">
            How can I help you today?
          </h3>
          <p className="text-sm text-muted-foreground">
            Ask me about your database, SQL queries, or use @ to mention
            specific tables
          </p>
          {isTauri() && (
            <div className="pt-2">
              <Button
                size="sm"
                disabled={requesting}
                onClick={async () => {
                  try {
                    setRequesting(true);
                    // Ensure opencode server is up for SDK operations
                    if (isTauri()) {
                      console.log("AI ensureOpencodeServer");
                      await ensureOpencodeServer();
                    }
                    // Check if already authenticated
                    const authed = await invoke<boolean>(
                      "ai_opencode_is_authenticated",
                    );
                    if (authed) {
                      return;
                    }

                    // OpenAuth-based flow
                    pendingUrlRef.current = null;
                    const { url, verifier } = await beginAnthropicOAuth(
                      "oauth",
                    );
                    pendingUrlRef.current = url;
                    verifierRef.current = verifier; // Store verifier in ref
                    setAuthUrl(url);
                    await invoke("ai_open_system_url", { url });
                    setIsLoginActive(true);
                  } catch {
                    toast({
                      title: "Failed to start login flow",
                      description: "Please retry.",
                      variant: "destructive",
                    });
                  } finally {
                    setRequesting(false);
                  }
                }}
              >
                {requesting && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Sign in to Claude
              </Button>
              {isLoginActive && (
                <div className="mt-3 text-xs text-muted-foreground">
                  {authUrl && (
                    <div className="flex justify-center mt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isSubmitting}
                        onClick={async () => {
                          setIsSubmitting(true);
                          try {
                            // Use Tauri clipboard API
                            const { readText } = await import(
                              "@tauri-apps/plugin-clipboard-manager"
                            );
                            const code = await readText();

                            if (!code || !code.trim()) {
                              toast({
                                title: "No code found",
                                description:
                                  "Please copy the code from your browser first.",
                                variant: "destructive",
                              });
                              setIsSubmitting(false);
                              return;
                            }

                            const verifier = verifierRef.current; // Get verifier from ref
                            // Exchange code (backend does network; UI never sends token anywhere else)
                            const creds = await exchangeAnthropicCode(
                              code.trim(),
                              verifier,
                            );
                            await setAnthropicOAuth(
                              creds.access,
                              creds.refresh,
                              creds.expires,
                            );
                            const ok = await verifyOpencodeAuth();

                            if (ok) {
                              setIsAuthed(true);
                              setIsLoginActive(false);
                              setAuthUrl(null);
                              toast({
                                title: "Authenticated with Claude",
                                description: "Login successful.",
                              });
                            } else {
                              throw new Error("verify failed");
                            }
                          } catch (e) {
                            const msg =
                              e instanceof Error ? e.message : String(e);
                            toast({
                              title: "Authentication failed",
                              description: msg,
                              variant: "destructive",
                            });
                          } finally {
                            setIsSubmitting(false);
                            setIsLoginActive(false);
                            setAuthUrl(null);
                            pendingUrlRef.current = null;
                          }
                        }}
                      >
                        {isSubmitting && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        {isSubmitting
                          ? "Submitting..."
                          : "Paste Code from Clipboard"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto pb-4">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const message = allItems[virtualItem.index];
          if (!message) return null;

          const isLoadingItem = message.id === "loading";

          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {isLoadingItem ? (
                <div className="flex gap-2 py-2 px-2">
                  <div className="flex gap-0.5 items-center">
                    <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              ) : (
                <ChatMessage message={message} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
