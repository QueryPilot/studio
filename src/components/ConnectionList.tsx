import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useConnectionWindowStore } from "@/stores/connectionWindowStore";
import type { ConnectionProfile, StoredConnection } from "@/types/connection";
import { DbType } from "@/types/connection";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";
import {
  Database,
  Layers3,
  Circle,
  GripVertical,
  Edit2,
  Trash2,
  Plus,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { getDatabaseLogo } from "@/utils/databaseLogos";

const databaseColors: Record<string, string> = {
  PostgreSQL: "text-blue-600",
  MySQL: "text-orange-600",
  SQLite: "text-gray-600",
  SQLServer: "text-red-600",
};

const databaseBgColors: Record<string, string> = {
  PostgreSQL: "rgba(37, 99, 235, 0.1)",
  MySQL: "rgba(251, 146, 60, 0.1)",
  SQLite: "rgba(107, 114, 128, 0.1)",
  SQLServer: "rgba(239, 68, 68, 0.1)",
};

interface ConnectionListProps {
  searchQuery: string;
  onAddConnection?: () => void;
}

interface ConnectionItemProps {
  connection: StoredConnection;
  isActive: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

interface ConnectionGroupProps {
  title: string;
  connections: StoredConnection[];
  activeConnectionId: string | null;
  onConnectionClick: (connection: StoredConnection) => void;
  onEdit: (connection: StoredConnection) => void;
  onDelete: (connection: StoredConnection) => void;
  onDuplicate: (connection: StoredConnection) => void;
  onAddConnection?: () => void;
}

function ConnectionItem({
  connection,
  isActive,
  onClick,
  onEdit,
  onDelete,
  onDuplicate: _onDuplicate,
}: ConnectionItemProps) {
  const dbTypeStr = DbType[connection.profile.db_type];
  const colorClass = databaseColors[dbTypeStr] || "text-gray-600";
  const bgColorClass =
    databaseBgColors[dbTypeStr] || "rgba(107, 114, 128, 0.1)";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: connection.profile.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 999 : undefined,
  };

  // Get window count for this connection
  const windowCount = useConnectionWindowStore((state) =>
    state.getWindowCount(connection.profile.id),
  );
  const hasOpenWindows = windowCount > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/40 hover:bg-muted/60 cursor-pointer overflow-hidden ${
        isActive ? "bg-muted/60 ring-1 ring-primary/50" : ""
      } ${isDragging ? "opacity-50" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 text-muted-foreground/70 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>

        <img
          src={getDatabaseLogo(connection.profile.db_type)}
          alt={dbTypeStr}
          className="h-6 w-6 flex-shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium truncate max-w-[180px]">
              {connection.profile.name}
            </span>
            {isActive && (
              <Circle className="h-1.5 w-1.5 fill-primary text-primary flex-shrink-0" />
            )}
            {hasOpenWindows && !isActive && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <ExternalLink className="h-2.5 w-2.5 text-blue-500" />
                {windowCount > 1 && (
                  <span className="text-[9px] font-medium text-blue-500">
                    {windowCount}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
            {connection.profile.host}:{connection.profile.port}/
            {connection.profile.database}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {connection.metadata.tags
            .filter((tag) =>
              ["local", "dev", "staging", "uat", "prod", "test"].includes(tag),
            )
            .slice(0, 1)
            .map((tag) => {
              const tagColor =
                tag === "local"
                  ? "bg-gray-500"
                  : tag === "dev"
                  ? "bg-blue-500"
                  : tag === "staging"
                  ? "bg-yellow-500"
                  : tag === "uat"
                  ? "bg-amber-600"
                  : tag === "prod"
                  ? "bg-red-500"
                  : "bg-green-500";

              return (
                <Badge
                  key={tag}
                  variant="secondary"
                  className={`text-[9px] px-1 py-0 h-3.5 ${tagColor} text-white`}
                >
                  {tag}
                </Badge>
              );
            })}
          <Badge
            variant="secondary"
            className={`text-[9px] px-1 py-0 h-3.5 font-medium border-0 ${colorClass}`}
            style={{
              backgroundColor: bgColorClass,
            }}
          >
            {dbTypeStr.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0 transition-all delay-100 duration-200 ease-out -mr-9 opacity-0 group-hover:opacity-100 group-hover:mr-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Edit2 className="!h-3.5 !w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="!h-3.5 !w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ConnectionGroup({
  title,
  connections,
  activeConnectionId,
  onConnectionClick,
  onEdit,
  onDelete,
  onDuplicate,
  onAddConnection,
}: ConnectionGroupProps) {
  const groupId = `group-${title}`;
  const connectionIds = connections.map((conn) => conn.profile.id);

  const { setNodeRef, isOver } = useDroppable({
    id: groupId,
    data: { type: "group", title },
  });

  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-1.5 px-1">
        <Layers3 className="h-3 w-3 text-muted-foreground" />
        <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </h2>
        <div className="flex-1">
          <Separator className="ml-1" />
        </div>
        <span className="text-[9px] text-muted-foreground font-medium">
          {connections.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`min-h-[60px] rounded-lg transition-all p-1 ${
          isOver ? "bg-primary/5 ring-2 ring-primary/20" : ""
        }`}
      >
        <SortableContext
          items={connectionIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-0.5">
            {connections.map((connection) => {
              const isActive = activeConnectionId === connection.profile.id;

              const handleEdit = () => {
                onEdit(connection);
              };
              const handleDelete = () => {
                onDelete(connection);
              };
              const handleDuplicate = () => {
                onDuplicate(connection);
              };

              return (
                <ContextMenu key={connection.profile.id}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <ConnectionItem
                        connection={connection}
                        isActive={isActive}
                        onClick={() => {
                          onConnectionClick(connection);
                        }}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onDuplicate={handleDuplicate}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48 min-w-0">
                    <ContextMenuItem
                      onClick={handleEdit}
                      className="py-1 px-2 text-sm"
                    >
                      <Edit2 className="mr-1.5 h-3 w-3" />
                      Edit
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={handleDuplicate}
                      className="py-1 px-2 text-sm"
                    >
                      <Copy className="mr-1.5 h-3 w-3" />
                      Duplicate
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={handleDelete}
                      className="text-destructive focus:text-destructive py-1 px-2 text-sm"
                    >
                      <Trash2 className="mr-1.5 h-3 w-3" />
                      Delete
                    </ContextMenuItem>
                    {onAddConnection && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={onAddConnection}
                          className="py-1 px-2 text-sm"
                        >
                          <Plus className="mr-1.5 h-3 w-3" />
                          Add Connection
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

export function ConnectionList({
  searchQuery,
  onAddConnection,
}: ConnectionListProps) {
  const {
    connections,
    deleteConnection,
    addTag,
    removeTag,
    loading: isLoading,
  } = useConnectionStore();
  const [editingConnection, setEditingConnection] =
    useState<StoredConnection | null>(null);
  const [deletingConnection, setDeletingConnection] =
    useState<StoredConnection | null>(null);
  const [duplicatingConnection, setDuplicatingConnection] =
    useState<StoredConnection | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
  );

  const filteredConnections = useMemo(() => {
    if (!searchQuery) return connections;

    const query = searchQuery.toLowerCase();
    return connections.filter(
      (conn) =>
        conn.profile.name.toLowerCase().includes(query) ||
        conn.profile.host.toLowerCase().includes(query) ||
        conn.profile.database.toLowerCase().includes(query),
    );
  }, [connections, searchQuery]);

  // Group connections by their group tags (non-environment tags)
  const groupedConnections = useMemo(() => {
    const groups: Record<string, StoredConnection[]> = {};
    const ungroupedConnections: StoredConnection[] = [];

    // Environment tags that shouldn't be used for grouping
    const envTags = ["local", "dev", "staging", "uat", "prod", "test"];

    filteredConnections.forEach((connection) => {
      const tags = connection.metadata.tags;

      // Find the first non-environment tag to use as the group
      const groupTag = tags.find((tag) => !envTags.includes(tag));

      if (groupTag) {
        if (!groups[groupTag]) {
          groups[groupTag] = [];
        }
        groups[groupTag].push(connection);
      } else {
        ungroupedConnections.push(connection);
      }
    });

    return { groups, ungroupedConnections };
  }, [filteredConnections]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center text-muted-foreground">
          <Database className="mx-auto h-12 w-12 mb-4 opacity-50 animate-pulse" />
          <h3 className="text-lg font-medium">Loading connections...</h3>
        </div>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center text-muted-foreground">
          <Database className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No connections yet</h3>
          <p className="text-sm">
            Click "Load PostgreSQL Dev" to add development connections,
            <br />
            or create a new connection to get started.
          </p>
        </div>
      </div>
    );
  }

  if (filteredConnections.length === 0 && searchQuery) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center text-muted-foreground">
          <Database className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No matches found</h3>
          <p className="text-sm">
            Try adjusting your search terms or clear the filter.
          </p>
        </div>
      </div>
    );
  }

  const handleConnectionClick = async (connection: StoredConnection) => {
    setActiveConnectionId(connection.profile.id);

    try {
      const defaultDatabase = connection.profile.database.trim();
      const connectionName = connection.profile.name || "Workspace";

      // Open workspace in a new window
      await windowManager.openWorkspace(
        connection.profile.id,
        connectionName,
        defaultDatabase ? { database: defaultDatabase } : undefined,
      );
    } catch (error) {
      console.error("Failed to open workspace:", error);
      toast.error("Failed to open workspace", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to open workspace window",
      });
    }
  };

  const handleEdit = (connection: StoredConnection) => {
    setEditingConnection(connection);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (connection: StoredConnection) => {
    setDeletingConnection(connection);
    setIsDeleteDialogOpen(true);
  };

  const handleDuplicate = (connection: StoredConnection) => {
    setDuplicatingConnection(connection);
    setIsDuplicateDialogOpen(true);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      return;
    }

    // Same item, no-op
    if (active.id === over.id) {
      return;
    }

    const activeConnection = connections.find(
      (c) => c.profile.id === active.id,
    );

    if (!activeConnection) {
      return;
    }

    const envTags = ["local", "dev", "staging", "uat", "prod", "test"];
    const activeGroupTag = activeConnection.metadata.tags.find(
      (tag) => !envTags.includes(tag),
    );

    // Check if dropped on a group zone (empty area or group header)
    const overData = over.data.current;
    if (overData?.type === "group") {
      const targetGroupTitle = overData.title;
      const targetGroupTag =
        targetGroupTitle === "Connections" ? null : targetGroupTitle;

      if (activeGroupTag !== targetGroupTag) {
        try {
          if (activeGroupTag) {
            await removeTag(activeConnection.profile.id, activeGroupTag);
          }
          if (targetGroupTag) {
            await addTag(activeConnection.profile.id, targetGroupTag);
          }

          toast.success("Connection moved", {
            description: `Moved to ${targetGroupTag || "ungrouped"} group`,
          });
        } catch (error) {
          toast.error("Failed to move connection", {
            description:
              error instanceof Error ? error.message : "An error occurred",
          });
        }
      }
      return;
    }

    // Dropped on another connection item
    const overConnection = connections.find((c) => c.profile.id === over.id);
    if (!overConnection) {
      // Might have dropped on a group zone
      return;
    }

    const overGroupTag = overConnection.metadata.tags.find(
      (tag) => !envTags.includes(tag),
    );

    // Check if moving to a different group
    if (activeGroupTag !== overGroupTag) {
      try {
        if (activeGroupTag) {
          await removeTag(activeConnection.profile.id, activeGroupTag);
        }
        if (overGroupTag) {
          await addTag(activeConnection.profile.id, overGroupTag);
        }

        toast.success("Connection moved", {
          description: `Moved to ${overGroupTag || "ungrouped"} group`,
        });
      } catch (error) {
        toast.error("Failed to move connection", {
          description:
            error instanceof Error ? error.message : "An error occurred",
        });
      }
    }
    // If same group, SortableContext handles reordering automatically (visual only, no persistence yet)
  };

  const activeConnection = activeId
    ? connections.find((c) => c.profile.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 overflow-auto p-3">
              <div className="h-full">
                {/* Render grouped connections */}
                {Object.entries(groupedConnections.groups).map(
                  ([groupName, connections]) => (
                    <ConnectionGroup
                      key={groupName}
                      title={groupName}
                      connections={connections}
                      activeConnectionId={activeConnectionId}
                      onConnectionClick={handleConnectionClick}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onDuplicate={handleDuplicate}
                      onAddConnection={onAddConnection}
                    />
                  ),
                )}

                {/* Render ungrouped connections */}
                {groupedConnections.ungroupedConnections.length > 0 && (
                  <ConnectionGroup
                    title="Connections"
                    connections={groupedConnections.ungroupedConnections}
                    activeConnectionId={activeConnectionId}
                    onConnectionClick={handleConnectionClick}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicate}
                    onAddConnection={onAddConnection}
                  />
                )}

                {connections.length > 0 && (
                  <div className="text-center pt-2 pb-2">
                    <p className="text-sm text-muted-foreground">
                      {filteredConnections.length} of {connections.length}{" "}
                      connections
                    </p>
                  </div>
                )}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48 min-w-0">
            {onAddConnection && (
              <ContextMenuItem
                onClick={onAddConnection}
                className="py-1 px-2 text-sm"
              >
                <Plus className="mr-1.5 h-3 w-3" />
                Add Connection
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* Edit Connection Dialog */}
        {editingConnection && (
          <ConnectionDialog
            open={isEditDialogOpen}
            onOpenChange={(open) => {
              setIsEditDialogOpen(open);
              if (!open) setEditingConnection(null);
            }}
            connection={
              {
                ...editingConnection.profile,
                metadata: editingConnection.metadata,
              } as ConnectionProfile
            }
          />
        )}

        {/* Duplicate Connection Dialog */}
        {duplicatingConnection && (
          <ConnectionDialog
            open={isDuplicateDialogOpen}
            onOpenChange={(open) => {
              setIsDuplicateDialogOpen(open);
              if (!open) setDuplicatingConnection(null);
            }}
            connection={
              {
                ...duplicatingConnection.profile,
                id: `conn-${Date.now()}`,
                name: `${duplicatingConnection.profile.name} (Copy)`,
                metadata: duplicatingConnection.metadata,
              } as ConnectionProfile
            }
          />
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) setDeletingConnection(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Connection</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "
                {deletingConnection?.profile.name}"? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (deletingConnection) {
                    try {
                      await deleteConnection(deletingConnection.profile.id);
                      toast.success("Connection deleted", {
                        description: `"${deletingConnection.profile.name}" has been removed`,
                      });
                    } catch (error) {
                      toast.error("Failed to delete connection", {
                        description:
                          error instanceof Error
                            ? error.message
                            : "An error occurred",
                      });
                    }
                    setDeletingConnection(null);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeConnection ? (
            <div className="opacity-90 bg-background shadow-lg rounded-lg">
              <ConnectionItem
                connection={activeConnection}
                isActive={false}
                onClick={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
                onDuplicate={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </>
    </DndContext>
  );
}
