import { useState, useRef, useEffect, useCallback } from "react";
import { RedisAdapter } from "@/adapters/redis/RedisAdapter";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Trash2, Clock, Terminal } from "lucide-react";
import { format } from "date-fns";

interface RedisCliPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: number; // Redis DB index (0-15)
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
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize adapter
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

  const handleExecute = useCallback(async () => {
    if (!input.trim() || !adapterRef.current) return;

    const fullCommand = input.trim();
    const parts = fullCommand.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (parts.length === 0) return;

    const command = parts[0] ?? "";
    const args = parts.slice(1).map(arg => arg.replace(/^"(.*)"$/, '$1'));

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
            : item
        )
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
            : item
        )
      );
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleExecute();
    }
  };

  const clearHistory = () => {
    setHistory([]);
    inputRef.current?.focus();
  };

  const renderOutput = (output: string | object | null) => {
    if (output === null) return "nil";
    if (typeof output === "object") return JSON.stringify(output, null, 2);
    return output;
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <ResizablePanelGroup direction="vertical" className="h-full">
        <ResizablePanel defaultSize={85} minSize={20}>
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Terminal className="w-4 h-4" />
                <span className="font-medium">Redis CLI</span>
                <span className="px-1.5 py-0.5 rounded-md bg-muted text-xs">
                  DB {database}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                title="Clear History"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
            </div>
            
            <ScrollArea className="flex-1 p-4 font-mono text-sm">
              <div className="space-y-4">
                {history.length === 0 && (
                  <div className="text-muted-foreground text-center py-10 opacity-50">
                    <Terminal className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Enter a Redis command to start</p>
                    <p className="text-xs mt-2">Example: SET mykey "Hello World"</p>
                  </div>
                )}
                
                {history.map((item) => (
                  <div key={item.id} className="flex flex-col gap-2 group">
                    <div className="flex items-start gap-2">
                      <div className="mt-1 text-muted-foreground/50 select-none">
                        <Clock className="w-3 h-3" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground select-none">
                            {format(item.timestamp, "HH:mm:ss")}
                          </span>
                          <span className="font-bold text-primary">
                            {item.command}
                          </span>
                          <span className="text-foreground/90">
                            {item.args.join(" ")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={cn(
                      "ml-5 pl-4 border-l-2 py-1 overflow-x-auto",
                      item.status === "error" 
                        ? "border-red-500/50 bg-red-500/5 text-red-500" 
                        : "border-green-500/30 bg-muted/30 text-foreground"
                    )}>
                      {item.status === "running" ? (
                        <span className="text-muted-foreground animate-pulse">Executing...</span>
                      ) : (
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                          {renderOutput(item.output)}
                        </pre>
                      )}
                      
                      {item.executionTime !== undefined && (
                        <div className="mt-1 text-[10px] text-muted-foreground/50 text-right">
                          {item.executionTime.toFixed(2)}ms
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={scrollViewportRef} />
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
        
        <ResizableHandle />
        
        <ResizablePanel defaultSize={15} minSize={10} maxSize={50}>
          <div className="h-full p-4 bg-muted/10 flex gap-2 items-start">
            <div className="mt-2.5">
              <span className="text-green-500 font-bold select-none">{">"}</span>
            </div>
            <div className="flex-1 flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); }}
                onKeyDown={handleKeyDown}
                placeholder="Enter command..."
                className="font-mono bg-background"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              <Button 
                onClick={handleExecute} 
                disabled={isExecuting || !input.trim()}
                size="icon"
                className="shrink-0"
              >
                <Play className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
