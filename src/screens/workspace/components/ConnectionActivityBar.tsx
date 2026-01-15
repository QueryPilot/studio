/**
 * ConnectionActivityBar - VS Code-style activity bar for multi-root workspaces
 *
 * Displays connection icons for all connections in the current workspace.
 * Supports drag-to-reorder, status indicators, and context menu actions.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { windowManager } from "@/services/windowManager";
import type { OpenConnection } from "@/types/workspace";
import { IconPlus, IconLayout2 } from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getDatabaseLogo } from "@/utils/databaseLogos";

/** Get status indicator styles */
function getStatusStyles(status: OpenConnection["status"]): {
  bg: string;
  ring?: string;
} {
  switch (status) {
    case "connected":
      return { bg: "bg-green-500", ring: "ring-green-500/20" };
    case "connecting":
      return { bg: "bg-amber-500 animate-pulse", ring: "ring-amber-500/20" };
    case "error":
      return { bg: "bg-red-500", ring: "ring-red-500/20" };
    case "disconnected":
      return { bg: "bg-muted-foreground/50" };
  }
}

interface ConnectionItemProps {
  connection: OpenConnection;
  isActive: boolean;
  onFocus: () => void;
  onReconnect: () => void;
  onRemove: () => void;
}

function ConnectionItem({
  connection,
  isActive,
  onFocus,
  onReconnect,
  onRemove,
}: ConnectionItemProps) {
  const statusStyles = getStatusStyles(connection.status);
  const logoSrc = getDatabaseLogo(connection.profile.db_type);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Tooltip>
          <TooltipTrigger
            onClick={onFocus}
            className={cn(
              "relative flex items-center justify-center transition-all cursor-pointer",
              "w-8 h-8 mx-auto rounded-lg p-1.5",
              "hover:bg-primary/60",
              isActive ? "bg-primary/30" : "bg-transparent",
            )}
          >
            <img
              src={logoSrc}
              alt={connection.profile.db_type}
              className="w-full h-full object-contain"
            />
            {/* Status indicator - positioned at bottom right */}
            <span
              className={cn(
                "absolute bottom-0 right-0 w-2 h-2 rounded-full animate-pulse",
                statusStyles.bg,
              )}
            />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            sideOffset={12}
            className="z-50 px-3 py-2 max-w-[200px]"
          >
            <p className="font-medium text-sm truncate">
              {connection.profile.name}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {connection.profile.host}:{connection.profile.port}
            </p>
            {connection.status === "error" && connection.error && (
              <p className="text-xs text-destructive select-text mt-1 leading-tight">
                {connection.error}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onFocus}>Focus Connection</ContextMenuItem>
        <ContextMenuItem onClick={onReconnect}>Reconnect</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRemove} className="text-destructive">
          Remove from Workspace
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ConnectionActivityBar() {
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);

  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const focusedConnectionId = activeWorkspace?.focusedConnectionId;
  const setFocusedConnection = useWorkspaceBundleStore(
    (s) => s.setFocusedConnection,
  );
  const reconnectConnection = useWorkspaceBundleStore(
    (s) => s.reconnectConnection,
  );
  const removeConnectionFromWorkspace = useWorkspaceBundleStore(
    (s) => s.removeConnectionFromWorkspace,
  );
  const addConnectionToWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToWorkspace,
  );

  // Get all connections from store
  const allConnections = useConnectionStore((s) => s.connections);

  // Filter out connections already in workspace
  const workspaceConnectionIds = activeWorkspace
    ? new Set(activeWorkspace.config.connectionIds)
    : new Set<string>();
  const availableConnections = allConnections.filter(
    (c) => !workspaceConnectionIds.has(c.profile.id),
  );

  if (!activeWorkspace) return null;

  const connections = Array.from(activeWorkspace.connections.values());

  return (
    <div className="w-12 shrink-0 flex flex-col items-center py-2 bg-secondary">
      {/* Connection icons */}
      <div className="flex-1 flex flex-col gap-3 w-full pl-1.5">
        {connections.map((conn) => (
          <ConnectionItem
            key={conn.id}
            connection={conn}
            isActive={conn.id === focusedConnectionId}
            onFocus={() => {
              setFocusedConnection(conn.id);
            }}
            onReconnect={() => void reconnectConnection(conn.id)}
            onRemove={() => void removeConnectionFromWorkspace(conn.id)}
          />
        ))}
        {/* Add connection button */}
      </div>
      <div className="sticky bottom-0 flex justify-center items-center">
        <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
          <Tooltip>
            <TooltipTrigger>
              <PopoverTrigger
                className={cn(
                  "inline-flex items-center justify-center",
                  "h-7 w-7 rounded-lg",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-primary/30 transition-colors",
                )}
              >
                <IconPlus className="w-4 h-4" />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={12} className="z-50">
              Add Connection
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="right"
            sideOffset={8}
            align="end"
            className="w-64 p-0"
          >
            <Command className="rounded-lg p-0">
              <CommandInput
                placeholder="Search connections..."
                className="text-xs"
              />
              <CommandList className="max-h-48 min-h-0">
                <CommandEmpty className="py-4 text-xs text-muted-foreground sticky top-0">
                  No connections available
                </CommandEmpty>
                <CommandGroup heading="Add to Workspace">
                  {availableConnections.map((conn) => (
                    <CommandItem
                      key={conn.profile.id}
                      value={`${conn.profile.name} ${conn.profile.database}@${conn.profile.host}:${conn.profile.port}`}
                      onSelect={() => {
                        void addConnectionToWorkspace(conn.profile.id);
                        setAddPopoverOpen(false);
                      }}
                      className="gap-2"
                    >
                      <img
                        src={getDatabaseLogo(conn.profile.db_type)}
                        alt=""
                        className="w-4 h-4 object-contain shrink-0"
                      />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate text-xs font-medium">
                          {conn.profile.name}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {conn.profile.host}:{conn.profile.port}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex justify-center items-center mt-2 mb-1">
        <Popover
          open={workspaceSwitcherOpen}
          onOpenChange={setWorkspaceSwitcherOpen}
        >
          <Tooltip>
            <TooltipTrigger>
              <PopoverTrigger
                className={cn(
                  "inline-flex items-center justify-center",
                  "h-7 w-7 rounded-lg",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-primary/30 transition-colors",
                )}
              >
                <IconLayout2 className="w-4 h-4" />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={12} className="z-50">
              Switch Workspace
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="right"
            sideOffset={8}
            align="end"
            className="w-64 p-0"
          >
            <Command className="rounded-lg p-0">
              <CommandInput
                placeholder="Search workspaces..."
                className="text-xs"
              />
              <CommandList className="max-h-48 min-h-0">
                <CommandEmpty className="py-4 text-xs text-muted-foreground">
                  No workspaces found
                </CommandEmpty>
                <CommandGroup heading="Workspaces">
                  {savedWorkspaces.map((ws) => (
                    <CommandItem
                      key={ws.id}
                      value={ws.name}
                      onSelect={() => {
                        void windowManager.openNamedWorkspace(ws.id, ws.name);
                        setWorkspaceSwitcherOpen(false);
                      }}
                      className="gap-2"
                    >
                      <IconLayout2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate text-xs font-medium">
                          {ws.name}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {ws.connectionIds.length} connection
                          {ws.connectionIds.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
