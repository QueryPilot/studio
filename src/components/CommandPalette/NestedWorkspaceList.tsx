import React, { useMemo } from "react";
import { matchSorter, rankings } from "match-sorter";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { IconLayout2 } from "@tabler/icons-react";

interface WorkspaceItem {
  id: string;
  name: string;
  connectionCount: number;
}

interface NestedWorkspaceListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (workspaceId: string) => void;
}

export function NestedWorkspaceList({
  listRef,
  query,
  onSelect,
}: NestedWorkspaceListProps): React.ReactElement {
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);

  const workspaceItems = useMemo<WorkspaceItem[]>(() => {
    return savedWorkspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      connectionCount: ws.connectionIds.length,
    }));
  }, [savedWorkspaces]);

  const filteredWorkspaces = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return workspaceItems;
    }
    return matchSorter(workspaceItems, trimmedQuery, {
      keys: [{ key: "name", maxRanking: rankings.STARTS_WITH }],
      threshold: rankings.MATCHES,
    });
  }, [workspaceItems, query]);

  return (
    <CommandList ref={listRef} className="h-[300px]">
      <CommandEmpty>No workspaces found.</CommandEmpty>

      <CommandGroup heading="Workspaces">
        {filteredWorkspaces.map((wsItem) => (
          <CommandItem
            key={wsItem.id}
            value={wsItem.id}
            onSelect={() => {
              onSelect(wsItem.id);
            }}
          >
            <div className="flex items-center gap-2 w-full">
              <IconLayout2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate font-medium">{wsItem.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {wsItem.connectionCount} connection
                  {wsItem.connectionCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
