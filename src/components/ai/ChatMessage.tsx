import { useState } from "react";
import { Copy, ClipboardCheck, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message } from "./types";
import { useToast } from "@/hooks/use-toast";
import useWorkbenchStore from "@/stores/workbenchStore";

interface ChatMessageProps {
  message: Message;
  style?: React.CSSProperties;
}

export function ChatMessage({ message, style }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState<{ [key: string]: boolean }>({});
  const { toast } = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleCopyCode = async (code: string, index: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode({ ...copiedCode, [index]: true });
    setTimeout(() => {
      setCopiedCode({ ...copiedCode, [index]: false });
    }, 2000);
  };

  const handleExecuteCode = (code: string) => {
    console.log("[AI] Execute button clicked, code:", code);

    // Clean up the SQL - remove trailing semicolons as they cause issues
    const cleanedCode = code.trim().replace(/;\s*$/, '');
    console.log("[AI] Cleaned code:", cleanedCode);

    const state = useWorkbenchStore.getState();
    const { focusedPanelId, addTab, panelContents } = state;

    console.log("[AI] Workbench state:", {
      focusedPanelId,
      panelCount: panelContents.size,
      panels: Array.from(panelContents.keys()),
    });

    // Find the first panel to add the tab to
    let targetPanelId = focusedPanelId;

    if (!targetPanelId && panelContents.size > 0) {
      // No focused panel, use the first available panel
      targetPanelId = Array.from(panelContents.keys())[0];
      console.log("[AI] No focused panel, using first:", targetPanelId);
    }

    if (!targetPanelId) {
      console.log("[AI] No panels available at all");
      toast({
        title: "No panel available",
        description: "Unable to create query tab. Please open a database connection first.",
        variant: "destructive",
      });
      return;
    }

    // Get connection info from the panel's existing tabs or use a placeholder
    const panel = panelContents.get(targetPanelId);
    let connectionId = "";
    let database = "";

    if (panel && panel.tabIds.length > 0) {
      // Try to get connection info from existing tabs
      const firstTabMeta = panel.metadata[panel.tabIds[0]];
      if (firstTabMeta) {
        connectionId = firstTabMeta.connectionId || "";
        database = firstTabMeta.database || "";
      }
    }

    // Create unique tab ID
    const tabId = `query-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    console.log("[AI] Adding tab to panel:", targetPanelId, "with id:", tabId);

    // Add the tab with the cleaned SQL code
    addTab(targetPanelId, tabId, {
      type: "query",
      title: "AI Query",
      isQuery: true,
      connectionId,
      database,
      sql: cleanedCode, // Pass the cleaned SQL code here
    });

    console.log("[AI] Tab added successfully");
    toast({
      title: "Query tab opened",
      description: "SQL code has been added to a new query tab",
    });
  };

  const renderAssistantMessage = (msg: Message) => {
    // Parse for <devdb_executable> tags
    const executableRegex = /<devdb_executable>([\s\S]*?)<\/devdb_executable>/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let codeBlockIndex = 0;

    while ((match = executableRegex.exec(msg.content)) !== null) {
      // Add markdown content before the executable block
      if (match.index > lastIndex) {
        const markdownContent = msg.content.slice(lastIndex, match.index);
        parts.push(
          <ReactMarkdown
            key={`md-${lastIndex}`}
            remarkPlugins={[remarkGfm]}
            components={{
              code({ inline, className, children, ...props }: any) {
                const codeMatch = /language-(\w+)/.exec(className || "");
                const language = codeMatch ? codeMatch[1] : undefined;
                const codeString = String(children).replace(/\n$/, "");

                return !inline && language ? (
                  <div className="relative group/code">
                    <SyntaxHighlighter
                      style={oneDark as any}
                      language={language}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        borderRadius: "0.375rem",
                        fontSize: "0.75rem",
                        padding: "1rem",
                      }}
                      {...props}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  </div>
                ) : (
                  <code
                    className={cn(
                      "bg-muted px-1 py-0.5 rounded text-xs",
                      className,
                    )}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-2">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc pl-4 mb-2">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal pl-4 mb-2">{children}</ol>;
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-4 border-muted pl-4 italic">
                    {children}
                  </blockquote>
                );
              },
            }}
          >
            {markdownContent}
          </ReactMarkdown>,
        );
      }

      // Add the executable code block
      const codeContent = match[1].trim();
      const currentCodeIndex = `${msg.id}-exec-${codeBlockIndex}`;
      codeBlockIndex++;

      parts.push(
        <div key={`exec-${match.index}`} className="relative group/code">
          <SyntaxHighlighter
            style={oneDark as any}
            language="sql"
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: "0.375rem",
              fontSize: "0.75rem",
              padding: "1rem",
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
          <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover/code:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] bg-background/80 hover:bg-background"
              onClick={() => handleCopyCode(codeContent, currentCodeIndex)}
            >
              {copiedCode[currentCodeIndex] ? (
                <>
                  <ClipboardCheck className="h-2.5 w-2.5 mr-0.5 text-green-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-2.5 w-2.5 mr-0.5" />
                  Copy
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] bg-background/80 hover:bg-background"
              onClick={() => {
                handleExecuteCode(codeContent);
              }}
            >
              <Play className="h-2.5 w-2.5 mr-0.5" />
              Execute
            </Button>
          </div>
        </div>,
      );

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining markdown content
    if (lastIndex < msg.content.length) {
      const remainingContent = msg.content.slice(lastIndex);
      parts.push(
        <ReactMarkdown
          key={`md-${lastIndex}`}
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }: any) {
              const codeMatch = /language-(\w+)/.exec(className || "");
              const language = codeMatch ? codeMatch[1] : undefined;
              const codeString = String(children).replace(/\n$/, "");

              return !inline && language ? (
                <div className="relative group/code">
                  <SyntaxHighlighter
                    style={oneDark as any}
                    language={language}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: "0.375rem",
                      fontSize: "0.75rem",
                      padding: "1rem",
                    }}
                    {...props}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              ) : (
                <code
                  className={cn(
                    "bg-muted px-1 py-0.5 rounded text-xs",
                    className,
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            p({ children }) {
              return <p className="mb-2">{children}</p>;
            },
            ul({ children }) {
              return <ul className="list-disc pl-4 mb-2">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal pl-4 mb-2">{children}</ol>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="border-l-4 border-muted pl-4 italic">
                  {children}
                </blockquote>
              );
            },
          }}
        >
          {remainingContent}
        </ReactMarkdown>,
      );
    }

    return <>{parts}</>;
  };

  // Show loading state for empty assistant messages
  const isAssistantLoading = message.role === "assistant" && (!message.content || message.content === "");

  return (
    <div
      style={style}
      className={cn(
        "relative group flex gap-2 py-6 px-4",
        isUser ? "justify-end" : "",
      )}
    >
      <div
        className={cn("flex flex-col", isUser ? "max-w-[90%]" : "max-w-[95%]")}
      >
        <div
          className={cn(
            "p-2 -m-2 rounded-lg text-xs relative",
            isUser ? "bg-muted text-foreground" : "",
          )}
        >
          {isAssistantLoading ? (
            // Show loading state for assistant messages without content
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="flex gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: "200ms" }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: "400ms" }}>●</span>
              </div>
              <span className="text-xs">Thinking...</span>
            </div>
          ) : isUser ? (
            <div className="whitespace-pre-wrap break-words">
              {renderMessageContent(message.content, message.mentions, isUser)}
            </div>
          ) : (
            <div className="space-y-2">{renderAssistantMessage(message)}</div>
          )}

          <div
            className={cn(
              "hidden w-full group-hover:flex items-center absolute",
              {
                "-bottom-6 justify-end pr-2": isUser,
                "-bottom-5 justify-start": !isUser,
              },
            )}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <ClipboardCheck className="!h-4 !w-4 text-green-500" />
                </>
              ) : (
                <>
                  <Copy className="!h-4 !w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderMessageContent(
  content: string,
  mentions?: Message["mentions"],
  isUser: boolean = false,
) {
  if (!mentions || mentions.length === 0) {
    return content;
  }

  let lastIndex = 0;
  const parts: React.ReactNode[] = [];

  mentions.forEach((mention, index) => {
    const beforeMention = content.substring(lastIndex, mention.position);
    if (beforeMention) {
      parts.push(beforeMention);
    }

    const mentionText = `@${mention.table}`;
    parts.push(
      <span
        key={`mention-${index}`}
        className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded font-medium text-xs",
          isUser
            ? "bg-background/60 text-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {mentionText}
      </span>,
    );

    lastIndex = mention.position + mentionText.length;
  });

  const remaining = content.substring(lastIndex);
  if (remaining) {
    parts.push(remaining);
  }

  return <>{parts}</>;
}
