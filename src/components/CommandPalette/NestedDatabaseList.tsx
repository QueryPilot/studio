import React, { useMemo } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconCircleFilled,
  IconLoader2,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQuery } from "@tanstack/react-query";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";

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
}

export function NestedDatabaseList({
  listRef,
  query,
  onSelect,
}: NestedDatabaseListProps): React.ReactElement {
  const exitNestedMode = useCommandPaletteStore((state) => state.exitNestedMode);
  const connectionId = useWorkspaceSelectionStore((state) => state.connectionId);
  const currentDatabase = useWorkspaceSelectionStore((state) => state.database);
  const connections = useConnectionStore((state) => state.connections);
  const currentConnection = useConnectionStore((state) =>
    connectionId ? state.getConnection(connectionId) : undefined
  );

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
    enabled: !!connectionId && databaseService.isConnectionActive(connectionId ?? ""),
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

  const handleBack = () => {
    exitNestedMode();
  };

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
        <CommandGroup>
          <CommandItem onSelect={handleBack}>
            <IconArrowLeft className="size-4" />
            <span>Back</span>
          </CommandItem>
        </CommandGroup>
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load databases: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef}>
      <CommandGroup heading="Switch Database">
        <CommandItem onSelect={handleBack}>
          <IconArrowLeft className="size-4" />
          <span>Back</span>
        </CommandItem>
      </CommandGroup>

      <CommandEmpty>No databases found.</CommandEmpty>

      <CommandGroup heading="Databases">
        {filteredDatabases.map((dbItem) => (
          <CommandItem
            key={dbItem.name}
            value={dbItem.name}
            onSelect={() => onSelect(dbItem.name)}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <IconCheck
                  className={cn(
                    "size-4",
                    dbItem.isCurrent ? "opacity-100" : "opacity-0"
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    dbItem.isCurrent && "font-medium"
                  )}
                >
                  {dbItem.name}
                </span>
              </div>
              {dbItem.hasProfile && (
                <IconCircleFilled className="size-2 text-primary" />
              )}
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
