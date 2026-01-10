import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Handle,
  MarkerType,
  Position,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  EdgeLabelRenderer,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { IconKey, IconLink, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { TableStructure } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";
import type { DBMLRelationship } from "@/services/dbmlService";
import type { NodePosition, ViewportState } from "@/stores/erdStore";

export type LayoutDirection = "LR" | "TB" | "RL" | "BT";

const NODE_WIDTH = 320;
const FIT_VIEW_PADDING = 0.08;
const PREVIEW_COLUMN_LIMIT = 10;

interface ERDVisualizerProps {
  tables: TableStructure[];
  relationships: DBMLRelationship[];
  nodePositions: Record<string, NodePosition>;
  initialViewport?: ViewportState;
  layoutDirection?: LayoutDirection;
  hasManualPositions?: boolean;
  onNodePositionsChange?: (positions: Record<string, NodePosition>) => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onViewportChange?: (viewport: ViewportState) => void;
  onColumnDoubleClick?: (tableName: string, columnName: string) => void;
  onLayoutDirectionChange?: (direction: LayoutDirection) => void;
}

type ColumnHandleSets = {
  source: ReadonlySet<string>;
  target: ReadonlySet<string>;
};

type MutableColumnHandleSets = {
  source: Set<string>;
  target: Set<string>;
};

const EMPTY_SOURCE_HANDLE_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_TARGET_HANDLE_SET: ReadonlySet<string> = new Set<string>();

const DEFAULT_COLUMN_HANDLES: ColumnHandleSets = {
  source: EMPTY_SOURCE_HANDLE_SET,
  target: EMPTY_TARGET_HANDLE_SET,
};

interface TableNodeData {
  table: TableStructure;
  expanded: boolean;
  isSelected: boolean;
  onToggleExpand: (tableId: string) => void;
  onHover: (tableId: string) => void;
  onLeave: () => void;
  onClick: (tableId: string) => void;
  onColumnHover?: (columnName: string) => void;
  onColumnLeave?: () => void;
  onColumnDoubleClick?: (tableName: string, columnName: string) => void;
  columnHandles: ColumnHandleSets;
}

interface ForeignEdgeData {
  relationshipId: string;
  label: string;
  sourceCardinality?: "1" | "n";
  targetCardinality?: "1" | "n";
  highlighted?: boolean;
  isHovered?: boolean;
  isDragging?: boolean;
  onHover?: (relationshipId: string) => void;
  onLeave?: () => void;
}

const FLOW_CLASS = "erd-flow";

const edgeStylesInjected = (() => {
  let injected = false;
  return () => {
    if (injected) return;
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes erd-line-flow {
        from { stroke-dashoffset: 0; }
        to { stroke-dashoffset: 24; }
      }
      .erd-edge-animated {
        stroke-dasharray: 5 5;
        animation: erd-line-flow 1s linear infinite;
      }
      .erd-table-card {
        transform: translateZ(0);
        will-change: transform;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        perspective: 1000px;
        -webkit-perspective: 1000px;
        contain: layout style paint;
      }
      .erd-table-card-selected {
        box-shadow: 0 0 0 2px hsl(var(--primary));
        border-color: hsl(var(--primary));
      }
      .${FLOW_CLASS} {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        image-rendering: crisp-edges;
      }
      .${FLOW_CLASS} .react-flow__renderer {
        transform: translateZ(0);
        transform-origin: center center;
        image-rendering: crisp-edges;
        will-change: transform;
      }
      .${FLOW_CLASS} .react-flow__node {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transform-origin: center center;
        will-change: transform;
        pointer-events: auto;
      }
      .${FLOW_CLASS} .react-flow__node.dragging {
        cursor: grabbing;
      }
      .${FLOW_CLASS} .react-flow__edge {
        will-change: d;
      }
      .erd-cardinality-badge {
        font-weight: 600;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
      }
    `;
    document.head.appendChild(style);
    injected = true;
  };
})();

const buildNodeId = (table: TableStructure): string =>
  `${table.schema}.${table.name}`;

const makeHandleId = (
  columnName: string,
  role: "source" | "target",
  side?: "left" | "right",
) => (side ? `${role}-${side}-${columnName}` : `${role}-${columnName}`);

const TABLE_NODE_TYPE = "table-node";
const EDGE_TYPE = "foreign";

const TableNodeComponent: React.FC<NodeProps<any>> = ({
  id,
  data,
  selected,
}) => {
  const {
    table,
    expanded,
    isSelected,
    onToggleExpand,
    onHover,
    onLeave,
    onClick,
    onColumnHover,
    onColumnLeave,
    onColumnDoubleClick,
    columnHandles,
  } = data;

  // Columns are pre-sorted in the worker for performance
  // No need to sort again in the UI component
  const columns: ColumnMeta[] = expanded
    ? table.columns
    : table.columns.slice(0, PREVIEW_COLUMN_LIMIT);
  const hasMore = table.columns.length > PREVIEW_COLUMN_LIMIT;

  const renderColumnIcons = useCallback((column: ColumnMeta) => {
    const icons = [];
    if (column.is_pk) {
      icons.push(<IconKey key="pk" className="h-3 w-3 text-amber-500" />);
    }
    if (
      column.is_fk ||
      (!column.is_pk && column.name.toLowerCase().includes("_id"))
    ) {
      icons.push(<IconLink key="fk" className="h-3 w-3 text-sky-500" />);
    }
    return icons.length > 0 ? (
      <div className="flex gap-0.5">{icons}</div>
    ) : null;
  }, []);

  const formatColumnType = useCallback((column: ColumnMeta) => {
    const type = column.db_type;
    const constraints = [];
    if (!column.nullable) constraints.push("NN");
    return { type, constraints };
  }, []);

  const hiddenColumns: ColumnMeta[] = expanded ? [] : table.columns.slice(PREVIEW_COLUMN_LIMIT);
  const hiddenConnectedColumns: ColumnMeta[] = hiddenColumns.filter(
    (column: ColumnMeta) =>
      columnHandles.source.has(column.name) ||
      columnHandles.target.has(column.name),
  );

  return (
    <div
      className={[
        "erd-table-card w-[320px] rounded-md border bg-card text-xs shadow-sm",
        selected || isSelected ? "erd-table-card-selected" : "border-border",
      ].join(" ")}
      onMouseEnter={() => {
        onHover(id);
      }}
      onMouseLeave={() => {
        onLeave();
      }}
      onMouseUp={() => {
        onClick(id);
      }}
    >
      <div className="flex items-center justify-between border-b px-2 py-1 text-xs font-semibold">
        <span className="truncate">
          {table.schema}.{table.name}
        </span>
        {hasMore ? (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(id);
            }}
            title={expanded ? "Show less" : "Show all columns"}
          >
            {expanded ? (
              <IconChevronUp className="h-3.5 w-3.5" />
            ) : (
              <IconChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
      <div className="overflow-auto px-1.5 py-1">
        <ul className="space-y-0">
          {columns.map((column) => {
            const { type, constraints } = formatColumnType(
              column,
            );
            const showSourceHandles = columnHandles.source.has(column.name);
            const showTargetHandles = columnHandles.target.has(column.name);
            return (
              <Tooltip key={column.name} delayDuration={200}>
                <TooltipTrigger
                  render={
                    <li
                      className="group relative flex items-center gap-2 rounded px-1.5 py-0.5 transition hover:bg-muted cursor-pointer"
                      onMouseEnter={() => { onColumnHover?.(column.name); }}
                      onMouseLeave={() => { onColumnLeave?.(); }}
                      onDoubleClick={(e) => { e.stopPropagation(); onColumnDoubleClick?.(table.name, column.name); }}
                    >
                      {showTargetHandles && (
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={makeHandleId(column.name, "target", "left")}
                          className="absolute left-0 top-1/2 opacity-0 group-hover:opacity-100"
                          style={{ width: 8, height: 8, border: "none", background: "transparent", pointerEvents: "all", transform: "translate(-8px, -50%)" }}
                        />
                      )}
                      {showSourceHandles && (
                        <Handle
                          type="source"
                          position={Position.Left}
                          id={makeHandleId(column.name, "source", "left")}
                          className="absolute left-0 top-1/2 opacity-0 group-hover:opacity-100"
                          style={{ width: 8, height: 8, border: "none", background: "transparent", pointerEvents: "all", transform: "translate(-8px, -50%)" }}
                        />
                      )}
                      <div className="flex flex-1 items-center gap-2 min-w-0 text-xs">
                        <div className="flex-1 inline-flex items-center gap-2">
                          <span className="font-medium text-foreground truncate max-w-[160px]">{column.name}</span>
                          {renderColumnIcons(column)}
                        </div>
                        <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                          {constraints.length > 0 && (
                            <span className="text-xs text-orange-500 font-semibold flex-shrink-0">{constraints.join(",")}</span>
                          )}
                          <span className="text-xs text-muted-foreground truncate max-w-[80px]" title={type}>{type}</span>
                        </div>
                      </div>
                      {showTargetHandles && (
                        <Handle
                          type="target"
                          position={Position.Right}
                          id={makeHandleId(column.name, "target", "right")}
                          className="absolute right-0 top-1/2 opacity-0 group-hover:opacity-100"
                          style={{ width: 8, height: 8, border: "none", background: "transparent", pointerEvents: "all", transform: "translate(8px, -50%)" }}
                        />
                      )}
                      {showSourceHandles && (
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={makeHandleId(column.name, "source", "right")}
                          className="absolute right-0 top-1/2 opacity-0 group-hover:opacity-100"
                          style={{ width: 8, height: 8, border: "none", background: "transparent", pointerEvents: "all", transform: "translate(8px, -50%)" }}
                        />
                      )}
                    </li>
                  }
                />
                {(column.default || column.comment) && (
                  <TooltipContent side="right" sideOffset={5}>
                    <div className="space-y-1">
                      {column.default && <div>Default: {column.default}</div>}
                      {column.comment && <div>Comment: {column.comment}</div>}
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
          {hasMore && !expanded ? (
            <li className="relative pt-1 pl-2 text-xs text-muted-foreground">
              +{table.columns.length - PREVIEW_COLUMN_LIMIT} more columns
              {hiddenConnectedColumns.map((column: ColumnMeta) => {
                const showSourceHandles = columnHandles.source.has(column.name);
                const showTargetHandles = columnHandles.target.has(column.name);
                return (
                  <React.Fragment key={column.name}>
                    {showTargetHandles && (
                      <>
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={makeHandleId(column.name, "target", "left")}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            opacity: 0,
                            pointerEvents: "none",
                            width: 1,
                            height: 1,
                            minWidth: 0,
                            minHeight: 0,
                            background: "transparent",
                            border: 0,
                          }}
                        />
                        <Handle
                          type="target"
                          position={Position.Right}
                          id={makeHandleId(column.name, "target", "right")}
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "50%",
                            opacity: 0,
                            pointerEvents: "none",
                            width: 1,
                            height: 1,
                            minWidth: 0,
                            minHeight: 0,
                            background: "transparent",
                            border: 0,
                          }}
                        />
                      </>
                    )}
                    {showSourceHandles && (
                      <>
                        <Handle
                          type="source"
                          position={Position.Left}
                          id={makeHandleId(column.name, "source", "left")}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            opacity: 0,
                            pointerEvents: "none",
                            width: 1,
                            height: 1,
                            minWidth: 0,
                            minHeight: 0,
                            background: "transparent",
                            border: 0,
                          }}
                        />
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={makeHandleId(column.name, "source", "right")}
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "50%",
                            opacity: 0,
                            pointerEvents: "none",
                            width: 1,
                            height: 1,
                            minWidth: 0,
                            minHeight: 0,
                            background: "transparent",
                            border: 0,
                          }}
                        />
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
};

// Custom comparison to prevent unnecessary re-renders
const areTableNodesEqual = (
  prevProps: NodeProps<any>,
  nextProps: NodeProps<any>,
): boolean => {
  // Compare basic props
  if (prevProps.id !== nextProps.id) return false;
  if (prevProps.selected !== nextProps.selected) return false;
  
  // Compare data object deeply
  const prevData = prevProps.data as TableNodeData;
  const nextData = nextProps.data as TableNodeData;
  
  if (!prevData || !nextData) return prevData === nextData;
  
  // Compare relevant data properties
  if (prevData.expanded !== nextData.expanded) return false;
  if (prevData.isSelected !== nextData.isSelected) return false;
  if (prevData.table !== nextData.table) return false;
  if (prevData.columnHandles !== nextData.columnHandles) return false;
  
  return true;
};

const TableNode = React.memo(TableNodeComponent, areTableNodesEqual);

// Pre-computed marker styles cache - CRITICAL for performance
const MARKER_STYLES_CACHE = {
  "1-source-primary": {
    markerWidth: 4, markerHeight: 7, refX: 0, refY: 3.5,
    orient: "auto", fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 0.8,
  },
  "1-target-primary": {
    markerWidth: 4, markerHeight: 7, refX: 4, refY: 3.5,
    orient: "auto", fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 0.8,
  },
  "n-source-primary": {
    markerWidth: 7, markerHeight: 6, refX: 0, refY: 3,
    orient: "auto", fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 0.6,
  },
  "n-target-primary": {
    markerWidth: 7, markerHeight: 6, refX: 7, refY: 3,
    orient: "auto", fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 0.6,
  },
  "1-source-muted": {
    markerWidth: 4, markerHeight: 7, refX: 0, refY: 3.5,
    orient: "auto", fill: "none", stroke: "hsl(var(--muted-foreground))", strokeWidth: 0.8,
  },
  "1-target-muted": {
    markerWidth: 4, markerHeight: 7, refX: 4, refY: 3.5,
    orient: "auto", fill: "none", stroke: "hsl(var(--muted-foreground))", strokeWidth: 0.8,
  },
  "n-source-muted": {
    markerWidth: 7, markerHeight: 6, refX: 0, refY: 3,
    orient: "auto", fill: "none", stroke: "hsl(var(--muted-foreground))", strokeWidth: 0.6,
  },
  "n-target-muted": {
    markerWidth: 7, markerHeight: 6, refX: 7, refY: 3,
    orient: "auto", fill: "none", stroke: "hsl(var(--muted-foreground))", strokeWidth: 0.6,
  },
} as const;

// Pre-computed line styles cache
const LINE_STYLES_CACHE = {
  "1-1": { strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
  "1-n": { strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
  "n-1": { strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
  "n-n": { strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeDasharray: "5,5" },
} as const;

// Edge path cache for better performance during pan/zoom
const edgePathCache = new Map<string, [string, number, number]>();

const ForeignKeyEdgeComponent: React.FC<EdgeProps<any>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  style = {},
  markerEnd,
}) => {
  const edgeData = data as ForeignEdgeData | undefined;

  const relationshipType = `${edgeData?.sourceCardinality || "1"}-${edgeData?.targetCardinality || "1"}`;
  const highlighted = Boolean(selected || edgeData?.highlighted);
  const colorKey = highlighted ? "primary" : "muted";

  const computeSmoothPath = () => {
    const result = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 8,
      offset: 32,
    });
    return {
      path: result[0],
      labelX: result[1],
      labelY: result[2],
    } as const;
  };

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  const shouldUseCache = !edgeData?.isDragging;

  if (shouldUseCache) {
    const cacheKey = `${sourceX}-${sourceY}-${targetX}-${targetY}-${sourcePosition}-${targetPosition}`;
    const cached = edgePathCache.get(cacheKey);
    if (cached) {
      [edgePath, labelX, labelY] = cached;
    } else {
      const computed = computeSmoothPath();
      edgePath = computed.path;
      labelX = computed.labelX;
      labelY = computed.labelY;
      edgePathCache.set(cacheKey, [edgePath, labelX, labelY]);

      // Limit cache size to prevent memory bloat
      if (edgePathCache.size > 500) {
        const firstKey = edgePathCache.keys().next().value;
        if (firstKey) edgePathCache.delete(firstKey);
      }
    }
  } else {
    const computed = computeSmoothPath();
    edgePath = computed.path;
    labelX = computed.labelX;
    labelY = computed.labelY;
  }

  // Use cached line style
  const lineStyle = LINE_STYLES_CACHE[relationshipType as keyof typeof LINE_STYLES_CACHE] || LINE_STYLES_CACHE["1-1"];

  // Use cached marker styles
  const sourceMarkerId = `marker-source-${id}`;
  const targetMarkerId = `marker-target-${id}`;
  const sourceMarkerStyle = edgeData?.sourceCardinality
    ? MARKER_STYLES_CACHE[`${edgeData.sourceCardinality}-source-${colorKey}` as keyof typeof MARKER_STYLES_CACHE]
    : null;
  const targetMarkerStyle = edgeData?.targetCardinality
    ? MARKER_STYLES_CACHE[`${edgeData.targetCardinality}-target-${colorKey}` as keyof typeof MARKER_STYLES_CACHE]
    : null;

  // Position cardinality labels closer to the actual connection points
  const sourceOffset = 20;
  const targetOffset = 20;

  // Calculate positions based on source and target positions
  let startLabelX = sourceX;
  let startLabelY = sourceY;
  let endLabelX = targetX;
  let endLabelY = targetY;

  // Adjust based on connection position
  switch (sourcePosition) {
    case Position.Right:
      startLabelX = sourceX + sourceOffset;
      break;
    case Position.Left:
      startLabelX = sourceX - sourceOffset;
      break;
    case Position.Top:
      startLabelY = sourceY - sourceOffset;
      break;
    case Position.Bottom:
      startLabelY = sourceY + sourceOffset;
      break;
  }

  switch (targetPosition) {
    case Position.Right:
      endLabelX = targetX + targetOffset;
      break;
    case Position.Left:
      endLabelX = targetX - targetOffset;
      break;
    case Position.Top:
      endLabelY = targetY - targetOffset;
      break;
    case Position.Bottom:
      endLabelY = targetY + targetOffset;
      break;
  }

  return (
    <>
      {/* Define custom markers */}
      <defs>
        {sourceMarkerStyle && (
          <marker id={sourceMarkerId} {...sourceMarkerStyle}>
            {edgeData?.sourceCardinality === "1" ? (
              <line x1="0" y1="0.5" x2="0" y2="6.5" />
            ) : (
              // Smaller crow's foot for "many"
              <g>
                <line x1="0" y1="1" x2="4" y2="3" />
                <line x1="0" y1="3" x2="4" y2="3" />
                <line x1="0" y1="5" x2="4" y2="3" />
              </g>
            )}
          </marker>
        )}
        {targetMarkerStyle && (
          <marker id={targetMarkerId} {...targetMarkerStyle}>
            {edgeData?.targetCardinality === "1" ? (
              <line x1="4" y1="0.5" x2="4" y2="6.5" />
            ) : (
              // Smaller crow's foot for "many"
              <g>
                <line x1="3" y1="1" x2="7" y2="3" />
                <line x1="3" y1="3" x2="7" y2="3" />
                <line x1="3" y1="5" x2="7" y2="3" />
              </g>
            )}
          </marker>
        )}
      </defs>

      {/* Invisible wider path for better hover detection */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={20}
        fill="none"
        onMouseEnter={() => edgeData?.onHover?.(edgeData.relationshipId)}
        onMouseLeave={() => edgeData?.onLeave?.()}
        pointerEvents="stroke"
        style={{ cursor: "pointer" }}
      />

      {/* Background stroke for line crossing bridge effect - only for non-highlighted edges */}
      {!highlighted && (
        <path
          d={edgePath}
          stroke="hsl(var(--background))"
          strokeWidth={4}
          fill="none"
          pointerEvents="none"
          style={{
            ...lineStyle,
          }}
        />
      )}

      <path
        id={id}
        d={edgePath}
        stroke={
          highlighted ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"
        }
        strokeWidth={highlighted ? 1.5 : 0.5}
        fill="none"
        markerStart={sourceMarkerStyle ? `url(#${sourceMarkerId})` : undefined}
        markerEnd={targetMarkerStyle ? `url(#${targetMarkerId})` : markerEnd}
        pointerEvents="none"
        className={highlighted ? "erd-edge-animated" : ""}
        style={{
          ...style,
          ...lineStyle,
        }}
      />

      {/* Cardinality indicators only show when line is hovered or highlighted */}
      {edgeData?.sourceCardinality &&
        (edgeData.isHovered || edgeData.highlighted) && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${startLabelX}px, ${startLabelY}px)`,
                pointerEvents: "none",
                opacity: edgeData.isHovered || edgeData.highlighted ? 1 : 0,
                transition: "opacity 150ms ease-in-out",
              }}
              className="text-xs font-bold text-primary bg-background rounded-full w-6 h-6 flex items-center justify-center shadow-sm border border-primary/40"
            >
              {edgeData.sourceCardinality === "n"
                ? "N"
                : edgeData.sourceCardinality}
            </div>
          </EdgeLabelRenderer>
        )}
      {edgeData?.targetCardinality &&
        (edgeData.isHovered || edgeData.highlighted) && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${endLabelX}px, ${endLabelY}px)`,
                pointerEvents: "none",
                opacity: edgeData.isHovered || edgeData.highlighted ? 1 : 0,
                transition: "opacity 150ms ease-in-out",
              }}
              className="text-xs font-bold text-primary bg-background rounded-full w-6 h-6 flex items-center justify-center shadow-sm border border-primary/40"
            >
              {edgeData.targetCardinality === "n"
                ? "N"
                : edgeData.targetCardinality}
            </div>
          </EdgeLabelRenderer>
        )}

      {edgeData?.label && edgeData.isHovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded bg-background px-2 py-0.5 text-xs font-medium text-foreground shadow-md border border-primary/50"
          >
            {edgeData.label}
            {/* Show relationship type in label when highlighted */}
            <span className="ml-1 text-xs text-muted-foreground">
              ({edgeData.sourceCardinality || "1"}:
              {edgeData.targetCardinality || "1"})
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

// Custom comparison to prevent unnecessary edge re-renders
const areForeignKeyEdgesEqual = (
  prevProps: EdgeProps<any>,
  nextProps: EdgeProps<any>,
): boolean => {
  // Compare basic props
  if (prevProps.id !== nextProps.id) return false;
  if (prevProps.selected !== nextProps.selected) return false;
  if (prevProps.sourceX !== nextProps.sourceX) return false;
  if (prevProps.sourceY !== nextProps.sourceY) return false;
  if (prevProps.targetX !== nextProps.targetX) return false;
  if (prevProps.targetY !== nextProps.targetY) return false;
  if (prevProps.sourcePosition !== nextProps.sourcePosition) return false;
  if (prevProps.targetPosition !== nextProps.targetPosition) return false;
  
  // Compare edge data
  const prevData = prevProps.data as ForeignEdgeData | undefined;
  const nextData = nextProps.data as ForeignEdgeData | undefined;
  
  if (!prevData || !nextData) return prevData === nextData;
  
  if (prevData.relationshipId !== nextData.relationshipId) return false;
  if (prevData.highlighted !== nextData.highlighted) return false;
  if (prevData.isHovered !== nextData.isHovered) return false;
  if (prevData.isDragging !== nextData.isDragging) return false;
  
  return true;
};

const ForeignKeyEdge = React.memo(ForeignKeyEdgeComponent, areForeignKeyEdgesEqual);

const nodeTypes = {
  [TABLE_NODE_TYPE]: TableNode,
};

const edgeTypes = {
  [EDGE_TYPE]: ForeignKeyEdge,
};

export interface ERDVisualizerRef {
  triggerAutoArrange: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
}

export const ERDVisualizer = React.forwardRef<
  ERDVisualizerRef,
  ERDVisualizerProps
>(
  (
    {
      tables,
      relationships,
      nodePositions,
      initialViewport,
      layoutDirection = "LR",
      hasManualPositions = false,
      onNodePositionsChange,
      onNodePositionChange,
      onViewportChange,
      onColumnDoubleClick,
      // onLayoutDirectionChange is passed but not used internally
    },
    ref,
  ) => {
    edgeStylesInjected();

    const [nodes, setNodes, onNodesChangeInternal] = useNodesState<any>([]);
    const [edges, setEdges] = useEdgesState<any>([]);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [hoveredRelationshipId, setHoveredRelationshipId] = useState<
      string | null
    >(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
    const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
    const [, setHoveredColumn] = useState<string | null>(null);
    const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
    const fitAppliedRef = useRef(false);
    const autoArrangeTriggeredRef = useRef(false);
    const isInitialMountRef = useRef(true);
    const edgeUpdateFrameRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);

    // Use a ref to track current nodes to avoid dependency cycles
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    const toggleExpanded = useCallback((nodeId: string) => {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    }, []);

    const hasStoredPositions = useMemo(() => {
      if (!tables.length) return false;
      return tables.every((table) => {
        const id = buildNodeId(table);
        return Boolean(nodePositions[id]);
      });
    }, [tables, nodePositions]);

    const handleEdgeHover = useCallback((relationshipId: string) => {
      setHoveredRelationshipId(relationshipId);
    }, []);

    const handleEdgeLeave = useCallback(() => {
      setHoveredRelationshipId(null);
    }, []);

    const handleTableClick = useCallback((tableId: string) => {
      setSelectedTableId((prev) => (prev === tableId ? null : tableId));
    }, []);

    const handlePaneClick = useCallback(() => {
      // Deselect table when clicking on the pane/background
      setSelectedTableId(null);
    }, []);

    // Stable callbacks that don't change - CRITICAL for performance
    const stableCallbacks = useMemo(() => ({
      onToggleExpand: toggleExpanded,
      onHover: setHoveredNodeId,
      onClick: handleTableClick,
      onColumnHover: setHoveredColumn,
      onColumnLeave: () => { setHoveredColumn(null); },
      onColumnDoubleClick,
    }), [toggleExpanded, handleTableClick, onColumnDoubleClick]);

    const handleColumnMap = useMemo(() => {
      if (!relationships.length) {
        return new Map<string, MutableColumnHandleSets>();
      }

      const map = new Map<string, MutableColumnHandleSets>();

      const ensureEntry = (nodeId: string) => {
        let entry = map.get(nodeId);
        if (!entry) {
          entry = { source: new Set<string>(), target: new Set<string>() };
          map.set(nodeId, entry);
        }
        return entry;
      };

      relationships.forEach((relationship) => {
        const sourceId = `${relationship.fromSchema ?? "public"}.${
          relationship.fromTable
        }`;
        const targetId = `${relationship.toSchema ?? "public"}.${
          relationship.toTable
        }`;

        const sourceEntry = ensureEntry(sourceId);
        relationship.fromColumns.forEach((columnName) => {
          if (columnName) {
            sourceEntry.source.add(columnName);
          }
        });

        const targetEntry = ensureEntry(targetId);
        relationship.toColumns.forEach((columnName) => {
          if (columnName) {
            targetEntry.target.add(columnName);
          }
        });
      });

      return map;
    }, [relationships]);

    // Memoize node data factory for performance - CRITICAL optimization
    // Use useMemo instead of useCallback to cache the entire data objects
    const nodeDataMap = useMemo(() => {
      const map = new Map<string, TableNodeData>();
      tables.forEach((table) => {
        const nodeId = buildNodeId(table);
        const columnHandles =
          (handleColumnMap.get(nodeId) as ColumnHandleSets | undefined) ??
          DEFAULT_COLUMN_HANDLES;
        map.set(nodeId, {
          table,
          expanded: expandedNodes.has(nodeId),
          isSelected: selectedTableId === nodeId,
          columnHandles,
          ...stableCallbacks,
          onLeave: () => {
            setHoveredNodeId((prev) => (prev === nodeId ? null : prev));
          },
        });
      });
      return map;
    }, [tables, expandedNodes, selectedTableId, stableCallbacks, handleColumnMap]);

    // Memoize edge creation for performance - CRITICAL optimization
    const createEdges = useMemo((): any[] => {
      return relationships.flatMap((relationship) => {
        const sourceId = `${relationship.fromSchema ?? "public"}.${
          relationship.fromTable
        }`;
        const targetId = `${relationship.toSchema ?? "public"}.${
          relationship.toTable
        }`;
        const pairCount = Math.max(
          relationship.fromColumns.length,
          relationship.toColumns.length,
        );

        // Function to determine optimal connection side based on node positions
        const getOptimalConnectionSide = (
          sourceNodeId: string,
          targetNodeId: string,
        ) => {
          const sourceNode = nodesRef.current.find(
            (n) => n.id === sourceNodeId,
          );
          const targetNode = nodesRef.current.find(
            (n) => n.id === targetNodeId,
          );

          if (!sourceNode || !targetNode) {
            return { source: "right", target: "left" }; // Default fallback
          }

          const sourceX =
            ((sourceNode.position.x as number | undefined) ?? 0) +
            ((sourceNode.width as number | undefined) ?? NODE_WIDTH) / 2;
          const targetX =
            ((targetNode.position.x as number | undefined) ?? 0) +
            ((targetNode.width as number | undefined) ?? NODE_WIDTH) / 2;

          // Calculate which sides would give the shortest connection
          const isTargetToTheRight = targetX > sourceX;
          const isTargetToTheLeft = targetX < sourceX;

          return {
            source: isTargetToTheRight ? "right" : "left",
            target: isTargetToTheLeft ? "right" : "left",
          };
        };

        // Get optimal connection sides
        const connectionSides = getOptimalConnectionSide(sourceId, targetId);

        return Array.from({ length: pairCount }, (_, index) => {
          const sourceColumn =
            relationship.fromColumns[index] ??
            relationship.fromColumns[0] ??
            "";
          const targetColumn =
            relationship.toColumns[index] ?? relationship.toColumns[0] ?? "";
          const edgeId = `${relationship.id}-${index}`;

          return {
            id: edgeId,
            source: sourceId,
            target: targetId,
            sourceHandle: makeHandleId(
              sourceColumn,
              "source",
              connectionSides.source as "left" | "right",
            ),
            targetHandle: makeHandleId(
              targetColumn,
              "target",
              connectionSides.target as "left" | "right",
            ),
            type: EDGE_TYPE,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "hsl(var(--muted-foreground))",
            },
            style: {
              strokeWidth: 0.5,
            },
            data: {
              relationshipId: relationship.id,
              label: relationship.name,
              sourceCardinality: relationship.sourceCardinality,
              targetCardinality: relationship.targetCardinality,
              onHover: handleEdgeHover,
              onLeave: handleEdgeLeave,
            },
          } as any;
        });
      });
    }, [relationships, handleEdgeHover, handleEdgeLeave]);

    const layoutWithDagre = useCallback(() => {
      // Calculate dynamic heights based on expanded state
      const getNodeHeight = (table: TableStructure) => {
        const id = buildNodeId(table);
        const isExpanded = expandedNodes.has(id);
        const baseHeight = 50;
        const columnHeight = 24;
        const visibleColumns = isExpanded
          ? table.columns.length
          : Math.min(table.columns.length, PREVIEW_COLUMN_LIMIT);
        return baseHeight + visibleColumns * columnHeight + 20;
      };

      // Create new graph for this layout (Dagre is mutable)
      const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

      // Configure graph - Outerbase-style settings with dynamic layout direction
      g.setGraph({
        rankdir: layoutDirection, // LR = Left-to-right, TB = Top-to-bottom
        marginx: 50, // Horizontal margin
        marginy: 50, // Vertical margin
        nodesep: 75, // Space between nodes on same rank
        ranksep: 110, // Space between ranks
        edgesep: 55, // Space for edges
      });

      // Add nodes with measured dimensions
      tables.forEach((table) => {
        const id = buildNodeId(table);
        g.setNode(id, {
          width: NODE_WIDTH,
          height: getNodeHeight(table),
        });
      });

      // Add edges for layout calculation
      relationships.forEach((relationship) => {
        const sourceId = `${relationship.fromSchema ?? "public"}.${
          relationship.fromTable
        }`;
        const targetId = `${relationship.toSchema ?? "public"}.${
          relationship.toTable
        }`;
        g.setEdge(sourceId, targetId);
      });

      // Run layout algorithm (synchronous - much faster than ELK!)
      Dagre.layout(g);

      const positions: Record<string, NodePosition> = {};
      const layoutNodes: any[] = tables.map((table) => {
        const id = buildNodeId(table);
        const dagreNode = g.node(id);

        // Dagre uses center-center anchor, ReactFlow uses top-left
        // So we need to adjust the position
        const position = {
          x: dagreNode.x - NODE_WIDTH / 2,
          y: dagreNode.y - getNodeHeight(table) / 2,
        };
        positions[id] = position;

        return {
          id,
          position,
          data: nodeDataMap.get(id),
          type: TABLE_NODE_TYPE,
          // Force React to re-render when expansion changes
          style: {
            width: NODE_WIDTH,
          },
        } as any;
      });

      setNodes(layoutNodes);
      setEdges(createEdges);
      onNodePositionsChange?.(positions);
      fitAppliedRef.current = false;
      autoArrangeTriggeredRef.current = true;

      // Fit view and update viewport after applying new layout
      setTimeout(() => {
        const instance = flowInstanceRef.current;
        if (instance) {
          void instance.fitView({ padding: FIT_VIEW_PADDING, duration: 400 });
          // Update viewport state after fitting
          setTimeout(() => {
            const newViewport = instance.getViewport();
            onViewportChange?.(newViewport);
          }, 450); // After fitView animation completes
        }
      }, 50);
    }, [
      tables,
      relationships,
      layoutDirection,
      nodeDataMap,
      setNodes,
      setEdges,
      createEdges,
      onNodePositionsChange,
      onViewportChange,
    ]);

    React.useImperativeHandle(
      ref,
      () => ({
        triggerAutoArrange: layoutWithDagre,
        zoomIn: () => {
          const instance = flowInstanceRef.current;
          if (instance) {
            void instance.zoomIn({ duration: 200 });
          }
        },
        zoomOut: () => {
          const instance = flowInstanceRef.current;
          if (instance) {
            void instance.zoomOut({ duration: 200 });
          }
        },
        fitView: () => {
          const instance = flowInstanceRef.current;
          if (instance) {
            void instance.fitView({ padding: FIT_VIEW_PADDING, duration: 400 });
          }
        },
      }),
      [layoutWithDagre],
    );

    useEffect(() => {
      const applyStoredPositions = () => {
        const positionedNodes: any[] = tables.map((table) => {
          const id = buildNodeId(table);
          const position = nodePositions[id] ?? { x: 0, y: 0 };
          return {
            id,
            position,
            data: nodeDataMap.get(id),
            type: TABLE_NODE_TYPE,
            // Force React to re-render when expansion changes
            style: {
              width: NODE_WIDTH,
            },
          } as any;
        });
        setNodes(positionedNodes);
        setEdges(createEdges);
      };

      if (!tables.length) {
        setNodes([]);
        setEdges([]);
        return;
      }

      // Skip auto-layout if manual positions exist
      if (hasStoredPositions || hasManualPositions) {
        applyStoredPositions();
      } else {
        layoutWithDagre();
      }
    }, [
      tables,
      nodePositions,
      hasStoredPositions,
      hasManualPositions,
      nodeDataMap,
      setNodes,
      setEdges,
      createEdges,
      layoutWithDagre,
    ]);

    useEffect(() => {
      setNodes((nds) =>
        nds.map((node) => {
          const data = nodeDataMap.get(node.id as string);
          if (!data) return node;
          return {
            ...node,
            data,
          };
        }),
      );
    }, [nodeDataMap, setNodes]);

    // Trigger re-layout when layout direction changes
    useEffect(() => {
      // Skip on initial mount
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false;
        return;
      }
      
      // Only re-layout if we have tables to layout
      if (tables.length > 0) {
        layoutWithDagre();
      }
    }, [layoutDirection, layoutWithDagre, tables.length]);

    useEffect(() => {
      const instance = flowInstanceRef.current;
      if (!instance) return;

      // Don't apply initial viewport if auto-arrange was just triggered
      if (autoArrangeTriggeredRef.current) {
        autoArrangeTriggeredRef.current = false;
        return;
      }

      if (initialViewport) {
        void instance.setViewport(initialViewport as Viewport, { duration: 0 });
        fitAppliedRef.current = true;
        return;
      }

      if (!fitAppliedRef.current && nodes.length > 0) {
        void instance.fitView({ padding: FIT_VIEW_PADDING, duration: 200 });
        fitAppliedRef.current = true;
      }

      if (nodes.length === 0) {
        fitAppliedRef.current = false;
      }
    }, [nodes, initialViewport]);

    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        onNodesChangeInternal(changes as NodeChange<any>[]);
        // Don't update positions during drag - only on drag end
        // This prevents throttling issues that cause nodes to disappear
      },
      [onNodesChangeInternal],
    );

    const handleNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        isDraggingRef.current = false;
        setDraggingNodeId(null);
        onNodePositionChange?.(node.id, node.position);
      },
      [onNodePositionChange],
    );

    const handleNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        isDraggingRef.current = true;
        setDraggingNodeId(node.id);
        setHoveredNodeId(node.id);
      },
      [],
    );

    const handleMoveEnd = useCallback(
      (
        _event: MouseEvent | React.MouseEvent | TouchEvent | null | undefined,
        viewport: Viewport,
      ) => {
        onViewportChange?.({
          x: viewport.x,
          y: viewport.y,
          zoom: viewport.zoom,
        });
      },
      [onViewportChange],
    );

    // Optimized edge highlighting with RAF throttling for smooth 60fps+ performance
    useEffect(() => {
      // Cancel any pending frame
      if (edgeUpdateFrameRef.current !== null) {
        cancelAnimationFrame(edgeUpdateFrameRef.current);
      }

      // Throttle edge updates using requestAnimationFrame
      edgeUpdateFrameRef.current = requestAnimationFrame(() => {
        const selectedIds = new Set(
          nodes.filter((node) => node.selected).map((node) => node.id),
        );
        if (selectedTableId) {
          selectedIds.add(selectedTableId);
        }

        // Skip edge updates during active drag for maximum performance
        if (isDraggingRef.current && draggingNodeId) {
          return;
        }

        setEdges((eds) => {
          const updatedEdges = eds.map((edge) => {
            const isRelatedToSelected =
              selectedIds.has(edge.source) || selectedIds.has(edge.target);

            const isTemporarilyHighlighted =
              hoveredNodeId === edge.source ||
              hoveredNodeId === edge.target ||
              (hoveredRelationshipId !== null &&
                (edge.data as ForeignEdgeData).relationshipId ===
                  hoveredRelationshipId);

            const isEdgeHovered =
              hoveredRelationshipId !== null &&
              (edge.data as ForeignEdgeData).relationshipId ===
                hoveredRelationshipId;

            const highlighted = isRelatedToSelected || isTemporarilyHighlighted;
            const isHovered = isEdgeHovered;
            const isDragging = draggingNodeId !== null;

            // Only update if values changed
            const currentData = edge.data as ForeignEdgeData;
            if (
              currentData.highlighted === highlighted &&
              currentData.isHovered === isHovered &&
              currentData.isDragging === isDragging
            ) {
              return edge;
            }

            return {
              ...edge,
              data: {
                ...currentData,
                highlighted,
                isHovered,
                isDragging,
              },
            };
          });

          return updatedEdges;
        });
      });

      return () => {
        if (edgeUpdateFrameRef.current !== null) {
          cancelAnimationFrame(edgeUpdateFrameRef.current);
        }
      };
    }, [
      nodes,
      hoveredNodeId,
      hoveredRelationshipId,
      setEdges,
      selectedTableId,
      draggingNodeId,
    ]);

    return (
      <div
        className="h-full w-full"
        onClick={(e) => {
          // Only dismiss if clicking directly on the wrapper, not on ReactFlow elements
          if (e.target === e.currentTarget) {
            setSelectedTableId(null);
          }
        }}
      >
        <ReactFlow
          className={FLOW_CLASS}
          nodes={nodes as any}
          edges={edges as any}
          nodeTypes={nodeTypes as any}
          edgeTypes={edgeTypes as any}
          fitView
          minZoom={0.1}
          maxZoom={1.5}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          panOnScroll={false}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          selectNodesOnDrag={false}
          panActivationKeyCode="Space"
          proOptions={{ hideAttribution: true }}
          // Performance optimizations for 60-120fps
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          autoPanOnNodeDrag={false}
          autoPanOnConnect={false}
          nodeOrigin={[0, 0]}
          // Disable RAF-based viewport updates during drag for better performance
          preventScrolling={false}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            if (initialViewport) {
              void instance.setViewport(initialViewport as Viewport, {
                duration: 0,
              });
              fitAppliedRef.current = true;
            }
          }}
          onNodeDragStart={handleNodeDragStart}
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onMoveEnd={handleMoveEnd}
          onPaneClick={handlePaneClick}
        >
          <Background className="opacity-60" gap={24} size={1} />
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              if (node.selected) return "hsl(var(--primary))";
              return "hsl(var(--muted))";
            }}
            nodeBorderRadius={4}
            maskColor="hsl(var(--background) / 0.8)"
            className="!bg-secondary !border !border-border rounded-md shadow-none"
            position="bottom-right"
            pannable={true}
            zoomable={true}
            style={{
              width: 180,
              height: 120,
            }}
          />
        </ReactFlow>
      </div>
    );
  },
);

ERDVisualizer.displayName = "ERDVisualizer";
