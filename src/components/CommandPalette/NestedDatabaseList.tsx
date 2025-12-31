import React, { useMemo } from "react";
import {
  IconCheck,
  IconCircleFilled,
  IconLoader2,
  IconPlus,
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
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { DbType } from "@/types/connection";
import { DATABASE_CREATION_SUPPORTED } from "./actions";

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
  onClose: () => void;
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
    connectionId ? state.getConnection(connectionId) : undefined
  );

  const dbType = currentConnection?.profile.db_type ?? null;
  const supportsCreateDatabase = dbType && DATABASE_CREATION_SUPPORTED.includes(dbType);

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

  const handleCreateDatabase = async () => {
    const template = getCreateDatabaseTemplate(dbType);
    await navigator.clipboard.writeText(template);
    toast.success("CREATE DATABASE template copied to clipboard");
    onClose();
  };

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No databases found.</CommandEmpty>

      <CommandGroup heading="Databases">
        {filteredDatabases.map((dbItem) => (
          <CommandItem
            key={dbItem.name}
            value={dbItem.name}
            onSelect={() => { onSelect(dbItem.name); }}
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

      {supportsCreateDatabase && (
        <CommandGroup heading="Commands">
          <CommandItem
            value="create-database"
            onSelect={handleCreateDatabase}
          >
            <div className="flex items-center gap-2">
              <IconPlus className="size-4 text-muted-foreground" />
              <span>Create Database</span>
            </div>
          </CommandItem>
        </CommandGroup>
      )}
    </CommandList>
  );
}

function getCreateDatabaseTemplate(dbType: DbType | null): string {
  const dbName = "new_database";
  switch (dbType) {
    case DbType.PostgreSQL:
      return `CREATE DATABASE "${dbName}"
  WITH
  OWNER = current_user
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE = template0;`;

    case DbType.MySQL:
      return `CREATE DATABASE \`${dbName}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;`;

    case DbType.SQLServer:
      return `CREATE DATABASE [${dbName}];`;

    default:
      return `CREATE DATABASE ${dbName};`;
  }
}
