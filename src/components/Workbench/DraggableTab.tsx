import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { shouldShowConnectionColors } from "@/utils/connectionColors";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { DbType } from "@/types/connection";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useIsTabLoading } from "@/stores/tabLoadingStore";
import { toast } from "sonner";

interface DraggableTabProps {
  tabId: string;
  panelId: string;
  displayName: string;
  isActive: boolean;
  isFocused: boolean;
  isLast: boolean;
  tabType?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  returnType?: string;
  objectType?: "function" | "procedure";
  isNextActive?: boolean;
  connectionId?: string;
  workspaceConnectionIds?: string[];
  databaseName?: string;
  dbType?: DbType;
  connectionName?: string;
  schemaName?: string;
  isOnlyTab?: boolean;
  tabIndex?: number;
  totalTabs?: number;
  syncSort?: boolean;
}

export const DraggableTab: React.FC<DraggableTabProps> = React.memo(({
  tabId,
  panelId,
  displayName,
  isActive,
  isFocused,
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
  syncSort,
}) => {
  const isLoading = useIsTabLoading(tabId);
  const setActiveTab = useWorkbenchStore((state) => state.setActiveTab);
  const focusPanel = useWorkbenchStore((state) => state.focusPanel);
  const removeTab = useWorkbenchStore((state) => state.removeTab);
  const updateTabMetadata = useWorkbenchStore((state) => state.updateTabMetadata);

  const draggableId = `tab-${panelId}-${tabId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { tabId, panelId, displayName, tabType, isView, kind },
  });

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

  const showConnectionIndicator =
    connectionId &&
    workspaceConnectionIds.length > 0 &&
    shouldShowConnectionColors(workspaceConnectionIds.length);

  const databaseLogoPath =
    showConnectionIndicator && dbType ? getDatabaseLogo(dbType) : null;

  const subtitle = useMemo(() => {
    if (!showConnectionIndicator) return null;
    if (!connectionName && !schemaName) return null;
    const parts: string[] = [];
    if (connectionName) parts.push(connectionName);
    if (schemaName) parts.push(schemaName);
    return parts.join(":");
  }, [showConnectionIndicator, connectionName, schemaName]);

  const hasTabsToRight = tabIndex < totalTabs - 1;

  const handleActivate = useCallback(() => {
    setActiveTab(panelId, tabId);
    focusPanel(panelId);
  }, [focusPanel, panelId, setActiveTab, tabId]);

  const handleClose = useCallback(() => {
    removeTab(panelId, tabId);
  }, [panelId, removeTab, tabId]);

  const handleCloseOthers = useCallback(() => {
    const panel = useWorkbenchStore.getState().panelContents.get(panelId);
    panel?.tabIds.forEach((existingTabId) => {
      if (existingTabId !== tabId) {
        removeTab(panelId, existingTabId);
      }
    });
  }, [panelId, removeTab, tabId]);

  const handleCloseToRight = useCallback(() => {
    const panel = useWorkbenchStore.getState().panelContents.get(panelId);
    if (!panel) {
      return;
    }

    const tabPosition = panel.tabIds.indexOf(tabId);
    panel.tabIds.slice(tabPosition + 1).forEach((existingTabId) => {
      removeTab(panelId, existingTabId);
    });
  }, [panelId, removeTab, tabId]);

  const handleCloseAll = useCallback(() => {
    const panel = useWorkbenchStore.getState().panelContents.get(panelId);
    panel?.tabIds.forEach((existingTabId) => {
      removeTab(panelId, existingTabId);
    });
  }, [panelId, removeTab]);

  const handleCopyName = useCallback(() => {
    void navigator.clipboard.writeText(displayName);
    toast.success("Copied to clipboard", {
      description: displayName,
    });
  }, [displayName]);

  const handleToggleSyncSort = useCallback(() => {
    const metadata =
      useWorkbenchStore.getState().panelContents.get(panelId)?.metadata?.[tabId];
    updateTabMetadata(panelId, tabId, {
      syncSort: metadata?.syncSort === false ? true : false,
    });
  }, [panelId, tabId, updateTabMetadata]);

  const [loadProgress, setLoadProgress] = useState(0);
  const loadProgressRaf = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      let progress = 0;
      let lastTime = performance.now();
      const animate = (now: number) => {
        const dt = now - lastTime;
        lastTime = now;
        const scale = dt / 50;
        if (progress < 80) {
          progress += 4 * scale;
        } else if (progress < 90) {
          progress += 0.5 * scale;
        } else if (progress < 98) {
          progress += 0.1 * scale;
        }
        if (progress > 98) progress = 98;
        setLoadProgress(progress);
        loadProgressRaf.current = requestAnimationFrame(animate);
      };
      loadProgressRaf.current = requestAnimationFrame(animate);
    } else {
      if (loadProgressRaf.current != null) {
        cancelAnimationFrame(loadProgressRaf.current);
        loadProgressRaf.current = null;
      }
      if (loadProgress > 0) {
        setLoadProgress(100);
        const timer = setTimeout(() => {
          setLoadProgress(0);
        }, 200);
        return () => {
          clearTimeout(timer);
        };
      }
    }
    return () => {
      if (loadProgressRaf.current != null) {
        cancelAnimationFrame(loadProgressRaf.current);
        loadProgressRaf.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

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
                handleActivate();
              }}
            >
              {databaseLogoPath && (
                <Tooltip>
                  <TooltipTrigger className="flex items-center">
                    <img
                      src={databaseLogoPath}
                      alt={dbType || "Database"}
                      className="h-3.5 w-3.5 min-w-3.5 min-h-3.5 shrink-0"
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
                <button
                  className="absolute inset-0 z-10 flex items-center justify-center hover:bg-destructive/10 rounded transition-all duration-100 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose();
                  }}
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
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
              {loadProgress > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 z-20">
                  <div className="absolute inset-0 bg-primary/20" />
                  <div
                    className="absolute inset-y-0 left-0 bg-primary transition-all duration-150 ease-out"
                    style={{ width: `${loadProgress}%` }}
                  />
                </div>
              )}
            </div>
          }
        />
        <ContextMenuContent>
          <ContextMenuItem onClick={handleClose}>
            <IconX className="h-4 w-4 mr-2" />
            Close
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCloseOthers} disabled={isOnlyTab}>
            <span className="h-4 w-4 mr-2" />
            Close Others
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCloseToRight} disabled={!hasTabsToRight}>
            <IconArrowRight className="h-4 w-4 mr-2" />
            Close to the Right
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCloseAll}>
            <span className="h-4 w-4 mr-2" />
            Close All
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleCopyName}>
            <IconCopy className="h-4 w-4 mr-2" />
            Copy Name
          </ContextMenuItem>
          {syncSort !== undefined && (
            <>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem
                checked={syncSort}
                onCheckedChange={() => {
                  handleToggleSyncSort();
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
});
