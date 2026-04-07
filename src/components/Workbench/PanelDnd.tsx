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
  type DropPosition,
  type TabMetadata,
  type TabRenderState,
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { useDroppable } from "@dnd-kit/core";
import { DraggableTab } from "./DraggableTab";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useShallow } from "zustand/react/shallow";
import type { DbType } from "@/types/connection";
import { usePanelContent } from "@/hooks/usePanelContent";
import { getMountedTabs, recordVisit } from "./heavyTabMountPolicy";
import { useDragStore } from "@/stores/dragStore";

import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";
import { commandService } from "@/services/commandService";

const EMPTY_PANEL_SHORTCUTS: Array<{ label: string; binding: string }> = [
  { label: "New query tab", binding: "cmd+t" },
  { label: "AI assistant", binding: "cmd+l" },
  { label: "Command palette", binding: "cmd+p" },
  { label: "Split panel", binding: "cmd+\\" },
];

function useMountedTabs(
  activeTabId: string | null,
  allTabIds: string[],
  metadataByTab?: Record<string, TabMetadata | undefined>,
) {
  const [recentOrder, setRecentOrder] = useState<string[]>(() =>
    activeTabId ? [activeTabId] : [],
  );
  const [isPending, startTransition] = useTransition();
  const recentOrderRef = useRef(recentOrder);
  const tabIdsRef = useRef(allTabIds);
  const metadataByTabRef = useRef(metadataByTab);

  useEffect(() => {
    recentOrderRef.current = recentOrder;
  }, [recentOrder]);

  useEffect(() => {
    tabIdsRef.current = allTabIds;
    metadataByTabRef.current = metadataByTab;
  }, [allTabIds, metadataByTab]);

  useEffect(() => {
    if (!activeTabId) return;

    const updateOrder = () => {
      setRecentOrder((prev) => recordVisit(prev, activeTabId));
    };

    const isAlreadyMounted = getMountedTabs({
      activeTabId,
      tabIds: tabIdsRef.current,
      metadataByTab: metadataByTabRef.current,
      recentOrder: recentOrderRef.current,
    }).has(activeTabId);

    if (isAlreadyMounted) {
      updateOrder();
    } else {
      startTransition(updateOrder);
    }
  }, [activeTabId, startTransition]);

  const mountedTabs = useMemo(
    () =>
      getMountedTabs({
        activeTabId,
        tabIds: allTabIds,
        metadataByTab,
        recentOrder,
      }),
    [activeTabId, allTabIds, metadataByTab, recentOrder],
  );

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
}

const DroppableZone: React.FC<DroppableZoneProps> = ({
  panelId,
  position,
}) => {
  const droppableId = `drop-${panelId}-${position}`;
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { panelId, position },
  });

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

const MemoizedPanelContent = React.memo(
  function MemoizedPanelContent({
    panelId,
    tabId,
    metadata,
    renderState,
  }: {
    panelId: string;
    tabId: string;
    metadata: TabMetadata;
    renderState: TabRenderState;
  }) {
    return (
      <PanelContentRenderer
        panelId={panelId}
        tabId={tabId}
        metadata={metadata}
        renderState={renderState}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.panelId === nextProps.panelId &&
    prevProps.tabId === nextProps.tabId &&
    prevProps.metadata === nextProps.metadata &&
    prevProps.renderState.isActiveTab === nextProps.renderState.isActiveTab &&
    prevProps.renderState.isInteractive ===
      nextProps.renderState.isInteractive,
);

interface PanelProps {
  panelId: string;
  path?: number[];
  className?: string;
}

export const Panel: React.FC<PanelProps> = React.memo(
  ({ panelId, className }) => {
    const content = usePanelContent(panelId);

    // Use dedicated focus store to avoid subscribing to entire workbench store
    const isFocused = usePanelFocusStore(
      useCallback(
        (state: { focusedPanelId: string | null }) =>
          state.focusedPanelId === panelId,
        [panelId],
      ),
    );
    const focusPanel = useWorkbenchStore((state) => state.focusPanel);
    const closePanelAction = useWorkbenchStore(
      (state) => state.closePanelAction,
    );
    const splitPanelAction = useWorkbenchStore(
      (state) => state.splitPanelAction,
    );

    const panelRef = useRef<HTMLDivElement>(null);
    const tabsContainerRef = useRef<HTMLDivElement>(null);

    const isOnlyPanel = useWorkbenchStore(
      useCallback(
        (state: { panelContents: Map<string, unknown> }) =>
          state.panelContents.size <= 1,
        [],
      ),
    );
    const isDragActive = useDragStore((state) => state.isDragActive);
    const isSourcePanel = useDragStore(
      useCallback(
        (state) => state.sourcePanelId === panelId,
        [panelId],
      ),
    );
    const showCenterZone = isDragActive && (!isSourcePanel || isOnlyPanel);

    // Get workspace connection IDs for tab color grouping
    const workspaceConnectionIds = useWorkspaceBundleStore(
      useShallow((state) => state.activeWorkspace?.config.connectionIds ?? []),
    );

    const { mountedTabs, isPending } = useMountedTabs(
      content?.activeTabId ?? null,
      content?.tabIds ?? [],
      content?.metadata,
    );

    // Memoize connection lookups to avoid O(n*m) connection searches during render
    const tabIds = content?.tabIds;
    const metadata = content?.metadata;
    const connectionInfoByConnectionId = useMemo(() => {
      const map = new Map<string, { dbType: DbType; name: string }>();
      if (!tabIds) return map;
      tabIds.forEach((tabId) => {
        const connectionId = metadata?.[tabId]?.connectionId;
        if (connectionId && !map.has(connectionId)) {
          const conn = useConnectionStore
            .getState()
            .getConnection(connectionId);
          if (conn) {
            map.set(connectionId, {
              dbType: conn.profile.db_type,
              name: conn.profile.name,
            });
          }
        }
      });
      return map;
    }, [tabIds, metadata]);

    // Focus the panel itself when it becomes logically focused
    // Note: We intentionally don't focus the inner grid content to avoid
    // triggering auto-selection of the first cell. The user should click
    // on the grid to focus it and select a specific cell.
    useEffect(() => {
      if (isFocused && panelRef.current) {
        // Only focus the panel container if focus isn't already inside it.
        // Without this guard, clicking on an inner element (e.g. QuickFilter input)
        // triggers focusPanel → isFocused changes → this effect steals focus back
        // to the panel div, forcing the user to click twice.
        if (!panelRef.current.contains(document.activeElement)) {
          panelRef.current.focus({ preventScroll: true });
        }
      }
    }, [isFocused]);

    const handleClick = useCallback(() => {
      focusPanel(panelId);
    }, [focusPanel, panelId]);

    const handleSplit = useCallback(
      (direction: "up" | "down" | "left" | "right") => {
        splitPanelAction({
          targetPanelId: panelId,
          direction,
          splitRatio: 0.5,
        });
      },
      [splitPanelAction, panelId],
    );

    const handleNewQueryTab = useCallback(() => {
      focusPanel(panelId);
      void commandService.execute("workbench.action.newQueryTab");
    }, [focusPanel, panelId]);

    if (!content) return null;

    return (
      <div
        ref={panelRef}
        tabIndex={0}
        data-panel-id={panelId}
        className={cn(
          "panel flex flex-col bg-background h-full overflow-hidden relative rounded-xl outline-none border-2",
          isFocused && !isOnlyPanel ? "border-primary/30" : "border-background",
          className,
        )}
        onClick={handleClick}
        onFocus={() => {
          focusPanel(panelId);
        }}
      >
        <div className="panel-header flex items-center justify-between bg-muted">
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
                    panelId={panelId}
                    displayName={displayName}
                    isActive={content.activeTabId === tabId}
                    isFocused={isFocused}
                    isLast={index === content.tabIds.length - 1}
                    tabType={metadata?.type || "table"}
                    isView={metadata?.isView}
                    kind={metadata?.kind}
                    returnType={metadata?.returnType as string | undefined}
                    objectType={
                      metadata?.objectType as
                        | "function"
                        | "procedure"
                        | "package"
                        | "package_body"
                        | "sequence"
                        | "synonym"
                        | undefined
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
                    syncSort={
                      metadata &&
                      (metadata.type === "table" ||
                        metadata.type === "mongo-collection" ||
                        metadata.type === "redis-key")
                        ? metadata.syncSort !== false
                        : undefined
                    }
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
                    closePanelAction(panelId);
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
              if (!metadata) return null;

              const renderState: TabRenderState = {
                isActiveTab: isActive,
                isPanelFocused: isFocused,
                isInteractive: isFocused && isActive,
              };

              return (
                <div
                  key={tabId}
                  className={cn("absolute inset-0")}
                  style={{ display: isActive ? "block" : "none" }}
                >
                  <MemoizedPanelContent
                    panelId={panelId}
                    tabId={tabId}
                    metadata={metadata}
                    renderState={renderState}
                  />
                </div>
              );
            })}

          {content.tabIds.length === 0 && (
            <div className="flex h-full w-full items-center justify-center p-6">
              <div className="mt-3 grid grid-cols-1 gap-3 w-full">
                {EMPTY_PANEL_SHORTCUTS.map(({ label, binding }) => (
                  <div
                    key={binding}
                    className="flex items-center justify-center gap-3 w-full"
                  >
                    <div className="w-1/2 text-xs text-foreground text-right">
                      {label}
                    </div>
                    <div className="w-1/2">
                      <ShortcutKeys binding={binding} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drop Zones */}
          {isDragActive && (
            <>
              <DroppableZone panelId={panelId} position="top" />
              <DroppableZone panelId={panelId} position="bottom" />
              <DroppableZone panelId={panelId} position="left" />
              <DroppableZone panelId={panelId} position="right" />
              {showCenterZone && (
                <DroppableZone panelId={panelId} position="center" />
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);

Panel.displayName = "Panel";
