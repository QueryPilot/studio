import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  IconX,
  IconTable,
  IconEye,
  IconMathFunction,
  IconBrandTabler,
  IconLayout2,
  IconArrowRight,
  IconCopy,
} from "@tabler/icons-react";
import { useDraggable } from "@dnd-kit/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { shouldShowConnectionColors } from "@/utils/connectionColors";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { DbType } from "@/types/connection";

interface DraggableTabProps {
  tabId: string;
  panelId: string;
  displayName: string;
  isActive: boolean;
  isFocused: boolean;
  isLoading?: boolean;
  isLast: boolean;
  tabType?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  returnType?: string;
  objectType?: "function" | "procedure";
  isNextActive?: boolean;
  /** Connection ID this tab belongs to */
  connectionId?: string;
  /** All connection IDs in the workspace (for color assignment) */
  workspaceConnectionIds?: string[];
  /** Database name for tooltip display */
  databaseName?: string;
  /** Database type for showing database logo */
  dbType?: DbType;
  /** Connection display name for subtitle */
  connectionName?: string;
  /** Schema name for subtitle */
  schemaName?: string;
  /** Whether this is the only tab in the panel */
  isOnlyTab?: boolean;
  /** Index of this tab in the panel */
  tabIndex?: number;
  /** Total number of tabs in the panel */
  totalTabs?: number;
  onActivate: () => void;
  onClose: () => void;
  /** Close all other tabs in the panel */
  onCloseOthers?: () => void;
  /** Close all tabs to the right of this tab */
  onCloseToRight?: () => void;
  /** Close all tabs in the panel */
  onCloseAll?: () => void;
  /** Copy the tab name to clipboard */
  onCopyName?: () => void;
  /** Whether sort is synced across tabs of the same table */
  syncSort?: boolean;
  /** Toggle sort sync for this tab */
  onToggleSyncSort?: () => void;
}

export const DraggableTab: React.FC<DraggableTabProps> = ({
  tabId,
  panelId,
  displayName,
  isActive,
  isFocused,
  isLoading = false,
  isLast,
  tabType = "table",
  isView,
  kind,
  returnType,
  objectType,
  isNextActive = false,
  connectionId,
  workspaceConnectionIds = [],
  databaseName,
  dbType,
  connectionName,
  schemaName,
  isOnlyTab = false,
  tabIndex = 0,
  totalTabs = 1,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onCopyName,
  syncSort,
  onToggleSyncSort,
}) => {
  const draggableId = `tab-${panelId}-${tabId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { tabId, panelId, displayName, tabType, isView, kind },
  });

  // Don't apply transform here - DragOverlay handles the visual feedback
  // Only reduce opacity to indicate the element is being dragged
  const style = {
    opacity: isDragging ? 0.4 : 1,
  };

  const Icon = useMemo(() => {
    switch (tabType) {
      case "table":
        if (isView) {
          return IconEye;
        }
        return IconTable;
      case "view":
        return IconEye;
      case "function":
        return IconMathFunction;
      case "query":
        return IconBrandTabler;
      case "mongo-collection":
      case "collection-design":
        return IconLayout2;
      default:
        return IconTable;
    }
  }, [tabType, isView]);

  // Determine icon color based on type
  const getIconClass = () => {
    if (tabType === "table" && isView) {
      if (kind === "MaterializedView") {
        return cn(
          "h-3.5 w-3.5",
          isActive && isFocused ? "text-blue-500" : "text-blue-500/60",
        );
      }
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-green-500" : "text-green-500/60",
      );
    }
    if (tabType === "table") {
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-primary" : "text-primary/60",
      );
    }
    if (tabType === "function") {
      // Procedures return 'void', functions have a return type
      const isProcedure =
        objectType === "procedure" ||
        (objectType == null && returnType === "void");
      if (isProcedure) {
        return cn(
          "h-3.5 w-3.5",
          isActive && isFocused ? "text-orange-500" : "text-orange-500/60",
        );
      }
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-purple-500" : "text-purple-500/60",
      );
    }
    if (tabType === "mongo-collection" || tabType === "collection-design") {
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-emerald-600" : "text-emerald-600/60",
      );
    }
    return "h-3.5 w-3.5";
  };

  // Connection indicator - only shown when 2+ connections in workspace
  const showConnectionIndicator =
    connectionId &&
    workspaceConnectionIds.length > 0 &&
    shouldShowConnectionColors(workspaceConnectionIds.length);

  // Get database logo path if dbType is provided
  const databaseLogoPath =
    showConnectionIndicator && dbType ? getDatabaseLogo(dbType) : null;

  // Build subtitle for multi-connection context: "connectionName:schema"
  const subtitle = useMemo(() => {
    if (!showConnectionIndicator) return null;
    if (!connectionName && !schemaName) return null;
    const parts: string[] = [];
    if (connectionName) parts.push(connectionName);
    if (schemaName) parts.push(schemaName);
    return parts.join(":");
  }, [showConnectionIndicator, connectionName, schemaName]);

  const hasTabsToRight = tabIndex < totalTabs - 1;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={setNodeRef}
              style={style}
              {...listeners}
              {...attributes}
              className={cn(
                "group px-2 py-1 text-xs h-8 transition-colors flex items-center gap-1.5 cursor-move relative group",
                {
                  "bg-background text-foreground z-10 sticky left-0 right-0":
                    isActive && isFocused,
                  "bg-background/90 text-foreground/70 z-10 sticky left-0 right-0":
                    isActive && !isFocused,
                  "bg-muted text-muted-foreground/60": !isActive,
                  "hover:bg-background/80": !isActive && !isFocused,
                  "opacity-50": isDragging,
                },
              )}
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
              }}
            >
              {/* Database logo indicator */}
              {databaseLogoPath && (
                <Tooltip>
                  <TooltipTrigger className="flex items-center">
                    <img
                      src={databaseLogoPath}
                      alt={dbType || "Database"}
                      className="h-3.5 w-3.5 shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    {databaseName || "Unknown database"}
                  </TooltipContent>
                </Tooltip>
              )}
              <div className="h-5 w-5 relative shrink-0">
                {/* Close button — fades in on hover, always interactive */}
                <button
                  className="absolute inset-0 z-10 flex items-center justify-center hover:bg-destructive/10 rounded transition-all duration-100 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
                {/* Type icon — fades out on hover */}
                <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 pointer-events-none group-hover:opacity-0 group-focus-within:opacity-0">
                  <Icon className={getIconClass()} />
                </div>
              </div>
              <span className="whitespace-nowrap pr-1">
                {displayName}
                {subtitle && (
                  <span className="text-muted-foreground ml-1 text-[10px]">
                    {subtitle}
                  </span>
                )}
              </span>
              {/* Loading progress bar — nprogress-style at tab bottom */}
              {isLoading && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 z-20">
                  <div className="absolute inset-0 bg-primary/20" />
                  <div className="absolute inset-y-0 left-0 bg-primary animate-tab-progress" />
                </div>
              )}
            </div>
          }
        />
        <ContextMenuContent>
          <ContextMenuItem onClick={onClose}>
            <IconX className="h-4 w-4 mr-2" />
            Close
          </ContextMenuItem>
          <ContextMenuItem onClick={onCloseOthers} disabled={isOnlyTab}>
            <span className="h-4 w-4 mr-2" />
            Close Others
          </ContextMenuItem>
          <ContextMenuItem onClick={onCloseToRight} disabled={!hasTabsToRight}>
            <IconArrowRight className="h-4 w-4 mr-2" />
            Close to the Right
          </ContextMenuItem>
          <ContextMenuItem onClick={onCloseAll}>
            <span className="h-4 w-4 mr-2" />
            Close All
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCopyName}>
            <IconCopy className="h-4 w-4 mr-2" />
            Copy Name
          </ContextMenuItem>
          {onToggleSyncSort && (
            <>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem
                checked={!!syncSort}
                onCheckedChange={() => {
                  onToggleSyncSort();
                }}
              >
                Sync Grid State Across Tabs
              </ContextMenuCheckboxItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <div
        className={cn("py-1.5 bg-muted/60 min-w-px max-w-px", {
          "bg-transparent": !(!isLast && !isActive && !isNextActive),
        })}
      >
        <div
          className={cn("h-5 w-px min-w-px self-center max-w-px", {
            "bg-muted-foreground/30": !isLast && !isActive && !isNextActive,
            "bg-transparent": !(!isLast && !isActive && !isNextActive),
          })}
        />
      </div>
    </>
  );
};
