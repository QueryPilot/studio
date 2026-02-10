import { logger } from "@/lib/logger";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  useTransition,
} from "react";
import { cn } from "@/lib/utils";
import {
  type PanelContent,
  type DropPosition,
  type TabMetadata,
} from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import {
  IconX,
  IconLayoutGrid,
  IconLayoutSidebarRight,
  IconLayoutBottombar,
  IconLayoutSidebar,
  IconLayoutNavbar,
  IconPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { useDroppable } from "@dnd-kit/core";
import { DraggableTab } from "./DraggableTab";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import type { DbType } from "@/types/connection";

import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

const EMPTY_PANEL_SHORTCUTS: Array<{ label: string; binding: string }> = [
  { label: "New query tab", binding: "cmd+t" },
  { label: "AI assistant", binding: "cmd+l" },
  { label: "Quick panel", binding: "cmd+p" },
  { label: "Command palette", binding: "cmd+shift+p" },
  { label: "Split panel", binding: "cmd+\\" },
];

// Keep last N tabs mounted for instant switching
// Increased from 3 to preserve more tab state during typical usage
const MAX_MOUNTED_TABS = 20;

/**
 * Hook to track recently accessed tabs and keep the last N mounted.
 * Uses React 19's startTransition for non-cached tabs to keep old UI visible
 * while new content loads.
 */
function useRecentTabs(activeTabId: string | null, allTabIds: string[]) {
  // Track order of recently accessed tabs (most recent first)
  const [recentOrder, setRecentOrder] = useState<string[]>(() =>
    activeTabId ? [activeTabId] : [],
  );

  // React 19 transition - keeps old UI visible while new tab loads
  const [isPending, startTransition] = useTransition();

  // Use ref to check cache status without triggering re-renders
  const recentOrderRef = useRef(recentOrder);
  recentOrderRef.current = recentOrder;

  // Update recent order when active tab changes
  useEffect(() => {
    if (!activeTabId) return;

    // Check if tab is already in cache using ref (avoids dependency loop)
    const isAlreadyCached = recentOrderRef.current.includes(activeTabId);

    const updateOrder = () => {
      setRecentOrder((prev) => {
        // Skip if already at front
        if (prev[0] === activeTabId) return prev;
        // Remove from current position and add to front
        const filtered = prev.filter((id) => id !== activeTabId);
        return [activeTabId, ...filtered].slice(0, MAX_MOUNTED_TABS);
      });
    };

    if (isAlreadyCached) {
      // Cached tab - update immediately for instant switch
      updateOrder();
    } else {
      // Non-cached tab - use transition to keep old UI visible while loading
      startTransition(updateOrder);
    }
  }, [activeTabId]); // Only depend on activeTabId

  // Clean up tabs that no longer exist
  useEffect(() => {
    const validTabIds = new Set(allTabIds);
    setRecentOrder((prev) => {
      const filtered = prev.filter((id) => validTabIds.has(id));
      // Only update if something was removed
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [allTabIds]);

  // Return set of tabs that should remain mounted + pending state
  const mountedTabs = useMemo(() => new Set(recentOrder), [recentOrder]);

  return { mountedTabs, isPending };
}

function ShortcutKeys({
  binding,
  className,
}: {
  binding: string;
  className?: string;
}) {
  const chords = normalizeKeybindingLabel(binding);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {chords.map((chord, chordIndex) => {
        const parts = chord.split("+");
        return (
          <React.Fragment key={`${binding}-${chordIndex}`}>
            <KbdGroup>
              {parts.map((part, partIndex) => (
                <Kbd key={partIndex}>{part}</Kbd>
              ))}
            </KbdGroup>
            {chordIndex < chords.length - 1 ? (
              <span className="text-muted-foreground text-xs font-medium">
                then
              </span>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface DroppableZoneProps {
  panelId: string;
  position: DropPosition;
  isVisible: boolean;
}

const DroppableZone: React.FC<DroppableZoneProps> = ({
  panelId,
  position,
  isVisible,
}) => {
  const droppableId = `drop-${panelId}-${position}`;
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { panelId, position },
  });

  if (!isVisible) return null;

  const positionStyles: Record<DropPosition, string> = {
    top: "absolute top-1 left-1 right-1 h-1/5",
    bottom: "absolute bottom-1 left-1 right-1 h-1/5",
    left: "absolute top-1 left-1 bottom-1 w-1/5",
    right: "absolute top-1 right-1 bottom-1 w-1/5",
    center: "absolute inset-[20%]",
  };

  const labels: Record<DropPosition, string> = {
    top: "Split Up",
    bottom: "Split Down",
    left: "Split Left",
    right: "Split Right",
    center: "Move Tab Here",
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        positionStyles[position],
        "bg-primary/20 border-2 border-primary border-dashed rounded-md z-50",
        "flex items-center justify-center group cursor-pointer transition-all duration-200",
        isOver
          ? "opacity-100 bg-primary/30 border-solid"
          : "opacity-50 hover:opacity-100",
      )}
    >
      <div className="text-primary-foreground font-medium text-xs bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
        {labels[position]}
      </div>
    </div>
  );
};

const MemoizedPanelContent = React.memo(function MemoizedPanelContent({
  panelId,
  tabId,
  metadata,
}: {
  panelId: string;
  tabId: string;
  metadata: TabMetadata;
}) {
  const stableMetadata = useMemo(
    () => metadata,
    [
      metadata?.type,
      metadata?.connectionId,
      metadata?.database,
      metadata?.schema,
      metadata?.table,
      metadata?.title,
      metadata?.kind,
      metadata?.isView,
      metadata?.viewType,
      metadata?.sql,
      (metadata as Record<string, unknown>)?.initialFilter,
      (metadata as Record<string, unknown>)?.functionName,
      (metadata as Record<string, unknown>)?.returnType,
      (metadata as Record<string, unknown>)?.objectType,
    ],
  );

  return (
    <PanelContentRenderer
      panelId={panelId}
      tabId={tabId}
      metadata={stableMetadata}
    />
  );
});

interface PanelProps {
  content: PanelContent;
  path?: number[];
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({ content, className }) => {
  // Use dedicated focus store to avoid subscribing to entire workbench store
  const isFocused = usePanelFocusStore(
    useCallback((state: { focusedPanelId: string | null }) => state.focusedPanelId === content.id, [content.id])
  );
  const focusPanel = useWorkbenchStore((state) => state.focusPanel);
  const closePanelAction = useWorkbenchStore((state) => state.closePanelAction);
  const splitPanelAction = useWorkbenchStore((state) => state.splitPanelAction);
  const setActiveTab = useWorkbenchStore((state) => state.setActiveTab);
  const removeTab = useWorkbenchStore((state) => state.removeTab);
  const addTab = useWorkbenchStore((state) => state.addTab);

  const panelRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to drag state
  const draggedTab = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab,
  );
  const isOnlyPanel = useWorkbenchStore(
    useCallback((state: { panelContents: Map<string, unknown> }) => state.panelContents.size <= 1, [])
  );
  const isDragActive = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab !== null,
  );
  const isSourcePanel = draggedTab?.panelId === content.id;
  // Show split zones (top/bottom/left/right) on ALL panels when dragging
  const showSplitZones = isDragActive;
  // Show center zone only on non-source panels (dropping on source center is a no-op)
  // Exception: show center on source if it's the only panel (for consistency)
  const showCenterZone = isDragActive && (!isSourcePanel || isOnlyPanel);

  // Get workspace connection IDs for tab color grouping
  const workspaceConnectionIds = useWorkspaceBundleStore(
    (state) => state.activeWorkspace?.config.connectionIds ?? [],
  );

  // Get focused connection management for tab-sidebar sync
  const focusedConnectionId = useWorkspaceBundleStore(
    (state) => state.activeWorkspace?.focusedConnectionId,
  );
  const setFocusedConnection = useWorkspaceBundleStore(
    (state) => state.setFocusedConnection,
  );

  // Track recently accessed tabs - keeps last N tabs mounted for instant switching
  // isPending is true while a non-cached tab is loading (React 19 transition)
  const { mountedTabs, isPending } = useRecentTabs(
    content.activeTabId,
    content.tabIds,
  );

  // Memoize connection lookups to avoid O(n*m) connection searches during render
  const connectionInfoByConnectionId = useMemo(() => {
    const map = new Map<string, { dbType: DbType; name: string }>();
    content.tabIds.forEach((tabId) => {
      const connectionId = content.metadata?.[tabId]?.connectionId;
      if (connectionId && !map.has(connectionId)) {
        const conn = useConnectionStore.getState().getConnection(connectionId);
        if (conn) {
          map.set(connectionId, {
            dbType: conn.profile.db_type,
            name: conn.profile.name,
          });
        }
      }
    });
    return map;
  }, [content.tabIds, content.metadata]);

  // Focus the panel itself when it becomes logically focused
  // Note: We intentionally don't focus the inner grid content to avoid
  // triggering auto-selection of the first cell. The user should click
  // on the grid to focus it and select a specific cell.
  useEffect(() => {
    if (isFocused && panelRef.current) {
      // Only focus the panel container, not the inner content
      panelRef.current.focus({ preventScroll: true });
    }
  }, [isFocused]);

  // Removed auto-scroll logic - using sticky positioning instead

  useEffect(() => {
    logger.info(`Panel ${content.id} - Drag state:`, {
      isDragActive,
      isSourcePanel,
      showSplitZones,
      showCenterZone,
      draggedTab,
      panelCount: isOnlyPanel,
      contentId: content.id,
    });
  }, [
    isDragActive,
    isSourcePanel,
    showSplitZones,
    showCenterZone,
    draggedTab,
    isOnlyPanel,
    content.id,
  ]);

  const handleClick = useCallback(() => {
    focusPanel(content.id);
  }, [focusPanel, content.id]);

  const handleSplit = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      splitPanelAction({
        targetPanelId: content.id,
        direction,
        splitRatio: 0.5,
      });
    },
    [splitPanelAction, content.id],
  );

  const handleNewQueryTab = useCallback(() => {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
    const tabId = `query-${uuid}`;

    const { activeConnectionId, panelContents } = useWorkbenchStore.getState();
    const { getConnection } = useConnectionStore.getState();
    const { schema: selectedSchema } = useWorkspaceSelectionStore.getState();

    const connectionId = activeConnectionId ?? "";
    const connection = connectionId ? getConnection(connectionId) : null;

    const totalQueryCount = Array.from(panelContents.values()).reduce(
      (count, panelContent) => {
        return (
          count +
          panelContent.tabIds.filter((id) => {
            const metadata = panelContent.metadata?.[id];
            return metadata?.type === "query" || id.startsWith("query-");
          }).length
        );
      },
      0,
    );

    const title =
      totalQueryCount > 0 ? `Query ${totalQueryCount + 1}` : "New Query";

    addTab(content.id, tabId, {
      type: "query",
      title,
      connectionId,
      database: connection?.profile.database || "",
      schema: selectedSchema || "",
      sql: "",
    });
    setActiveTab(content.id, tabId);
    focusPanel(content.id);
  }, [addTab, content.id, focusPanel, setActiveTab]);

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      className={cn(
        "panel flex flex-col bg-background h-full overflow-hidden relative rounded-xl outline-none",
        className,
      )}
      onClick={handleClick}
      onFocus={() => {
        focusPanel(content.id);
      }}
    >
      <div className="panel-header flex items-center justify-between bg-secondary">
        <div className="overflow-x-auto relative scrollbar-none">
          <div
            ref={tabsContainerRef}
            className="flex items-center relative overflow-hidden overflow-x-scroll scrollbar-none"
          >
            {content.tabIds.map((tabId, index) => {
              const metadata = content.metadata?.[tabId];
              const displayName =
                metadata?.table ||
                metadata?.title ||
                tabId.split("-").pop() ||
                tabId;

              const nextTabId = content.tabIds[index + 1];
              const isNextActive = nextTabId
                ? content.activeTabId === nextTabId
                : false;

              // Use memoized connection info lookup
              const connInfo = metadata?.connectionId
                ? connectionInfoByConnectionId.get(metadata.connectionId)
                : undefined;

              return (
                <DraggableTab
                  key={tabId}
                  tabId={tabId}
                  panelId={content.id}
                  displayName={displayName}
                  isActive={content.activeTabId === tabId}
                  isFocused={isFocused}
                  isLast={index === content.tabIds.length - 1}
                  tabType={metadata?.type || "table"}
                  isView={metadata?.isView}
                  kind={metadata?.kind}
                  returnType={metadata?.returnType as string | undefined}
                  objectType={
                    metadata?.objectType as "function" | "procedure" | undefined
                  }
                  isNextActive={isNextActive}
                  connectionId={metadata?.connectionId}
                  workspaceConnectionIds={workspaceConnectionIds}
                  databaseName={metadata?.database}
                  dbType={connInfo?.dbType}
                  connectionName={connInfo?.name}
                  schemaName={metadata?.schema}
                  isOnlyTab={content.tabIds.length === 1}
                  tabIndex={index}
                  totalTabs={content.tabIds.length}
                  onActivate={() => {
                    setActiveTab(content.id, tabId);
                    focusPanel(content.id);

                    // If this tab belongs to a different connection, update focused connection
                    const tabConnectionId = metadata?.connectionId;
                    if (tabConnectionId && tabConnectionId !== focusedConnectionId) {
                      setFocusedConnection(tabConnectionId);
                    }
                  }}
                  onClose={() => {
                    removeTab(content.id, tabId);
                  }}
                  onCloseOthers={() => {
                    // Close all tabs except this one
                    content.tabIds.forEach((tid) => {
                      if (tid !== tabId) {
                        removeTab(content.id, tid);
                      }
                    });
                  }}
                  onCloseToRight={() => {
                    // Close all tabs to the right of this one
                    const tabsToClose = content.tabIds.slice(index + 1);
                    tabsToClose.forEach((tid) => {
                      removeTab(content.id, tid);
                    });
                  }}
                  onCloseAll={() => {
                    // Close all tabs
                    content.tabIds.forEach((tid) => {
                      removeTab(content.id, tid);
                    });
                  }}
                  onCopyName={() => {
                    navigator.clipboard.writeText(displayName);
                    toast.success("Copied to clipboard", {
                      description: displayName,
                    });
                  }}
                />
              );
            })}

            {content.tabIds.length === 0 && (
              <span className="text-muted-foreground px-2 h-8 flex items-center text-xs font-bold">
                Empty Panel
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 pr-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleNewQueryTab}
            title="New query tab"
          >
            <IconPlus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm">
                  <IconLayoutGrid />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("right");
                }}
              >
                <IconLayoutSidebarRight className="mr-2 h-4 w-4" />
                Split Right
                <DropdownMenuShortcut>⌘\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("down");
                }}
              >
                <IconLayoutBottombar className="mr-2 h-4 w-4" />
                Split Down
                <DropdownMenuShortcut>⌘⇧\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("left");
                }}
              >
                <IconLayoutSidebar className="mr-2 h-4 w-4" />
                Split Left
                <DropdownMenuShortcut>⌘⌥←</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("up");
                }}
              >
                <IconLayoutNavbar className="mr-2 h-4 w-4" />
                Split Up
                <DropdownMenuShortcut>⌘⌥↑</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  closePanelAction(content.id);
                }}
                className="text-destructive focus:text-destructive"
              >
                <IconX className="mr-2 h-4 w-4 text-destructive" />
                Close Panel
                <DropdownMenuShortcut className="text-destructive">
                  ⌘⇧W
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="panel-body flex-1 overflow-hidden relative">
        {/* Subtle loading indicator when switching to non-cached tab */}
        {isPending && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-50 overflow-hidden">
            <div className="h-full bg-primary/60 animate-pulse" />
          </div>
        )}

        {/* Render recently accessed tabs - keeps last N mounted for instant switching */}
        {/* Inactive tabs are hidden via CSS but remain mounted to preserve state */}
        {content.tabIds
          .filter((tabId) => mountedTabs.has(tabId))
          .map((tabId) => {
            const isActive = content.activeTabId === tabId;
            const metadata = content.metadata?.[tabId];
            if (!metadata || !isActive) return null;

            return (
              <div key={tabId} className={cn("absolute inset-0")}>
                <MemoizedPanelContent
                  panelId={content.id}
                  tabId={tabId}
                  metadata={metadata}
                />
              </div>
            );
          })}

        {content.tabIds.length === 0 && (
          <div className="flex h-full w-full items-center justify-center p-6">
            <div className="text-center space-y-3">
              <div className="mt-3 grid grid-cols-1 gap-3">
                {EMPTY_PANEL_SHORTCUTS.map(({ label, binding }) => (
                  <div
                    key={binding}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="w-1/2 !text-xs text-foreground text-right">
                      {label}
                    </div>
                    <div className="w-1/2">
                      <ShortcutKeys binding={binding} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Drop Zones */}
        <DroppableZone
          panelId={content.id}
          position="top"
          isVisible={showSplitZones}
        />
        <DroppableZone
          panelId={content.id}
          position="bottom"
          isVisible={showSplitZones}
        />
        <DroppableZone
          panelId={content.id}
          position="left"
          isVisible={showSplitZones}
        />
        <DroppableZone
          panelId={content.id}
          position="right"
          isVisible={showSplitZones}
        />
        <DroppableZone
          panelId={content.id}
          position="center"
          isVisible={showCenterZone}
        />
      </div>
    </div>
  );
};
