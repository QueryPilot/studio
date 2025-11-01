import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  type PanelContent,
  type DropPosition,
  type TabMetadata,
} from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  X,
  LayoutGrid,
  PanelRight,
  PanelBottom,
  PanelLeft,
  PanelTop,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { useDroppable } from "@dnd-kit/core";
import { DraggableTab } from "./DraggableTab";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";

const EMPTY_PANEL_SHORTCUTS: Array<{ label: string; binding: string }> = [
  { label: "New query tab", binding: "cmd+t" },
  { label: "AI assistant", binding: "cmd+l" },
  { label: "Quick panel", binding: "cmd+p" },
  { label: "Command palette", binding: "cmd+shift+p" },
  { label: "Split panel", binding: "cmd+\\" },
];

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
          <div
            key={`${binding}-${chordIndex}`}
            className="flex items-center gap-1"
          >
            {parts.map((part, partIndex) => (
              <React.Fragment
                key={`${binding}-${chordIndex}-${part}-${partIndex}`}
              >
                <kbd
                  className={cn(
                    "rounded-md border bg-muted p-0.5 h-7 w-7 flex items-center justify-center",
                    "text-foreground text-center",
                    [
                      "Enter",
                      "Escape",
                      "Space",
                      "Tab",
                      "Backspace",
                      "Delete",
                      "Del",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                      "Up",
                      "Down",
                      "Left",
                      "Right",
                      "Minus",
                      "Plus",
                      "=",
                      "-",
                      "`",
                      "~",
                      ";",
                      "'",
                      ",",
                      ".",
                      "/",
                      "⌘",
                      "⌥",
                      "⌃",
                      "⇧",
                    ].includes(part)
                      ? "text-xl"
                      : "text-sm",
                  )}
                >
                  {part}
                </kbd>
              </React.Fragment>
            ))}
            {chordIndex < chords.length - 1 ? (
              <span className="text-muted-foreground text-sm font-medium">
                then
              </span>
            ) : null}
          </div>
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
    top: "absolute top-1 left-1 right-1 h-1/3",
    bottom: "absolute bottom-1 left-1 right-1 h-1/3",
    left: "absolute top-1 left-1 bottom-1 w-1/3",
    right: "absolute top-1 right-1 bottom-1 w-1/3",
    center: "absolute inset-4",
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
      <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
        {labels[position]}
      </div>
    </div>
  );
};

interface PanelProps {
  content: PanelContent;
  path?: number[];
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({ content, className }) => {
  const {
    focusedPanelId,
    focusPanel,
    closePanelAction,
    splitPanelAction,
    setActiveTab,
    removeTab,
    addTab,
  } = useWorkbenchStore();

  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );

  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to drag state
  const draggedTab = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab,
  );
  const panelCount = useWorkbenchStore((state) => state.panelContents.size);
  const isDragActive = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab !== null,
  );
  const isSourcePanel = draggedTab?.panelId === content.id;
  // Show drop zones if dragging and either not source panel OR only one panel exists
  const showDropZones = isDragActive && (!isSourcePanel || panelCount === 1);

  const isFocused = focusedPanelId === content.id;

  // Removed auto-scroll logic - using sticky positioning instead

  useEffect(() => {
    console.log(`Panel ${content.id} - Drag state:`, {
      isDragActive,
      isSourcePanel,
      showDropZones,
      draggedTab,
      panelCount,
      contentId: content.id,
    });
  }, [
    isDragActive,
    isSourcePanel,
    showDropZones,
    draggedTab,
    panelCount,
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
    const { selectedSchema } = useSchemaStore.getState();

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
      database: connection?.database || "",
      schema: selectedSchema || "",
      sql: "",
    });
    setActiveTab(content.id, tabId);
    focusPanel(content.id);
  }, [addTab, content.id, focusPanel, setActiveTab]);

  return (
    <div
      className={cn(
        "panel flex flex-col bg-background h-full overflow-hidden relative rounded-xl",
        className,
      )}
      onClick={handleClick}
    >
      <div className="panel-header flex items-center justify-between bg-background">
        <div className="flex-1 overflow-x-auto relative scrollbar-none pt-1 px-1">
          <div
            ref={tabsContainerRef}
            className="flex items-center relative rounded-tl-xl overflow-hidden overflow-x-scroll scrollbar-none"
          >
            {content.tabIds.map((tabId, index) => {
              const metadata = content.metadata?.[tabId];
              const displayName =
                metadata?.title ||
                metadata?.table ||
                tabId.split("-").pop() ||
                tabId;

              const nextTabId = content.tabIds[index + 1];
              const isNextActive = nextTabId
                ? content.activeTabId === nextTabId
                : false;

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
                  isNextActive={isNextActive}
                  onActivate={() => {
                    setActiveTab(content.id, tabId);
                    focusPanel(content.id);
                  }}
                  onClose={() => {
                    removeTab(content.id, tabId);
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
            size="icon"
            className="h-6 w-6"
            onClick={handleNewQueryTab}
            title="New query tab"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <LayoutGrid className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("right");
                }}
              >
                <PanelRight className="mr-2 h-4 w-4" />
                Split Right
                <DropdownMenuShortcut>⌘\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("down");
                }}
              >
                <PanelBottom className="mr-2 h-4 w-4" />
                Split Down
                <DropdownMenuShortcut>⌘⇧\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("left");
                }}
              >
                <PanelLeft className="mr-2 h-4 w-4" />
                Split Left
                <DropdownMenuShortcut>⌘⌥←</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("up");
                }}
              >
                <PanelTop className="mr-2 h-4 w-4" />
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
                <X className="mr-2 h-4 w-4 text-destructive" />
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
        {/* Render ALL tab contents - keep them mounted to preserve state */}
        {content.tabIds.map((tabId) => {
          const isActive = content.activeTabId === tabId;
          const metadata = content.metadata?.[tabId];

          return (
            <div
              key={tabId}
              className={cn(
                "absolute inset-0",
                isActive ? "block z-10" : "hidden",
              )}
            >
              <PanelContentRenderer
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
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="bottom"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="left"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="right"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="center"
          isVisible={showDropZones}
        />
      </div>
    </div>
  );
};
