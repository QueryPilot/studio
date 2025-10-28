# ERD Panel Implementation Specification

## Executive Summary

Implementation of an Entity-Relationship Diagram (ERD) panel for Query Pilot that converts database schema to DBML format and provides interactive visualization with dual-mode editing (visual + code).

## Alignment With Current Codebase

- No ERD UI/store/service exists yet; this spec remains a plan.
- `erd` is a known tab type and keyboard view, but there is no `ERDPanel` renderer.
- Reuse existing building blocks:
  - Code editor: `src/components/CodeEditor` (SQL mode as placeholder)
  - Resizable layout: `src/components/ui/resizable`
  - Table structure/types: `src/types/tableStructure.ts` + `src/services/databaseService.ts`
- Dependencies for ERD are present in `package.json` (`reactflow`, `elkjs`, `@dbml/core`).
- Phase 1 focuses on adding an ERD tab route and skeleton UI, then iterates.

## Core Architecture

### 1. Technology Stack

```typescript
// Primary Dependencies
- @dbml/core: DBML parsing and AST manipulation
- reactflow: ERD visualization with custom nodes/edges
- elkjs: Automatic graph layout algorithm for ERD
- @codemirror/lang-sql, @codemirror/view: CodeMirror 6 editor
- @uiw/react-codemirror: React bindings for CodeMirror 6
- zustand: ERD view state management
// Optional (later): validate our view state (not DBML syntax)
// - zod (optional): validate persisted ERD view metadata
```

### 2. Service Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Schema Store │────▶│ DBML Service │────▶│ ERD Store    │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                      │
                            ▼                      ▼
                     ┌──────────────┐     ┌──────────────┐
                     │ DBML Parser  │     │ ERD Panel    │
                     └──────────────┘     └──────────────┘
                                                   │
                            ┌──────────────────────┼──────────────────────┐
                            ▼                      ▼                      ▼
                     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                     │ Visual View  │     │ Code Editor  │     │ View Manager │
                     └──────────────┘     └──────────────┘     └──────────────┘
```

## Implementation Components

### 1. DBML Conversion Service

```typescript
// src/services/dbmlService.ts (planned)
import type { TableStructure } from "@/types/tableStructure";

interface DBMLConversionOptions {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  includeTriggers?: boolean;
  includeComments?: boolean;
  includeEnums?: boolean;
  filterTables?: string[];
  excludeSystemTables?: boolean;
}

interface DBMLSchema {
  dbml: string;
  ast: any; // DBML AST
  metadata: {
    tableCount: number;
    relationshipCount: number;
    enumCount: number;
    version: string;
    generatedAt: Date;
  };
}

class DBMLService {
  // Convert tables (from DatabaseService) to DBML
  async schemaToDBML(
    tables: TableStructure[],
    options?: DBMLConversionOptions,
  ): Promise<DBMLSchema>;
  // Note: set Project.database_type based on active connection (postgresql/mysql/sqlite/mssql, etc.)

  // Parse DBML string to AST
  parseDBML(dbml: string): Promise<any>;

  // Validate DBML syntax via @dbml/core
  validateDBML(dbml: string): { valid: boolean; errors?: string[] };

  // Extract relationships from schema
  extractRelationships(tables: TableStructure[]): DBMLRelationship[];
}
```

### 2. ERD Store

```typescript
// src/stores/erdStore.ts (planned)

interface ERDView {
  id: string;
  name: string;
  dbml: string;
  connectionId: string;
  createdAt: Date;
  updatedAt: Date;
  isTemporary?: boolean;
  filters?: {
    schemas?: string[];
    tables?: string[];
    hideSystemTables?: boolean;
  };
  // Visual state
  viewport?: Viewport;
  nodePositions?: Record<string, { x: number; y: number }>;
}

interface ERDState {
  views: Record<string, ERDView>;
  activeViewId: string | null;

  // Visual state
  zoom: number;
  position: { x: number; y: number };
  selectedNodeIds: string[];
  highlightedEdgeIds: string[];
  collapsedTableIds: string[];

  // Layout state
  autoLayout: boolean;
  layoutDirection: "TB" | "BT" | "LR" | "RL";

  // Editor state
  editorMode: "visual" | "code" | "split";
  editorReadOnly: boolean;
  editorCollapsed: boolean;

  // Actions - Views
  createView: (name: string, dbml: string, connectionId: string) => ERDView;
  updateView: (id: string, updates: Partial<ERDView>) => void;
  deleteView: (id: string) => void;
  setActiveView: (id: string) => void;

  // Actions - Visual
  toggleTableCollapse: (tableName: string) => void;
  selectTable: (tableName: string, multi?: boolean) => void;
  clearSelection: () => void;
  highlightRelatedTables: (tableName: string) => void;
  clearHighlights: () => void;

  // Actions - Layout
  setAutoLayout: (enabled: boolean) => void;
  setLayoutDirection: (direction: "TB" | "BT" | "LR" | "RL") => void;
  saveNodePosition: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  saveViewport: (viewport: Viewport) => void;

  // Actions - Editor
  setEditorMode: (mode: "visual" | "code" | "split") => void;
  setEditorReadOnly: (readOnly: boolean) => void;
  setEditorCollapsed: (collapsed: boolean) => void;

  // Persistence helpers (used alongside zustand persist)
  saveViewToStorage: (view: ERDView) => Promise<void>;
  loadViewsFromStorage: (connectionId: string) => Promise<void>;
}
```

### 3. ERD Visual Component

```typescript
// src/components/Erd/ERDVisualizer.tsx (planned)

interface ERDVisualizerProps {
  dbml: string;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
  readOnly?: boolean;
  options?: {
    showCardinality?: boolean;
    showIndexes?: boolean;
    collapsedThreshold?: number; // Auto-collapse tables with > N columns
    theme?: "light" | "dark" | "auto";
  };
}

// Custom node component for tables
interface TableNodeProps {
  data: {
    name: string;
    schema?: string;
    columns: Column[];
    indexes?: Index[];
    isCollapsed?: boolean;
    isSelected?: boolean;
    hasRelationships?: boolean;
  };
}

// Custom edge component for relationships
interface RelationshipEdgeProps {
  data: {
    sourceColumn: string;
    targetColumn: string;
    cardinality: "1-1" | "1-n" | "n-1" | "n-n";
    onDelete?: string;
    onUpdate?: string;
    isHighlighted?: boolean;
  };
}
```

### 4. DBML Code Editor (CodeMirror 6)

```typescript
// Use existing CodeEditor (CodeMirror 6)
// Current: language="sql" as placeholder for DBML
// Planned: add language="dbml" mode or use text+validation
// Planned DBML mode features:
// 1) DBML syntax highlighting (Table, Ref, Enum, Note, Indexes)
// 2) Completion for table/column names and types
// 3) Linting via @dbml/core parser diagnostics
// 4) Folding for table blocks
```

### 5. ERD Panel Integration

```typescript
// src/components/Erd/ERDPanel.tsx
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { CodeEditor } from "@/components/CodeEditor";

interface ERDPanelProps {
  connectionId: string;
  tabId: string;
}

const ERDPanel: React.FC<ERDPanelProps> = ({ connectionId, tabId }) => {
  const [mode, setMode] = useState<"visual" | "code" | "split">("visual");
  const [editorCollapsed, setEditorCollapsed] = useState(false);

  return (
    <div className="erd-panel h-full flex flex-col">
      <ERDToolbar
        mode={mode}
        onModeChange={setMode}
        onCreateView={() => {}}
        onExport={() => {}}
      />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Visualizer Panel - Always rendered, never hidden */}
        <ResizablePanel
          defaultSize={mode === "split" ? 60 : 100}
          minSize={30}
          className="erd-visualizer-panel"
          style={{
            display: mode === "code" ? "none" : "block",
            width: mode === "code" ? "0" : undefined,
          }}
        >
          {/* Placeholder until ERDVisualizer is implemented */}
          {/* <ERDVisualizer /> */}
          <div className="h-full flex items-center justify-center text-muted-foreground">
            ERD visualizer coming soon
          </div>
        </ResizablePanel>

        {/* Resizable handle - only in split mode */}
        {mode === "split" && !editorCollapsed && <ResizableHandle />}

        {/* Code Editor Panel */}
        {(mode === "code" || mode === "split") && (
          <ResizablePanel
            defaultSize={mode === "code" ? 100 : 40}
            minSize={20}
            maxSize={mode === "code" ? 100 : 70}
            collapsible={mode === "split"}
            onCollapse={() => setEditorCollapsed(true)}
            onExpand={() => setEditorCollapsed(false)}
            className="erd-editor-panel"
            style={{
              display: editorCollapsed ? "none" : "block",
            }}
          >
            {/* Current: SQL mode used as DBML placeholder */}
            <CodeEditor language="sql" />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {/* Future: Properties panel for selected entities */}
      {/* <ERDProperties selectedEntity={selectedEntity} /> */}
    </div>
  );
};
```

Note: Add a renderer branch for the `erd` tab type in `src/components/Workbench/PanelContentRenderer.tsx` to mount `ERDPanel`, following the existing patterns for query/table/function.

## Features Specification

### 1. Visual Rendering Features

- **Table Representation**

  - Compact card design with schema.table header
  - Column list with type badges
  - Primary key indicators (🔑)
  - Foreign key indicators (🔗)
  - Index indicators (📇)
  - Collapsible beyond 10 columns with count badge

- **Relationship Visualization**

  - Bezier curves for connections
  - Cardinality notation at endpoints (crow's foot notation)
  - Color coding: Primary (blue), Foreign (green)
  - Animated dash pattern on selection
  - Relationship labels on hover

- **Interactive Features**
  - Pan and zoom with mouse/trackpad
  - Mini-map for navigation
  - Table selection highlights all connections
  - Multi-select with Cmd/Ctrl
  - Drag to reposition tables
  - Double-click to expand/collapse
  - Right-click context menu

### 2. Code Editor Features

- **DBML Syntax Support**

  - Syntax highlighting
  - Auto-completion for keywords
  - Table/column name IntelliSense
  - Bracket matching
  - Code folding

- **Validation & Linting**

  - Real-time syntax validation
  - Reference checking (FK targets exist)
  - Type compatibility warnings
  - Duplicate name detection
  - Missing index suggestions

- **Editor Tools**
  - Format document (defer DBML-specific formatting; basic whitespace rules)
  - Find and replace
  - Multi-cursor editing
  - Code snippets
  - Diff view for changes

### 3. View Management

- **View Operations**

  - Create empty view
  - Generate from current schema
  - Clone existing view
  - Filter by schemas/tables
  - Save/load views
  - Export as image (PDF/SQL deferred)

- **Filtering Options**
  - Include/exclude schemas
  - Include/exclude tables by pattern
  - Show only related tables (n-degree)
  - Hide system tables
  - Show only tables with data

### 4. Performance Optimizations

```typescript
// Performance strategies for ReactFlow ERD rendering

// 1. ReactFlow baseline configuration
const erdFlowConfig = {
  // ReactFlow base settings
  deleteKeyCode: null,
  elevateNodesOnSelect: false,
  panOnScroll: false,
  minZoom: 0.1,
  maxZoom: 2,
  // Note: React Flow does not virtualize nodes by default.
  // Keep node render trees light and debounce expensive work.
};

// 2. Lazy node expansion
const useCollapsedTables = () => {
  // Tables with >10 columns start collapsed
  // Expand on user interaction only
  const [expanded, setExpanded] = useState(new Set());
  return {
    expanded,
    toggle: (id) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
  };
};

// 3. Debounced DBML parsing
const useDebouncedParsing = (dbml: string, delay = 500) => {
  const [parsed, setParsed] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setParsed(parseDBML(dbml));
    }, delay);
    return () => clearTimeout(timer);
  }, [dbml, delay]);
  return parsed;
};

// 4. Web Worker for DBML parsing/conversion (planned)
// Use bundler-friendly URL form with Vite/Tauri
const dbmlWorker = new Worker(new URL("./dbml.worker.ts", import.meta.url), {
  type: "module",
});
dbmlWorker.postMessage({ action: "convert", schema });

// 5. ReactFlow with ELK auto-layout
const useAutoLayout = (tables, relationships) => {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    calculateOptimalLayout(tables, relationships).then(setPositions);
  }, [tables, relationships]);

  const nodes = useMemo(
    () =>
      tables.map((table) => ({
        id: table.name,
        type: "tableNode",
        position: positions[table.name] || { x: 0, y: 0 },
        data: { ...table, collapsed: !expanded.has(table.name) },
      })),
    [tables, positions, expanded],
  );

  const edges = useMemo(
    () =>
      relationships.map((rel) => ({
        id: `${rel.from}-${rel.to}`,
        source: rel.from,
        target: rel.to,
        type: "relationshipEdge",
        animated: highlightedEdges.has(`${rel.from}-${rel.to}`),
        data: rel,
      })),
    [relationships, highlightedEdges],
  );

  return { nodes, edges };
};
```

## UX/DX Enhancements

### 1. Smart Layout Algorithm (Using ELK)

```typescript
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

// Automatic table positioning using ELK layered algorithm
const calculateOptimalLayout = async (
  tables: Table[],
  relationships: Relationship[],
) => {
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "50",
      "elk.layered.spacing.nodeNodeBetweenLayers": "50",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children: tables.map((table) => ({
      id: table.name,
      width: 250,
      height: Math.min(100 + table.columns.length * 20, 300), // Collapsed height
    })),
    edges: relationships.map((rel) => ({
      id: `${rel.from_table}_${rel.to_table}`,
      sources: [rel.from_table],
      targets: [rel.to_table],
    })),
  };

  const layouted = await elk.layout(elkGraph);

  // Convert ELK positions to ReactFlow positions
  return layouted.children.reduce(
    (acc, node) => ({
      ...acc,
      [node.id]: { x: node.x, y: node.y },
    }),
    {},
  );
};
```

### 2. Relationship Path Highlighting

```typescript
// Trace relationship paths when table selected
const highlightRelationshipPaths = (
  selectedTable: string,
  depth: number = 2,
) => {
  // Find all connected tables within depth
  // Apply gradient highlighting (stronger = closer)
  // Show cardinality badges
  // Animate the highlight propagation
};
```

### 3. Quick Actions

- **Table Actions**

  - View data (opens table tab)
  - Copy table name
  - Copy CREATE statement
  - Generate SELECT query
  - Show statistics

- **Relationship Actions**
  - View join query
  - Create index suggestion
  - Validate referential integrity
  - Show relationship data

### 4. Search & Navigation

```typescript
interface SearchOptions {
  searchIn: "tables" | "columns" | "all";
  matchCase: boolean;
  useRegex: boolean;
}

const useERDSearch = (query: string, options: SearchOptions) => {
  // Highlight matching entities
  // Zoom to result
  // Show results panel
};
```

## Integration Points

### 1. With Workspace Title Bar & Tab System

```typescript
// In WorkspaceTitleBar.tsx - Add ERD button between SwatchBook and panel toggles
import { GitBranch } from "lucide-react"; // ERD icon

// Add ERD button in the right section before panel toggles
<Button
  variant="ghost"
  size="sm"
  className="h-7 w-7 p-0"
  onClick={handleOpenERD}
  title="Open ERD View"
>
  <GitBranch className="h-3.5 w-3.5" />
</Button>;

// Handler to open ERD in the active/primary panel
const handleOpenERD = () => {
  const { addTabToPanel, getPrimaryPanel, activePanelId } =
    usePanelStore.getState();
  const panelId = activePanelId || getPrimaryPanel()?.id;
  if (panelId) {
    addTabToPanel(panelId, {
      type: "erd",
      connectionId,
      title: "ERD View",
      payload: {
        erdViewId: null, // New ERD view
        erdMode: "visual", // Start in visual mode
      },
    });
  }
};

// Tab creation helper
const createERDTab = (connectionId: string): TabState => ({
  id: generateId(),
  type: "erd",
  connectionId,
  title: "ERD View",
  icon: "diagram",
  payload: {
    erdViewId: null,
    erdMode: "visual",
  },
  // ...
});
```

### 2. With Schema Store

```typescript
// Subscribe to schema changes
useEffect(() => {
  const unsubscribe = schemaStore.subscribe(
    (state) => state.tables,
    (tables) => {
      // Regenerate DBML when schema changes
      if (autoRefresh) {
        regenerateDBML(tables);
      }
    },
  );
  return unsubscribe;
}, []);
```

### 3. With Query Editor

```typescript
// Generate queries from ERD
const generateJoinQuery = (
  table1: string,
  table2: string,
  relationship: Relationship,
) => {
  // Create JOIN query
  // Open in new query tab
  // Pre-populate with relationship conditions
};
```

## Database-Specific Handling

### PostgreSQL

- Support for schemas
- Array types visualization
- Composite types
- Table inheritance
- Materialized views

### MySQL/MariaDB

- No schema support (use database as schema)
- Enum types
- Set types
- Storage engine info

### SQL Server

- Schema support
- Computed columns
- Temporal tables
- Graph tables

### SQLite

- No schema support
- Type affinity
- Virtual tables
- Simplified types

Note: the "Show only tables with data" filter depends on row counts. Availability varies by engine and backend support; provide fallbacks or disable when unavailable.

## Error Handling

```typescript
interface ERDError {
  type: "parsing" | "rendering" | "validation";
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

const handleERDError = (error: ERDError) => {
  // Show inline error in editor
  // Display toast for rendering errors
  // Provide recovery suggestions
  // Fallback to previous valid state
};
```

## Testing Strategy

### Unit Tests

- DBML conversion accuracy
- Relationship extraction
- Parser validation
- Store actions

### Integration Tests

- Schema to ERD flow
- View persistence
- Tab integration
- Cross-database compatibility

### Visual Tests

- Component snapshots
- Layout algorithm
- Theme consistency
- Responsive behavior

### Performance Tests

- Large schema rendering (1000+ tables)
- Real-time editing responsiveness
- Memory usage monitoring
- Layout calculation speed

## Delivery Milestones

### Phase 1: Routing + Skeleton (Week 1)

- [ ] Add ERD tab rendering branch in PanelContentRenderer
- [ ] Create `ERDPanel` with split layout and SQL editor placeholder
- [ ] Wire keyboard context to `erdView` when focused

### Phase 2: DBML + Minimal Visualizer (Week 2)

- [ ] DBML service with basic conversion from `TableStructure`
- [ ] DBML parse/validate (debounced, worker-ready)
- [ ] Minimal React Flow visualizer with collapsed nodes and panning

### Phase 3: Layout + Interaction (Week 3)

- [ ] ELK auto-layout and node positioning persistence
- [ ] Relationship edges with basic cardinality markers
- [ ] Filtering and search (tables/columns)
- [ ] Export as image

### Phase 4: Persistence + Polish (Week 4)

- [ ] View management (save/load JSON-safe)
- [ ] Performance tuning (memoization, chunked updates)
- [ ] Keyboard shortcuts and animations
- [ ] Documentation and tests

## Success Metrics (Targets)

- Performance: render medium schemas quickly; stretch: 500+ tables under 2s
- Responsiveness: strive for 60 FPS interactions on typical schemas
- Memory: keep footprint reasonable (< 200MB on large schemas)
- Accuracy: DBML parser-compliant; verify FKs and columns faithfully
- UX: common actions within a few clicks

## Future Enhancements

1. **Collaborative Features**

   - Share ERD views
   - Real-time collaboration
   - Comments and annotations

2. **AI Integration**

   - Auto-layout suggestions
   - Relationship discovery
   - Naming convention validation

3. **Advanced Visualization**

   - 3D view mode
   - Hierarchical layout
   - Timeline view for migrations

4. **Database Design Mode**
   - Create tables from DBML
   - Generate migrations
   - Schema diff visualization
