import React, { useMemo } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { IconFolder } from "@tabler/icons-react";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";

interface WorkspaceItem {
  id: string;
  name: string;
  connectionCount: number;
}

const WORKSPACE_FUSE_OPTIONS: IFuseOptions<WorkspaceItem> = {
  keys: ["name"],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

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

  const fuse = useMemo(
    () => new Fuse(workspaceItems, WORKSPACE_FUSE_OPTIONS),
    [workspaceItems],
  );

  const filteredWorkspaces = useMemo(() => {
    if (!query.trim()) {
      return workspaceItems;
    }
    return fuse.search(query).map((r) => r.item);
  }, [workspaceItems, fuse, query]);

  return (
    <CommandList ref={listRef}>
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
