/**
 * Conversation List Component
 *
 * Displays list of conversations with create/delete actions.
 */

import { useCallback } from "react";
import { useConnectionConversations } from "@/hooks/usePersistedChat";
import { db } from "@/lib/db/conversations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface ConversationListProps {
  connectionId: string | null;
  onSelectConversation?: (conversationId: string) => void;
}

export function ConversationList({
  connectionId,
  onSelectConversation,
}: ConversationListProps) {
  const { conversations, isLoading } = useConnectionConversations(connectionId);

  const handleCreateNew = useCallback(async () => {
    if (!connectionId) return;

    const newId = crypto.randomUUID();
    await db.conversations.add({
      id: newId,
      connectionId,
      title: "New Conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    onSelectConversation?.(newId);
  }, [connectionId, onSelectConversation]);

  const handleDelete = useCallback(async (id: string) => {
    await db.deleteConversation(id);
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      onSelectConversation?.(id);
    },
    [onSelectConversation]
  );

  if (isLoading) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Loading conversations...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Conversations</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateNew}
            disabled={!connectionId}
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" />
            New Conversation
          </Button>
        </div>
        {conversations && conversations.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {conversations.length} conversation{conversations.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!conversations || conversations.length === 0 ? (
          <Card className="bg-muted/50">
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">
                No conversations yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a new conversation to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          conversations.map((conv) => (
            <Card
              key={conv.id}
              className="hover:bg-accent transition-colors cursor-pointer group"
            >
              <CardHeader className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 justify-start h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSelect(conv.id)}
                    aria-label={`Select conversation ${conv.title}`}
                  >
                    <div className="text-left">
                      <CardTitle className="text-sm font-medium">
                        {conv.title}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(conv.updatedAt, { addSuffix: true })}
                      </p>
                    </div>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(conv.id);
                    }}
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
