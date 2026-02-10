import React, { useMemo, useCallback } from "react";
import {
  IconCheck,
  IconLoader2,
  IconExternalLink,
  IconPlus,
} from "@tabler/icons-react";
import { matchSorter, rankings } from "match-sorter";
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
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { DbType } from "@/types/connection";

interface DatabaseItem {
  name: string;
  hasProfile: boolean;
  isCurrent: boolean;
}

interface SavedProfileItem {
  id: string;
  name: string;
  database: string;
  host: string;
  port: number;
  db_type: DbType;
}

interface NestedDatabaseListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  /** Called when a database is successfully selected (after add-to-workspace completes) */
  onSelect?: (database: string) => void;
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
  const setFocusedConnection = useWorkspaceBundleStore(
    (s) => s.setFocusedConnection,
  );

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

  // Build saved profile items (different servers)
  const savedProfileItems = useMemo<SavedProfileItem[]>(() => {
    if (!currentConnection) return [];
    return connections
      .filter((conn) => {
        const isSameServer =
          conn.profile.host === currentConnection.profile.host &&
          conn.profile.port === currentConnection.profile.port &&
          conn.profile.username === currentConnection.profile.username;
        return !isSameServer;
      })
      .map((conn) => ({
        id: conn.profile.id,
        name: conn.profile.name,
        database: conn.profile.database || "",
        host: conn.profile.host,
        port: conn.profile.port,
        db_type: conn.profile.db_type,
      }));
  }, [connections, currentConnection]);

  // Filter results based on search query
  const filteredResults = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { databases: databaseItems, profiles: savedProfileItems };
    }
    return {
      databases: matchSorter(databaseItems, trimmedQuery, {
        keys: [{ key: "name", maxRanking: rankings.STARTS_WITH }],
        threshold: rankings.MATCHES,
      }),
      profiles: matchSorter(savedProfileItems, trimmedQuery, {
        keys: [
          { key: "name", maxRanking: rankings.STARTS_WITH },
          { key: "database", maxRanking: rankings.WORD_STARTS_WITH },
        ],
        threshold: rankings.MATCHES,
      }),
    };
  }, [databaseItems, savedProfileItems, query]);

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
   * Handle database selection - uses add-to-workspace flow
   */
  const handleDatabaseSelect = useCallback(
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
          setFocusedConnection(targetConnectionId);
          logger.info(`[NestedDatabaseList] Focused existing connection: ${targetConnectionId}`);
        } else {
          await addConnectionToWorkspace(targetConnectionId);
          logger.info(`[NestedDatabaseList] Added and focused connection: ${targetConnectionId}`);
        }

        onSelect?.(dbName);
        onClose?.();
      } catch (error) {
        logger.error("Failed to select database:", error);
        toast.error("Failed to switch database");
      }
    },
    [activeWorkspace, getOrCreateConnectionForDatabase, addConnectionToWorkspace, setFocusedConnection, onSelect, onClose],
  );

  /**
   * Add a server database to the workspace (+ button)
   */
  const handleAddToWorkspace = useCallback(
    async (dbName: string, hasProfile: boolean) => {
      if (!activeWorkspace) return;

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
          toast.info("Database already in workspace");
          return;
        }

        await addConnectionToWorkspace(targetConnectionId);
        toast.success(`Added ${dbName} to workspace`);
        onClose?.();
      } catch (error) {
        logger.error("Failed to add database to workspace:", error);
        toast.error("Failed to add database");
      }
    },
    [activeWorkspace, getOrCreateConnectionForDatabase, addConnectionToWorkspace, onClose],
  );

  /**
   * Handle saved profile selection
   */
  const handleProfileSelect = useCallback(
    async (profile: SavedProfileItem) => {
      if (!activeWorkspace) {
        toast.error("No active workspace");
        return;
      }

      try {
        if (activeWorkspace.connections.has(profile.id)) {
          setFocusedConnection(profile.id);
          logger.info(`[NestedDatabaseList] Focused existing profile: ${profile.id}`);
        } else {
          await addConnectionToWorkspace(profile.id);
          logger.info(`[NestedDatabaseList] Added and focused profile: ${profile.id}`);
        }

        onClose?.();
      } catch (error) {
        logger.error("Failed to select profile:", error);
        toast.error("Failed to switch database");
      }
    },
    [activeWorkspace, addConnectionToWorkspace, setFocusedConnection, onClose],
  );

  /**
   * Open saved profile in a new window
   */
  const handleOpenProfileNewWindow = useCallback(
    (profile: SavedProfileItem) => {
      void windowManager.openWorkspace(
        profile.id,
        profile.name,
        profile.database ? { database: profile.database } : undefined,
      );
      onClose?.();
    },
    [onClose],
  );

  const dbType = currentConnection?.profile.db_type;

  if (isLoading) {
    return (
      <CommandList ref={listRef} className="h-[300px]">
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading databases...
        </div>
      </CommandList>
    );
  }

  if (error) {
    return (
      <CommandList ref={listRef} className="h-[300px]">
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load databases: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef} className="h-[300px]">
      <CommandEmpty>No databases found.</CommandEmpty>

      {/* Section 1: On this Server */}
      {filteredResults.databases.length > 0 && (
        <CommandGroup heading="On this Server">
          {filteredResults.databases.map((dbItem) => (
            <CommandItem
              key={dbItem.name}
              value={dbItem.name}
              onSelect={() => {
                void handleDatabaseSelect(dbItem.name, dbItem.hasProfile);
              }}
              className="group/db-item"
            >
              <div className="flex items-center gap-2 w-full">
                {dbType ? (
                  <img
                    src={getDatabaseLogo(dbType)}
                    alt={dbType}
                    className="size-4 shrink-0"
                  />
                ) : (
                  <div className="size-4 shrink-0" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={cn("truncate font-medium", dbItem.isCurrent && "text-primary")}>
                    {dbItem.name}
                  </span>
                </div>
                {/* Checkmark for current database */}
                {dbItem.isCurrent && (
                  <IconCheck className="size-4 text-primary shrink-0" />
                )}
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
                      Open in New Window
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {/* Section 2: Saved Profiles (Different Servers) */}
      {filteredResults.profiles.length > 0 && (
        <CommandGroup heading="Saved Profiles">
          {filteredResults.profiles.map((profile) => (
            <CommandItem
              key={profile.id}
              value={profile.id}
              onSelect={() => {
                void handleProfileSelect(profile);
              }}
              className="group/profile-item"
            >
              <div className="flex items-center gap-2 w-full">
                <img
                  src={getDatabaseLogo(profile.db_type)}
                  alt={profile.db_type}
                  className="size-4 shrink-0"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate font-medium">{profile.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {profile.host}:{profile.port}
                    {profile.database && ` / ${profile.database}`}
                  </span>
                </div>
                {/* Action buttons - visible on hover */}
                <div className="flex items-center gap-1 opacity-0 group-hover/profile-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 transition-opacity shrink-0">
                  {isMultiConnectionWorkspace && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleProfileSelect(profile);
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
                            handleOpenProfileNewWindow(profile);
                          }}
                          className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                        >
                          <IconExternalLink className="!h-3.5 !w-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent side="top" className="text-xs">
                      Open in New Window
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </CommandList>
  );
}
