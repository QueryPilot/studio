import React, { useMemo } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { IconPlus, IconExternalLink } from "@tabler/icons-react";
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
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { DbType } from "@/types/connection";

interface ConnectionItem {
  id: string;
  name: string;
  database: string;
  host: string;
  port: number;
  dbType: DbType;
}

const CONNECTION_FUSE_OPTIONS: IFuseOptions<ConnectionItem> = {
  keys: ["name", "database", "host"],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

interface NestedConnectionListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (connectionId: string) => void;
  onClose?: () => void;
  title?: string;
  filterConnected?: boolean;
}

export function NestedConnectionList({
  listRef,
  query,
  onSelect,
  onClose,
  title = "Connections",
  filterConnected = false,
}: NestedConnectionListProps): React.ReactElement {
  const allConnections = useConnectionStore((state) => state.connections);
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const addConnectionToWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToWorkspace,
  );

  // Filter to only connected if requested (using runtime connection status)
  const connections = useMemo(() => {
    if (!filterConnected) return allConnections;

    // Get connected connection IDs from the active workspace
    const connectedIds = new Set<string>();
    if (activeWorkspace) {
      for (const [id, conn] of activeWorkspace.connections) {
        if (conn.status === "connected") {
          connectedIds.add(id);
        }
      }
    }

    return allConnections.filter((c) => connectedIds.has(c.profile.id));
  }, [allConnections, filterConnected, activeWorkspace]);

  // Check if we're in a multi-connection workspace context
  const isMultiConnectionWorkspace =
    activeWorkspace && !activeWorkspace.isTemporary;

  // Build connection items
  const connectionItems = useMemo<ConnectionItem[]>(() => {
    return connections.map((conn) => ({
      id: conn.profile.id,
      name: conn.profile.name,
      database: conn.profile.database || "",
      host: conn.profile.host,
      port: conn.profile.port,
      dbType: conn.profile.db_type,
    }));
  }, [connections]);

  // Create Fuse index
  const fuse = useMemo(
    () => new Fuse(connectionItems, CONNECTION_FUSE_OPTIONS),
    [connectionItems],
  );

  // Filter results based on search query
  const filteredConnections = useMemo(() => {
    if (!query.trim()) {
      return connectionItems;
    }
    return fuse.search(query).map((r) => r.item);
  }, [connectionItems, fuse, query]);

  const handleAddToWorkspace = async (connItem: ConnectionItem) => {
    if (!activeWorkspace) return;

    if (activeWorkspace.connections.has(connItem.id)) {
      toast.info("Connection already in workspace");
      return;
    }

    await addConnectionToWorkspace(connItem.id);
    toast.success(`Added ${connItem.name} to workspace`);
    onClose?.();
  };

  return (
    <CommandList ref={listRef} className="h-[300px]">
      <CommandEmpty>
        {filterConnected ? "No connected databases." : "No connections found."}
      </CommandEmpty>

      <CommandGroup heading={title}>
        {filteredConnections.map((connItem) => (
          <CommandItem
            key={connItem.id}
            value={connItem.id}
            onSelect={() => {
              onSelect(connItem.id);
            }}
            className="group/conn-item"
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
                  {connItem.host}:{connItem.port}
                  {connItem.database && ` / ${connItem.database}`}
                </span>
              </div>
              {/* Action buttons - visible on hover */}
              <div className="flex items-center gap-1 opacity-0 group-hover/conn-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 transition-opacity shrink-0">
                {isMultiConnectionWorkspace && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAddToWorkspace(connItem);
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
                          onSelect(connItem.id);
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
