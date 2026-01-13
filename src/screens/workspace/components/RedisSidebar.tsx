import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconDatabase,
  IconKey,
  IconRefresh,
  IconSearch,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
} from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRedisStore } from "@/stores/redisStore";
import { usePanelStore } from "@/stores/panelStore";
import { v4 as uuidv4 } from "uuid";

interface RedisSidebarProps {
  connectionId: string;
  isLoading?: boolean;
}

// Redis supports 16 databases by default (0-15)
const REDIS_DATABASES = Array.from({ length: 16 }, (_, i) => i);

export function RedisSidebar({
  connectionId,
  isLoading: initialLoading,
}: RedisSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Set<number>>(new Set([0]));
  const [dbSizes, setDbSizes] = useState<Map<number, number>>(new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { 
    currentDatabase, 
    setCurrentDatabase, 
    fetchNextPage, 
    groupedKeys, 
    scannedKeys,
    setScanPattern
  } = useRedisStore();

  const { addTabToPanel, activePanelId } = usePanelStore();

  // Load database sizes on mount
  useEffect(() => {
    if (connectionId && !initialLoading) {
      void loadDatabaseSizes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, initialLoading]);

  const loadDatabaseSizes = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      // Get size of db 0 as an initial check
      const size = await invoke<number>("redis_dbsize", {
        connId: connectionId,
      });
      setDbSizes(new Map([[0, size]]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleDatabase = (dbIndex: number) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbIndex)) {
        next.delete(dbIndex);
      } else {
        // Ensure single expansion logic to match store
        next.clear(); 
        next.add(dbIndex);
        
        // Sync state and refresh
        setCurrentDatabase(dbIndex);
        // Execute DB switch
        invoke("keyvalue_execute", { 
          connId: connectionId, 
          operation: { type: "selectDb", index: dbIndex } 
        }).then(() => {
          void fetchNextPage();
        }).catch(err => console.error("Failed to select DB:", err));
      }
      return next;
    });
  };

  const handleGroupClick = (prefix: string) => {
    setScanPattern(prefix + "*");
    
    // Check if we need to open a tab
    const tabId = uuidv4();
    if (activePanelId) {
      addTabToPanel(activePanelId, {
        id: tabId,
        title: `Browser: ${prefix}*`,
        type: "redis-key",
        connectionId,
        payload: {
          database: String(currentDatabase),
          // No table/selectedKey -> renders Grid
        },
      });
    }
  };

  const openKeyBrowser = (dbIndex: number) => {
    const tabId = uuidv4();
    if (activePanelId) {
      addTabToPanel(activePanelId, {
        id: tabId,
        title: `DB ${dbIndex} Keys`,
        type: "redis-key",
        connectionId,
        payload: {
          database: String(dbIndex),
        },
      });
    }
  };

  if (initialLoading) {
    return (
      <div className="flex flex-col h-full p-2 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search and Refresh */}
      <div className="flex items-center gap-1 p-2 border-b">
        <div className="relative flex-1">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={loadDatabaseSizes}
          disabled={isRefreshing}
        >
          <IconRefresh
            className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
          />
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-2 text-xs text-destructive bg-destructive/10 m-2 rounded">
          {error}
        </div>
      )}

      {/* Database List */}
      <div className="flex-1 overflow-y-auto p-1">
        {REDIS_DATABASES.map((dbIndex) => {
          const size = dbSizes.get(dbIndex) ?? 0;
          const isExpanded = expandedDbs.has(dbIndex);
          // Only show content if this DB is the actively selected one in store
          const isActive = currentDatabase === dbIndex; 
          const showContent = isExpanded && isActive;

          return (
            <div key={dbIndex} className="select-none">
              {/* Database Node */}
              <button
                className={cn(
                  "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent group",
                  isActive && "bg-accent"
                )}
                onClick={() => toggleDatabase(dbIndex)}
              >
                {isExpanded ? (
                  <IconChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <IconChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <IconDatabase className="h-3.5 w-3.5 text-red-500" />
                <span>db{dbIndex}</span>
                {size > 0 && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {size} keys
                  </span>
                )}
                <div 
                  className="hidden group-hover:flex ml-1 p-0.5 rounded hover:bg-background/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    openKeyBrowser(dbIndex);
                  }}
                  title="Open Key Grid"
                >
                  <IconKey className="h-3 w-3 text-muted-foreground" />
                </div>
              </button>

              {/* Groups & Keys */}
              {showContent && (
                <div className="ml-4 border-l border-border/50 pl-1">
                  {/* Groups */}
                  {Array.from(groupedKeys.entries()).map(([prefix, count]) => (
                    <button
                      key={prefix}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent text-left"
                      onClick={() => handleGroupClick(prefix)}
                    >
                      <IconFolder className="h-3.5 w-3.5 text-yellow-500" />
                      <span className="truncate font-mono text-[11px] flex-1">
                        {prefix}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {count}
                      </span>
                    </button>
                  ))}

                  {/* Scanned Keys Preview (limit to 10 to avoid clutter) */}
                  {scannedKeys.slice(0, 10).map((key) => (
                    <div 
                      key={key.key}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
                    >
                      <IconKey className="h-3 w-3 opacity-50" />
                      <span className="truncate font-mono text-[10px]">{key.key}</span>
                    </div>
                  ))}
                  
                  {scannedKeys.length > 10 && (
                    <div 
                      className="px-2 py-1 text-[10px] text-muted-foreground italic cursor-pointer hover:text-foreground"
                      onClick={() => openKeyBrowser(dbIndex)}
                    >
                      ... and {scannedKeys.length - 10} more loaded
                    </div>
                  )}

                  {scannedKeys.length === 0 && (
                    <div className="px-2 py-1 text-[10px] text-muted-foreground">
                      No keys loaded
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
