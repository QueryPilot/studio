import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { TableMentionPopup } from "./TableMentionPopup";
import { AI_MODELS, type AIModel, type TableMention } from "./types";

interface ChatInputProps {
  onSendMessage: (message: string, mentions: TableMention[]) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedModel: AIModel;
  onModelChange: (model: AIModel) => void;
}

export function ChatInput({
  onSendMessage,
  disabled,
  placeholder = "Ask a question or use @ to mention a table...",
  selectedModel,
  onModelChange,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionSearchQuery, setMentionSearchQuery] = useState("");
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentions, setMentions] = useState<TableMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const openaiModels = AI_MODELS.filter((m) => m.provider === "openai");
  const claudeModels = AI_MODELS.filter((m) => m.provider === "anthropic");

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPosition = e.target.selectionStart;
    setMessage(value);

    const lastAtSymbol = value.lastIndexOf("@", cursorPosition);

    if (lastAtSymbol !== -1) {
      const textAfterAt = value.substring(lastAtSymbol + 1, cursorPosition);
      const hasSpaceAfterAt = textAfterAt.includes(" ");

      if (!hasSpaceAfterAt) {
        setMentionSearchQuery(textAfterAt);
        setShowMentionPopup(true);

        if (textareaRef.current) {
          const textarea = textareaRef.current;
          const rect = textarea.getBoundingClientRect();

          const lineHeight = 20;
          const lines = value.substring(0, lastAtSymbol).split("\n");
          const currentLine = lines.length;

          setMentionPosition({
            top: rect.top - 280 + currentLine * lineHeight,
            left: rect.left + 20,
          });
        }
      } else {
        setShowMentionPopup(false);
      }
    } else {
      setShowMentionPopup(false);
    }
  };

  const handleTableSelect = (table: { name: string; schema?: string }) => {
    const lastAtSymbol = message.lastIndexOf("@");
    if (lastAtSymbol !== -1) {
      const beforeAt = message.substring(0, lastAtSymbol);
      const afterCursor = message.substring(
        lastAtSymbol + mentionSearchQuery.length + 1,
      );

      const newMessage = `${beforeAt}@${table.name}${afterCursor}`;
      setMessage(newMessage);

      const newMention: TableMention = {
        table: table.name,
        schema: table.schema,
        position: lastAtSymbol,
      };
      setMentions([...mentions, newMention]);
    }

    setShowMentionPopup(false);
    setMentionSearchQuery("");

    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim(), mentions);
      setMessage("");
      setMentions([]);
      setShowMentionPopup(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      showMentionPopup &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter")
    ) {
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    if (e.key === "Escape" && showMentionPopup) {
      setShowMentionPopup(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowMentionPopup(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <>
      <div className="border-t">
        <div className="p-2 pb-1">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="min-h-[40px] max-h-[200px] resize-none text-sm border-0 bg-transparent px-3 py-2 focus:outline-none focus:ring-0 shadow-none"
          />
        </div>

        <div className="flex items-center justify-between px-3 pb-2">
          <Select
            value={selectedModel.name}
            onValueChange={(name) => {
              const model = AI_MODELS.find((m) => m.name === name);
              if (model) onModelChange(model);
            }}
          >
            <SelectTrigger className="w-[280px] h-7 text-xs border-0 bg-transparent hover:bg-accent focus:ring-0">
              <span>{selectedModel.name}</span>
            </SelectTrigger>
            <SelectContent>
              {openaiModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs px-2">Codex</SelectLabel>
                  {openaiModels.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.name}
                      className="text-xs"
                    >
                      <div className="flex flex-col items-start w-full">
                        <span>{model.name}</span>
                        {model.description && (
                          <span className="text-muted-foreground text-[10px] mt-0.5">
                            {model.description}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}

              {claudeModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs px-2">
                    Claude Code
                  </SelectLabel>
                  {claudeModels.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.name}
                      className="text-xs"
                    >
                      <div className="flex flex-col items-start w-full">
                        <span>{model.name}</span>
                        {model.description && (
                          <span className="text-muted-foreground text-[10px] mt-0.5">
                            {model.description}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          <Button
            onClick={handleSend}
            disabled={!message.trim() || disabled}
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full hover:bg-primary/10"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <TableMentionPopup
        isOpen={showMentionPopup}
        searchQuery={mentionSearchQuery}
        position={mentionPosition}
        onSelect={handleTableSelect}
      />
    </>
  );
}
