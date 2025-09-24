import { useState, useRef, useEffect } from "react";
import { Send, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { TableMentionPopup } from "./TableMentionPopup";
import type { TableMention } from "./types";
import { getAIProviders, type AIProvider } from "@/services/opencodeService";
import { isTauri } from "@tauri-apps/api/core";

interface ChatInputProps {
  onSendMessage: (message: string, mentions: TableMention[]) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedModel: string;
  onModelChange: (model: string) => void;
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
  const [modelOpen, setModelOpen] = useState(false);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea as content grows
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      // Reset height to auto to recalculate
      textarea.style.height = 'auto';
      // Set to scrollHeight but limit to 30vh
      const maxHeight = window.innerHeight * 0.3;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message]);

  useEffect(() => {
    if (!isTauri()) return;

    const loadProviders = async () => {
      setLoadingModels(true);
      try {
        const providerList = await getAIProviders();
        setProviders(providerList);
      } catch (error) {
        console.error("Failed to load providers:", error);
      } finally {
        setLoadingModels(false);
      }
    };

    void loadProviders();
  }, []);

  const getModelDisplay = () => {
    if (!selectedModel) return "Select model...";
    // selectedModel may be either "provider/model" or raw model id
    let providerId: string | undefined;
    let modelId = selectedModel;
    if (selectedModel.includes("/")) {
      const parts = selectedModel.split("/");
      providerId = parts[0];
      modelId = parts.slice(1).join("/");
    }
    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      const model = provider?.models.find((m) => m.id === modelId);
      if (model?.name) return model.name;
    }
    // Fallback: search all providers for matching raw id
    for (const p of providers) {
      const m = p.models.find(
        (mm) => mm.id === selectedModel || mm.id === modelId,
      );
      if (m?.name) return m.name;
    }
    return modelId;
  };

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
    if (!selectedModel) {
      // force user to pick a model first; open the selector
      setModelOpen(true);
      return;
    }
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
        <div className="flex flex-col p-2 gap-2">
          {/* Input area */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="resize-none !text-xs border-0 bg-transparent !px-2 !py-2 !focus:outline-none !focus:ring-0 shadow-none overflow-y-auto"
            style={{ minHeight: '40px' }}
          />

          {/* Model selector and send button on same line */}
          <div className="flex items-center justify-between">
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                  disabled={loadingModels}
                >
                  <span className="truncate">{getModelDisplay()}</span>
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search models..."
                    className="text-xs"
                  />
                  <CommandList>
                    <CommandEmpty>No models found.</CommandEmpty>
                    {providers.map((provider) => (
                      <CommandGroup key={provider.id} heading={provider.name}>
                        {provider.models.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={`${provider.name} ${model.name}`}
                            onSelect={() => {
                              onModelChange(`${provider.id}/${model.id}`);
                              setModelOpen(false);
                            }}
                            className="text-xs"
                          >
                            <span className="text-xs">{model.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

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
