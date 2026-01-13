/**
 * Redis Sidebar Component
 *
 * Displays databases (0-15) and keys for Redis connections.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconDatabase,
  IconKey,
  IconRefresh,
  IconSearch,
  IconChevronRight,
  IconChevronDown,
  IconHash,
  IconList,
  IconBraces,
  IconSortAscending,
  IconTimeline,
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

interface KeyInfo {
  key: string;
  type: string;
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
  const [keys, setKeys] = useState<Map<number, KeyInfo[]>>(new Map());
  const [loadingDbs, setLoadingDbs] = useState<Set<number>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentDatabase, selectedKey, setCurrentDatabase, selectKey } =
    useRedisStore();

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

  const loadKeysForDb = useCallback(
    async (dbIndex: number, _pattern = "*") => {
      setLoadingDbs((prev) => new Set(prev).add(dbIndex));

      try {
        // For now, we'll use INFO to get key count since we don't have SCAN yet
        // In a real implementation, we'd use SCAN for pagination
        const size = await invoke<number>("redis_dbsize", {
          connId: connectionId,
        });
        
        setDbSizes((prev) => new Map(prev).set(dbIndex, size));
        
        // Note: We don't have KEYS/SCAN command exposed yet
        // For now, just show the database is expandable
        setKeys((prev) => new Map(prev).set(dbIndex, []));
      } catch (err) {
        console.error(`Failed to load keys for db ${dbIndex}:`, err);
      } finally {
        setLoadingDbs((prev) => {
          const next = new Set(prev);
          next.delete(dbIndex);
          return next;
        });
      }
    },
    [connectionId]
  );

  const toggleDatabase = (dbIndex: number) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbIndex)) {
        next.delete(dbIndex);
      } else {
        next.add(dbIndex);
        // Load keys if not already loaded
        if (!keys.has(dbIndex)) {
          void loadKeysForDb(dbIndex);
        }
      }
      return next;
    });
    setCurrentDatabase(dbIndex);
  };

  const handleKeyClick = (dbIndex: number, keyName: string, _keyType: string) => {
    setCurrentDatabase(dbIndex);
    selectKey(keyName);

    // Open a key viewer tab in the active panel
    const tabId = uuidv4();
    if (activePanelId) {
      addTabToPanel(activePanelId, {
        id: tabId,
        title: keyName,
        type: "redis-key",
        connectionId,
        payload: {
          database: String(dbIndex),
          tableName: keyName, // Using tableName to store key name
        },
      });
    }
  };

  const getKeyTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "string":
        return <IconKey className="h-3.5 w-3.5 text-green-500" />;
      case "hash":
        return <IconHash className="h-3.5 w-3.5 text-blue-500" />;
      case "list":
        return <IconList className="h-3.5 w-3.5 text-purple-500" />;
      case "set":
        return <IconBraces className="h-3.5 w-3.5 text-orange-500" />;
      case "zset":
        return <IconSortAscending className="h-3.5 w-3.5 text-pink-500" />;
      case "stream":
        return <IconTimeline className="h-3.5 w-3.5 text-cyan-500" />;
      default:
        return <IconKey className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Filter databases that have keys or match search
  const filteredDatabases = REDIS_DATABASES.filter((dbIndex) => {
    if (!searchQuery) return true;
    const dbKeys = keys.get(dbIndex) || [];
    return dbKeys.some((k) =>
      k.key.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

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
        {filteredDatabases.map((dbIndex) => {
          const size = dbSizes.get(dbIndex) ?? 0;
          const isExpanded = expandedDbs.has(dbIndex);
          const isLoading = loadingDbs.has(dbIndex);
          const dbKeys = keys.get(dbIndex) || [];

          return (
            <div key={dbIndex} className="select-none">
              {/* Database Node */}
              <button
                className={cn(
                  "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent",
                  currentDatabase === dbIndex && "bg-accent"
                )}
                onClick={() => toggleDatabase(dbIndex)}
              >
                {isLoading ? (
                  <div className="h-3 w-3 border border-primary border-t-transparent rounded-full animate-spin" />
                ) : isExpanded ? (
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
              </button>

              {/* Keys */}
              {isExpanded && (
                <div className="ml-4 border-l border-border/50">
                  {dbKeys.length === 0 && !isLoading && (
                    <div className="px-2 py-1 text-[10px] text-muted-foreground ml-1">
                      Use CLI to browse keys
                    </div>
                  )}
                  {dbKeys
                    .filter(
                      (k) =>
                        !searchQuery ||
                        k.key.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((keyInfo) => (
                      <button
                        key={keyInfo.key}
                        className={cn(
                          "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent ml-1",
                          selectedKey === keyInfo.key &&
                            currentDatabase === dbIndex &&
                            "bg-accent"
                        )}
                        onClick={() =>
                          handleKeyClick(dbIndex, keyInfo.key, keyInfo.type)
                        }
                      >
                        {getKeyTypeIcon(keyInfo.type)}
                        <span className="truncate font-mono text-[11px]">
                          {keyInfo.key}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Info */}
      <div className="p-2 border-t text-[10px] text-muted-foreground">
        <div className="flex justify-between">
          <span>DB 0 Keys:</span>
          <span>{dbSizes.get(0) ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
