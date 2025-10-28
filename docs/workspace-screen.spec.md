# Workspace Screen & Window Manager Implementation Plan

## Overview

This document outlines the complete implementation plan for the workspace screen and window manager for Query Pilot. The workspace screen is the main interface where users interact with database connections, browse schemas, execute queries, and manage data.

## Architecture Overview

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    TitleBar                                     │
│  [←][↻][🔒][DB] Connection Name | PostgreSQL v15.2    [⚙][≡][≡] │
├──────────┬─────────────────────────────────────┬───────────────┤
│          │                                      │               │
│   Left   │        Main Content Area             │     Right     │
│  Sidebar │                                      │    Sidebar    │
│          │  Panel 1 (Primary)                   │               │
│ Database │  ┌─────────────────────────────┐    │      AI       │
│  Objects │  │ Tab Bar: [Table][Query][+]  │    │   Assistant   │
│          │  ├─────────────────────────────┤    │               │
│  Tables  │  │ Content Area               │    │   - Chat      │
│  Views   │  │                             │    │   - Suggest   │
│ Functions│  ├─────────────────────────────┤    │   - Explain   │
│          │  │ Data Preview (collapsible) │    │   - Generate  │
│          │  └─────────────────────────────┘    │               │
│          │  ─────────────────────────────      │               │
│          │  Panel 2 (Secondary - Optional)      │               │
│          │  ┌─────────────────────────────┐    │               │
│          │  │ Tab Bar: [Result][Schema]   │    │               │
│          │  ├─────────────────────────────┤    │               │
│          │  │ Content Area               │    │               │
│          │  ├─────────────────────────────┤    │               │
│          │  │ Data Preview (if needed)   │    │               │
│          │  └─────────────────────────────┘    │               │
├──────────┴─────────────────────────────────────┴───────────────┤
│ StatusBar: ● Connected | 42 rows | 125ms | Ready               │
└─────────────────────────────────────────────────────────────────┘
```

**Note:** Each panel has its own tab bar. Data preview appears at the bottom of TableViewPanel and QueryPanel. The right sidebar is reserved for AI features.

## Component Architecture

### 1. Window Manager System

#### Service: `windowManager.ts`

**Purpose:** Manages multiple workspace windows, one per database connection

**Core Functionality:**
- Track open windows by connection ID
- Prevent duplicate windows for same connection
- Handle window lifecycle (create, focus, close)
- Persist window state (size, position)
- Cross-window communication

**API Design:**
```typescript
interface WindowManager {
  openWorkspace(connectionId: string): Promise<string>
  closeWorkspace(connectionId: string): void
  focusWorkspace(connectionId: string): void
  getActiveWindows(): Map<string, WindowInfo>
  isWorkspaceOpen(connectionId: string): boolean
  broadcastToWorkspaces(event: string, data: any): void
}
```

### 2. Workspace Screen Components

#### Main Container: `WorkspaceScreen.tsx`

**Responsibilities:**
- Layout orchestration
- State initialization
- Event handling
- Panel management

#### Component Hierarchy:

```
WorkspaceScreen
├── WorkspaceTitleBar
│   ├── NavigationControls (left)
│   ├── ConnectionInfo (center)
│   └── ToolbarActions (right)
├── DatabaseSidebar (left)
│   ├── SchemaSelector
│   ├── SearchInput
│   └── ObjectTreeView
│       ├── Tables
│       ├── Views
│       └── Functions
├── MainContentArea
│   └── SplitPanelContainer
│       ├── Panel (primary)
│       │   ├── PanelTabBar
│       │   │   └── Tabs[]
│       │   └── PanelContent
│       │       ├── TableViewPanel
│       │       │   ├── TableDataGrid
│       │       │   └── DataPreviewPane (bottom, collapsible)
│       │       ├── QueryPanel
│       │       │   ├── MonacoEditor
│       │       │   └── QueryResultsPane (bottom, collapsible)
│       │       ├── SchemaViewPanel
│       │       ├── FunctionViewPanel
│       │       └── ResultPanel
│       └── Panel (secondary, optional)
│           ├── PanelTabBar
│           │   └── Tabs[]
│           └── PanelContent
│               └── [Same panel types]
├── AISidebar (right)
│   ├── ChatInterface
│   ├── QuerySuggestions
│   ├── CodeExplainer
│   ├── SQLGenerator
│   └── OptimizationHints
└── WorkspaceStatusBar
    ├── ConnectionStatus
    ├── QueryMetrics
    └── SystemMessages
```

### 3. State Management

#### Enhanced Type System

```typescript
// Panel manages its own tabs
export interface PanelState {
  id: string
  type: 'primary' | 'secondary'
  tabs: Map<string, TabState>
  tabOrder: string[]
  activeTabId: string | null
  width?: number  // For vertical split
  height?: number // For horizontal split
}

// Tab knows its parent panel
export interface TabState {
  id: string
  type: TabType
  connectionId: string
  panelId: string  // NEW: Which panel owns this tab
  title: string
  icon?: string
  payload: TabPayload
  ui: TabUIState
  isDirty: boolean
  isLoading: boolean
  error?: string
  createdAt: Date
  lastAccessedAt: Date
}

// Workspace manages panels instead of tabs directly
export interface WorkspaceState {
  id: string
  name: string
  connectionIds: string[]
  activeConnectionId: string | null
  
  // Panel management (replaces direct tab management)
  panels: Map<string, PanelState>
  activePanelId: string
  splitMode: 'none' | 'horizontal' | 'vertical'
  splitPosition: number // 0-1 percentage
  
  // UI state
  sidebars: {
    left: boolean
    right: boolean
  }
  
  settings: WorkspaceSettings
  createdAt: Date
  updatedAt: Date
  lastOpened: Date
}
```

#### Store: `workspaceScreenStore.ts`

```typescript
interface WorkspaceScreenStore {
  // Panel operations
  splitPanel(direction: 'horizontal' | 'vertical'): void
  unsplitPanel(): void
  setActivePanel(panelId: string): void
  
  // Tab operations (panel-aware)
  addTab(panelId: string, tab: Partial<TabState>): string
  closeTab(tabId: string, panelId: string): void
  moveTab(tabId: string, fromPanelId: string, toPanelId: string): void
  
  // Tab state within panel
  setActiveTab(panelId: string, tabId: string): void
  updateTab(panelId: string, tabId: string, updates: Partial<TabState>): void
  
  // Sidebar toggles
  toggleSidebar(side: 'left' | 'right'): void
  
  // Window management
  windows: Map<string, WindowLabel>
  registerWindow(connectionId: string, windowLabel: string): void
  unregisterWindow(connectionId: string): void
}
```

#### Store: `schemaStore.ts`

```typescript
interface SchemaState {
  schemas: Map<string, SchemaInfo[]>
  tables: Map<string, TableInfo[]>
  views: Map<string, ViewInfo[]>
  functions: Map<string, FunctionInfo[]>
  selectedSchema: string
  searchQuery: string
  expandedNodes: Set<string>
  loading: boolean
  lastRefreshed: Date
}
```

## Implementation Phases

### Phase 1: Foundation Infrastructure

1. **Window Manager Service**
   - Implement Tauri WebviewWindow integration
   - Create window registry and lifecycle methods
   - Add window state persistence

2. **Basic Workspace Screen**
   - Create main layout container
   - Implement CSS Grid structure
   - Add placeholder components

3. **Routing Setup**
   - Add workspace route handler
   - Implement connection ID parameter handling
   - Setup navigation from main screen

### Phase 2: Essential UI Components

1. **WorkspaceTitleBar**
   - Connection info display
   - Navigation controls (disconnect, reload)
   - Sidebar toggle buttons
   - Settings dropdown

2. **WorkspaceStatusBar**
   - Connection status indicator
   - Query execution metrics
   - System messages display

3. **Basic Layout**
   - Sidebar containers
   - Main content area
   - Responsive design

### Phase 3: Database Explorer

1. **DatabaseSidebar Implementation**
   - Schema selector dropdown
   - Search/filter input
   - Tree view structure
   - Lazy loading nodes

2. **Object Management**
   - Table listing with icons
   - View listing
   - Function/procedure listing
   - Context menus

3. **Performance Optimization**
   - Virtual scrolling for large lists
   - Debounced search
   - Cached schema data

### Phase 4: Tab Management System

1. **Tab Manager Component**
   - Tab creation and switching
   - Tab types (Query, Table, Schema, Result)
   - Drag to reorder
   - Close/duplicate actions

2. **Tab State Management**
   - Integration with existing TabState types
   - State persistence
   - Dirty state tracking
   - Tab restoration

3. **Tab Content Rendering**
   - Dynamic component loading
   - State preservation
   - Error boundaries

### Phase 5: Split Panel Implementation

1. **Split Container**
   - Horizontal/vertical split modes
   - Resizable divider
   - Min/max size constraints
   - Collapsible panels

2. **Panel Management**
   - Panel focus tracking
   - Synchronized scrolling option
   - Panel swap functionality
   - Keyboard navigation

3. **State Synchronization**
   - Split ratio persistence
   - Panel content state
   - Layout preferences

### Phase 6: AI Assistant Sidebar

1. **AI Sidebar Implementation**
   - Chat interface for database questions
   - Context-aware SQL suggestions
   - Natural language to SQL conversion
   - Query explanation and documentation

2. **AI Features**
   - Schema understanding and suggestions
   - Query optimization recommendations
   - Error diagnosis and fixes
   - Best practices guidance

3. **Data Preview Integration**
   - Bottom pane in TableViewPanel
   - Collapsible preview in QueryPanel
   - Quick data sampling
   - Statistics and metadata display

## Panel Operations

### Split Panel Logic

1. **Splitting a Panel**:
   - Create new `PanelState` with unique ID
   - Move active tab from primary to secondary panel
   - Update `tab.panelId` to reference new panel
   - Set secondary panel as active
   - Adjust split ratio (default 50/50)

2. **Closing Tabs**:
   - Remove tab from parent panel's tab list
   - If last tab in secondary panel → remove panel (unsplit)
   - If last tab in primary panel → show empty state
   - Update focus to nearest tab

3. **Tab Migration**:
   - Drag tab between panel tab bars
   - Update `tab.panelId` to target panel
   - Remove from source panel, add to target
   - Maintain tab state during transfer

4. **Unsplitting**:
   - Move all tabs from secondary to primary
   - Update all `panelId` references
   - Remove secondary panel
   - Reset split mode to 'none'

### Panel Component Types

```typescript
// Base interface for all panel components
interface PanelComponentProps {
  tab: TabState
  connectionId: string
  isActive: boolean
  onUpdate: (updates: Partial<TabState>) => void
  onClose: () => void
}

// Specific implementations with their layouts
TableViewPanel     // Table data grid with DataViewer + bottom data preview pane
QueryPanel         // Monaco SQL editor + bottom query results pane
SchemaViewPanel    // Database schema structure browser
FunctionViewPanel  // Function/procedure source code viewer
ResultPanel        // Standalone query results grid
ERDPanel          // Entity relationship diagram viewer
```

## Backend Integration

### Required Tauri Commands

```rust
// Schema exploration
db_get_schemas(connection_id: String) -> Vec<SchemaInfo>
db_get_tables(connection_id: String, schema: String) -> Vec<TableInfo>
db_get_views(connection_id: String, schema: String) -> Vec<ViewInfo>
db_get_functions(connection_id: String, schema: String) -> Vec<FunctionInfo>

// Data preview
db_get_table_preview(connection_id: String, schema: String, table: String, limit: u32) -> QueryResult
db_get_table_info(connection_id: String, schema: String, table: String) -> TableMetadata
db_get_column_info(connection_id: String, schema: String, table: String) -> Vec<ColumnInfo>

// Window management
window_register(connection_id: String, window_label: String) -> Result<()>
window_unregister(connection_id: String) -> Result<()>
window_get_state(connection_id: String) -> WindowState
```

## Technical Stack

### Core Libraries
- **Window Management:** `@tauri-apps/api/window`
- **Split Panels:** `react-resizable-panels`
- **Virtualization:** `@tanstack/react-virtual`
- **Tree View:** Custom implementation with shadcn/ui
- **State Management:** Zustand (existing)
- **Query Management:** TanStack Query (existing)

### UI Components
- **Base Components:** shadcn/ui (existing)
- **Icons:** Lucide React (existing)
- **Styling:** Tailwind CSS (existing)
- **Themes:** CSS variables with theme provider (existing)

## Performance Targets

### Metrics
- **Window Switching:** < 100ms
- **Initial Schema Load:** < 1 second
- **Panel Resizing:** 60 FPS
- **Tree Expansion:** < 50ms
- **Search Response:** < 200ms
- **Memory Usage:** < 100MB per 1000 tables

### Optimization Strategies
- Virtual scrolling for large lists
- Lazy loading for tree nodes
- Schema data caching (5-minute TTL)
- Debounced search (300ms)
- Request deduplication
- Progressive data loading

## Event System

### Window Events
```typescript
workspace:opened    // New workspace window created
workspace:closed    // Workspace window closed
workspace:focused   // Workspace window gained focus
workspace:resized   // Window dimensions changed
```

### Connection Events
```typescript
connection:ready    // Connection established
connection:error    // Connection error occurred
connection:closed   // Connection terminated
connection:health   // Health status changed
```

### Schema Events
```typescript
schema:loaded       // Schema data fetched
schema:selected     // Schema selection changed
schema:refreshed    // Schema data updated
object:selected     // Table/view/function selected
```

### Tab Events
```typescript
tab:created         // New tab opened
tab:activated       // Tab switched
tab:closed          // Tab closed
tab:modified        // Tab content changed
```

## Error Handling

### Connection Errors
- Display clear error messages in status bar
- Offer reconnection options
- Preserve workspace state for recovery
- Log errors for debugging

### Data Loading Errors
- Show inline error states
- Provide retry mechanisms
- Fallback to cached data when available
- Graceful degradation

### Window Management Errors
- Handle window creation failures
- Manage orphaned windows
- Clean up on unexpected closure
- Restore window state on restart

## Security Considerations

- Never expose credentials in window titles or URLs
- Use secure IPC for cross-window communication
- Sanitize all database object names in UI
- Implement proper SQL injection prevention
- Clear sensitive data on window close

## Testing Strategy

### Unit Tests
- Store actions and reducers
- Service layer methods
- Utility functions
- Component logic

### Integration Tests
- Window lifecycle management
- Database command integration
- State synchronization
- Event propagation

### E2E Tests
- Complete workflow scenarios
- Multi-window interactions
- Error recovery flows
- Performance benchmarks

## Success Criteria

1. **Functionality**
   - All specified features working
   - Smooth multi-window management
   - Reliable database exploration
   - Stable split panel operation

2. **Performance**
   - Meeting all performance targets
   - Smooth UI interactions
   - Efficient memory usage
   - Fast data loading

3. **User Experience**
   - Intuitive navigation
   - Responsive design
   - Clear error messages
   - Consistent behavior

4. **Code Quality**
   - TypeScript strict mode compliance
   - Comprehensive error handling
   - Well-documented code
   - Maintainable architecture

## Updated File Structure

```
src/
├── screens/
│   └── workspace/
│       ├── WorkspaceScreen.tsx              # Main workspace container
│       └── components/
│           ├── WorkspaceTitleBar.tsx        # Top title bar
│           ├── DatabaseSidebar.tsx          # Left sidebar (schema explorer)
│           ├── AISidebar.tsx                # Right sidebar (AI assistant)
│           ├── WorkspaceStatusBar.tsx       # Bottom status bar
│           ├── SplitPanelContainer.tsx      # Split view container
│           ├── Panel.tsx                    # Panel wrapper with tab bar
│           ├── PanelTabBar.tsx              # Tab bar for each panel
│           └── panels/                      # Specific panel implementations
│               ├── TableViewPanel.tsx       # Table data viewer
│               ├── QueryPanel.tsx           # SQL query editor
│               ├── SchemaViewPanel.tsx      # Schema structure browser
│               ├── FunctionViewPanel.tsx    # Function/procedure viewer
│               ├── ResultPanel.tsx          # Query results display
│               └── ERDPanel.tsx             # Entity relationship diagram
│
├── services/
│   ├── windowManager.ts                     # Window lifecycle management
│   └── schemaService.ts                     # Database schema operations
│
├── stores/
│   ├── workspaceScreenStore.ts              # Workspace UI state with panel management
│   ├── schemaStore.ts                       # Database objects cache
│   └── panelStore.ts                        # Panel and tab state management
│
├── hooks/
│   ├── useWorkspaceWindow.ts                # Window management hook
│   ├── useSchemaExplorer.ts                 # Schema browsing hook
│   ├── usePanelSplit.ts                     # Split panel operations
│   └── useTabManagement.ts                  # Tab operations within panels
│
└── types/
    └── workspaceScreen.ts                   # Enhanced types with panel hierarchy
```

## Next Steps

1. Review and approve this specification
2. Set up development environment
3. Begin Phase 1 implementation
4. Create tracking issues for each phase
5. Establish testing procedures
6. Plan incremental releases