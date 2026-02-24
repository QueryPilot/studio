import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { RedisAdapter } from "@/adapters/redis/RedisAdapter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Play,
  Trash2,
  Terminal,
  Copy,
  Check,
  AlertTriangle,
  Database,
  Zap,
  Key,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  REDIS_COMMANDS,
  type RedisCommand,
  isDangerousCommand,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from "@/data/redisCommands";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { createPortal } from "react-dom";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";

interface RedisCliPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: number;
  className?: string;
}

interface HistoryItem {
  id: string;
  command: string;
  args: string[];
  output: string | object | null;
  timestamp: Date;
  status: "running" | "success" | "error";
  executionTime?: number;
}

// Type guard for Redis typed response
interface RedisTypedValue {
  type: string;
  value?: unknown;
}

function isRedisTypedValue(obj: unknown): obj is RedisTypedValue {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    typeof (obj as RedisTypedValue).type === "string"
  );
}

// Extract the actual value from Redis typed response
function extractRedisValue(output: unknown): unknown {
  if (isRedisTypedValue(output)) {
    const { type, value } = output;
    // Handle nil type specially - it may not have a value property
    if (type === "nil") {
      return null;
    }
    if (type === "array" && Array.isArray(value)) {
      return value.map(extractRedisValue);
    }
    return value;
  }
  if (Array.isArray(output)) {
    return output.map(extractRedisValue);
  }
  return output;
}

// Get the Redis type from a typed response
function getRedisType(output: unknown): string | null {
  if (isRedisTypedValue(output)) {
    return output.type;
  }
  return null;
}

function formatRedisOutput(output: unknown): string {
  // Handle Redis typed values
  if (isRedisTypedValue(output)) {
    return formatRedisOutput(extractRedisValue(output));
  }

  if (output === null) return "(nil)";
  if (output === undefined) return "(nil)";
  if (typeof output === "string") return output;
  if (typeof output === "number") return String(output);
  if (typeof output === "boolean") return output ? "true" : "false";
  if (Array.isArray(output)) {
    if (output.length === 0) return "(empty array)";
    return output
      .map((item, index) => `${index + 1}) ${formatRedisOutput(item)}`)
      .join("\n");
  }
  if (typeof output === "object") {
    return JSON.stringify(output, null, 2);
  }
  return "";
}

// Type badge component
function RedisTypeBadge({ type }: { type: string }) {
  const typeColors: Record<string, string> = {
    string: "text-green-600 bg-green-500/10",
    integer: "text-blue-600 bg-blue-500/10",
    array: "text-purple-600 bg-purple-500/10",
    bulk: "text-orange-600 bg-orange-500/10",
    status: "text-cyan-600 bg-cyan-500/10",
    error: "text-red-600 bg-red-500/10",
    nil: "text-gray-500 bg-gray-500/10",
  };

  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide",
        typeColors[type] || "text-muted-foreground bg-muted",
      )}
    >
      {type}
    </span>
  );
}

// Thresholds for collapsing
// Thresholds for collapsing
const COLLAPSE_ARRAY_THRESHOLD = 10; // Collapse arrays with more than 10 elements
const COLLAPSE_STRING_LENGTH = 500; // Collapse strings longer than 500 chars
const COLLAPSE_STRING_LINES = 5; // Collapse strings with more than 5 lines
const PREVIEW_ARRAY_COUNT = 5; // Show first 5 items in preview
const PREVIEW_LINE_COUNT = 3; // Show first 3 lines in preview
const PREVIEW_CHAR_LENGTH = 200; // Show first 200 chars in preview

// Get truncated preview of a string
function getStringPreview(str: string, hasNewlines: boolean): string {
  if (hasNewlines) {
    const lines = str.split("\n");
    if (lines.length > PREVIEW_LINE_COUNT) {
      return lines.slice(0, PREVIEW_LINE_COUNT).join("\n");
    }
  }
  if (str.length > PREVIEW_CHAR_LENGTH) {
    return str.slice(0, PREVIEW_CHAR_LENGTH);
  }
  return str;
}

// Render array items
function ArrayItemsDisplay({
  items,
  startIndex = 0,
}: {
  items: unknown[];
  startIndex?: number;
}) {
  return (
    <div className="space-y-0.5 pl-2 border-l border-border/50">
      {items.map((item, index) => (
        <div
          key={startIndex + index}
          className="flex items-start gap-2 text-xs group/item"
        >
          <span className="text-muted-foreground/60 shrink-0 w-5 text-right font-mono text-[10px] pt-0.5">
            {startIndex + index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <RedisValueDisplay output={item} showType={false} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Render a single Redis value with its type
function RedisValueDisplay({
  output,
  showType = true,
}: {
  output: unknown;
  showType?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const type = getRedisType(output);
  const value = extractRedisValue(output);

  // Handle nil/null
  if (value === null || value === undefined) {
    return (
      <div className="space-y-1">
        {showType && type && <RedisTypeBadge type={type} />}
        <span className="text-muted-foreground italic text-xs">(nil)</span>
      </div>
    );
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="space-y-1">
          {showType && <RedisTypeBadge type="array" />}
          <span className="text-muted-foreground italic text-xs">
            (empty array)
          </span>
        </div>
      );
    }

    const isLargeArray = value.length > COLLAPSE_ARRAY_THRESHOLD;
    const previewItems = value.slice(0, PREVIEW_ARRAY_COUNT);
    const remainingCount = value.length - PREVIEW_ARRAY_COUNT;

    return (
      <div className="space-y-1">
        {showType && (
          <div className="flex items-center gap-2">
            <RedisTypeBadge type="array" />
            <span className="text-muted-foreground text-[10px]">
              {value.length} {value.length === 1 ? "element" : "elements"}
            </span>
          </div>
        )}
        {isLargeArray && !isExpanded ? (
          <>
            <ArrayItemsDisplay items={previewItems} />
            <button
              onClick={() => {
                setIsExpanded(true);
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              <ChevronRight className="w-3 h-3" />
              <span>Show {remainingCount} more elements...</span>
            </button>
          </>
        ) : (
          <>
            <ArrayItemsDisplay items={value} />
            {isLargeArray && (
              <button
                onClick={() => {
                  setIsExpanded(false);
                }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-2"
              >
                <ChevronDown className="w-3 h-3" />
                <span>Show less</span>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // Handle objects (non-Redis typed) - cast to reset type narrowing since extractRedisValue returns unknown
  if (typeof value === "object") {
    const jsonStr = JSON.stringify(value, null, 2);
    const isLargeObject = jsonStr.length > COLLAPSE_STRING_LENGTH;
    const previewJson = getStringPreview(jsonStr, true);

    return (
      <div className="space-y-1">
        {showType && type && <RedisTypeBadge type={type} />}
        <pre className="text-xs font-mono select-text whitespace-pre-wrap break-all bg-muted/30 rounded px-2 py-1">
          {isExpanded || !isLargeObject ? jsonStr : previewJson + "..."}
        </pre>
        {isLargeObject && (
          <button
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                <span>Show all ({jsonStr.length} chars)</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  // Handle primitives (string, number, boolean)
  const displayValue =
    typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : JSON.stringify(value);

  // Check if string has newlines (like INFO command output)
  const hasNewlines = typeof value === "string" && value.includes("\n");
  const lineCount = hasNewlines ? displayValue.split("\n").length : 1;
  const isLargeString =
    displayValue.length > COLLAPSE_STRING_LENGTH ||
    lineCount > COLLAPSE_STRING_LINES;

  // Get preview for collapsed state
  const previewValue = isLargeString
    ? getStringPreview(displayValue, hasNewlines)
    : displayValue;
  const showValue = isExpanded || !isLargeString ? displayValue : previewValue;

  return (
    <div className="space-y-1">
      {showType && type && <RedisTypeBadge type={type} />}
      {hasNewlines || isLargeString ? (
        <pre className="font-mono text-xs select-text whitespace-pre-wrap break-all text-foreground">
          {showValue}
          {!isExpanded && isLargeString && (
            <span className="text-muted-foreground">...</span>
          )}
        </pre>
      ) : (
        <span className="font-mono text-xs select-text break-all text-foreground">
          {showValue}
        </span>
      )}
      {isLargeString && (
        <button
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors bg-muted/30 rounded px-2 py-1 sticky bottom-0"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Show less</span>
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              <span>
                Show all (
                {lineCount > COLLAPSE_STRING_LINES
                  ? `${lineCount} lines`
                  : `${displayValue.length} chars`}
                )
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

function RedisOutputDisplay({
  output,
  status,
}: {
  output: unknown;
  status: string;
}) {
  if (status === "error") {
    const errorMessage = isRedisTypedValue(output)
      ? String(extractRedisValue(output))
      : formatRedisOutput(output);
    return (
      <div className="space-y-1.5">
        <RedisTypeBadge type="error" />
        <span className="text-red-500 font-mono text-xs select-text whitespace-pre-wrap break-all block">
          {errorMessage}
        </span>
      </div>
    );
  }

  return <RedisValueDisplay output={output} />;
}

export const RedisCliPanel = ({
  panelId: _panelId,
  tabId: _tabId,
  connectionId,
  database,
  className,
}: RedisCliPanelProps) => {
  void _panelId;
  void _tabId;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showDangerousWarning, setShowDangerousWarning] = useState<
    string | null
  >(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [autocompletePosition, setAutocompletePosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const adapterRef = useRef<RedisAdapter | null>(null);

  useEffect(() => {
    adapterRef.current = new RedisAdapter(connectionId);
    adapterRef.current.selectDatabase(database).catch(console.error);

    return () => {
      adapterRef.current = null;
    };
  }, [connectionId, database]);

  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(event.target as Node)
      ) {
        setShowAutocomplete(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const filteredCommands = useMemo(() => {
    if (!input.trim()) return [];
    const searchTerm = input.split(" ")[0]?.toUpperCase() || "";
    if (searchTerm.length < 1) return [];
    return REDIS_COMMANDS.filter((cmd) =>
      cmd.name.toUpperCase().startsWith(searchTerm),
    ).slice(0, 10);
  }, [input]);

  const executeCommand = useCallback(async (commandInput: string) => {
    if (!commandInput.trim() || !adapterRef.current) return;

    const fullCommand = commandInput.trim();
    const parts = fullCommand.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (parts.length === 0) return;

    const command = parts[0] ?? "";
    const args = parts.slice(1).map((arg) => arg.replace(/^"(.*)"$/, "$1"));

    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      command,
      args,
      output: null,
      timestamp: new Date(),
      status: "running",
    };

    setHistory((prev) => [...prev, newItem]);
    setInput("");
    setHistoryIndex(-1);
    setIsExecuting(true);

    const startTime = performance.now();

    try {
      const result = await adapterRef.current.executeRaw(command, args);
      const executionTime = performance.now() - startTime;

      setHistory((prev) =>
        prev.map((item) =>
          item.id === newItem.id
            ? {
                ...item,
                output: result,
                status: "success",
                executionTime,
              }
            : item,
        ),
      );
    } catch (error) {
      const executionTime = performance.now() - startTime;
      let errorMessage = "Unknown error";
      if (error instanceof Error) errorMessage = error.message;
      else if (typeof error === "string") errorMessage = error;

      setHistory((prev) =>
        prev.map((item) =>
          item.id === newItem.id
            ? {
                ...item,
                output: errorMessage,
                status: "error",
                executionTime,
              }
            : item,
        ),
      );
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, []);

  const handleExecute = useCallback(async () => {
    if (!input.trim()) return;

    const parts = input.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const command = parts[0]?.toUpperCase() || "";

    if (isDangerousCommand(command)) {
      setShowDangerousWarning(command);
      return;
    }

    await executeCommand(input);
  }, [input, executeCommand]);

  const confirmDangerousCommand = useCallback(async () => {
    setShowDangerousWarning(null);
    await executeCommand(input);
  }, [input, executeCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showAutocomplete && filteredCommands.length > 0) {
        const selectedCmd = filteredCommands[selectedAutocompleteIndex];
        if (selectedCmd) {
          handleAutocompleteSelect(selectedCmd);
        }
      } else {
        void handleExecute();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showAutocomplete && filteredCommands.length > 0) {
        setSelectedAutocompleteIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1,
        );
      } else if (history.length > 0) {
        const newIndex =
          historyIndex === -1
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        const historyItem = history[newIndex];
        if (historyItem) {
          setInput([historyItem.command, ...historyItem.args].join(" "));
        }
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showAutocomplete && filteredCommands.length > 0) {
        setSelectedAutocompleteIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0,
        );
      } else if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIndex);
          const historyItem = history[newIndex];
          if (historyItem) {
            setInput([historyItem.command, ...historyItem.args].join(" "));
          }
        }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        const selectedCmd = filteredCommands[selectedAutocompleteIndex];
        if (selectedCmd) {
          handleAutocompleteSelect(selectedCmd);
        }
      }
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
      setShowDangerousWarning(null);
    }
  };

  const handleAutocompleteSelect = (cmd: RedisCommand) => {
    const currentInput = input.trim();
    const spaceIndex = currentInput.indexOf(" ");
    if (spaceIndex === -1) {
      setInput(cmd.name + " ");
    } else {
      const args = currentInput.slice(spaceIndex + 1);
      setInput(cmd.name + " " + args);
    }
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);
    setHistoryIndex(-1);
    const shouldShow = value.trim().length > 0;
    setShowAutocomplete(shouldShow);
    setSelectedAutocompleteIndex(0);

    if (shouldShow && inputContainerRef.current) {
      const rect = inputContainerRef.current.getBoundingClientRect();
      setAutocompletePosition({
        top: rect.top - 8,
        left: rect.left,
        width: rect.width - 48,
      });
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
    inputRef.current?.focus();
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId(null);
      }, 2000);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const insertQuickCommand = (command: string) => {
    setInput(command);
    inputRef.current?.focus();
  };

  const quickCommands = [
    { label: "PING", command: "PING", icon: Zap },
    { label: "INFO", command: "INFO", icon: Database },
    { label: "DBSIZE", command: "DBSIZE", icon: Database },
    { label: "KEYS", command: "KEYS *", icon: Key },
  ];

  return (
    <TooltipProvider>
      <div
        className={cn("flex flex-col h-full bg-background relative", className)}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-medium">Redis CLI</span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              DB {database}
            </Badge>
          </div>
          <div className="flex items-center gap-0.5">
            {quickCommands.map((cmd) => (
              <Button
                key={cmd.label}
                variant="ghost"
                size="sm"
                onClick={() => {
                  insertQuickCommand(cmd.command);
                }}
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <cmd.icon className="w-3 h-3 mr-1" />
                {cmd.label}
              </Button>
            ))}
            <div className="w-px h-3 bg-border mx-0.5" />
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              title="Clear History"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-auto">
          <div className="p-2 space-y-2 font-mono text-xs min-h-full">
            {history.length === 0 && (
              <div className="text-muted-foreground text-center py-8 opacity-50">
                <Terminal className="w-8 h-8 mx-auto mb-3 opacity-20" />
                <p className="text-xs">Enter a Redis command to start</p>
                <p className="text-[10px] mt-1 text-muted-foreground/60">
                  Example: SET mykey "Hello World"
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {quickCommands.map((cmd) => (
                    <Button
                      key={cmd.label}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        insertQuickCommand(cmd.command);
                      }}
                      className="text-[10px] h-6 px-2"
                    >
                      <cmd.icon className="w-3 h-3 mr-1" />
                      {cmd.command}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {history.map((item) => (
              <div
                key={item.id}
                className="group animate-in fade-in slide-in-from-bottom-1 duration-150"
              >
                {/* Command line */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-muted-foreground/40 select-none">
                    {format(item.timestamp, "HH:mm:ss")}
                  </span>
                  <span className="text-emerald-500 font-medium">
                    {item.command}
                  </span>
                  <span className="text-foreground/80">
                    {item.args.join(" ")}
                  </span>
                  {item.executionTime !== undefined && (
                    <div className="mt-1 text-[10px] text-muted-foreground/80 text-right flex-1">
                      {item.executionTime < 10
                        ? `${item.executionTime.toFixed(2)}ms`
                        : item.executionTime < 100
                          ? `${item.executionTime.toFixed(1)}ms`
                          : `${Math.round(item.executionTime)}ms`}
                    </div>
                  )}
                </div>

                {/* Output */}
                <div
                  className={cn(
                    "mt-1.5 pl-2 border-l-2 py-1.5 pr-2 rounded-r relative group/output",
                    item.status === "error"
                      ? "border-red-500/50 bg-red-500/5"
                      : "border-emerald-500/30 bg-muted/20",
                  )}
                >
                  {item.status === "running" ? (
                    <span className="text-muted-foreground animate-pulse text-[11px]">
                      Executing...
                    </span>
                  ) : (
                    <>
                      <RedisOutputDisplay
                        output={item.output}
                        status={item.status}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-0.5 right-0.5 h-5 w-5 opacity-0 group-hover/output:opacity-100 transition-opacity"
                        onClick={() =>
                          copyToClipboard(
                            formatRedisOutput(item.output),
                            item.id,
                          )
                        }
                      >
                        {copiedId === item.id ? (
                          <Check className="w-2.5 h-2.5 text-green-500" />
                        ) : (
                          <Copy className="w-2.5 h-2.5" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={scrollViewportRef} />
          </div>
        </div>

        {/* Sticky input area at bottom - matching AI Panel style */}
        <div className="shrink-0 p-1.5">
          <div
            ref={inputContainerRef}
            className={cn(
              "relative rounded-xl border-2 bg-background transition-all duration-200",
              "border-border hover:border-border/80",
              "focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.1)]",
            )}
          >
            {/* Input row */}
            <div className="flex items-center relative">
              <span className="text-emerald-500 font-mono font-semibold select-none text-xs mr-2 absolute left-2 top-1/2 -translate-y-1/2">
                &gt;
              </span>
              <Input
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a command..."
                className={cn(
                  "flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/50",
                  "focus-visible:ring-0 focus-visible:ring-offset-0 border-0",
                  "pl-7 pr-4 py-4 rounded-none",
                )}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            {/* Footer inside the input container */}
            <div className="flex items-center gap-1.5 p-1 px-1.5">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                <span>
                  <Kbd className="font-mono">↑↓</Kbd> history
                </span>
                <span>
                  <Kbd className="font-mono">Tab</Kbd> complete
                </span>
              </div>
              <div className="flex-1" />

              {/* Keyboard hint */}
              {input.trim() && (
                <span className="text-[10px] text-muted-foreground/50 mr-2 hidden sm:inline">
                  <Kbd className="font-mono">↵</Kbd> to run
                </span>
              )}

              <Button
                onClick={() => {
                  void handleExecute();
                }}
                disabled={isExecuting || !input.trim()}
                size="icon"
                className={cn(
                  "h-6 w-6 rounded-md transition-all",
                  input.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    : "text-muted-foreground",
                )}
                variant={input.trim() ? "default" : "ghost"}
              >
                <Play
                  className={cn("w-3.5 h-3.5", isExecuting && "animate-pulse")}
                />
              </Button>
            </div>
          </div>

          {showAutocomplete &&
            filteredCommands.length > 0 &&
            autocompletePosition &&
            createPortal(
              <div
                ref={autocompleteRef}
                className="fixed bg-popover border rounded shadow-lg max-h-48 overflow-y-auto z-9999 text-[11px]"
                style={{
                  top: `${autocompletePosition.top}px`,
                  left: `${autocompletePosition.left}px`,
                  width: `${autocompletePosition.width}px`,
                  transform: "translateY(-100%)",
                }}
              >
                {filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.name}
                    onClick={() => {
                      handleAutocompleteSelect(cmd);
                    }}
                    className={cn(
                      "w-full px-2 py-1 text-left flex items-center justify-between hover:bg-accent transition-colors border-b last:border-b-0 border-border/30",
                      index === selectedAutocompleteIndex && "bg-accent",
                    )}
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="font-mono font-medium shrink-0">
                        {cmd.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-mono truncate">
                        {cmd.args}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {cmd.dangerous && (
                        <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] h-3.5 px-1",
                          CATEGORY_COLORS[cmd.category],
                        )}
                      >
                        {CATEGORY_LABELS[cmd.category]}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>

        {showDangerousWarning && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border rounded-lg p-6 max-w-md shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-500/10 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold">Dangerous Command</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                The command{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  {showDangerousWarning}
                </code>{" "}
                may cause data loss or performance issues.
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                Are you sure you want to execute this command?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDangerousWarning(null);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDangerousCommand}>
                  Execute Anyway
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
