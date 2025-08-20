# P3-002: ERD (Entity Relationship Diagram) Visualization

## Priority
P3 - Nice-to-have

## Dependencies
- P1-003: Column Metadata (needs FK relationships)

## Estimated Effort
6-8 hours

## Problem Statement
Users can't visualize database relationships and structure. No way to see the big picture of how tables connect, making it hard to understand complex schemas.

## Acceptance Criteria
- [ ] Interactive ERD with draggable tables
- [ ] Auto-layout algorithm for initial positioning
- [ ] Show/hide columns and relationships
- [ ] Zoom and pan controls
- [ ] Export to SVG/PNG
- [ ] Highlight relationship paths
- [ ] Filter by schema or table groups
- [ ] Mini-map for large diagrams

## Implementation Notes

### ERD Data Model
```typescript
// src/types/erd.ts
export interface ERDTable {
  id: string;
  name: string;
  schema: string;
  position: { x: number; y: number };
  columns: ERDColumn[];
  color?: string;
  collapsed?: boolean;
}

export interface ERDColumn {
  name: string;
  type: string;
  isPK: boolean;
  isFK: boolean;
  nullable: boolean;
}

export interface ERDRelationship {
  id: string;
  source: {
    tableId: string;
    columnName: string;
  };
  target: {
    tableId: string;
    columnName: string;
  };
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  onDelete: string;
  onUpdate: string;
}

// src/components/ERD/ERDCanvas.tsx
import { useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';

export function ERDCanvas({ 
  tables,
  relationships,
  connectionId,
}: ERDCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  
  // Convert tables to nodes
  useEffect(() => {
    const newNodes: Node[] = tables.map(table => ({
      id: table.id,
      type: 'erdTable',
      position: table.position || { x: 0, y: 0 },
      data: {
        table,
        onCollapse: () => toggleTableCollapse(table.id),
        onHighlight: () => highlightRelatedTables(table.id),
      },
    }));
    
    setNodes(newNodes);
  }, [tables]);
  
  // Convert relationships to edges
  useEffect(() => {
    const newEdges: Edge[] = relationships.map(rel => ({
      id: rel.id,
      source: rel.source.tableId,
      target: rel.target.tableId,
      sourceHandle: rel.source.columnName,
      targetHandle: rel.target.columnName,
      type: 'smoothstep',
      animated: false,
      label: formatRelationType(rel.type),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
      },
      style: {
        strokeWidth: 2,
        stroke: rel.type === 'one-to-one' ? '#10b981' : '#3b82f6',
      },
      data: rel,
    }));
    
    setEdges(newEdges);
  }, [relationships]);
  
  // Auto-layout using dagre
  const autoLayout = useCallback(() => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ 
      rankdir: 'TB',
      nodesep: 100,
      ranksep: 100,
    });
    
    nodes.forEach(node => {
      dagreGraph.setNode(node.id, { 
        width: 250, 
        height: node.data.table.collapsed ? 60 : 
          (50 + node.data.table.columns.length * 25) 
      });
    });
    
    edges.forEach(edge => {
      dagreGraph.setEdge(edge.source, edge.target);
    });
    
    dagre.layout(dagreGraph);
    
    const layoutedNodes = nodes.map(node => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - nodeWithPosition.width / 2,
          y: nodeWithPosition.y - nodeWithPosition.height / 2,
        },
      };
    });
    
    setNodes(layoutedNodes);
  }, [nodes, edges]);
  
  // Highlight related tables
  const highlightRelatedTables = useCallback((tableId: string) => {
    const related = new Set<string>();
    
    edges.forEach(edge => {
      if (edge.source === tableId) {
        related.add(edge.target);
      } else if (edge.target === tableId) {
        related.add(edge.source);
      }
    });
    
    setNodes(nodes => nodes.map(node => ({
      ...node,
      style: {
        ...node.style,
        opacity: related.has(node.id) || node.id === tableId ? 1 : 0.3,
      },
    })));
    
    setEdges(edges => edges.map(edge => ({
      ...edge,
      style: {
        ...edge.style,
        opacity: edge.source === tableId || edge.target === tableId ? 1 : 0.3,
      },
    })));
  }, [edges]);
  
  // Export to SVG
  const exportToSVG = useCallback(() => {
    const svg = document.querySelector('.react-flow__viewport');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'erd.svg';
    link.click();
    
    URL.revokeObjectURL(url);
  }, []);
  
  return (
    <div className="erd-canvas h-full">
      <div className="absolute top-2 left-2 z-10 flex gap-2">
        <Button onClick={autoLayout} size="sm" variant="outline">
          <Layout className="h-4 w-4 mr-1" />
          Auto Layout
        </Button>
        <Button onClick={exportToSVG} size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
        <Button
          onClick={() => highlightRelatedTables(null)}
          size="sm"
          variant="outline"
        >
          <Eye className="h-4 w-4 mr-1" />
          Reset View
        </Button>
      </div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant="dots" gap={12} size={1} />
        <Controls />
        <MiniMap 
          nodeColor={node => node.data.table.color || '#e5e7eb'}
          nodeStrokeWidth={3}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// Custom table node component
function ERDTableNode({ data }: { data: any }) {
  const { table, onCollapse, onHighlight } = data;
  
  return (
    <div className="erd-table bg-background border-2 rounded shadow-lg">
      <div 
        className="table-header bg-primary/10 p-2 flex items-center justify-between cursor-pointer"
        onClick={onHighlight}
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          <span className="font-semibold">{table.name}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
        >
          {table.collapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
      
      {!table.collapsed && (
        <div className="table-columns p-2">
          {table.columns.map((column: ERDColumn) => (
            <div
              key={column.name}
              className="column flex items-center gap-2 py-1 text-sm"
            >
              {column.isPK && <Key className="h-3 w-3 text-yellow-500" />}
              {column.isFK && <Link2 className="h-3 w-3 text-blue-500" />}
              <span className={cn(
                "flex-1",
                column.isPK && "font-semibold"
              )}>
                {column.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {column.type}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {/* Connection handles for relationships */}
      {table.columns
        .filter((col: ERDColumn) => col.isFK || col.isPK)
        .map((col: ERDColumn) => (
          <Handle
            key={col.name}
            type={col.isPK ? "source" : "target"}
            position={col.isPK ? Position.Right : Position.Left}
            id={col.name}
            style={{
              top: `${50 + table.columns.indexOf(col) * 25}px`,
            }}
          />
        ))}
    </div>
  );
}

const nodeTypes = {
  erdTable: ERDTableNode,
};

// ERD Container with data fetching
export function ERDViewer({ connectionId }: { connectionId: string }) {
  const [tables, setTables] = useState<ERDTable[]>([]);
  const [relationships, setRelationships] = useState<ERDRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadERDData();
  }, [connectionId]);
  
  const loadERDData = async () => {
    setLoading(true);
    
    try {
      // Fetch all tables with columns
      const tablesData = await invoke('db_get_all_tables', { connectionId });
      
      // Fetch all foreign key relationships
      const relationshipsData = await invoke('db_get_relationships', { 
        connectionId 
      });
      
      // Transform to ERD format
      const erdTables = tablesData.map(transformToERDTable);
      const erdRelationships = relationshipsData.map(transformToERDRelationship);
      
      setTables(erdTables);
      setRelationships(erdRelationships);
    } catch (error) {
      toast.error(`Failed to load ERD: ${error}`);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <div>Loading ERD...</div>;
  }
  
  return (
    <ERDCanvas
      tables={tables}
      relationships={relationships}
      connectionId={connectionId}
    />
  );
}
```

## Files to Modify
- Install ReactFlow: `pnpm add reactflow`
- Install dagre: `pnpm add dagre @types/dagre`
- Create `src/types/erd.ts` - ERD type definitions
- Create `src/components/ERD/ERDCanvas.tsx` - Main canvas component
- Create `src/components/ERD/ERDTableNode.tsx` - Table node component
- Create `src/components/ERD/ERDControls.tsx` - Control panel
- Update `src-tauri/src/commands/database.rs` - Add relationship query
- Create new route/tab for ERD viewer

## Testing Requirements
1. **Unit Tests**
   - Test layout algorithm
   - Test relationship detection
   - Test export functionality

2. **Integration Tests**
   - Load ERD with 50+ tables
   - Test drag and drop
   - Test zoom/pan performance

3. **Manual Testing**
   - Test with complex schemas
   - Verify relationship accuracy
   - Test on different screen sizes

## Success Metrics
- Handle 100+ tables smoothly
- Auto-layout completes < 1 second
- Export produces valid SVG
- Relationships correctly mapped

## Notes
- Consider clustering for very large schemas
- May need virtualization for huge diagrams
- Future: Edit mode to modify schema