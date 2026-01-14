import { useMemo, useState } from "react";
import {
  IconDatabase,
  IconLayoutGrid,
  IconList,
  IconFolder,
  IconChevronRight,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { ConnectionCard } from "../shared/ConnectionCard";
import { ConnectionRow } from "../shared/ConnectionRow";
import { windowManager } from "@/services/windowManager";
import type { StoredConnection } from "@/types/connection";
import type { WorkspaceConfig } from "@/types/workspace";

type ViewMode = "hybrid" | "grid" | "list";

interface WorkspaceGroup {
  workspace: WorkspaceConfig | null;
  connections: StoredConnection[];
}

function sortConnections(connections: StoredConnection[]): StoredConnection[] {
  return [...connections].sort((a, b) => {
    if (a.metadata.is_favorite && !b.metadata.is_favorite) return -1;
    if (!a.metadata.is_favorite && b.metadata.is_favorite) return 1;

    const aTime = a.metadata.last_used
      ? new Date(a.metadata.last_used).getTime()
      : 0;
    const bTime = b.metadata.last_used
      ? new Date(b.metadata.last_used).getTime()
      : 0;
    return bTime - aTime;
  });
}

function ConnectionGroup({
  group,
  viewMode,
  isCollapsed,
  onToggleCollapse,
}: {
  group: WorkspaceGroup;
  viewMode: ViewMode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const sortedConnections = useMemo(
    () => sortConnections(group.connections),
    [group.connections],
  );

  const handleOpenWorkspace = async () => {
    if (!group.workspace) return;
    await windowManager.openNamedWorkspace(
      group.workspace.id,
      group.workspace.name,
    );
  };

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-2 mb-2 w-full text-left group hover:bg-accent/50 rounded-md px-2 py-1.5 -mx-2 transition-colors"
      >
        <IconChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-90"}`}
        />
        {group.workspace ? (
          <IconLayout2 className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {group.workspace?.name ?? "Uncategorized"}
        </span>
        <span className="text-xs text-muted-foreground">
          ({group.connections.length})
        </span>
        {group.workspace && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void handleOpenWorkspace();
            }}
            className="ml-auto h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <IconPlayerPlay className="h-3 w-3 mr-1" />
            Open
          </Button>
        )}
      </button>

      {!isCollapsed && (
        <div className="pl-7">
          {viewMode === "list" ? (
            <div className="space-y-0.5">
              {sortedConnections.map((connection) => (
                <ConnectionRow
                  key={connection.profile.id}
                  connection={connection}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedConnections.map((connection) => (
                <ConnectionCard
                  key={connection.profile.id}
                  connection={connection}
                  variant="compact"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectionsSection() {
  const connections = useConnectionStore((s) => s.connections);
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);

  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const getConnectionsByWorkspace = useWorkspaceBundleStore(
    (s) => s.getConnectionsByWorkspace,
  );
  const getUncategorizedConnectionIds = useWorkspaceBundleStore(
    (s) => s.getUncategorizedConnectionIds,
  );

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    new Set(),
  );

  const filteredConnections = useMemo(() => {
    if (
      !activeEnvFilters ||
      activeEnvFilters.length === 0 ||
      activeEnvFilters.includes("all")
    ) {
      return connections;
    }

    return connections.filter((conn) => {
      const tags = conn.metadata?.tags ?? [];
      return tags.some((tag) => activeEnvFilters.includes(tag));
    });
  }, [connections, activeEnvFilters]);

  const connectionMap = useMemo(() => {
    const map = new Map<string, StoredConnection>();
    for (const conn of filteredConnections) {
      map.set(conn.profile.id, conn);
    }
    return map;
  }, [filteredConnections]);

  const workspaceGroups = useMemo(() => {
    const groups: WorkspaceGroup[] = [];
    const workspaceToConnections = getConnectionsByWorkspace();
    const uncategorizedIds = getUncategorizedConnectionIds();

    for (const ws of savedWorkspaces) {
      const connIds = workspaceToConnections.get(ws.id) ?? [];
      const wsConnections = connIds
        .map((id) => connectionMap.get(id))
        .filter((c): c is StoredConnection => c !== undefined);

      if (wsConnections.length > 0) {
        groups.push({ workspace: ws, connections: wsConnections });
      }
    }

    const uncategorizedConnections = uncategorizedIds
      .map((id) => connectionMap.get(id))
      .filter((c): c is StoredConnection => c !== undefined);

    if (uncategorizedConnections.length > 0) {
      groups.push({ workspace: null, connections: uncategorizedConnections });
    }

    return groups;
  }, [
    savedWorkspaces,
    connectionMap,
    getConnectionsByWorkspace,
    getUncategorizedConnectionIds,
  ]);

  const toggleWorkspaceCollapse = (wsId: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) {
        next.delete(wsId);
      } else {
        next.add(wsId);
      }
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconDatabase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Connections</h2>
          <span className="text-xs text-muted-foreground">
            ({filteredConnections.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 rounded-r-none ${viewMode === "grid" ? "bg-muted" : ""}`}
              onClick={() => {
                setViewMode("grid");
              }}
              title="Grid view"
            >
              <IconLayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 rounded-l-none ${viewMode === "list" ? "bg-muted" : ""}`}
              onClick={() => {
                setViewMode("list");
              }}
              title="List view"
            >
              <IconList className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> connect
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>⌘D</Kbd> clone
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd> search
        </span>
      </div>

      {filteredConnections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No connections match the selected filter
        </div>
      ) : (
        <div>
          {workspaceGroups.map((group) => (
            <ConnectionGroup
              key={group.workspace?.id ?? "uncategorized"}
              group={group}
              viewMode={viewMode}
              isCollapsed={collapsedWorkspaces.has(
                group.workspace?.id ?? "uncategorized",
              )}
              onToggleCollapse={() =>
                toggleWorkspaceCollapse(
                  group.workspace?.id ?? "uncategorized",
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
