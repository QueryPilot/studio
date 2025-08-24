import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useConnectionStore } from "@/stores/connectionStore";
import { windowManager } from "@/services/windowManager";
import { useNavigate } from "react-router-dom";
import type { DatabaseType } from "@/types/database";
import { 
  Database, 
  Server, 
  FileText, 
  HardDrive,
  Layers3,
  Circle
} from "lucide-react";
import { useMemo } from "react";

const databaseIcons: Record<DatabaseType, typeof Database> = {
  postgresql: Database,
  mysql: Database,
  sqlite: FileText,
  mssql: Server,
  mariadb: HardDrive,
};

const databaseColors: Record<DatabaseType, string> = {
  postgresql: "text-blue-600",
  mysql: "text-orange-600", 
  sqlite: "text-gray-600",
  mssql: "text-red-600",
  mariadb: "text-purple-600",
};

interface ConnectionListProps {
  searchQuery: string;
}

export function ConnectionList({ searchQuery }: ConnectionListProps) {
  const { connections, setActiveConnection, activeConnectionId, isLoading } = useConnectionStore();
  const navigate = useNavigate();

  const filteredConnections = useMemo(() => {
    if (!searchQuery) return connections;
    
    const query = searchQuery.toLowerCase();
    return connections.filter(conn => 
      conn.name.toLowerCase().includes(query) ||
      conn.workspace.toLowerCase().includes(query) ||
      conn.type.toLowerCase().includes(query) ||
      conn.tags.some(tag => tag.name.toLowerCase().includes(query))
    );
  }, [connections, searchQuery]);

  const connectionsByWorkspace = useMemo(() => {
    const grouped = new Map<string, typeof filteredConnections>();
    
    filteredConnections.forEach(conn => {
      if (!grouped.has(conn.workspace)) {
        grouped.set(conn.workspace, []);
      }
      const workspaceConnections = grouped.get(conn.workspace);
      if (workspaceConnections) {
        workspaceConnections.push(conn);
      }
    });
    
    return grouped;
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
            Click "Load Dev Databases" to add development connections,<br />
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
      {Array.from(connectionsByWorkspace.entries()).map(([workspace, workspaceConnections]) => (
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
          
          <div className="space-y-1">
            {workspaceConnections.map((connection) => {
              const IconComponent = databaseIcons[connection.type];
              const colorClass = databaseColors[connection.type];
              const isActive = activeConnectionId === connection.id;
              
              return (
                <div 
                  key={connection.id} 
                  className={`flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors ${
                    isActive ? "bg-muted/50 border-l-2 border-primary" : ""
                  }`}
                  onClick={async () => {
                    setActiveConnection(connection.id);
                    
                    // Try to open workspace window
                    try {
                      await windowManager.openWorkspace(connection.id, connection.name);
                    } catch (error) {
                      // If window manager fails, navigate to workspace in same window
                      console.error("Failed to open workspace window:", error);
                      navigate(`/workspace/${connection.id}`);
                    }
                  }}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <IconComponent className={`h-5 w-5 flex-shrink-0 ${colorClass}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-1">
                        <span className="text-sm font-medium truncate">{connection.name}</span>
                        {isActive && (
                          <Circle className="h-1.5 w-1.5 fill-primary text-primary flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {connection.host ? 
                          `${connection.host}:${connection.port} • ${connection.database}` :
                          connection.filepath
                        }
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
                                color: tag.color
                              }}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge 
                    variant="secondary" 
                    className={`text-[10px] px-1.5 py-0 h-4 ml-2 flex-shrink-0 font-medium border-0 ${colorClass}`}
                    style={{
                      backgroundColor: colorClass.includes('blue') ? 'rgba(37, 99, 235, 0.1)' :
                                       colorClass.includes('orange') ? 'rgba(251, 146, 60, 0.1)' :
                                       colorClass.includes('gray') ? 'rgba(107, 114, 128, 0.1)' :
                                       colorClass.includes('red') ? 'rgba(239, 68, 68, 0.1)' :
                                       colorClass.includes('purple') ? 'rgba(168, 85, 247, 0.1)' :
                                       'transparent'
                    }}
                  >
                    {connection.type.toUpperCase()}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      
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