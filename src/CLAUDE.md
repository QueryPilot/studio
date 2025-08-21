# Frontend (React/TypeScript) Guidelines

## DataViewer Component Architecture

### Component Structure
- **Main Component**: `DataViewer.tsx` - Orchestrates the entire data viewing experience
- **QueryDataViewer**: `QueryDataViewer.tsx` - Adapter component for query results display
- **Sub-components** (in `/components/DataViewer/components/`):
  - `Toolbar.tsx` - Search, column visibility, export functionality
  - `VirtualRow.tsx` - Individual virtualized table rows
  - `DetailsPanel.tsx` - Row details with table/JSON view modes
  - `RowContextMenu.tsx` - Right-click menu for row operations
  - `ColumnContextMenu.tsx` - Column-specific context menu
  - `DraggableHeader.tsx` - Draggable and resizable column headers
  - `PreviewTable.tsx` - Table preview component
  - `StructureTable.tsx` - Table structure display
  - `SkeletonRow.tsx` - Loading state skeleton

### Key Features
- **Virtual Scrolling**: TanStack Virtual for infinite loading of large datasets
- **Row Selection**: Stable selection using row IDs with multi-select support
- **Column Management**: Drag-to-reorder, resize, visibility toggles
- **Context Menus**: Separate menus for rows and columns
- **Search & Filter**: Real-time global search
- **Export**: CSV export functionality
- **Responsive Design**: Compact toolbar with h-6 buttons, h-5 toggles

## Workspace Tab System

### Tab Components (in `/components/workspace/tabs/`)
- **QueryTab**: SQL query editor with Monaco integration
- **ResultTab**: Query execution results display
- **TableTab**: Table data viewer with full DataViewer features
- **SchemaTab**: Database schema browser and structure viewer

### Tab Management
- **TabBar**: Draggable tab bar with SortableTab components
- **TabContent**: Dynamic content rendering based on tab type
- **NewTabButton**: Create new tabs with type selection
- **EmptyState**: Shown when no tabs are open

## UI Component Patterns

### Component Organization
- Use functional components with TypeScript
- Place reusable UI components in `/components/ui/`
- Application-specific components in `/components/`
- Workspace components in `/components/workspace/`
- Screen-level components in `/screens/`

### State Management
- Zustand stores in `/stores/` directory
- Use typed store hooks with TypeScript
- Secure stores prefix with "secure" (e.g., secureConnectionStore)
- **Note**: `editorStore.ts` has a naming conflict (exports `useWorkspaceStore` instead of `useEditorStore`)

### Styling Conventions
- Tailwind CSS for utility-first styling
- shadcn/ui components with Radix UI primitives
- Custom styles in `/styles/` directory
- Use `cn()` helper from `/lib/utils` for conditional classes

### Security Practices
- Never store sensitive data in plain text
- Use encryption services from `/services/secureStorage`
- Clear sensitive data from memory after use
- Validate all user inputs with Zod schemas

### Monaco Editor Integration
- Use `@monaco-editor/react` for SQL editing
- Configure with SQL language support
- Theme follows app theme (light/dark)

### Form Handling
- TanStack Form for form state management
- Zod for schema validation
- Use form adapters for type safety

### Query Management
- TanStack Query for server state
- Query keys in consistent format
- Optimistic updates where appropriate

### Virtual Scrolling
- Use TanStack Virtual for large lists
- Implement infinite scrolling with `FETCH_SIZE` and `WINDOW_SIZE` constants
- Preserve scroll position when layout changes
- Calculate total column width for proper horizontal scrolling

### Drag & Drop
- DnD Kit for sortable columns
- Separate drag handles from resize handles
- Use `restrictToHorizontalAxis` modifier for column reordering

### Data Table Implementation Details
- **Column Resizing**: Live preview with resize handles separate from drag handles
- **Column Reordering**: DnD Kit with `restrictToHorizontalAxis` modifier
- **Selection Management**: 
  - Shift+click for range selection
  - Cmd/Ctrl+click for individual selection
  - Select all with Cmd/Ctrl+A
- **Performance**:
  - `FETCH_SIZE = 100` rows per batch
  - `WINDOW_SIZE = 1000` max rows in memory
  - Deferred value for selection state updates
- **Sticky Headers**: `bg-background/95 backdrop-blur` for transparency effect

## Performance Optimizations
- Memoize expensive components with `React.memo`
- Use `useDeferredValue` for selection state updates
- Implement windowing for large datasets (keep max 1000 rows in memory)
- Cache table data and schema with `cacheService`
- Avoid layout thrashing by calculating widths upfront
- Use `contain: strict` CSS for better scroll performance