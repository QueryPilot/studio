import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useConnectionStore } from "@/stores/connectionStore";
import { windowManager } from "@/services/windowManager";
import { useNavigate } from "react-router-dom";
import type { DatabaseType, DatabaseConnection } from "@/types/database";
import {
  Database,
  Server,
  FileText,
  HardDrive,
  Layers3,
  Circle,
  GripVertical,
} from "lucide-react";
import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const databaseIcons: Record<DatabaseType, typeof Database> = {
  postgresql: Database,
  mysql: Database,
  sqlite: FileText,
  mssql: Server,
  mariadb: HardDrive,
  mongodb: Layers3,
};

const databaseColors: Record<DatabaseType, string> = {
  postgresql: "text-blue-600",
  mysql: "text-orange-600",
  sqlite: "text-gray-600",
  mssql: "text-red-600",
  mariadb: "text-purple-600",
  mongodb: "text-green-600",
};

interface ConnectionListProps {
  searchQuery: string;
}

interface SortableConnectionItemProps {
  connection: DatabaseConnection;
  isActive: boolean;
  onClick: () => void;
}

function SortableConnectionItem({
  connection,
  isActive,
  onClick,
}: SortableConnectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: connection.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const IconComponent = databaseIcons[connection.type];
  const colorClass = databaseColors[connection.type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center justify-between px-1 py-1.5 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors ${
        isActive ? "bg-muted/50 border-l-2 border-primary" : ""
      } ${isDragging ? "z-10 shadow-lg bg-background border" : ""}`}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      <div className="flex items-center space-x-1 min-w-0 flex-1">
        <div className="flex items-center justify-center w-3 h-4 transition-opacity opacity-0 group-hover:opacity-100 text-muted-foreground/70">
          <GripVertical className="w-2.5 h-2.5" />
        </div>

        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <IconComponent className={`h-5 w-5 flex-shrink-0 ${colorClass}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1">
              <span className="text-sm font-medium truncate">
                {connection.name}
              </span>
              {isActive && (
                <Circle className="h-1.5 w-1.5 fill-primary text-primary flex-shrink-0" />
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {connection.host
                ? `${connection.host}:${connection.port} • ${connection.database}`
                : connection.filepath}
            </div>
            {connection.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {connection.tags.map((tag, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="text-xs px-2 py-0.5 h-5"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      borderColor: tag.color,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Badge
        variant="secondary"
        className={`text-[10px] px-1.5 py-0 h-4 ml-2 flex-shrink-0 font-medium border-0 ${colorClass}`}
        style={{
          backgroundColor: colorClass.includes("blue")
            ? "rgba(37, 99, 235, 0.1)"
            : colorClass.includes("orange")
            ? "rgba(251, 146, 60, 0.1)"
            : colorClass.includes("gray")
            ? "rgba(107, 114, 128, 0.1)"
            : colorClass.includes("red")
            ? "rgba(239, 68, 68, 0.1)"
            : colorClass.includes("purple")
            ? "rgba(168, 85, 247, 0.1)"
            : "transparent",
        }}
      >
        {connection.type.toUpperCase()}
      </Badge>
    </div>
  );
}

export function ConnectionList({ searchQuery }: ConnectionListProps) {
  const {
    connections,
    setActiveConnection,
    activeConnectionId,
    isLoading,
    reorderConnections,
  } = useConnectionStore();
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const filteredConnections = useMemo(() => {
    if (!searchQuery) return connections;

    const query = searchQuery.toLowerCase();
    return connections.filter(
      (conn) =>
        conn.name.toLowerCase().includes(query) ||
        conn.workspace.toLowerCase().includes(query) ||
        conn.type.toLowerCase().includes(query) ||
        conn.tags.some((tag) => tag.name.toLowerCase().includes(query)),
    );
  }, [connections, searchQuery]);

  const connectionsByWorkspace = useMemo(() => {
    const grouped = new Map<string, typeof filteredConnections>();

    filteredConnections.forEach((conn) => {
      if (!grouped.has(conn.workspace)) {
        grouped.set(conn.workspace, []);
      }
      const workspaceConnections = grouped.get(conn.workspace);
      if (workspaceConnections) {
        workspaceConnections.push(conn);
      }
    });

    // Sort connections within each workspace by order
    for (const [_, workspaceConnections] of grouped) {
      workspaceConnections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    return grouped;
  }, [filteredConnections]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeConnection = connections.find((conn) => conn.id === active.id);
    const overConnection = connections.find((conn) => conn.id === over.id);

    if (!activeConnection || !overConnection) {
      return;
    }

    // Only allow reordering within the same workspace
    if (activeConnection.workspace !== overConnection.workspace) {
      return;
    }

    // Get all connections in the same workspace
    const workspaceConnections = connections.filter(
      (conn) => conn.workspace === activeConnection.workspace,
    );
    const oldIndex = workspaceConnections.findIndex(
      (conn) => conn.id === active.id,
    );
    const newIndex = workspaceConnections.findIndex(
      (conn) => conn.id === over.id,
    );

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Reorder within workspace
    const reorderedWorkspaceConnections = arrayMove(
      workspaceConnections,
      oldIndex,
      newIndex,
    );

    // Update the full connections array with reordered workspace connections
    const otherConnections = connections.filter(
      (conn) => conn.workspace !== activeConnection.workspace,
    );
    const allReorderedConnections = [
      ...otherConnections,
      ...reorderedWorkspaceConnections,
    ];

    // Save the reordered connections
    await reorderConnections(allReorderedConnections);
  };

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
            Click "Load Dev Databases" to add development connections,
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

  return (
    <div className="flex-1 overflow-auto p-3">
      {Array.from(connectionsByWorkspace.entries()).map(
        ([workspace, workspaceConnections]) => (
          <div key={workspace} className="mb-4">
            <div className="flex items-center gap-1 mb-2">
              <Layers3 className="h-3 w-3 text-muted-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {workspace}
              </h2>
              <div className="flex-1">
                <Separator className="ml-1" />
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={workspaceConnections.map((conn) => conn.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1">
                  {workspaceConnections.map((connection) => {
                    const isActive = activeConnectionId === connection.id;

                    const handleConnectionClick = () => {
                      setActiveConnection(connection.id);

                      // Try to open workspace window
                      windowManager
                        .openWorkspace(connection.id, connection.name)
                        .catch((error: unknown) => {
                          // If window manager fails, navigate to workspace in same window
                          console.error(
                            "Failed to open workspace window:",
                            error,
                          );
                          navigate(`/workspace/${connection.id}`);
                        });
                    };

                    return (
                      <SortableConnectionItem
                        key={connection.id}
                        connection={connection}
                        isActive={isActive}
                        onClick={handleConnectionClick}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ),
      )}

      {connections.length > 0 && (
        <div className="text-center pt-2 pb-2">
          <p className="text-sm text-muted-foreground">
            {filteredConnections.length} of {connections.length} connections
          </p>
        </div>
      )}
    </div>
  );
}
