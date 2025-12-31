import React, { useMemo } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { DbType } from "@/types/connection";

interface ConnectionItem {
  id: string;
  name: string;
  database: string;
  host: string;
  dbType: DbType;
}

const CONNECTION_FUSE_OPTIONS: IFuseOptions<ConnectionItem> = {
  keys: ["name", "database", "host"],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

interface NestedConnectionListProps {
  listRef?: React.RefObject<HTMLDivElement>;
  query: string;
  onSelect: (connectionId: string) => void;
}

export function NestedConnectionList({
  listRef,
  query,
  onSelect,
}: NestedConnectionListProps): React.ReactElement {
  const exitNestedMode = useCommandPaletteStore((state) => state.exitNestedMode);
  const connections = useConnectionStore((state) => state.connections);

  // Build connection items
  const connectionItems = useMemo<ConnectionItem[]>(() => {
    return connections.map((conn) => ({
      id: conn.profile.id,
      name: conn.profile.name,
      database: conn.profile.database || "",
      host: conn.profile.host,
      dbType: conn.profile.db_type,
    }));
  }, [connections]);

  // Create Fuse index
  const fuse = useMemo(
    () => new Fuse(connectionItems, CONNECTION_FUSE_OPTIONS),
    [connectionItems]
  );

  // Filter results based on search query
  const filteredConnections = useMemo(() => {
    if (!query.trim()) {
      return connectionItems;
    }
    return fuse.search(query).map((r) => r.item);
  }, [connectionItems, fuse, query]);

  const handleBack = () => {
    exitNestedMode();
  };

  return (
    <CommandList ref={listRef}>
      <CommandGroup heading="Open Connection">
        <CommandItem onSelect={handleBack}>
          <IconArrowLeft className="size-4" />
          <span>Back</span>
        </CommandItem>
      </CommandGroup>

      <CommandEmpty>No connections found.</CommandEmpty>

      <CommandGroup heading="Connections">
        {filteredConnections.map((connItem) => (
          <CommandItem
            key={connItem.id}
            value={connItem.id}
            onSelect={() => onSelect(connItem.id)}
          >
            <div className="flex items-center gap-2 w-full">
              <img
                src={getDatabaseLogo(connItem.dbType)}
                alt={connItem.dbType}
                className="size-4 shrink-0"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate font-medium">{connItem.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {connItem.database || connItem.host}
                </span>
              </div>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
