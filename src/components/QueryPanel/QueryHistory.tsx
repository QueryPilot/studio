import { logger } from "@/lib/logger";
import { useCallback, useState } from "react";
import {
  queryHistoryService,
  type QueryHistoryEntry,
} from "@/services/queryHistoryService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IconTrash,
  IconClock,
  IconAlertCircle,
  IconCircleCheckFilled,
  IconSearch,
  IconX,
  IconStar,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { formatExecutionTime } from "@/utils/formatTime";

dayjs.extend(relativeTime);

interface QueryHistoryProps {
  connectionId: string;
  database: string;
  onSelectQuery: (query: string) => void;
}

export function QueryHistory({
  connectionId,
  database,
  onSelectQuery,
}: QueryHistoryProps) {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [editingFavorite, setEditingFavorite] = useState<{
    id: number;
    currentName: string;
  } | null>(null);
  const [favoriteName, setFavoriteName] = useState("");

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const entries = await queryHistoryService.getHistory(
        connectionId,
        database,
      );
      setHistory(entries);
    } catch (error) {
      logger.error("Failed to load query history:", error);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database]);

  const handleSearch = useCallback(async () => {
    if (searchTerm.trim()) {
      const results = await queryHistoryService.searchHistory(
        connectionId,
        searchTerm,
      );
      setHistory(results);
    } else {
      void loadHistory();
    }
  }, [connectionId, loadHistory, searchTerm]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (id) {
        await queryHistoryService.deleteEntry(id);
        void loadHistory();
      }
    },
    [loadHistory],
  );

  const handleClearAll = useCallback(async () => {
    await queryHistoryService.clearHistory(connectionId, database);
    setHistory([]);
  }, [connectionId, database]);

  const handleToggleFavorite = useCallback(
    async (id: number, query: string) => {
      try {
        const entry = history.find((h) => h.id === id);
        if (entry?.isFavorite) {
          await queryHistoryService.toggleFavorite(id);
          toast.success("Removed from favorites");
        } else {
          const defaultName =
            query.length > 50 ? `${query.substring(0, 50)}...` : query;
          setEditingFavorite({ id, currentName: defaultName });
          setFavoriteName(defaultName);
        }
        void loadHistory();
      } catch {
        toast.error("Failed to update favorite");
      }
    },
    [history, loadHistory],
  );

  const handleSaveFavorite = useCallback(async () => {
    if (editingFavorite && favoriteName.trim()) {
      try {
        await queryHistoryService.toggleFavorite(
          editingFavorite.id,
          favoriteName.trim(),
        );
        toast.success("Added to favorites");
        setEditingFavorite(null);
        setFavoriteName("");
        void loadHistory();
      } catch {
        toast.error("Failed to save favorite");
      }
    }
  }, [editingFavorite, favoriteName, loadHistory]);

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
            <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleSearch();
                }
              }}
              placeholder="Search query history..."
              className="pl-8 h-8"
            />
            {searchTerm && (
              <Button
                onClick={() => {
                  setSearchTerm("");
                  void loadHistory();
                }}
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              >
                <IconX className="h-3 w-3" />
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
            <IconClock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No query history yet</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {history.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "group relative p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors",
                  entry.error && "border-destructive/50",
                )}
                onClick={() => {
                  onSelectQuery(entry.query);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {entry.error ? (
                        <IconAlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />
                      ) : (
                        <IconCircleCheckFilled className="h-3 w-3 text-green-600 dark:text-green-500 flex-shrink-0" />
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
                      <p className="text-xs text-destructive mt-1">
                        {entry.error}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (entry.id)
                          void handleToggleFavorite(entry.id, entry.query);
                      }}
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7",
                        entry.isFavorite && "opacity-100 text-yellow-500",
                      )}
                    >
                      <IconStar
                        className={cn(
                          "h-3 w-3",
                          entry.isFavorite && "fill-current",
                        )}
                      />
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (entry.id) void handleDelete(entry.id);
                      }}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                    >
                      <IconTrash className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {entry.isFavorite && entry.name && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-yellow-600 dark:text-yellow-500">
                    <IconStar className="h-3 w-3 fill-current" />
                    <span className="font-medium">{entry.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* IconEdit Favorite Dialog */}
      <Dialog
        open={!!editingFavorite}
        onOpenChange={(open) => {
          if (!open) {
            setEditingFavorite(null);
            setFavoriteName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Favorites</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={favoriteName}
                onChange={(e) => {
                  setFavoriteName(e.target.value);
                }}
                placeholder="Enter a name for this query..."
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && handleSaveFavorite()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingFavorite(null);
                  setFavoriteName("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveFavorite}
                disabled={!favoriteName.trim()}
              >
                <IconDeviceFloppy className="size-3!" /> Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
