import { useState, useCallback } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  DEFAULT_MODEL,
  type AIModel,
  type Message,
  type TableMention,
} from "./types";

interface ChatAssistantProps {
  connectionId: string;
}

export function ChatAssistant({
  connectionId: _connectionId,
}: ChatAssistantProps) {
  const [selectedModel, setSelectedModel] = useState<AIModel>(DEFAULT_MODEL);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const generateMockResponse = (
    model: AIModel,
    _userMessage: string,
  ): string => {
    const responses: Record<string, string[]> = {
      claude: [
        "I can help you analyze your database schema and write efficient SQL queries. What specific aspect would you like to explore?",
        "Based on your query, here's an optimized approach using indexes and proper joins for better performance.",
        "I've analyzed the table structure you mentioned. Here are some suggestions for improving your database design.",
      ],
      openai: [
        "Let me help you with that SQL query. I'll optimize it for better performance and readability.",
        "I understand your database structure. Here's a comprehensive solution using best practices.",
        "Great question! I can suggest several approaches to solve this database challenge.",
      ],
    };

    const providerResponses =
      responses[model.provider] || responses["openai"] || [];
    if (!providerResponses.length) {
      return "How can I help you with your database?";
    }
    return (
      providerResponses[Math.floor(Math.random() * providerResponses.length)] ||
      "How can I help you?"
    );
  };

  const handleSendMessage = useCallback(
    (content: string, mentions: TableMention[]) => {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
        mentions: mentions.length > 0 ? mentions : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      setTimeout(() => {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: generateMockResponse(selectedModel, content),
          timestamp: new Date(),
          model: selectedModel.id,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
      }, 1000 + Math.random() * 1000);
    },
    [selectedModel],
  );

  const handleModelChange = (model: AIModel) => {
    setSelectedModel(model);

    const systemMessage: Message = {
      id: Date.now().toString(),
      role: "system",
      content: `Switched to ${model.name}`,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, systemMessage]);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <ChatHeader onSettingsClick={() => {}} />

      <ChatMessages messages={messages} isLoading={isLoading} />

      <ChatInput
        onSendMessage={handleSendMessage}
        disabled={isLoading}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
      />
    </div>
  );
}
