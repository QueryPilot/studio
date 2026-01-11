import React, { useMemo, useCallback } from "react";
import {
  IconCheck,
  IconCircleFilled,
  IconDatabase,
  IconLoader2,
  IconPlus,
  IconExternalLink,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { databaseService } from "@/services/databaseService";
import { windowManager } from "@/services/windowManager";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface DatabaseItem {
  name: string;
  hasProfile: boolean;
  isCurrent: boolean;
}

const DATABASE_FUSE_OPTIONS: IFuseOptions<DatabaseItem> = {
  keys: ["name"],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

interface NestedDatabaseListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (database: string) => void;
  onClose?: () => void;
}

export function NestedDatabaseList({
  listRef,
  query,
  onSelect,
  onClose,
}: NestedDatabaseListProps): React.ReactElement {
  const connectionId = useWorkspaceSelectionStore((state) => state.connectionId);
  const currentDatabase = useWorkspaceSelectionStore((state) => state.database);
  const connections = useConnectionStore((state) => state.connections);
  const currentConnection = useConnectionStore((state) =>
    connectionId ? state.getConnection(connectionId) : undefined,
  );

  // Workspace store for add to workspace functionality
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const addConnectionToWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToWorkspace,
  );

  // Check if we're in a multi-connection workspace context
  const isMultiConnectionWorkspace =
    activeWorkspace && !activeWorkspace.isTemporary;

  // Query for databases list
  const {
    data: databases = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => {
      if (!connectionId) return [];
      if (!databaseService.isConnectionActive(connectionId)) {
        throw new Error("Connection is not active");
      }
      return await databaseService.listDatabases(connectionId);
    },
    enabled: !!connectionId && databaseService.isConnectionActive(connectionId),
    staleTime: 60_000,
    retry: 2,
  });

  // Build database items with profile info
  const databaseItems = useMemo<DatabaseItem[]>(() => {
    if (!currentConnection) return [];

    return databases.map((db) => {
      const hasProfile = connections.some(
        (conn) =>
          conn.profile.host === currentConnection.profile.host &&
          conn.profile.port === currentConnection.profile.port &&
          conn.profile.database === db &&
          conn.profile.username === currentConnection.profile.username
      );
      const isCurrent = db === currentDatabase;
      return { name: db, hasProfile, isCurrent };
    });
  }, [databases, connections, currentConnection, currentDatabase]);

  // Create Fuse index
  const fuse = useMemo(
    () => new Fuse(databaseItems, DATABASE_FUSE_OPTIONS),
    [databaseItems]
  );

  // Filter results based on search query
  const filteredDatabases = useMemo(() => {
    if (!query.trim()) {
      return databaseItems;
    }
    return fuse.search(query).map((r) => r.item);
  }, [databaseItems, fuse, query]);

  /**
   * Get or create connection profile for a database
   */
  const getOrCreateConnectionForDatabase = useCallback(
    async (dbName: string, hasProfile: boolean): Promise<string | null> => {
      if (!currentConnection || !connectionId) return null;

      const connectionStore = useConnectionStore.getState();

      if (hasProfile) {
        const existingConnection = connectionStore.findConnectionByDatabase(
          currentConnection.profile.host,
          currentConnection.profile.port,
          dbName,
          currentConnection.profile.username,
        );
        return existingConnection?.profile.id ?? null;
      } else {
        // Check if already exists
        const existingBeforeCreate = connectionStore.findConnectionByDatabase(
          currentConnection.profile.host,
          currentConnection.profile.port,
          dbName,
          currentConnection.profile.username,
        );
        if (existingBeforeCreate) {
          return existingBeforeCreate.profile.id;
        }
        return await connectionStore.getOrCreateDatabaseConnection(
          connectionId,
          dbName,
        );
      }
    },
    [currentConnection, connectionId],
  );

  /**
   * Open database in a new window
   */
  const handleOpenNewWindow = useCallback(
    async (dbName: string, hasProfile: boolean) => {
      try {
        const targetConnectionId = await getOrCreateConnectionForDatabase(
          dbName,
          hasProfile,
        );
        if (!targetConnectionId) {
          toast.error("Failed to get connection");
          return;
        }

        if (windowManager.isWorkspaceOpen(targetConnectionId)) {
          await windowManager.focusWorkspace(targetConnectionId);
        } else {
          await windowManager.openWorkspace(targetConnectionId, dbName, {
            database: dbName,
          });
        }
        onClose?.();
      } catch (error) {
        logger.error("Failed to open database in new window:", error);
        toast.error("Failed to open database");
      }
    },
    [getOrCreateConnectionForDatabase, onClose],
  );

  /**
   * Add database connection to current workspace
   */
  const handleAddToWorkspace = useCallback(
    async (dbName: string, hasProfile: boolean) => {
      if (!activeWorkspace) {
        toast.error("No active workspace");
        return;
      }

      try {
        const targetConnectionId = await getOrCreateConnectionForDatabase(
          dbName,
          hasProfile,
        );
        if (!targetConnectionId) {
          toast.error("Failed to get connection");
          return;
        }

        if (activeWorkspace.connections.has(targetConnectionId)) {
          toast.info("Connection already in workspace");
          return;
        }

        await addConnectionToWorkspace(targetConnectionId);
        toast.success(`Added ${dbName} to workspace`);
        onClose?.();
      } catch (error) {
        logger.error("Failed to add database to workspace:", error);
        toast.error("Failed to add to workspace");
      }
    },
    [activeWorkspace, getOrCreateConnectionForDatabase, addConnectionToWorkspace, onClose],
  );

  if (isLoading) {
    return (
      <CommandList ref={listRef}>
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading databases...
        </div>
      </CommandList>
    );
  }

  if (error) {
    return (
      <CommandList ref={listRef}>
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load databases: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No databases found.</CommandEmpty>

      <CommandGroup heading="Databases">
        {filteredDatabases.map((dbItem) => (
          <CommandItem
            key={dbItem.name}
            value={dbItem.name}
            onSelect={() => {
              onSelect(dbItem.name);
            }}
            className="group/db-item"
          >
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <IconCheck
                  className={cn(
                    "size-4 shrink-0",
                    dbItem.isCurrent ? "opacity-100" : "opacity-0",
                  )}
                />
                <IconDatabase className="size-4 text-muted-foreground shrink-0" />
                <span
                  className={cn(
                    "truncate",
                    dbItem.isCurrent && "font-medium",
                  )}
                >
                  {dbItem.name}
                </span>
                {dbItem.hasProfile && (
                  <IconCircleFilled className="h-1.5 w-1.5 text-primary shrink-0" />
                )}
              </div>
              {/* Action buttons - visible on hover */}
              <div className="flex items-center gap-1 opacity-0 group-hover/db-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 transition-opacity shrink-0">
                {isMultiConnectionWorkspace && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAddToWorkspace(dbItem.name, dbItem.hasProfile);
                          }}
                          className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                        >
                          <IconPlus className="!h-3.5 !w-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent side="top" className="text-xs">
                      Add to Workspace
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenNewWindow(dbItem.name, dbItem.hasProfile);
                        }}
                        className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                      >
                        <IconExternalLink className="!h-3.5 !w-3.5" />
                      </button>
                    }
                  />
                  <TooltipContent side="top" className="text-xs">
                    Open New Window
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
