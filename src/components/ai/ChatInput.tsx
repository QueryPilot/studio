import { useState, useRef, useEffect, useCallback } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TableMentionPopup } from "./TableMentionPopup";
import { CommandSuggestionPopup } from "./CommandSuggestionPopup";
import type { TableMention } from "./types";
import {
  getAIProviders,
  type AIProvider,
  type AICommandDefinition,
  type AIAgent,
} from "@/services/opencodeService";
import { isTauri } from "@tauri-apps/api/core";

interface ChatInputProps {
  onSendMessage: (message: string, mentions: TableMention[]) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedModel: string;
  onModelChange: (model: string) => void;
  agents?: AIAgent[];
  selectedAgent?: string;
  onAgentChange?: (agentId: string) => void;
  commands?: AICommandDefinition[];
  commandsLoading?: boolean;
  onRunCommand?: (
    command: AICommandDefinition,
    values: Record<string, string>,
  ) => void | Promise<void>;
  tables?: Array<{ name: string; schema: string; kind?: string; type?: string }>;
}

export function ChatInput({
  onSendMessage,
  disabled,
  placeholder = "Ask a question, use @ for tables or / for commands...",
  selectedModel,
  onModelChange,
  agents = [],
  selectedAgent,
  onAgentChange,
  commands = [],
  commandsLoading = false,
  onRunCommand,
  tables = [],
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionSearchQuery, setMentionSearchQuery] = useState("");
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentions, setMentions] = useState<TableMention[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [showCommandPopup, setShowCommandPopup] = useState(false);
  const [commandSearchQuery, setCommandSearchQuery] = useState("");
  const [commandPosition, setCommandPosition] = useState({ top: 0, left: 0 });
  const [commandTriggerIndex, setCommandTriggerIndex] = useState<number | null>(
    null,
  );
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState<AICommandDefinition | null>(
    null,
  );
  const [commandValues, setCommandValues] = useState<Record<string, string>>({});
  const [pendingCommand, setPendingCommand] = useState<AICommandDefinition | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandLauncherEnabled = Boolean(onRunCommand);
  const agentLauncherEnabled = Boolean(onAgentChange);

  const activeAgent = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = activeAgent?.name ?? "Select agent";
  const agentDisabled = agents.length === 0 || !agentLauncherEnabled;

  const formatVariableLabel = (variable: string): string => {
    return variable
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

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

  const getPopupPosition = useCallback((triggerIndex: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const rect = textarea.getBoundingClientRect();
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight || "0") || 20;
    const baseTop = rect.top + window.scrollY;
    const baseLeft = rect.left + window.scrollX;

    const textBefore = textarea.value.substring(0, triggerIndex);
    const lines = textBefore.split("\n");
    const lineOffset = Math.max(lines.length - 1, 0);

    return {
      top: baseTop + lineOffset * lineHeight + lineHeight + 8,
      left: baseLeft + 16,
    };
  }, []);

  const closeCommandPopup = useCallback(
    (options?: { clearPending?: boolean }) => {
      setShowCommandPopup(false);
      setCommandSearchQuery("");
      setCommandTriggerIndex(null);
      if (options?.clearPending) {
        setPendingCommand(null);
      }
    },
    [],
  );

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
        closeCommandPopup();
        setMentionPosition(getPopupPosition(lastAtSymbol));
      } else {
        setShowMentionPopup(false);
      }
    } else {
      setShowMentionPopup(false);
    }

    if (!commandLauncherEnabled) {
      closeCommandPopup({ clearPending: true });
      return;
    }

    const lastSlash = value.lastIndexOf("/", cursorPosition);
    if (lastSlash !== -1) {
      const charBeforeSlash = lastSlash > 0 ? value[lastSlash - 1] : "";
      const validPrefix = lastSlash === 0 || /\s/.test(charBeforeSlash);
      const textAfterSlash = value.substring(lastSlash + 1, cursorPosition);
      const hasTerminator = /\s/.test(textAfterSlash);

      if (validPrefix && !hasTerminator && commands.length > 0) {
        setCommandSearchQuery(textAfterSlash);
        setCommandTriggerIndex(lastSlash);
        setCommandPosition(getPopupPosition(lastSlash));
        setShowCommandPopup(true);
        setShowMentionPopup(false);
      } else {
        closeCommandPopup({ clearPending: true });
      }
    } else {
      closeCommandPopup({ clearPending: true });
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

  const resetCommandState = () => {
    setActiveCommand(null);
    setCommandValues({});
  };

  const handleCommandSelect = (command: AICommandDefinition) => {
    if (!onRunCommand) return;

    let insertionPoint = message.length;
    let searchEnd = message.length;

    if (commandTriggerIndex !== null) {
      insertionPoint = commandTriggerIndex;
      searchEnd = commandTriggerIndex + 1;
      while (searchEnd < message.length) {
        const ch = message[searchEnd];
        if (ch === undefined || /\s/.test(ch)) break;
        searchEnd += 1;
      }
    }

    const before = message.substring(0, insertionPoint);
    const after = message.substring(searchEnd);
    const commandToken = `/${command.name} `;
    const nextMessage = `${before}${commandToken}${after}`;
    setMessage(nextMessage);
    setPendingCommand(command);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        const caret = insertionPoint + commandToken.length;
        textarea.selectionStart = caret;
        textarea.selectionEnd = caret;
      }
    });

    closeCommandPopup();

    if (command.variables.length > 0) {
      const defaults = command.variables.reduce<Record<string, string>>(
        (acc, variable) => {
          acc[variable] = commandValues[variable] ?? "";
          return acc;
        },
        {},
      );

      setActiveCommand(command);
      setCommandValues(defaults);
      setCommandDialogOpen(true);
    }
  };

  const handleCommandSubmit = () => {
    if (!onRunCommand || !activeCommand) return;

    const sanitized: Record<string, string> = activeCommand.variables.reduce(
      (acc, variable) => {
        acc[variable] = commandValues[variable] ?? "";
        return acc;
      },
      {},
    );

    const hasEmpty = activeCommand.variables.some(
      (variable) => (sanitized[variable] ?? "").trim().length === 0,
    );
    if (hasEmpty) return;

    const submitResult = onRunCommand(activeCommand, sanitized);
    if (submitResult instanceof Promise) {
      submitResult.catch((error: unknown) => {
        console.error("Failed to run AI command", error);
      });
    }
    setCommandDialogOpen(false);
    resetCommandState();
    setPendingCommand(null);
    setMessage("");
  };

  const handleSend = () => {
    if (!selectedModel) {
      // force user to pick a model first; open the selector
      setModelOpen(true);
      return;
    }

    if (
      pendingCommand &&
      !commandDialogOpen &&
      commandLauncherEnabled &&
      onRunCommand
    ) {
      const trimmed = message.trim();
      const commandName = `/${pendingCommand.name}`;
      if (trimmed === commandName || trimmed.startsWith(`${commandName} `)) {
        const runResult = onRunCommand(pendingCommand, {});
        if (runResult instanceof Promise) {
          runResult.catch((error: unknown) => {
            console.error("Failed to run AI command shortcut", error);
          });
        }
        setPendingCommand(null);
        setMessage("");
        setMentions([]);
        setShowMentionPopup(false);
        closeCommandPopup({ clearPending: true });
        return;
      }
    }

    if (message.trim() && !disabled) {
      onSendMessage(message.trim(), mentions);
      setMessage("");
      setMentions([]);
      setShowMentionPopup(false);
      closeCommandPopup({ clearPending: true });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (showMentionPopup || showCommandPopup) &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Tab")
    ) {
      e.preventDefault();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    if (e.key === "Escape" && showMentionPopup) {
      setShowMentionPopup(false);
    }
    if (e.key === "Escape" && showCommandPopup) {
      e.preventDefault();
      closeCommandPopup({ clearPending: true });
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowMentionPopup(false);
        closeCommandPopup({ clearPending: true });
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [closeCommandPopup]);

  useEffect(() => {
    const handleFocusShortcut = (_event: Event) => {
      textareaRef.current?.focus();
    };

    const handleCommandShortcut = (_event: Event) => {
      if (!commandLauncherEnabled || disabled || commands.length === 0) return;
      closeCommandPopup({ clearPending: true });
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const currentValue = textarea.value;
      const selectionStart = textarea.selectionStart;
      const cursor =
        typeof selectionStart === "number"
          ? selectionStart
          : currentValue.length;
      const before = currentValue.substring(0, cursor);
      const after = currentValue.substring(cursor);
      const needsSlash = cursor === 0 || !before.endsWith("/");
      const nextValue = needsSlash ? `${before}/${after}` : currentValue;
      const triggerIndex = needsSlash ? cursor : cursor - 1;

      if (needsSlash) {
        setMessage(nextValue);
      }

      requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        const caret = triggerIndex + 1;
        target.selectionStart = caret;
        target.selectionEnd = caret;
        setCommandTriggerIndex(triggerIndex);
        setCommandSearchQuery("");
        setCommandPosition(getPopupPosition(triggerIndex));
        setShowCommandPopup(true);
        setShowMentionPopup(false);
      });
    };

    window.addEventListener("devdb-ai-focus", handleFocusShortcut);
    window.addEventListener("devdb-ai-open-commands", handleCommandShortcut);

    return () => {
      window.removeEventListener("devdb-ai-focus", handleFocusShortcut);
      window.removeEventListener("devdb-ai-open-commands", handleCommandShortcut);
    };
  }, [
    closeCommandPopup,
    commandLauncherEnabled,
    disabled,
    getPopupPosition,
    commands.length,
  ]);

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

          {/* Model/agent selectors and send button on same line */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
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

              {agentLauncherEnabled ? (
                <Popover open={agentOpen} onOpenChange={setAgentOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                      disabled={agentDisabled}
                    >
                      <span className="truncate max-w-[140px]">{agentLabel}</span>
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search agents..."
                        className="text-xs"
                      />
                      <CommandList>
                        <CommandEmpty>No agents found.</CommandEmpty>
                        {agents.length > 0 && (
                          <CommandGroup heading="Agents">
                            {agents.map((agent) => (
                              <CommandItem
                                key={agent.id}
                                value={`${agent.name} ${agent.description ?? ""}`}
                                onSelect={() => {
                                  onAgentChange?.(agent.id);
                                  setAgentOpen(false);
                                }}
                                className="flex flex-col items-start gap-0.5 text-xs"
                              >
                                <span className="text-xs font-medium">
                                  {agent.name}
                                </span>
                                {agent.description ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    {agent.description}
                                  </span>
                                ) : null}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : null}

              {/* Slash command picker is triggered inline via `/` */}
            </div>

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

      <Dialog
        open={commandDialogOpen}
        onOpenChange={(open) => {
          setCommandDialogOpen(open);
          if (!open) {
            resetCommandState();
            setPendingCommand(null);
          }
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {activeCommand ? `/${activeCommand.name}` : "Command"}
            </DialogTitle>
            <DialogDescription>
              Fill in the details and we will run the command with those
              inputs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {activeCommand?.variables.map((variable) => (
              <div key={variable} className="space-y-1">
                <Label htmlFor={`command-${variable}`} className="text-xs">
                  {formatVariableLabel(variable)}
                </Label>
                <Textarea
                  id={`command-${variable}`}
                  value={commandValues[variable] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCommandValues((prev) => ({
                      ...prev,
                      [variable]: value,
                    }));
                  }}
                  className="text-xs"
                  rows={3}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCommandDialogOpen(false);
                resetCommandState();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCommandSubmit}
              disabled={
                !onRunCommand ||
                !activeCommand ||
                !activeCommand.variables.every(
                  (variable) =>
                    (commandValues[variable] ?? "").trim().length > 0,
                ) ||
                disabled
              }
            >
              Run command
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TableMentionPopup
        isOpen={showMentionPopup}
        searchQuery={mentionSearchQuery}
        position={mentionPosition}
        onSelect={handleTableSelect}
        tables={tables}
      />
      <CommandSuggestionPopup
        isOpen={showCommandPopup && commandLauncherEnabled}
        searchQuery={commandSearchQuery}
        position={commandPosition}
        commands={commands}
        loading={commandsLoading}
        onSelect={handleCommandSelect}
        onClose={closeCommandPopup}
      />
    </>
  );
}
