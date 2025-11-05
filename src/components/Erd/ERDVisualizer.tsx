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
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { Key, Link2, ChevronDown, ChevronUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { TableStructure } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";
import type { DBMLRelationship } from "@/services/dbmlService";
import type { NodePosition, ViewportState } from "@/stores/erdStore";

export type LayoutDirection = "LR" | "TB";

const NODE_WIDTH = 260;
const FIT_VIEW_PADDING = 0.08;
const PREVIEW_COLUMN_LIMIT = 10;

interface ERDVisualizerProps {
  tables: TableStructure[];
  relationships: DBMLRelationship[];
  nodePositions: Record<string, NodePosition>;
  initialViewport?: ViewportState;
  layoutDirection?: LayoutDirection;
  onNodePositionsChange?: (positions: Record<string, NodePosition>) => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onViewportChange?: (viewport: ViewportState) => void;
  onColumnDoubleClick?: (tableName: string, columnName: string) => void;
}

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

const TableNodeComponent: React.FC<NodeProps<TableNodeData>> = ({
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
  } = data;

  // Memoize expensive column sorting - CRITICAL for performance
  const sortedColumns = useMemo(() => {
    return [...table.columns].sort((a, b) => {
      // Primary keys always come first
      if (a.is_pk && !b.is_pk) return -1;
      if (!a.is_pk && b.is_pk) return 1;

      // Among primary keys, 'id' comes first
      if (a.is_pk && b.is_pk) {
        if (a.name.toLowerCase() === "id") return -1;
        if (b.name.toLowerCase() === "id") return 1;
        return 0;
      }

      // Then FKs (including _id columns that aren't PKs)
      const aIsFk =
        a.is_fk || (!a.is_pk && a.name.toLowerCase().includes("_id"));
      const bIsFk =
        b.is_fk || (!b.is_pk && b.name.toLowerCase().includes("_id"));
      if (aIsFk && !bIsFk) return -1;
      if (!aIsFk && bIsFk) return 1;

      // Keep original order for remaining columns
      return 0;
    });
  }, [table.columns]);

  const columns = expanded
    ? sortedColumns
    : sortedColumns.slice(0, PREVIEW_COLUMN_LIMIT);
  const hasMore = sortedColumns.length > PREVIEW_COLUMN_LIMIT;

  const renderColumnIcons = useCallback((column: ColumnMeta) => {
    const icons = [];
    if (column.is_pk) {
      icons.push(<Key key="pk" className="h-3 w-3 text-amber-500" />);
    }
    if (
      column.is_fk ||
      (!column.is_pk && column.name.toLowerCase().includes("_id"))
    ) {
      icons.push(<Link2 key="fk" className="h-3 w-3 text-sky-500" />);
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

  return (
    <div
      className={[
        "erd-table-card w-[260px] rounded-md border bg-card text-xs shadow-sm",
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
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
      <div className="overflow-auto px-1.5 py-1">
        <ul className="space-y-0">
          {columns.map((column) => {
            const { type, constraints } = formatColumnType(column);
            return (
              <Tooltip key={column.name} delayDuration={200}>
                <TooltipTrigger asChild>
                  <li
                    className="group relative flex items-center gap-2 rounded px-1.5 py-0.5 transition hover:bg-muted cursor-pointer"
                    onMouseEnter={() => {
                      onColumnHover?.(column.name);
                    }}
                    onMouseLeave={() => {
                      onColumnLeave?.();
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onColumnDoubleClick?.(table.name, column.name);
                    }}
                  >
                    {/* Left side handles - hidden by default, shown on row hover */}
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={makeHandleId(column.name, "target", "left")}
                      className="absolute left-0 top-1/2 opacity-0 group-hover:opacity-100"
                      style={{
                        width: 8,
                        height: 8,
                        border: "none",
                        background: "transparent",
                        pointerEvents: "all",
                        transform: "translate(-8px, -50%)",
                      }}
                    />
                    <Handle
                      type="source"
                      position={Position.Left}
                      id={makeHandleId(column.name, "source", "left")}
                      className="absolute left-0 top-1/2 opacity-0 group-hover:opacity-100"
                      style={{
                        width: 8,
                        height: 8,
                        border: "none",
                        background: "transparent",
                        pointerEvents: "all",
                        transform: "translate(-8px, -50%)",
                      }}
                    />
                    <div className="flex flex-1 items-center gap-2 min-w-0 text-xs">
                      <div className="flex-1 inline-flex items-center gap-2">
                        <span className="font-medium text-foreground truncate max-w-[120px]">
                          {column.name}
                        </span>
                        {renderColumnIcons(column)}
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        {constraints.length > 0 && (
                          <span className="text-xs text-orange-500 font-semibold flex-shrink-0">
                            {constraints.join(",")}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {type}
                        </span>
                      </div>
                    </div>
                    {/* Right side handles - hidden by default, shown on row hover */}
                    <Handle
                      type="target"
                      position={Position.Right}
                      id={makeHandleId(column.name, "target", "right")}
                      className="absolute right-0 top-1/2 opacity-0 group-hover:opacity-100"
                      style={{
                        width: 8,
                        height: 8,
                        border: "none",
                        background: "transparent",
                        pointerEvents: "all",
                        transform: "translate(8px, -50%)",
                      }}
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={makeHandleId(column.name, "source", "right")}
                      className="absolute right-0 top-1/2 opacity-0 group-hover:opacity-100"
                      style={{
                        width: 8,
                        height: 8,
                        border: "none",
                        background: "transparent",
                        pointerEvents: "all",
                        transform: "translate(8px, -50%)",
                      }}
                    />
                  </li>
                </TooltipTrigger>
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
            <li className="pt-1 pl-2 text-xs text-muted-foreground">
              +{sortedColumns.length - PREVIEW_COLUMN_LIMIT} more columns
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
};

const TableNode = React.memo(TableNodeComponent);

const ForeignKeyEdgeComponent: React.FC<EdgeProps<ForeignEdgeData>> = ({
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
  // Determine relationship type based on cardinalities
  const getRelationshipType = () => {
    const source = data?.sourceCardinality || "1";
    const target = data?.targetCardinality || "1";
    return `${source}-${target}`;
  };

  const relationshipType = getRelationshipType();
  const highlighted = Boolean(selected || data?.highlighted);

  // Create custom markers for different relationship types
  const getMarkerStyle = (
    cardinality: "1" | "n",
    position: "source" | "target",
  ) => {
    const baseColor = highlighted
      ? "hsl(var(--primary))"
      : "hsl(var(--muted-foreground))";

    if (cardinality === "1") {
      // Single line for "one" side
      return {
        markerWidth: 4,
        markerHeight: 7,
        refX: position === "target" ? 4 : 0,
        refY: 3.5,
        orient: "auto",
        fill: "none",
        stroke: baseColor,
        strokeWidth: 0.8,
      };
    } else {
      // Crow's foot for "many" side
      return {
        markerWidth: 7,
        markerHeight: 6,
        refX: position === "target" ? 7 : 0,
        refY: 3,
        orient: "auto",
        fill: "none",
        stroke: baseColor,
        strokeWidth: 0.6,
      };
    }
  };

  // Get line style based on relationship type
  const getLineStyle = () => {
    const baseStyle = {
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    };

    switch (relationshipType) {
      case "1-1":
        return { ...baseStyle }; // Solid line
      case "1-n":
      case "n-1":
        return { ...baseStyle }; // Solid line
      case "n-n":
        return {
          ...baseStyle,
          strokeDasharray: "5,5", // Dashed line for many-to-many
        };
      default:
        return baseStyle;
    }
  };
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset: 32,
  });

  // Position cardinality labels closer to the actual connection points
  const sourceOffset = 20; // Distance from the node edge
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

  const lineStyle = getLineStyle();

  const sourceMarkerId = `marker-source-${id}`;
  const targetMarkerId = `marker-target-${id}`;
  const sourceMarkerStyle = data?.sourceCardinality
    ? getMarkerStyle(data.sourceCardinality, "source")
    : null;
  const targetMarkerStyle = data?.targetCardinality
    ? getMarkerStyle(data.targetCardinality, "target")
    : null;

  return (
    <>
      {/* Define custom markers */}
      <defs>
        {sourceMarkerStyle && (
          <marker id={sourceMarkerId} {...sourceMarkerStyle}>
            {data?.sourceCardinality === "1" ? (
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
            {data?.targetCardinality === "1" ? (
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
        onMouseEnter={() => data?.onHover?.(data.relationshipId)}
        onMouseLeave={() => data?.onLeave?.()}
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
      {data?.sourceCardinality && (data.isHovered || data.highlighted) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${startLabelX}px, ${startLabelY}px)`,
              pointerEvents: "none",
              opacity: data.isHovered || data.highlighted ? 1 : 0,
              transition: "opacity 150ms ease-in-out",
            }}
            className="text-xs font-bold text-primary bg-background rounded-full w-6 h-6 flex items-center justify-center shadow-sm border border-primary/40"
          >
            {data.sourceCardinality === "n" ? "N" : data.sourceCardinality}
          </div>
        </EdgeLabelRenderer>
      )}
      {data?.targetCardinality && (data.isHovered || data.highlighted) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${endLabelX}px, ${endLabelY}px)`,
              pointerEvents: "none",
              opacity: data.isHovered || data.highlighted ? 1 : 0,
              transition: "opacity 150ms ease-in-out",
            }}
            className="text-xs font-bold text-primary bg-background rounded-full w-6 h-6 flex items-center justify-center shadow-sm border border-primary/40"
          >
            {data.targetCardinality === "n" ? "N" : data.targetCardinality}
          </div>
        </EdgeLabelRenderer>
      )}

      {data?.label && data.isHovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded bg-background px-2 py-0.5 text-xs font-medium text-foreground shadow-md border border-primary/50"
          >
            {data.label}
            {/* Show relationship type in label when highlighted */}
            <span className="ml-1 text-xs text-muted-foreground">
              ({data.sourceCardinality || "1"}:{data.targetCardinality || "1"})
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const ForeignKeyEdge = React.memo(ForeignKeyEdgeComponent);

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
      onNodePositionsChange,
      onNodePositionChange,
      onViewportChange,
      onColumnDoubleClick,
    },
    ref,
  ) => {
    edgeStylesInjected();

    const [nodes, setNodes, onNodesChangeInternal] = useNodesState<
      Node<TableNodeData>
    >([]);
    const [edges, setEdges] = useEdgesState<Edge<ForeignEdgeData>>([]);
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

    // Memoize node data factory for performance - CRITICAL optimization
    const createNodeData = useCallback(
      (table: TableStructure, nodeId: string): TableNodeData => ({
        table,
        expanded: expandedNodes.has(nodeId),
        isSelected: selectedTableId === nodeId,
        onToggleExpand: toggleExpanded,
        onHover: setHoveredNodeId,
        onLeave: () => {
          setHoveredNodeId((prev) => (prev === nodeId ? null : prev));
        },
        onClick: handleTableClick,
        onColumnHover: setHoveredColumn,
        onColumnLeave: () => {
          setHoveredColumn(null);
        },
        onColumnDoubleClick,
      }),
      [
        expandedNodes,
        selectedTableId,
        toggleExpanded,
        handleTableClick,
        onColumnDoubleClick,
      ],
    );

    // Memoize edge creation for performance - CRITICAL optimization
    const createEdges = useMemo((): Edge<ForeignEdgeData>[] => {
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
            sourceNode.position.x + (sourceNode.width || NODE_WIDTH) / 2;
          const targetX =
            targetNode.position.x + (targetNode.width || NODE_WIDTH) / 2;

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
          } satisfies Edge<ForeignEdgeData>;
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
      const layoutNodes: Node<TableNodeData>[] = tables.map((table) => {
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
          data: createNodeData(table, id),
          type: TABLE_NODE_TYPE,
          // Force React to re-render when expansion changes
          style: {
            width: NODE_WIDTH,
          },
        } satisfies Node<TableNodeData>;
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
          instance.fitView({ padding: FIT_VIEW_PADDING, duration: 400 });
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
      createNodeData,
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
            instance.zoomIn({ duration: 200 });
          }
        },
        zoomOut: () => {
          const instance = flowInstanceRef.current;
          if (instance) {
            instance.zoomOut({ duration: 200 });
          }
        },
        fitView: () => {
          const instance = flowInstanceRef.current;
          if (instance) {
            instance.fitView({ padding: FIT_VIEW_PADDING, duration: 400 });
          }
        },
      }),
      [layoutWithDagre],
    );

    useEffect(() => {
      const applyStoredPositions = () => {
        const positionedNodes: Node<TableNodeData>[] = tables.map((table) => {
          const id = buildNodeId(table);
          const position = nodePositions[id] ?? { x: 0, y: 0 };
          return {
            id,
            position,
            data: createNodeData(table, id),
            type: TABLE_NODE_TYPE,
            // Force React to re-render when expansion changes
            style: {
              width: NODE_WIDTH,
            },
          } satisfies Node<TableNodeData>;
        });
        setNodes(positionedNodes);
        setEdges(createEdges);
      };

      if (!tables.length) {
        setNodes([]);
        setEdges([]);
        return;
      }

      if (hasStoredPositions) {
        applyStoredPositions();
      } else {
        layoutWithDagre();
      }
    }, [
      tables,
      nodePositions,
      hasStoredPositions,
      createNodeData,
      setNodes,
      setEdges,
      createEdges,
      layoutWithDagre,
    ]);

    useEffect(() => {
      setNodes((nds) =>
        nds.map((node) => {
          const table = tables.find((tbl) => buildNodeId(tbl) === node.id);
          if (!table) return node;
          return {
            ...node,
            data: createNodeData(table, node.id),
          };
        }),
      );
    }, [tables, createNodeData, setNodes]);

    // Trigger re-layout when layout direction changes
    useEffect(() => {
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
        instance.setViewport(initialViewport as Viewport, { duration: 0 });
        fitAppliedRef.current = true;
        return;
      }

      if (!fitAppliedRef.current && nodes.length > 0) {
        instance.fitView({ padding: FIT_VIEW_PADDING, duration: 200 });
        fitAppliedRef.current = true;
      }

      if (nodes.length === 0) {
        fitAppliedRef.current = false;
      }
    }, [nodes, initialViewport]);

    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        onNodesChangeInternal(changes);
        // Don't update positions during drag - only on drag end
        // This prevents throttling issues that cause nodes to disappear
      },
      [onNodesChangeInternal],
    );

    const handleNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        setDraggingNodeId(null);
        onNodePositionChange?.(node.id, node.position);
      },
      [onNodePositionChange],
    );

    const handleNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: Node) => {
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

    // Simplified edge highlighting - updates on hover/selection
    useEffect(() => {
      const selectedIds = new Set(
        nodes.filter((node) => node.selected).map((node) => node.id),
      );
      if (selectedTableId) {
        selectedIds.add(selectedTableId);
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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
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
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            if (initialViewport) {
              instance.setViewport(initialViewport as Viewport, {
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
