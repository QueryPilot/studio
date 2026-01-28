/**
 * SidebarConnectionList.tsx
 *
 * Container component that displays all connections in the workspace
 * as VS Code-style collapsible sections. Manages expanded state and
 * search filtering across all connections.
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
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { eventBus } from "@/services/eventBus";
import { QueryHistoryPanel } from "@/components/QueryHistory";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { ConnectionSection } from "./ConnectionSection";
import type { OpenConnection } from "@/types/workspace";
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";
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
  const [sidebarView, setSidebarView] = useState<"objects" | "queries">(
    "objects",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Listen for sidebar view switch commands from command palette
  useEffect(() => {
    const handleSwitchView = (event: { view: "objects" | "queries" }) => {
      setSidebarView(event.view);
    };
    eventBus.on("sidebar:switch-view", handleSwitchView);
    return () => {
      eventBus.off("sidebar:switch-view", handleSwitchView);
    };
  }, []);

  // Get all connections from workspace bundle store
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const focusedConnectionId = activeWorkspace?.focusedConnectionId ?? null;

  // Get connections as an array, sorted by the order in config.connectionIds
  const connections = useMemo(() => {
    if (!activeWorkspace) return [];

    const orderedConnections: OpenConnection[] = [];
    const connectionIds = activeWorkspace.config.connectionIds;

    for (const id of connectionIds) {
      const conn = activeWorkspace.connections.get(id);
      if (conn) {
        orderedConnections.push(conn);
      }
    }

    return orderedConnections;
  }, [activeWorkspace]);

  // Track expanded connections - auto-expand focused connection
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(
    () => {
      const initial = new Set<string>();
      // Auto-expand the focused connection
      if (focusedConnectionId) {
        initial.add(focusedConnectionId);
      }
      return initial;
    },
  );

  // Track previous focused connection to detect changes
  const prevFocusedIdRef = useRef<string | null>(null);

  // Track connection section DOM elements for scrolling
  const connectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // When focused connection changes, auto-expand it and scroll to it
  useEffect(() => {
    if (
      focusedConnectionId &&
      focusedConnectionId !== prevFocusedIdRef.current
    ) {
      setExpandedConnections((prev) => {
        const next = new Set(prev);
        next.add(focusedConnectionId);
        return next;
      });

      // Scroll to the connection section after a short delay (to allow expand animation)
      setTimeout(() => {
        const element = connectionRefs.current.get(focusedConnectionId);
        element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
    prevFocusedIdRef.current = focusedConnectionId;
  }, [focusedConnectionId]);

  const toggleConnection = useCallback((connectionId: string) => {
    setExpandedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(connectionId)) {
        next.delete(connectionId);
      } else {
        next.add(connectionId);
      }
      return next;
    });
  }, []);

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

  // Filter connections by search query (by name)
  const filteredConnections = useMemo(() => {
    if (!searchQuery) return connections;

    const query = searchQuery.toLowerCase();
    return connections.filter(
      (conn) =>
        conn.profile.name.toLowerCase().includes(query) ||
        conn.database.toLowerCase().includes(query),
    );
  }, [connections, searchQuery]);

  if (!activeWorkspace) {
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
    <div className="flex h-full">
      {/* Vertical Tab Bar */}
      <div className="flex flex-col py-1">
        <button
          onClick={() => {
            setSidebarView("objects");
          }}
          title="Database Objects"
          className={cn(
            "p-2 transition-colors",
            sidebarView === "objects"
              ? "text-foreground bg-background border-r-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <IconDatabase className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setSidebarView("queries");
          }}
          title="Query History"
          className={cn(
            "p-2 transition-colors",
            sidebarView === "queries"
              ? "text-foreground bg-background border-r-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <IconHistory className="h-4 w-4" />
        </button>
      </div>

      {/* Content Area */}
      {sidebarView === "queries" ? (
        <div className="flex-1 min-w-0">
          <QueryHistoryPanel />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header with search and actions */}
          <div className="shrink-0 p-1.5 space-y-1.5">
            {/* Title bar with actions */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Connections
              </span>
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

            {/* Search input */}
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
          </div>

          {/* Connection list */}
          <div className="flex-1 overflow-auto">
            {filteredConnections.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  No connections match "{searchQuery}"
                </p>
              </div>
            ) : (
              filteredConnections.map((connection) => (
                <ConnectionSection
                  key={connection.id}
                  ref={(el) => {
                    if (el) {
                      connectionRefs.current.set(connection.id, el);
                    } else {
                      connectionRefs.current.delete(connection.id);
                    }
                  }}
                  connection={connection}
                  isExpanded={expandedConnections.has(connection.id)}
                  onToggle={() => {
                    toggleConnection(connection.id);
                  }}
                  searchQuery={searchQuery}
                  onTableClick={onTableClick}
                  onFunctionClick={onFunctionClick}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
