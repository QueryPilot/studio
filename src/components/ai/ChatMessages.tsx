import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChatMessage } from "./ChatMessage";
import type { Message } from "./types";

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const allItems = [...messages];
  if (isLoading) {
    allItems.push({
      id: 'loading',
      role: 'assistant' as const,
      content: '',
      timestamp: new Date(),
    });
  }

  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
      }, 0);
    }
  }, [messages.length, allItems.length, virtualizer]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-2 max-w-md">
          <h3 className="text-lg font-medium text-foreground/80">How can I help you today?</h3>
          <p className="text-sm text-muted-foreground">
            Ask me about your database, SQL queries, or use @ to mention specific tables
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const message = allItems[virtualItem.index];
          if (!message) return null;

          const isLoadingItem = message.id === 'loading';

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {isLoadingItem ? (
                <div className="flex gap-2 p-4">
                  <div className="flex gap-1 items-center">
                    <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
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

