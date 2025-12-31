import React, { useMemo } from "react";
import { IconCheck, IconLoader2, IconStarFilled } from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQuery } from "@tanstack/react-query";

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

interface SchemaItem {
  name: string;
  isDefault: boolean;
  isCurrent: boolean;
}

const SCHEMA_FUSE_OPTIONS: IFuseOptions<SchemaItem> = {
  keys: ["name"],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

interface NestedSchemaListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (schema: string) => void;
}

export function NestedSchemaList({
  listRef,
  query,
  onSelect,
}: NestedSchemaListProps): React.ReactElement {
  const connectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId,
  );
  const currentDatabase = useWorkspaceSelectionStore((state) => state.database);
  const currentSchema = useWorkspaceSelectionStore((state) => state.schema);

  // Get the connection for dbType and default schema
  const currentConnection = useConnectionStore((state) =>
    connectionId ? state.getConnection(connectionId) : undefined,
  );
  const connectionDefaultSchema = currentConnection?.profile.default_schema;

  // Query for schemas list
  const {
    data: schemas = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["schemas", connectionId, currentDatabase],
    queryFn: async () => {
      if (!connectionId || !currentDatabase) return [];
      if (!databaseService.isConnectionActive(connectionId)) {
        throw new Error("Connection is not active");
      }
      return await databaseService.listSchemas(connectionId, currentDatabase);
    },
    enabled:
      !!connectionId &&
      !!currentDatabase &&
      databaseService.isConnectionActive(connectionId),
    staleTime: 60_000,
    retry: 2,
  });

  // Build schema items with default/current info
  const schemaItems = useMemo<SchemaItem[]>(() => {
    return schemas.map((schema) => ({
      name: schema,
      isDefault: schema === connectionDefaultSchema,
      isCurrent: schema === currentSchema,
    }));
  }, [schemas, connectionDefaultSchema, currentSchema]);

  // Create Fuse index
  const fuse = useMemo(
    () => new Fuse(schemaItems, SCHEMA_FUSE_OPTIONS),
    [schemaItems],
  );

  // Filter results based on search query
  const filteredSchemas = useMemo(() => {
    if (!query.trim()) {
      return schemaItems;
    }
    return fuse.search(query).map((r) => r.item);
  }, [schemaItems, fuse, query]);

  if (isLoading) {
    return (
      <CommandList ref={listRef}>
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading schemas...
        </div>
      </CommandList>
    );
  }

  if (error) {
    return (
      <CommandList ref={listRef}>
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load schemas:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No schemas found.</CommandEmpty>

      <CommandGroup heading="Schemas">
        {filteredSchemas.map((schemaItem) => (
          <CommandItem
            key={schemaItem.name}
            value={schemaItem.name}
            onSelect={() => {
              onSelect(schemaItem.name);
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <IconCheck
                  className={cn(
                    "size-4!",
                    schemaItem.isCurrent ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    schemaItem.isCurrent && "font-medium",
                  )}
                >
                  {schemaItem.name}
                </span>
              </div>
              {schemaItem.isDefault && (
                <IconStarFilled className="size-4! text-yellow-500" />
              )}
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
