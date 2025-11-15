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
  const bgColorClass = databaseBgColors[dbTypeStr] || "rgba(107, 114, 128, 0.1)";

  // Get window count for this connection
  const windowCount = useConnectionWindowStore((state) =>
    state.getWindowCount(connection.profile.id),
  );
  const hasOpenWindows = windowCount > 0;

  return (
    <div
      className={`group flex items-center justify-between px-1 py-1.5 rounded-xl bg-muted/40 hover:bg-muted/50 cursor-pointer transition-colors ${
        isActive ? "bg-muted/50 border-l-2 border-primary" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-center space-x-1 min-w-0 flex-1">
        <div className="flex items-center justify-center w-3 h-4 transition-opacity opacity-0 group-hover:opacity-100 text-muted-foreground/70">
          <GripVertical className="w-2.5 h-2.5" />
        </div>

        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <img
            src={getDatabaseLogo(connection.profile.db_type)}
            alt={dbTypeStr}
            className="h-5 w-5 flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1">
              <span className="text-sm font-medium truncate">
                {connection.profile.name}
              </span>
              {isActive && (
                <Circle className="h-1.5 w-1.5 fill-primary text-primary flex-shrink-0" />
              )}
              {hasOpenWindows && !isActive && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <ExternalLink className="h-3 w-3 text-blue-500" />
                  {windowCount > 1 && (
                    <span className="text-[10px] font-medium text-blue-500">
                      {windowCount}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {connection.profile.host}:{connection.profile.port}/
              {connection.profile.database}
            </div>
            <div className="flex flex-wrap gap-1 mt-1 items-center">
              {connection.metadata.tags
                .filter((tag) =>
                  ["local", "dev", "staging", "uat", "prod", "test"].includes(
                    tag,
                  ),
                )
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
                      className={`text-xs px-1.5 py-0 h-4 ${tagColor} text-white`}
                    >
                      {tag}
                    </Badge>
                  );
                })}
              <Badge
                variant="secondary"
                className={`text-[10px] px-1.5 py-0 h-4 font-medium border-0 ${colorClass}`}
                style={{
                  backgroundColor: bgColorClass,
                }}
              >
                {dbTypeStr.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
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
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1 mb-2">
        <Layers3 className="h-3 w-3 text-muted-foreground" />
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </h2>
        <div className="flex-1">
          <Separator className="ml-1" />
        </div>
      </div>

      <div className="space-y-1">
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

  return (
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
              {deletingConnection?.profile.name}"? This action cannot be undone.
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
    </>
  );
}
