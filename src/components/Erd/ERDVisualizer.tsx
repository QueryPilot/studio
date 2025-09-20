import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
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
} from "reactflow";
import "reactflow/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import { Key, Link2, ChevronDown, ChevronUp } from "lucide-react";

import type { TableStructure } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";
import type { DBMLRelationship } from "@/services/dbmlService";
import type { NodePosition, ViewportState } from "@/stores/erdStore";

const elk = new ELK();

const NODE_WIDTH = 280;
const PREVIEW_COLUMN_LIMIT = 10;

interface ERDVisualizerProps {
  tables: TableStructure[];
  relationships: DBMLRelationship[];
  nodePositions: Record<string, NodePosition>;
  initialViewport?: ViewportState;
  onNodePositionsChange?: (positions: Record<string, NodePosition>) => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onViewportChange?: (viewport: ViewportState) => void;
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
}

interface ForeignEdgeData {
  relationshipId: string;
  label: string;
  sourceCardinality?: "1" | "n";
  targetCardinality?: "1" | "n";
  highlighted?: boolean;
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
      @keyframes erd-arrow-flow {
        0% { transform: translateX(0); opacity: 0; }
        50% { opacity: 1; }
        100% { transform: translateX(20px); opacity: 0; }
      }
      .erd-edge-arrow {
        animation: erd-arrow-flow 1.5s ease-in-out infinite;
      }
      .erd-edge-hover-area {
        pointer-events: stroke;
        stroke-width: 20;
        stroke: transparent;
        fill: none;
      }
      .erd-table-card {
        transition: box-shadow 0.2s ease, border-color 0.2s ease;
        transform: translateZ(0);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        image-rendering: -webkit-optimize-contrast;
      }
      .erd-table-card-selected {
        box-shadow: 0 0 0 2px hsl(var(--primary)), 0 10px 30px rgba(0,0,0,0.12);
        border-color: hsl(var(--primary));
      }
      .${FLOW_CLASS} {
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        will-change: transform;
      }
      .${FLOW_CLASS} .react-flow__renderer {
        transform: translateZ(0);
        image-rendering: -webkit-optimize-contrast;
      }
      .${FLOW_CLASS} .react-flow__node {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .erd-column-tooltip {
        position: absolute;
        z-index: 1000;
        background: hsl(var(--popover));
        color: hsl(var(--popover-foreground));
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        pointer-events: none;
        white-space: nowrap;
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

const makeHandleId = (columnName: string, role: "source" | "target") =>
  `${role}-${columnName}`;

const TABLE_NODE_TYPE = "table-node";
const EDGE_TYPE = "foreign";

const TableNode: React.FC<NodeProps<TableNodeData>> = ({
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
  } = data;
  const [tooltipContent, setTooltipContent] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  // Sort columns: PK first, then FK, then others
  const sortedColumns = [...table.columns].sort((a, b) => {
    // Primary keys always come first
    if (a.is_pk && !b.is_pk) return -1;
    if (!a.is_pk && b.is_pk) return 1;

    // Among primary keys, 'id' comes first
    if (a.is_pk && b.is_pk) {
      if (a.name.toLowerCase() === 'id') return -1;
      if (b.name.toLowerCase() === 'id') return 1;
      return 0;
    }

    // Then FKs (including _id columns that aren't PKs)
    const aIsFk = a.is_fk || (!a.is_pk && a.name.toLowerCase().includes("_id"));
    const bIsFk = b.is_fk || (!b.is_pk && b.name.toLowerCase().includes("_id"));
    if (aIsFk && !bIsFk) return -1;
    if (!aIsFk && bIsFk) return 1;

    // Keep original order for remaining columns
    return 0;
  });

  const columns = expanded
    ? sortedColumns
    : sortedColumns.slice(0, PREVIEW_COLUMN_LIMIT);
  const hasMore = sortedColumns.length > PREVIEW_COLUMN_LIMIT;

  const renderColumnIcons = (column: ColumnMeta) => {
    const icons = [];
    if (column.is_pk) {
      icons.push(<Key key="pk" className="h-3 w-3 text-amber-500" />);
    }
    if (column.is_fk || (!column.is_pk && column.name.toLowerCase().includes("_id"))) {
      icons.push(<Link2 key="fk" className="h-3 w-3 text-sky-500" />);
    }
    return icons.length > 0 ? (
      <div className="flex gap-0.5">{icons}</div>
    ) : null;
  };

  const formatColumnType = (column: ColumnMeta) => {
    const type = column.db_type;
    const constraints = [];
    if (!column.nullable) constraints.push("NN");
    return { type, constraints };
  };

  return (
    <div
      className={[
        "erd-table-card w-[280px] rounded-md border bg-card text-xs shadow-sm",
        selected || isSelected ? "erd-table-card-selected" : "border-border",
      ].join(" ")}
      onMouseEnter={() => {
        onHover(id);
      }}
      onMouseLeave={() => {
        onLeave();
        setTooltipContent(null);
      }}
      onMouseUp={() => {
        onClick(id);
      }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
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
      <div className="max-h-[400px] overflow-auto px-2 py-2">
        <ul className="space-y-0.5">
          {columns.map((column) => {
            const { type, constraints } = formatColumnType(column);
            return (
              <li
                key={column.name}
                className="relative flex items-center gap-2 rounded px-2 py-1 transition hover:bg-muted"
                onMouseEnter={(e) => {
                  onColumnHover?.(column.name);
                  if (column.default || column.comment) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const content = [];
                    if (column.default)
                      content.push(`Default: ${column.default}`);
                    if (column.comment)
                      content.push(`Comment: ${column.comment}`);
                    setTooltipContent({
                      text: content.join("\n"),
                      x: rect.right + 5,
                      y: rect.top + rect.height / 2,
                    });
                  }
                }}
                onMouseLeave={() => {
                  onColumnLeave?.();
                  setTooltipContent(null);
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={makeHandleId(column.name, "target")}
                  className="absolute left-0 top-1/2"
                  style={{
                    width: 0,
                    height: 0,
                    border: "none",
                    background: "transparent",
                    pointerEvents: "none",
                    transform: "translate(-8px, -50%)",
                  }}
                />
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="flex-1 inline-flex items-center gap-2">
                    <span className="font-medium text-foreground truncate max-w-[120px]">
                      {column.name}
                    </span>
                    {renderColumnIcons(column)}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    {constraints.length > 0 && (
                      <span className="text-[9px] text-orange-500 font-semibold flex-shrink-0">
                        {constraints.join(",")}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground truncate">
                      {type}
                    </span>
                  </div>
                </div>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={makeHandleId(column.name, "source")}
                  className="absolute right-0 top-1/2"
                  style={{
                    width: 0,
                    height: 0,
                    border: "none",
                    background: "transparent",
                    pointerEvents: "none",
                    transform: "translate(8px, -50%)",
                  }}
                />
              </li>
            );
          })}
          {hasMore && !expanded ? (
            <li className="pt-1 pl-2 text-[10px] text-muted-foreground">
              +{sortedColumns.length - PREVIEW_COLUMN_LIMIT} more columns
            </li>
          ) : null}
        </ul>
      </div>
      {tooltipContent && (
        <div
          className="erd-column-tooltip"
          style={{
            left: tooltipContent.x,
            top: tooltipContent.y,
            transform: "translateY(-50%)",
            position: "fixed",
          }}
        >
          {tooltipContent.text.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const ForeignKeyEdge: React.FC<EdgeProps<ForeignEdgeData>> = ({
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
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
    offset: 24,
  });

  const startLabelX = sourceX + (targetX - sourceX) * 0.2;
  const startLabelY = sourceY + (targetY - sourceY) * 0.2;
  const endLabelX = targetX + (sourceX - targetX) * 0.2;
  const endLabelY = targetY + (sourceY - targetY) * 0.2;

  const highlighted = Boolean(selected || data?.highlighted);

  return (
    <>
      <path
        id={id}
        className={["erd-edge", highlighted ? "erd-edge-animated" : ""].join(
          " ",
        )}
        d={edgePath}
        stroke={
          highlighted ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"
        }
        strokeWidth={highlighted ? 2 : 1.5}
        fill="none"
        markerEnd={markerEnd}
        onMouseEnter={() => data?.onHover?.(data.relationshipId)}
        onMouseLeave={() => data?.onLeave?.()}
        pointerEvents="stroke"
        style={{
          ...style,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />

      {data?.sourceCardinality ? (
        <text
          x={startLabelX}
          y={startLabelY}
          className="fill-background"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          <tspan className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground">
            {data.sourceCardinality}
          </tspan>
        </text>
      ) : null}

      {data?.targetCardinality ? (
        <text
          x={endLabelX}
          y={endLabelY}
          className="fill-background"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          <tspan className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground">
            {data.targetCardinality}
          </tspan>
        </text>
      ) : null}

      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};

const nodeTypes = {
  [TABLE_NODE_TYPE]: TableNode,
};

const edgeTypes = {
  [EDGE_TYPE]: ForeignKeyEdge,
};

export const ERDVisualizer: React.FC<ERDVisualizerProps> = ({
  tables,
  relationships,
  nodePositions,
  initialViewport,
  onNodePositionsChange,
  onNodePositionChange,
  onViewportChange,
}) => {
  edgeStylesInjected();

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
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

  const createEdges = useCallback((): Edge<ForeignEdgeData>[] => {
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

      return Array.from({ length: pairCount }, (_, index) => {
        const sourceColumn =
          relationship.fromColumns[index] ?? relationship.fromColumns[0] ?? "";
        const targetColumn =
          relationship.toColumns[index] ?? relationship.toColumns[0] ?? "";
        const edgeId = `${relationship.id}-${index}`;

        return {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: makeHandleId(sourceColumn, "source"),
          targetHandle: makeHandleId(targetColumn, "target"),
          type: EDGE_TYPE,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "hsl(var(--muted-foreground))",
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

  useEffect(() => {
    let cancelled = false;

    const layoutWithElk = async () => {
      const graph = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "60",
          "elk.spacing.nodeNodeBetweenLayers": "80",
        },
        children: tables.map((table) => ({
          id: buildNodeId(table),
          width: NODE_WIDTH,
          height: 160,
        })),
        edges: relationships.map((relationship) => ({
          id: relationship.id,
          sources: [
            `${relationship.fromSchema ?? "public"}.${relationship.fromTable}`,
          ],
          targets: [
            `${relationship.toSchema ?? "public"}.${relationship.toTable}`,
          ],
        })),
      } as const;

      const layout = await elk.layout(graph);
      if (cancelled) return;

      const positions: Record<string, NodePosition> = {};
      const layoutNodes: Node<TableNodeData>[] = tables.map((table) => {
        const id = buildNodeId(table);
        const elkNode = layout.children?.find((child) => child.id === id);
        const position = {
          x: elkNode?.x ?? 0,
          y: elkNode?.y ?? 0,
        };
        positions[id] = position;

        return {
          id,
          position,
          data: {
            table,
            expanded: expandedNodes.has(id),
            isSelected: selectedTableId === id,
            onToggleExpand: toggleExpanded,
            onHover: setHoveredNodeId,
            onLeave: () => {
              setHoveredNodeId((prev) => (prev === id ? null : prev));
            },
            onClick: handleTableClick,
            onColumnHover: setHoveredColumn,
            onColumnLeave: () => {
              setHoveredColumn(null);
            },
          },
          type: TABLE_NODE_TYPE,
        } satisfies Node<TableNodeData>;
      });

      setNodes(layoutNodes);
      setEdges(createEdges());
      onNodePositionsChange?.(positions);
      fitAppliedRef.current = false;
    };

    const applyStoredPositions = () => {
      const positionedNodes: Node<TableNodeData>[] = tables.map((table) => {
        const id = buildNodeId(table);
        const position = nodePositions[id] ?? { x: 0, y: 0 };
        return {
          id,
          position,
          data: {
            table,
            expanded: expandedNodes.has(id),
            isSelected: selectedTableId === id,
            onToggleExpand: toggleExpanded,
            onHover: setHoveredNodeId,
            onLeave: () => {
              setHoveredNodeId((prev) => (prev === id ? null : prev));
            },
            onClick: handleTableClick,
            onColumnHover: setHoveredColumn,
            onColumnLeave: () => {
              setHoveredColumn(null);
            },
          },
          type: TABLE_NODE_TYPE,
        } satisfies Node<TableNodeData>;
      });
      setNodes(positionedNodes);
      setEdges(createEdges());
    };

    if (!tables.length) {
      setNodes([]);
      setEdges([]);
      return;
    }

    if (hasStoredPositions) {
      applyStoredPositions();
    } else {
      void layoutWithElk();
    }

    return () => {
      cancelled = true;
    };
  }, [
    tables,
    relationships,
    nodePositions,
    expandedNodes,
    hasStoredPositions,
    setNodes,
    setEdges,
    onNodePositionsChange,
    createEdges,
    toggleExpanded,
    selectedTableId,
    handleTableClick,
  ]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const table = tables.find((tbl) => buildNodeId(tbl) === node.id);
        if (!table) return node;
        return {
          ...node,
          data: {
            table,
            expanded: expandedNodes.has(node.id),
            isSelected: selectedTableId === node.id,
            onToggleExpand: toggleExpanded,
            onHover: setHoveredNodeId,
            onLeave: () => {
              setHoveredNodeId((prev) => (prev === node.id ? null : prev));
            },
            onClick: handleTableClick,
            onColumnHover: setHoveredColumn,
            onColumnLeave: () => {
              setHoveredColumn(null);
            },
          },
        };
      }),
    );
  }, [
    tables,
    expandedNodes,
    toggleExpanded,
    setNodes,
    selectedTableId,
    handleTableClick,
  ]);

  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;

    if (initialViewport) {
      instance.setViewport(initialViewport as Viewport, { duration: 0 });
      fitAppliedRef.current = true;
      return;
    }

    if (!fitAppliedRef.current && nodes.length > 0) {
      instance.fitView({ padding: 0.2, duration: 200 });
      fitAppliedRef.current = true;
    }

    if (nodes.length === 0) {
      fitAppliedRef.current = false;
    }
  }, [nodes, initialViewport]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeInternal(changes);
      changes.forEach((change) => {
        if (change.type === "position" && change.position) {
          onNodePositionChange?.(change.id, change.position);
        }
      });
    },
    [onNodesChangeInternal, onNodePositionChange],
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
      _event: MouseEvent | React.MouseEvent | TouchEvent | undefined,
      viewport: Viewport,
    ) => {
      onViewportChange?.({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [onViewportChange],
  );

  useEffect(() => {
    const selectedIds = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    // Add the custom selected table to the set
    if (selectedTableId) {
      selectedIds.add(selectedTableId);
    }
    setEdges((eds) =>
      eds.map((edge) => {
        // Check if edge is related to selected nodes (persistent highlight)
        const isRelatedToSelected =
          selectedIds.has(edge.source) || selectedIds.has(edge.target);

        // Check if edge is related to hovered/dragged nodes (temporary highlight)
        const isTemporarilyHighlighted =
          hoveredNodeId === edge.source ||
          hoveredNodeId === edge.target ||
          draggingNodeId === edge.source ||
          draggingNodeId === edge.target ||
          (hoveredRelationshipId !== null &&
            (edge.data as ForeignEdgeData).relationshipId ===
              hoveredRelationshipId);

        return {
          ...edge,
          data: {
            ...(edge.data as ForeignEdgeData),
            highlighted: isRelatedToSelected || isTemporarilyHighlighted,
          },
        };
      }),
    );
  }, [
    nodes,
    hoveredNodeId,
    draggingNodeId,
    hoveredRelationshipId,
    setEdges,
    selectedTableId,
  ]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        className={FLOW_CLASS}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        selectionOnDrag
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
          if (initialViewport) {
            instance.setViewport(initialViewport as Viewport, { duration: 0 });
            fitAppliedRef.current = true;
          }
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
      >
        <Background className="opacity-60" gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
};
