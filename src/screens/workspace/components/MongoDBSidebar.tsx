/**
 * MongoDB Sidebar Component
 *
 * Displays databases and collections for MongoDB connections.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconDatabase,
  IconLayout2,
  IconRefresh,
  IconSearch,
  IconChevronRight,
  IconChevronDown,
} from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMongoStore } from "@/stores/mongoStore";
import { usePanelStore } from "@/stores/panelStore";
import { v4 as uuidv4 } from "uuid";

interface MongoDBSidebarProps {
  connectionId: string;
  isLoading?: boolean;
}

interface DatabaseNode {
  name: string;
  collections: string[];
  isExpanded: boolean;
  isLoading: boolean;
}

export function MongoDBSidebar({
  connectionId,
  isLoading: initialLoading,
}: MongoDBSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [databases, setDatabases] = useState<DatabaseNode[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    currentDatabase,
    currentCollection,
    setCurrentDatabase,
    setCurrentCollection,
  } = useMongoStore();

  const { addTabToPanel, activePanelId } = usePanelStore();

  // Load databases on mount
  useEffect(() => {
    if (connectionId && !initialLoading) {
      void loadDatabases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, initialLoading]);

  const loadDatabases = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      const result = await invoke<{ name: string }[]>("mongo_list_databases", {
        connId: connectionId,
      });
      setDatabases(
        result.map((db) => ({
          name: db.name,
          collections: [],
          isExpanded: false,
          isLoading: false,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadCollections = async (dbName: string) => {
    setDatabases((prev) =>
      prev.map((db) => (db.name === dbName ? { ...db, isLoading: true } : db)),
    );

    try {
      // First, set the current database context
      setCurrentDatabase(dbName);

      const result = await invoke<{ name: string; type: string }[]>(
        "mongo_list_collections",
        { connId: connectionId },
      );

      setDatabases((prev) =>
        prev.map((db) =>
          db.name === dbName
            ? {
                ...db,
                collections: result.map((c) => c.name),
                isExpanded: true,
                isLoading: false,
              }
            : db,
        ),
      );
    } catch (err) {
      console.error("Failed to load collections:", err);
      setDatabases((prev) =>
        prev.map((db) =>
          db.name === dbName ? { ...db, isLoading: false } : db,
        ),
      );
    }
  };

  const toggleDatabase = (dbName: string) => {
    const db = databases.find((d) => d.name === dbName);
    if (!db) return;

    if (db.isExpanded) {
      // Collapse
      setDatabases((prev) =>
        prev.map((d) => (d.name === dbName ? { ...d, isExpanded: false } : d)),
      );
    } else {
      // Expand and load collections if needed
      if (db.collections.length === 0) {
        void loadCollections(dbName);
      } else {
        setDatabases((prev) =>
          prev.map((d) => (d.name === dbName ? { ...d, isExpanded: true } : d)),
        );
      }
    }
  };

  const handleCollectionClick = (dbName: string, collectionName: string) => {
    setCurrentDatabase(dbName);
    setCurrentCollection(collectionName);

    // Open a collection browser tab in the active panel
    const tabId = uuidv4();
    if (activePanelId) {
      addTabToPanel(activePanelId, {
        id: tabId,
        title: collectionName,
        type: "mongo-collection",
        connectionId,
        payload: {
          database: dbName,
          tableName: collectionName, // Using tableName to store collection name
        },
      });
    }
  };

  // Filter databases and collections based on search
  const filteredDatabases = databases.filter((db) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    if (db.name.toLowerCase().includes(query)) return true;
    return db.collections.some((c) => c.toLowerCase().includes(query));
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
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={loadDatabases}
          disabled={isRefreshing}
        >
          <IconRefresh
            className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
          />
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-2 text-xs text-destructive select-text bg-destructive/10 m-2 rounded">
          {error}
        </div>
      )}

      {/* Database Tree */}
      <div className="flex-1 overflow-y-auto p-1">
        {filteredDatabases.length === 0 && !isRefreshing && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No databases found
          </div>
        )}

        {filteredDatabases.map((db) => (
          <div key={db.name} className="select-none">
            {/* Database Node */}
            <button
              className={cn(
                "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent",
                currentDatabase === db.name && "bg-accent",
              )}
              onClick={() => {
                toggleDatabase(db.name);
              }}
            >
              {db.isLoading ? (
                <div className="h-3 w-3 border border-primary border-t-transparent rounded-full animate-spin" />
              ) : db.isExpanded ? (
                <IconChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <IconChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              <IconDatabase className="h-3.5 w-3.5 text-primary" />
              <span className="truncate">{db.name}</span>
              {db.collections.length > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {db.collections.length}
                </span>
              )}
            </button>

            {/* Collections */}
            {db.isExpanded && (
              <div className="ml-4 border-l border-border/50">
                {db.collections
                  .filter(
                    (c) =>
                      !searchQuery ||
                      c.toLowerCase().includes(searchQuery.toLowerCase()),
                  )
                  .map((collection) => (
                    <button
                      key={collection}
                      className={cn(
                        "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent ml-1",
                        currentCollection === collection &&
                          currentDatabase === db.name &&
                          "bg-accent",
                      )}
                      onClick={() => {
                        handleCollectionClick(db.name, collection);
                      }}
                    >
                      <IconLayout2 className="h-3.5 w-3.5 text-amber-500" />
                      <span className="truncate">{collection}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
