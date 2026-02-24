/**
 * SidebarConnectionList.tsx
 *
 * Container component that displays all connections in the workspace
 * as VS Code-style sections with search filtering across all connections.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconSearch,
  IconRefresh,
  IconPlus,
  IconLoader2,
  IconDatabase,
  IconHistory,
  IconSitemap,
  IconChevronRight,
  IconLayoutDashboard,
  IconColumns,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { eventBus } from "@/services/eventBus";
import { QueryHistoryPanel } from "@/components/QueryHistory";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useShallow } from "zustand/react/shallow";
import { ConnectionSection } from "./ConnectionSection";
import type { OpenConnection } from "@/types/workspace";
import { getParadigm } from "@/types/connection";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { openErdView, openErdInSplitRight } from "@/utils/workbench/openers";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";
import { DraggableSidebarItem, type SidebarItemDragData } from "./DatabaseSidebarItem";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

interface SidebarConnectionListProps {
  /** Optional callback when a table is clicked */
  onTableClick?: (
    connectionId: string,
    table: TableMeta,
    viewType?:
      | "data"
      | "structure"
      | "indexes"
      | "triggers"
      | "definition"
      | "partitions",
  ) => void;
  /** Optional callback when a function is clicked */
  onFunctionClick?: (connectionId: string, func: FunctionMeta) => void;
}

export function SidebarConnectionList({
  onTableClick,
  onFunctionClick,
}: SidebarConnectionListProps) {
  const [sidebarView, setSidebarView] = useState<"objects" | "queries" | "erd">(
    "objects",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [expandedErdDbs, setExpandedErdDbs] = useState<Set<string>>(new Set());

  // Listen for sidebar view switch commands from command palette
  useEffect(() => {
    const handleSwitchView = (event: { view: "objects" | "queries" | "erd" }) => {
      setSidebarView(event.view);
    };
    eventBus.on("sidebar:switch-view", handleSwitchView);
    return () => {
      eventBus.off("sidebar:switch-view", handleSwitchView);
    };
  }, []);

  // Only subscribe to connection list references, not focused connection changes.
  const [connectionIds, workspaceConnections] = useWorkspaceBundleStore(
    useShallow((s) => [
      s.activeWorkspace?.config.connectionIds ?? null,
      s.activeWorkspace?.connections ?? null,
    ]),
  );
  // Get connections as an array, sorted by the order in config.connectionIds
  const connections = useMemo(() => {
    if (!connectionIds || !workspaceConnections) return [];

    const orderedConnections: OpenConnection[] = [];

    for (const id of connectionIds) {
      const conn = workspaceConnections.get(id);
      if (conn) {
        orderedConnections.push(conn);
      }
    }

    return orderedConnections;
  }, [connectionIds, workspaceConnections]);

  // Default all SQL connections to expanded in ERD view.
  // Uses a ref to track which connections we've already seen so we don't
  // re-expand ones the user manually collapsed.
  const seenErdDbsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sqlIds = connections
      .filter((c) => getParadigm(c.profile.db_type) === "sql")
      .map((c) => c.id);
    const newIds = sqlIds.filter((id) => !seenErdDbsRef.current.has(id));
    if (newIds.length === 0) return;
    for (const id of newIds) seenErdDbsRef.current.add(id);
    setExpandedErdDbs((prev) => new Set([...prev, ...newIds]));
  }, [connections]);

  const noopToggleConnection = useCallback(() => {}, []);

  // Handle refresh all connections
  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      // Show feedback - individual components will refresh via their own hooks
      toast.info("Refreshing all connections...");

      // Small delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsRefreshingAll(false);
    }
  }, []);

  // Handle add connection
  const handleAddConnection = useCallback(() => {
    // TODO: Open connection picker dialog
    toast.info("Add connection - coming soon");
  }, []);

  // When searching, show all connections and let ConnectionSection filter items within
  // This allows finding tables/views/functions even if connection name doesn't match
  const filteredConnections = useMemo(() => {
    // When there's a search query, show all connections
    // ConnectionSection will filter and show only matching tables/views/functions
    if (searchQuery) return connections;
    return connections;
  }, [connections, searchQuery]);

  if (!connectionIds || !workspaceConnections) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">No workspace active</p>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground mb-3">
          No connections in workspace
        </p>
        <Button variant="outline" size="sm" onClick={handleAddConnection}>
          <IconPlus className="h-4 w-4 mr-2" />
          Add Connection
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with tabs and actions */}
      <div className="shrink-0 p-1.5 space-y-2">
        {/* Tabs and action buttons row */}
        <div className="flex items-center justify-between">
          {/* Horizontal Tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setSidebarView("objects");
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors",
                sidebarView === "objects"
                  ? "text-foreground bg-muted rounded-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <IconDatabase className="h-3.5 w-3.5" />
              <span>Objects</span>
            </button>
            <button
              onClick={() => {
                setSidebarView("queries");
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors",
                sidebarView === "queries"
                  ? "text-foreground bg-muted rounded-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <IconHistory className="h-3.5 w-3.5" />
              <span>History</span>
            </button>
            <button
              onClick={() => {
                setSidebarView("erd");
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors",
                sidebarView === "erd"
                  ? "text-foreground bg-muted rounded-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <IconSitemap className="h-3.5 w-3.5" />
              <span>ERD</span>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleAddConnection}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">Add Connection</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleRefreshAll}
                    disabled={isRefreshingAll}
                  >
                    {isRefreshingAll ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="h-3.5 w-3.5" />
                    )}
                  </Button>
                }
              />
              <TooltipContent side="bottom">Refresh All</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Search input - only show for objects view */}
        {sidebarView === "objects" && (
          <div className="relative">
            <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search objects..."
              className="pl-7 h-7 text-xs"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
            />
          </div>
        )}
      </div>

      {/* Content Area */}
      {sidebarView === "queries" ? (
        <div className="flex-1 min-w-0 overflow-auto">
          <QueryHistoryPanel />
        </div>
      ) : sidebarView === "erd" ? (
        <div className="flex-1 overflow-auto">
          {connections.filter((c) => getParadigm(c.profile.db_type) === "sql").length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No SQL databases in workspace
              </p>
            </div>
          ) : (
            <div className="py-1">
              {connections
                .filter((c) => getParadigm(c.profile.db_type) === "sql")
                .map((connection) => {
                  const isExpanded = expandedErdDbs.has(connection.id);
                  return (
                    <div key={connection.id}>
                      {/* Database header - collapsible */}
                      <button
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left"
                        onClick={() => {
                          setExpandedErdDbs((prev) => {
                            const next = new Set(prev);
                            if (next.has(connection.id)) {
                              next.delete(connection.id);
                            } else {
                              next.add(connection.id);
                            }
                            return next;
                          });
                        }}
                      >
                        <IconChevronRight
                          className={cn(
                            "h-3 w-3 text-muted-foreground transition-transform shrink-0",
                            isExpanded && "rotate-90"
                          )}
                        />
                        <img
                          src={getDatabaseLogo(connection.profile.db_type)}
                          alt={connection.profile.db_type}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="truncate flex-1">{connection.profile.name}</span>
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shrink-0",
                            connection.status === "connected"
                              ? "bg-green-500"
                              : connection.status === "connecting"
                                ? "bg-yellow-500"
                                : "bg-red-500"
                          )}
                        />
                      </button>

                      {/* ERD Views - shown when expanded */}
                      {isExpanded && (
                        <div className="ml-5">
                          {/* Main view (default) — draggable + right-click for "Open in Split Right" */}
                          <DraggableSidebarItem
                            dragId={`sidebar-erd-${connection.id}`}
                            dragData={{
                              type: "sidebar-item",
                              objectType: "erd",
                              name: `${connection.profile.name} ERD`,
                              connectionId: connection.id,
                              connectionName: connection.profile.name,
                              database: connection.database,
                              schema: connection.schema || "public",
                            } satisfies SidebarItemDragData}
                          >
                            <ContextMenu>
                              <ContextMenuTrigger
                                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted/50 transition-colors text-left rounded"
                                onClick={() => {
                                  openErdView({
                                    connectionId: connection.id,
                                    connectionName: connection.profile.name,
                                    database: connection.database,
                                    schema: connection.schema || "public",
                                  });
                                }}
                              >
                                <IconLayoutDashboard className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                <span className="truncate">main</span>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem
                                  onClick={() => {
                                    openErdView({
                                      connectionId: connection.id,
                                      connectionName: connection.profile.name,
                                      database: connection.database,
                                      schema: connection.schema || "public",
                                    });
                                  }}
                                >
                                  <IconSitemap className="h-4 w-4 mr-2" />
                                  Open ERD
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onClick={() => {
                                    openErdInSplitRight({
                                      connectionId: connection.id,
                                      connectionName: connection.profile.name,
                                      database: connection.database,
                                      schema: connection.schema || "public",
                                    });
                                  }}
                                >
                                  <IconColumns className="h-4 w-4 mr-2" />
                                  Open in Split Right
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          </DraggableSidebarItem>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {connections.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No connections in workspace
              </p>
            </div>
          ) : (
            filteredConnections.map((connection) => (
              <ConnectionSection
                key={connection.id}
                connection={connection}
                isExpanded={true}
                onToggle={noopToggleConnection}
                searchQuery={searchQuery}
                onTableClick={onTableClick}
                onFunctionClick={onFunctionClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
