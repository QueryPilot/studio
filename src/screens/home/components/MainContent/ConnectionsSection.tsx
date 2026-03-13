/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  IconLayoutGrid,
  IconList,
  IconChevronRight,
  IconPlayerPlay,
  IconTrash,
  IconAlertTriangle,
  IconDatabase,
  IconCheckbox,
  IconSquare,
  IconPencil,
  IconDots,
} from "@tabler/icons-react";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { ConnectionCard } from "../shared/ConnectionCard";
import { ConnectionRow } from "../shared/ConnectionRow";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { StoredConnection } from "@/types/connection";
import type { WorkspaceConfig } from "@/types/workspace";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { BulkActionsBar } from "./BulkActionsBar";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

// Draggable wrapper for connection items
function DraggableConnection({
  connection,
  viewMode,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  connection: StoredConnection;
  viewMode: ViewMode;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: connection.profile.id,
    data: { connection },
  });

  // In selection mode, don't attach drag listeners
  const dragProps = selectionMode ? {} : { ...listeners, ...attributes };

  return (
    <div
      ref={setNodeRef}
      {...dragProps}
      className={cn(
        "relative",
        isDragging && "opacity-50",
        !selectionMode && "cursor-grab active:cursor-grabbing",
      )}
    >
      {viewMode === "list" ? (
        <ConnectionRow
          connection={connection}
          selectionMode={selectionMode}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
        />
      ) : (
        <ConnectionCard
          connection={connection}
          variant="compact"
          selectionMode={selectionMode}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

// Droppable zone for workspace groups
function DroppableWorkspaceGroup({
  group,
  viewMode,
  isCollapsed,
  onToggleCollapse,
  onEditWorkspace,
  onDeleteWorkspace,
  isOver,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  group: WorkspaceGroup;
  viewMode: ViewMode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspace: WorkspaceConfig) => void;
  isOver: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
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

  const headerContent = (
    <div className="flex items-center gap-2 mb-2 w-full text-left group hover:bg-accent/50 rounded-md px-2 py-1.5 transition-colors">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-2 flex-1"
      >
        <IconChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
            isCollapsed ? "" : "rotate-90"
          }`}
        />
        {group.workspace ? (
          <span className="text-sm leading-none">
            {group.workspace.icon || "📦"}
          </span>
        ) : (
          <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {group.workspace?.name ?? "Uncategorized"}
        </span>
        <span className="text-xs text-muted-foreground">
          ({group.connections.length})
        </span>
      </button>
      {group.workspace && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void handleOpenWorkspace();
            }}
            className="h-6 px-2 text-xs"
          >
            <IconPlayerPlay className="h-3 w-3 mr-1" />
            Open
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <IconDots className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  void handleOpenWorkspace();
                }}
              >
                <IconPlayerPlay className="h-3.5 w-3.5 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onEditWorkspace(group.workspace!.id);
                }}
              >
                <IconPencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  onDeleteWorkspace(group.workspace!);
                }}
              >
                <IconTrash className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "mb-4 rounded-lg transition-colors",
        isOver && "bg-primary/5 ring-2 ring-primary/30 ring-inset",
      )}
    >
      {group.workspace ? (
        <ContextMenu>
          <ContextMenuTrigger>{headerContent}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => {
                void handleOpenWorkspace();
              }}
            >
              <IconPlayerPlay className="h-3.5 w-3.5 mr-2" />
              Open
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                onEditWorkspace(group.workspace!.id);
              }}
            >
              <IconPencil className="h-3.5 w-3.5 mr-2" />
              Edit
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => {
                onDeleteWorkspace(group.workspace!);
              }}
            >
              <IconTrash className="h-3.5 w-3.5 mr-2" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        headerContent
      )}

      {!isCollapsed && (
        <div className="pl-7 pb-3 pr-3">
          {viewMode === "list" ? (
            <div className="space-y-0.5">
              {sortedConnections.map((connection) => (
                <DraggableConnection
                  key={connection.profile.id}
                  connection={connection}
                  viewMode={viewMode}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(connection.profile.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedConnections.map((connection) => (
                <DraggableConnection
                  key={connection.profile.id}
                  connection={connection}
                  viewMode={viewMode}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(connection.profile.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drop zone when collapsed or empty */}
      {(isCollapsed || group.connections.length === 0) && isOver && (
        <div className="ml-7 py-4 text-center text-xs text-muted-foreground border-2 border-dashed border-primary/30 rounded-md">
          Drop here to add to {group.workspace?.name ?? "Uncategorized"}
        </div>
      )}
    </div>
  );
}

// Wrapper that adds useDroppable
function DroppableGroup({
  group,
  ...props
}: {
  group: WorkspaceGroup;
  viewMode: ViewMode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspace: WorkspaceConfig) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const groupId = group.workspace?.id ?? "uncategorized";
  const { setNodeRef, isOver } = useDroppable({
    id: `droppable-${groupId}`,
    data: { workspaceId: group.workspace?.id ?? null },
  });

  return (
    <div ref={setNodeRef}>
      <DroppableWorkspaceGroup group={group} isOver={isOver} {...props} />
    </div>
  );
}

// Drag overlay content
function DragOverlayContent({
  connection,
}: {
  connection: StoredConnection | null;
}) {
  if (!connection) return null;

  return (
    <div className="bg-card border rounded-md shadow-lg p-3 w-64 opacity-90">
      <div className="flex items-center gap-2">
        <img
          src={getDatabaseLogo(connection.profile.db_type)}
          alt=""
          className="h-4 w-4"
        />
        <span className="text-xs font-medium truncate">
          {connection.profile.name}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {connection.profile.host}:{connection.profile.port}
      </div>
    </div>
  );
}

export function ConnectionsSection() {
  const connections = useConnectionStore((s) => s.connections);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);
  const openWorkspaceForm = useHomeScreenStore((s) => s.openWorkspaceForm);

  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const deleteWorkspace = useWorkspaceBundleStore((s) => s.deleteWorkspace);
  const getConnectionsByWorkspace = useWorkspaceBundleStore(
    (s) => s.getConnectionsByWorkspace,
  );
  const getUncategorizedConnectionIds = useWorkspaceBundleStore(
    (s) => s.getUncategorizedConnectionIds,
  );
  const addConnectionToSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToSavedWorkspace,
  );
  const removeConnectionFromSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.removeConnectionFromSavedWorkspace,
  );

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    new Set(),
  );
  const [activeConnection, setActiveConnection] =
    useState<StoredConnection | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    workspace: WorkspaceConfig | null;
  }>({ isOpen: false, workspace: null });
  const [isDeleting, setIsDeleting] = useState(false);

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
  );

  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  const filteredConnections = useMemo(() => {
    if (activeEnvFilters.length === 0 || activeEnvFilters.includes("all")) {
      return connections;
    }

    return connections.filter((conn) => {
      const tags = conn.metadata.tags;
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

    // Collect connection IDs that belong to non-auto workspaces
    const nonAutoWorkspaceConnectionIds = new Set<string>();
    // Collect connection IDs from auto-created workspaces (treated as uncategorized)
    const autoCreatedConnectionIds = new Set<string>();

    for (const ws of savedWorkspaces) {
      if (ws.autoCreated) {
        for (const id of ws.connectionIds) {
          autoCreatedConnectionIds.add(id);
        }
        continue;
      }

      const connIds = workspaceToConnections.get(ws.id) ?? [];
      for (const id of connIds) {
        nonAutoWorkspaceConnectionIds.add(id);
      }
      const wsConnections = connIds
        .map((id) => connectionMap.get(id))
        .filter((c): c is StoredConnection => c !== undefined);

      // Always show workspace groups even if empty (so they can receive drops)
      groups.push({ workspace: ws, connections: wsConnections });
    }

    // Merge truly uncategorized + auto-created workspace connections,
    // but exclude auto-created ones that already appear in a real workspace
    const allUncategorizedIds = [
      ...uncategorizedIds,
      ...[...autoCreatedConnectionIds].filter(
        (id) => !nonAutoWorkspaceConnectionIds.has(id),
      ),
    ];
    const uncategorizedConnections = allUncategorizedIds
      .map((id) => connectionMap.get(id))
      .filter((c): c is StoredConnection => c !== undefined);

    // Always show uncategorized group
    groups.push({ workspace: null, connections: uncategorizedConnections });

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

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selection
        setSelectedIds(new Set());
      }
      return !prev;
    });
  };

  const toggleConnectionSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const connection = connectionMap.get(active.id as string);
    setActiveConnection(connection ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveConnection(null);

    if (!over) return;

    const connectionId = active.id as string;
    if (!connectionMap.has(connectionId)) return;

    // Extract target workspace ID from droppable
    const targetWorkspaceId = over.data.current?.workspaceId as string | null;

    // Derive source workspaces from savedWorkspaces (single source of truth)
    // A connection may appear in multiple workspaces
    const sourceWorkspaces = savedWorkspaces.filter((ws) =>
      ws.connectionIds.includes(connectionId),
    );

    // If only in the target workspace already (or uncategorized→uncategorized), do nothing
    if (
      sourceWorkspaces.length === 1 &&
      sourceWorkspaces[0]?.id === targetWorkspaceId
    )
      return;
    if (sourceWorkspaces.length === 0 && targetWorkspaceId === null) return;

    try {
      // Remove from all source workspaces (except target if already there)
      for (const ws of sourceWorkspaces) {
        if (ws.id !== targetWorkspaceId) {
          await removeConnectionFromSavedWorkspace(ws.id, connectionId);
        }
      }
      // Add to target workspace
      if (targetWorkspaceId) {
        await addConnectionToSavedWorkspace(targetWorkspaceId, connectionId);
      }

      await loadSavedWorkspaces();

      const targetName =
        savedWorkspaces.find((ws) => ws.id === targetWorkspaceId)?.name ??
        "Uncategorized";
      toast.success(`Moved to ${targetName}`);
    } catch (error) {
      toast.error("Failed to move connection", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDeleteWorkspaceOnly = async () => {
    if (!deleteDialog.workspace) return;
    setIsDeleting(true);
    try {
      await deleteWorkspace(deleteDialog.workspace.id);
      toast.success(`Deleted workspace "${deleteDialog.workspace.name}"`);
      setDeleteDialog({ isOpen: false, workspace: null });
    } catch (error) {
      toast.error("Failed to delete workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteWithConnections = async () => {
    if (!deleteDialog.workspace) return;
    setIsDeleting(true);
    try {
      for (const connId of deleteDialog.workspace.connectionIds) {
        await deleteConnection(connId);
      }
      await deleteWorkspace(deleteDialog.workspace.id);
      toast.success(
        `Deleted workspace "${deleteDialog.workspace.name}" and ${deleteDialog.workspace.connectionIds.length} connection(s)`,
      );
      setDeleteDialog({ isOpen: false, workspace: null });
    } catch (error) {
      toast.error("Failed to delete", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div>
        <div className="sticky top-0 z-10 bg-background pb-2 -mx-6 px-6 pt-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
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

            <div className="flex items-center gap-2">
              {/* Selection mode toggle */}
              <Button
                variant={selectionMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={toggleSelectionMode}
                title={
                  selectionMode ? "Exit selection mode" : "Select multiple"
                }
              >
                {selectionMode ? (
                  <IconCheckbox className="h-3.5 w-3.5" />
                ) : (
                  <IconSquare className="h-3.5 w-3.5" />
                )}
              </Button>

              <div className="flex items-center border rounded-md">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 px-2 rounded-r-none ${
                    viewMode === "grid" ? "bg-muted" : ""
                  }`}
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
                  className={`h-7 px-2 rounded-l-none ${
                    viewMode === "list" ? "bg-muted" : ""
                  }`}
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
        </div>

        {filteredConnections.length === 0 &&
        workspaceGroups.every((g) => g.connections.length === 0) ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No connections match the selected filter
          </div>
        ) : (
          <div>
            {workspaceGroups.map((group) => (
              <DroppableGroup
                key={group.workspace?.id ?? "uncategorized"}
                group={group}
                viewMode={viewMode}
                isCollapsed={collapsedWorkspaces.has(
                  group.workspace?.id ?? "uncategorized",
                )}
                onToggleCollapse={() => {
                  toggleWorkspaceCollapse(
                    group.workspace?.id ?? "uncategorized",
                  );
                }}
                onEditWorkspace={(workspaceId) => {
                  openWorkspaceForm("edit", workspaceId);
                }}
                onDeleteWorkspace={(workspace) => {
                  setDeleteDialog({ isOpen: true, workspace });
                }}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleConnectionSelection}
              />
            ))}
          </div>
        )}
      </div>

      {/* Drag overlay - shows the dragged item */}
      <DragOverlay dropAnimation={null}>
        <DragOverlayContent connection={activeConnection} />
      </DragOverlay>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        selectedIds={selectedIds}
        onClearSelection={clearSelection}
      />

      <Dialog
        open={deleteDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialog({ isOpen: false, workspace: null });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconAlertTriangle className="w-5 h-5 text-destructive" />
              Delete Workspace
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteDialog.workspace?.name}"?
              {deleteDialog.workspace &&
                deleteDialog.workspace.connectionIds.length > 0 && (
                  <span className="block mt-2 text-foreground">
                    This workspace contains{" "}
                    {deleteDialog.workspace.connectionIds.length} connection
                    {deleteDialog.workspace.connectionIds.length !== 1
                      ? "s"
                      : ""}
                    .
                  </span>
                )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <button
              type="button"
              onClick={() => void handleDeleteWorkspaceOnly()}
              disabled={isDeleting}
              className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors disabled:opacity-50"
            >
              <div className="font-medium text-sm">Keep connections</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Only remove the workspace. Connections will remain available.
              </div>
            </button>
            {deleteDialog.workspace &&
              deleteDialog.workspace.connectionIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleDeleteWithConnections()}
                  disabled={isDeleting}
                  className="w-full text-left p-3 rounded-lg border border-destructive/30 hover:bg-destructive/5 transition-colors disabled:opacity-50"
                >
                  <div className="font-medium text-sm text-destructive">
                    Delete everything
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Permanently delete workspace and all{" "}
                    {deleteDialog.workspace.connectionIds.length} connection
                    {deleteDialog.workspace.connectionIds.length !== 1
                      ? "s"
                      : ""}
                    .
                  </div>
                </button>
              )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteDialog({ isOpen: false, workspace: null });
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
