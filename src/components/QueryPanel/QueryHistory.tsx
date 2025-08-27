import { useEffect, useState } from "react";
import { queryHistoryService, type QueryHistoryEntry } from "@/services/queryHistoryService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Clock, AlertCircle, CheckCircle2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Input } from "@/components/ui/input";

dayjs.extend(relativeTime);

interface QueryHistoryProps {
  connectionId: string;
  database: string;
  onSelectQuery: (query: string) => void;
}

export function QueryHistory({ connectionId, database, onSelectQuery }: QueryHistoryProps) {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [connectionId, database]);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const entries = await queryHistoryService.getHistory(connectionId, database);
      setHistory(entries);
    } catch (error) {
      console.error("Failed to load query history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchTerm.trim()) {
      const results = await queryHistoryService.searchHistory(connectionId, searchTerm);
      setHistory(results);
    } else {
      loadHistory();
    }
  };

  const handleDelete = async (id: number) => {
    if (id) {
      await queryHistoryService.deleteEntry(id);
      loadHistory();
    }
  };

  const handleClearAll = async () => {
    await queryHistoryService.clearHistory(connectionId, database);
    setHistory([]);
  };

  const formatExecutionTime = (ms?: number) => {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading history...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search query history..."
              className="pl-8 h-8"
            />
            {searchTerm && (
              <Button
                onClick={() => {
                  setSearchTerm("");
                  loadHistory();
                }}
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Button
            onClick={handleClearAll}
            variant="outline"
            size="sm"
            disabled={history.length === 0}
          >
            Clear All
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No query history yet</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {history.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "group relative p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors",
                  entry.error && "border-destructive/50"
                )}
                onClick={() => onSelectQuery(entry.query)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {entry.error ? (
                        <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500 flex-shrink-0" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {dayjs(entry.executedAt).fromNow()}
                      </span>
                      {entry.executionTime && (
                        <span className="text-xs text-muted-foreground">
                          • {formatExecutionTime(entry.executionTime)}
                        </span>
                      )}
                      {entry.rowCount !== undefined && !entry.error && (
                        <span className="text-xs text-muted-foreground">
                          • {entry.rowCount} rows
                        </span>
                      )}
                    </div>
                    <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                      {entry.query.length > 200
                        ? `${entry.query.substring(0, 200)}...`
                        : entry.query}
                    </pre>
                    {entry.error && (
                      <p className="text-xs text-destructive mt-1">{entry.error}</p>
                    )}
                  </div>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry.id!);
                    }}
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 flex-shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}