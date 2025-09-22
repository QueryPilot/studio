import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message } from "./types";

interface ChatMessageProps {
  message: Message;
  style?: React.CSSProperties;
}

export function ChatMessage({ message, style }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 2000);
  };

  return (
    <div style={style} className={cn("flex gap-2 p-4", isUser ? "justify-end" : "")}>
      <div className={cn("flex flex-col gap-1", isUser ? "max-w-[70%]" : "max-w-[85%]")}>
        <div
          className={cn(
            "px-3 py-2 rounded-lg text-sm",
            isUser
              ? "bg-muted text-foreground"
              : ""
          )}
        >
          <div className="whitespace-pre-wrap break-words">
            {renderMessageContent(message.content, message.mentions, isUser)}
          </div>
        </div>

        {!isUser && message.role !== 'system' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function renderMessageContent(content: string, mentions?: Message['mentions'], isUser: boolean = false) {
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
            : "bg-muted text-foreground"
        )}
      >
        {mentionText}
      </span>
    );

    lastIndex = mention.position + mentionText.length;
  });

  const remaining = content.substring(lastIndex);
  if (remaining) {
    parts.push(remaining);
  }

  return <>{parts}</>;
}