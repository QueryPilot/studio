import { logger } from "@/lib/logger";
import React, { useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { type Direction, type TabMetadata } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useDragStore } from "@/stores/dragStore";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  IconTable,
  IconEye,
  IconMathFunction,
  IconBrandTabler,
  IconLayout2,
  IconDatabase,
  IconSitemap,
  IconHistory,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import type { SidebarItemDragData } from "@/screens/workspace/components/DatabaseSidebarItem";
import {
  openTableObject,
  openFunctionObject,
  openErdView,
} from "@/utils/workbench/openers";

interface WorkbenchDndProviderProps {
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Drag info types - generalized to handle both tab drags and sidebar drags
// ---------------------------------------------------------------------------

interface TabDragInfo {
  source: "tab";
  tabId: string;
  panelId: string;
  displayName?: string;
  tabType?: string;
  isView?: boolean;
  kind?: string;
}

interface SidebarDragInfo {
  source: "sidebar";
  data: SidebarItemDragData;
}

type ActiveDragInfo = TabDragInfo | SidebarDragInfo;

/**
 * Provides the DndContext that wraps both sidebar and workbench areas,
 * enabling drag-and-drop from sidebar items to workbench panel drop zones.
 *
 * Extracted from WorkbenchLayout so the DndContext can sit higher in the tree
 * (at WorkspaceScreen level) while panel drop zones remain inside WorkbenchLayout.
 */
export const WorkbenchDndProvider: React.FC<WorkbenchDndProviderProps> = ({
  children,
}) => {
  const [activeDragInfo, setActiveDragInfo] = useState<ActiveDragInfo | null>(
    null,
  );
  const overlayRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const updateOverlayPosition = useCallback((x: number, y: number) => {
    if (!overlayRef.current) {
      return;
    }

    overlayRef.current.style.left = `${x}px`;
    overlayRef.current.style.top = `${y}px`;
  }, []);

  const showOverlay = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.style.display = "block";
    }
  }, []);

  const hideOverlay = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.style.display = "none";
    }
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active, activatorEvent } = event;

    if ("clientX" in activatorEvent && "clientY" in activatorEvent) {
      updateOverlayPosition(
        activatorEvent.clientX as number,
        activatorEvent.clientY as number,
      );
      showOverlay();
    }

    if (!active.data.current) return;

    const data = active.data.current as Record<string, unknown>;

    if (data.type === "sidebar-item") {
      // ---- Sidebar item drag ----
      const sidebarData = data as unknown as SidebarItemDragData;
      setActiveDragInfo({ source: "sidebar", data: sidebarData });
      useDragStore
        .getState()
        .setDrag(`sidebar-${sidebarData.name}`, "__sidebar__", "sidebar");
    } else {
      // ---- Tab drag (existing behaviour) ----
      const tabInfo = data as {
        tabId: string;
        panelId: string;
        displayName?: string;
        tabType?: string;
        isView?: boolean;
        kind?: string;
      };
      setActiveDragInfo({
        source: "tab",
        ...tabInfo,
      });
      useDragStore
        .getState()
        .setDrag(tabInfo.tabId, tabInfo.panelId, "tab");
    }
  }, [showOverlay, updateOverlayPosition]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    if ("clientX" in event.activatorEvent) {
      const activatorEvent = event.activatorEvent as PointerEvent;
      updateOverlayPosition(
        activatorEvent.clientX + event.delta.x,
        activatorEvent.clientY + event.delta.y,
      );
    }
  }, [updateOverlayPosition]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    setActiveDragInfo(null);
    hideOverlay();
    useDragStore.getState().clearDrag();

    if (!over || !active.data.current || !over.data.current) return;

    const overData = over.data.current as {
      panelId: string;
      position: string;
    };
    const { panelId: targetPanelId, position } = overData;
    const activeData = active.data.current as Record<string, unknown>;

    // =======================================================================
    // Branch 1: Sidebar item drop
    // =======================================================================
    if (activeData.type === "sidebar-item") {
      const sidebarData = activeData as unknown as SidebarItemDragData;

      if (position === "center") {
        // Open the object in the target panel.
        // The openers use `usePanelFocusStore.focusedPanelId` to determine
        // the target, so we focus the drop target panel first.
        usePanelFocusStore.getState().focusPanel(targetPanelId);

        if (
          sidebarData.objectType === "table" ||
          sidebarData.objectType === "view"
        ) {
          if (sidebarData.table) {
            openTableObject({
              table: sidebarData.table,
              connectionId: sidebarData.connectionId,
              database: sidebarData.database,
            });
          }
        } else if (
          sidebarData.objectType === "function" ||
          sidebarData.objectType === "procedure"
        ) {
          if (sidebarData.func) {
            openFunctionObject({
              func: sidebarData.func,
              connectionId: sidebarData.connectionId,
              database: sidebarData.database,
            });
          }
        } else if (sidebarData.objectType === "erd") {
          openErdView({
            connectionId: sidebarData.connectionId,
            connectionName: sidebarData.connectionName ?? "",
            database: sidebarData.database,
            schema: sidebarData.schema,
          });
        } else if (sidebarData.objectType === "history") {
          const s = useWorkbenchStore.getState();
          const tabId = `query-${crypto.randomUUID()}`;
          s.addTab(targetPanelId, tabId, {
            type: "query",
            title: "Query from History",
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            schema: sidebarData.schema,
            sql: sidebarData.historyQuery,
          });
          s.setActiveTab(targetPanelId, tabId);
          s.focusPanel(targetPanelId);
        } else {
          // MongoDB collections and Redis databases use inline addTab
          const s = useWorkbenchStore.getState();
          if (sidebarData.objectType === "mongo-collection") {
            const objectKey = `mongo-${sidebarData.connectionId}-${sidebarData.database}-${sidebarData.name}`;
            const tabId = `${objectKey}:::${nanoid(6)}`;
            s.addTab(targetPanelId, tabId, {
              type: "mongo-collection",
              title: sidebarData.name,
              connectionId: sidebarData.connectionId,
              database: sidebarData.database,
              table: sidebarData.name,
              objectKey,
            });
          } else {
            const redisDb = sidebarData.redisDb ?? 0;
            const objectKey = `redis-${sidebarData.connectionId}-db${redisDb}`;
            const tabId = `${objectKey}:::${nanoid(6)}`;
            s.addTab(targetPanelId, tabId, {
              type: "redis-key",
              title: sidebarData.name,
              connectionId: sidebarData.connectionId,
              database: String(redisDb),
              objectKey,
            });
          }
          s.focusPanel(targetPanelId);
        }
      } else {
        // Edge drop: create a new split panel with the object
        const directionMap: Record<string, Direction> = {
          top: "up",
          bottom: "down",
          left: "left",
          right: "right",
        };
        const direction = directionMap[position];
        if (!direction) {
          logger.error("Invalid drop position:", position);
          return;
        }

        const s = useWorkbenchStore.getState();
        const newPanelId = `panel-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 11)}`;

        // Build tab metadata matching what openers produce
        let tabId: string;
        let tabMetadata: TabMetadata;

        if (
          sidebarData.objectType === "table" ||
          sidebarData.objectType === "view"
        ) {
          const table = sidebarData.table;
          if (!table) return;
          const objectKey = `table-${sidebarData.connectionId}-${table.schema}-${table.name}`;
          tabId = `${objectKey}:::${nanoid(6)}`;
          tabMetadata = {
            type: "table",
            title: table.name,
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            schema: table.schema,
            table: table.name,
            isView: table.kind !== "Table",
            kind: table.kind,
            viewType: "data",
            objectKey,
          };
        } else if (
          sidebarData.objectType === "function" ||
          sidebarData.objectType === "procedure"
        ) {
          const func = sidebarData.func;
          if (!func) return;
          const objectKey = `function-${sidebarData.connectionId}-${func.schema}-${func.name}`;
          tabId = `${objectKey}:::${nanoid(6)}`;
          const objectType =
            func.routine_type === "PROCEDURE" ||
            (!func.routine_type && func.return_type === "void")
              ? "procedure"
              : "function";
          tabMetadata = {
            type: "function",
            title: func.name,
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            schema: func.schema,
            functionName: func.name,
            returnType: func.return_type,
            objectType,
            objectKey,
          };
        } else if (sidebarData.objectType === "erd") {
          const objectKey = `erd-${sidebarData.connectionId}`;
          tabId = `${objectKey}:::${nanoid(6)}`;
          tabMetadata = {
            type: "erd",
            title: `${sidebarData.connectionName ?? ""} ERD`,
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            schema: sidebarData.schema,
            objectKey,
          };
        } else if (sidebarData.objectType === "history") {
          tabId = `query-${crypto.randomUUID()}`;
          tabMetadata = {
            type: "query",
            title: "Query from History",
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            schema: sidebarData.schema,
            sql: sidebarData.historyQuery,
          };
        } else if (sidebarData.objectType === "mongo-collection") {
          const objectKey = `mongo-${sidebarData.connectionId}-${sidebarData.database}-${sidebarData.name}`;
          tabId = `${objectKey}:::${nanoid(6)}`;
          tabMetadata = {
            type: "mongo-collection",
            title: sidebarData.name,
            connectionId: sidebarData.connectionId,
            database: sidebarData.database,
            table: sidebarData.name,
            objectKey,
          };
        } else {
          // redis-key
          const redisDb = sidebarData.redisDb ?? 0;
          const objectKey = `redis-${sidebarData.connectionId}-db${redisDb}`;
          tabId = `${objectKey}:::${nanoid(6)}`;
          tabMetadata = {
            type: "redis-key",
            title: sidebarData.name,
            connectionId: sidebarData.connectionId,
            database: String(redisDb),
            objectKey,
          };
        }

        s.splitPanelAction({
          targetPanelId,
          direction,
          newPanelContent: {
            id: newPanelId,
            type: "editor",
            tabIds: [tabId],
            activeTabId: tabId,
            metadata: { [tabId]: tabMetadata },
          },
        });

        s.focusPanel(newPanelId);
        s.setActiveTab(newPanelId, tabId);
      }

      return; // done handling sidebar item
    }

    // =======================================================================
    // Branch 2: Tab drag (existing behaviour)
    // =======================================================================
    const tabData = activeData as { tabId: string; panelId: string };
    const { tabId, panelId: sourcePanelId } = tabData;

    if (position === "center") {
      // Move tab to existing panel (only if different panels)
      if (sourcePanelId !== targetPanelId) {
        const s = useWorkbenchStore.getState();
        s.moveTab(tabId, sourcePanelId, targetPanelId);
        s.focusPanel(targetPanelId);
        s.setActiveTab(targetPanelId, tabId);
      }
    } else {
      // Create new panel with tab
      const directionMap: Record<string, Direction> = {
        top: "up",
        bottom: "down",
        left: "left",
        right: "right",
      };

      const direction = directionMap[position];
      if (!direction) {
        logger.error("Invalid drop position:", position);
        return;
      }

      const s = useWorkbenchStore.getState();
      const sourcePanel = s.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];

      const newPanelId = `panel-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 11)}`;

      s.splitPanelAction({
        targetPanelId,
        direction,
        newPanelContent: {
          id: newPanelId,
          type: "editor",
          tabIds: [tabId],
          activeTabId: tabId,
          metadata: tabMetadata ? { [tabId]: tabMetadata } : undefined,
        },
      });

      // Remove from source panel after split is created
      setTimeout(() => {
        const updatedState = useWorkbenchStore.getState();
        const sourcePanel = updatedState.panelContents.get(sourcePanelId);

        if (sourcePanel) {
          updatedState.removeTab(sourcePanelId, tabId);
        }

        updatedState.focusPanel(newPanelId);
        updatedState.setActiveTab(newPanelId, tabId);
      }, 50);
    }
  }, [hideOverlay]);

  // -----------------------------------------------------------------------
  // Drag overlay rendering
  // -----------------------------------------------------------------------
  const renderOverlay = () => {
    let Icon = IconTable;
    let iconClass = "h-3.5 w-3.5 text-primary";
    let label = "";

    if (activeDragInfo?.source === "sidebar") {
      // --- Sidebar item overlay ---
      const { data } = activeDragInfo;
      label = data.name;

      if (
        data.objectType === "function" ||
        data.objectType === "procedure"
      ) {
        Icon = IconMathFunction;
        iconClass =
          data.objectType === "procedure"
            ? "h-3.5 w-3.5 text-orange-500"
            : "h-3.5 w-3.5 text-purple-500";
      } else if (data.objectType === "view") {
        Icon = IconEye;
        iconClass =
          data.kind === "MaterializedView"
            ? "h-3.5 w-3.5 text-blue-500"
            : "h-3.5 w-3.5 text-green-500";
      } else if (data.objectType === "mongo-collection") {
        Icon = IconLayout2;
        iconClass = "h-3.5 w-3.5 text-emerald-600";
      } else if (data.objectType === "redis-key") {
        Icon = IconDatabase;
        iconClass = "h-3.5 w-3.5 text-orange-500";
      } else if (data.objectType === "erd") {
        Icon = IconSitemap;
        iconClass = "h-3.5 w-3.5 text-blue-500";
      } else if (data.objectType === "history") {
        Icon = IconHistory;
        iconClass = "h-3.5 w-3.5 text-amber-500";
      } else {
        // table
        Icon = IconTable;
        iconClass = "h-3.5 w-3.5 text-primary";
      }
    } else if (activeDragInfo?.source === "tab") {
      // --- Tab overlay (existing) ---
      const { tabType, isView, kind } = activeDragInfo;
      label =
        activeDragInfo.displayName ||
        activeDragInfo.tabId.split("-").pop() ||
        "";

      if (tabType === "query") {
        Icon = IconBrandTabler;
      } else if (tabType === "function") {
        Icon = IconMathFunction;
        iconClass = "h-3.5 w-3.5 text-purple-500";
      } else if (tabType === "table" && isView) {
        Icon = IconEye;
        iconClass =
          kind === "MaterializedView"
            ? "h-3.5 w-3.5 text-blue-500"
            : "h-3.5 w-3.5 text-green-500";
      }
    }

    return createPortal(
      <div
        ref={overlayRef}
        className="fixed pointer-events-none z-[9999]"
        style={{
          display: "none",
          left: 0,
          top: 0,
          transform: "translate(-50%, -50%)",
        }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-background border border-border shadow-lg">
          <Icon className={iconClass} />
          <span className="whitespace-nowrap font-medium">{label}</span>
        </div>
      </div>,
      document.body,
    );
  };

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {children}

      {renderOverlay()}
    </DndContext>
  );
};
