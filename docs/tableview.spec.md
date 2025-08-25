# TableView Component Specification

## Overview

This specification outlines the implementation of a comprehensive TableViewPanel component with a reusable DataTable that supports virtualization, editing, selection, and advanced features for database table visualization.

## Architecture

### Core Components Structure

```
src/components/DataTable/
├── index.ts                     # Main exports
├── DataTable.tsx               # Main virtualized table component
├── types.ts                    # TypeScript interfaces
├── hooks/
│   ├── useSelection.ts         # Selection state management
│   ├── useVirtualization.ts    # Virtual scrolling logic
│   └── useEditMode.ts          # Edit state management
├── components/
│   ├── TableCell.tsx           # Generic cell wrapper
│   ├── TableHeader.tsx         # Sticky header component
│   ├── TableSkeleton.tsx       # Loading skeleton (10 rows)
│   ├── PreviewPanel.tsx        # Bottom preview panel
│   └── ContextMenu.tsx         # Right-click context menu
└── cells/
    ├── StringCell.tsx          # Text type renderer + editor
    ├── NumberCell.tsx          # Integer/Decimal renderer + editor
    ├── DateCell.tsx           # Date/DateTime/Time renderer + editor
    ├── BooleanCell.tsx        # Boolean renderer + editor
    ├── JsonCell.tsx           # JSON renderer + editor
    ├── UuidCell.tsx           # UUID renderer + editor
    ├── BinaryCell.tsx         # Binary data renderer
    ├── ArrayCell.tsx          # Array type renderer
    ├── GeometryCell.tsx       # Spatial data renderer
    ├── XmlCell.tsx            # XML data renderer
    ├── EnumCell.tsx           # Enum type renderer + editor
    └── UnknownCell.tsx        # Fallback renderer
```

### TableViewPanel Structure

```
src/screens/workspace/components/panels/TableViewPanel.tsx
├── Tab Navigation (Data, Structure, Indexes, Triggers)
├── DataTable Integration
└── Panel State Management
```

## Implementation Phases

### Phase 1: Core DataTable Foundation

**Duration**: 2-3 days

**Tasks**:
- [x] Install and configure TanStack Virtual
- [x] Create DataTable component with basic virtualization
- [x] Implement CellValue type system
- [x] Create basic TableCell wrapper
- [x] Add TableSkeleton loading component
- [x] Implement sticky header with CSS position
- [x] Set up column definition system

**Key Files**:
- `src/components/DataTable/DataTable.tsx`
- `src/components/DataTable/hooks/useVirtualization.ts`
- `src/components/DataTable/components/TableCell.tsx`
- `src/components/DataTable/components/TableSkeleton.tsx`
- `src/components/DataTable/types.ts`

**Success Criteria**:
- Smooth scrolling with 10,000+ rows
- Render time < 100ms for viewport changes
- Proper virtualization in both directions

### Phase 2: Selection & Interaction System

**Duration**: 2-3 days

**Tasks**:
- [x] Implement row selection (single + range)
- [x] Add cell selection for editing
- [x] Create keyboard navigation (arrow keys, Shift+click, Ctrl+click)
- [x] Build basic context menu system
- [x] Add click-drag range selection

**Key Files**:
- `src/components/DataTable/hooks/useSelection.ts`
- `src/components/DataTable/components/ContextMenu.tsx`

**Success Criteria**:
- Intuitive selection behavior
- No selection state conflicts
- Proper keyboard navigation

### Phase 3: Cell System & Editing

**Duration**: 3-4 days

**Tasks**:
- [x] Create type-specific cell renderers for all CellValueTypes
- [x] Implement double-click edit mode
- [x] Add hover actions with delayed transitions
- [x] Create cell-specific editors
- [x] Implement copy functionality
- [x] Add edit mode validation

**Key Files**:
- `src/components/DataTable/cells/` (all cell components)
- `src/components/DataTable/hooks/useEditMode.ts`

**Success Criteria**:
- All CellValueTypes render correctly
- Edit mode works for each cell type
- Hover actions respond appropriately

### Phase 4: Preview Panel & Advanced Features

**Duration**: 2-3 days

**Tasks**:
- [x] Create bottom preview panel
- [x] Implement Table view mode (field/value pairs)
- [x] Add JSON view mode
- [x] Enhance context menu with copy formats
- [x] Add delete row functionality
- [x] Implement export features

**Key Files**:
- `src/components/DataTable/components/PreviewPanel.tsx`

**Success Criteria**:
- Preview panel useful and responsive
- Context menu actions work correctly
- Export functionality complete

### Phase 5: TableViewPanel Integration

**Duration**: 1-2 days

**Tasks**:
- [x] Integrate DataTable into TableViewPanel
- [x] Create tab system (Data, Structure, Indexes, Triggers)
- [x] Implement data loading coordination
- [x] Add filtering and sorting integration
- [x] Connect to backend table data streaming

**Key Files**:
- `src/screens/workspace/components/panels/TableViewPanel.tsx`

**Success Criteria**:
- All tabs work correctly
- Data loading seamless
- Integration with workspace panels

## Technical Specifications

### DataTable Component Interface

```typescript
interface DataTableProps<T = Record<string, CellValue>> {
  // Data & Structure
  data: T[]
  columns: ColumnDefinition[]
  isLoading: boolean
  
  // Data Loading
  onLoadMore: () => void
  hasNextPage: boolean
  
  // Selection
  selectedRows: Set<string>
  onRowSelect: (rows: T[], mode: 'single' | 'range' | 'toggle') => void
  
  // Editing
  onCellEdit: (rowId: string, field: string, value: CellValue) => void
  editableColumns?: Set<string>
  
  // Actions
  onRowDelete: (rows: T[]) => void
  onCopyRows: (rows: T[], format: 'json' | 'csv' | 'insert') => void
  
  // UI State
  showPreviewPanel?: boolean
  previewMode?: 'table' | 'json'
  onPreviewModeChange?: (mode: 'table' | 'json') => void
}
```

### Column Definition

```typescript
interface ColumnDefinition {
  id: string
  name: string
  dbType: string
  valueType: CellValueType
  width?: number
  minWidth?: number
  maxWidth?: number
  resizable?: boolean
  sortable?: boolean
  filterable?: boolean
  editable?: boolean
  sticky?: 'left' | 'right'
  metadata?: CellMetadata
}
```

### Selection State

```typescript
interface SelectionState {
  selectedRows: Set<string>
  selectedCells: Set<string> // "rowId:columnId" format
  anchorRow?: string
  focusRow?: string
  selectionMode: 'row' | 'cell' | 'range'
}
```

### Edit State

```typescript
interface EditState {
  editingCell: string | null // "rowId:columnId" format
  editingValue: CellValue | null
  isValidValue: boolean
  originalValue: CellValue | null
}
```

## Cell Renderer System

Each cell type implements the `CellRendererProps` interface:

```typescript
interface CellRendererProps {
  value: CellValue
  rowId: string
  columnId: string
  isSelected: boolean
  isEditing: boolean
  isHovered: boolean
  
  // Actions
  onEdit: (value: CellValue) => void
  onCopy: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  
  // Metadata
  column: ColumnDefinition
  rowIndex: number
  columnIndex: number
}
```

### Cell Type Implementations

**StringCell**:
- Plain text display with truncation
- Text input editor
- Copy functionality
- Multi-line support for large text

**NumberCell**:
- Right-aligned display
- Thousands separators for integers
- Precision/scale formatting for decimals
- Number input editor with validation

**DateCell**:
- Locale-aware date formatting
- Date/time picker editor
- Timezone support for DateTime types

**BooleanCell**:
- Checkbox display
- Toggle editor
- True/false text alternatives

**JsonCell**:
- Syntax highlighted display
- Collapsible structure
- JSON editor with validation
- Pretty-print formatting

**BinaryCell**:
- Hex representation
- Download/view options
- Size indicators
- Read-only (no editing)

## Virtualization Strategy

### TanStack Virtual Configuration

```typescript
const virtualConfig = {
  // Row virtualization
  rowVirtualizer: useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  }),
  
  // Column virtualization
  columnVirtualizer: useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => columns[index].width || DEFAULT_COLUMN_WIDTH,
    overscan: 2,
  }),
}
```

### Performance Optimizations

- **Memo Strategy**: Use `React.memo` for cell components with shallow comparison
- **Key Strategy**: Use stable keys based on `rowId:columnId` format
- **Render Optimization**: Only render visible cells + overscan
- **Event Delegation**: Single event handlers on table container
- **Debouncing**: Debounce selection updates and edit operations

## Context Menu System

### Row Context Menu Actions

```typescript
const rowContextMenuActions = [
  { label: "Open Preview Panel", action: "preview", icon: "Eye" },
  { label: "Copy as JSON", action: "copy:json", icon: "Copy" },
  { label: "Copy as CSV", action: "copy:csv", icon: "Copy" },
  { label: "Copy as INSERT", action: "copy:insert", icon: "Copy" },
  { type: "separator" },
  { label: "Delete Row(s)", action: "delete", icon: "Trash", variant: "destructive" },
]
```

### Copy Formats

**JSON Format**:
```json
[
  {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

**CSV Format**:
```csv
id,name,email,created_at
1,"John Doe","john@example.com","2024-01-15T10:30:00Z"
```

**INSERT Format**:
```sql
INSERT INTO users (id, name, email, created_at) 
VALUES (1, 'John Doe', 'john@example.com', '2024-01-15T10:30:00Z');
```

## Preview Panel System

### Table View Mode

```
┌─────────────┬─────────────────────────────────────┐
│ Field       │ Value                               │
├─────────────┼─────────────────────────────────────┤
│ id          │ 1                                   │
│ name        │ John Doe                            │
│ email       │ john@example.com                    │
│ created_at  │ 2024-01-15T10:30:00Z               │
└─────────────┴─────────────────────────────────────┘
```

For multiple rows selected: Show "Multiple values" for differing fields, shared values for identical fields.

### JSON View Mode

Syntax-highlighted JSON with expandable structures:

```json
{
  "id": 1,
  "name": "John Doe", 
  "email": "john@example.com",
  "created_at": "2024-01-15T10:30:00Z",
  "profile": {
    "age": 30,
    "location": "San Francisco"
  }
}
```

## TableViewPanel Tab System

### Data Tab
- Main DataTable with full functionality
- Filtering and sorting controls
- Pagination controls
- Row count and statistics

### Structure Tab
- Column metadata table
- Data types and constraints
- Primary/foreign key indicators
- Column statistics

### Indexes & Constraints Tab
- Index definitions and performance metrics
- Constraint information
- Relationship diagrams

### Triggers Tab
- Trigger definitions
- Event information (INSERT/UPDATE/DELETE)
- Timing (BEFORE/AFTER)
- Enable/disable controls

## Error Handling & Loading States

### Loading States

**Initial Load**:
- TableSkeleton with 10 placeholder rows
- Skeleton cells match column structure

**Infinite Loading**:
- Loading indicator at bottom of table
- Smooth transition between pages

**Edit Loading**:
- Cell spinner during save operations
- Optimistic updates with rollback

### Error States

**Connection Errors**:
- Retry mechanism
- Clear error messaging
- Graceful fallback

**Edit Errors**:
- Validation feedback
- Field-level error indicators
- Rollback to previous value

**Data Loading Errors**:
- Error boundary
- Partial data display when possible
- Refresh functionality

## Accessibility

### Keyboard Navigation

- Arrow keys: Cell navigation
- Tab/Shift+Tab: Focus management  
- Space: Select/deselect rows
- Enter: Start editing
- Escape: Cancel editing
- Ctrl+A: Select all
- Delete: Delete selected rows

### Screen Reader Support

- Proper ARIA labels
- Row/column headers
- Selection state announcements
- Edit mode indicators

### Visual Accessibility

- High contrast mode support
- Focus indicators
- Color-blind friendly selection
- Keyboard-only operation

## Testing Strategy

### Unit Tests

- Cell renderer correctness
- Selection state management
- Edit operations
- Virtualization calculations

### Integration Tests

- Data loading and pagination
- Context menu interactions
- Preview panel functionality
- Tab switching

### Performance Tests

- Large dataset rendering (10k+ rows)
- Scroll performance
- Memory usage profiling
- Edit operation latency

### E2E Tests

- Complete user workflows
- Cross-browser compatibility
- Accessibility compliance
- Mobile responsiveness

## Dependencies

### Required Packages (Already Available)

- `@tanstack/react-virtual`: ^3.13.12
- `@radix-ui/react-context-menu`: ^2.2.15
- `@radix-ui/react-tabs`: ^1.1.12
- `@dnd-kit/core`: ^6.3.1 (for future drag operations)

### Development Dependencies

- React DevTools Profiler for performance monitoring
- Testing utilities for virtualization testing

## Performance Targets

### Render Performance
- Initial render: < 100ms for 10k rows
- Scroll performance: 60fps sustained
- Cell edit latency: < 50ms

### Memory Usage
- Virtual window: 1000 rows maximum
- Cell recycling for efficient memory use
- Proper cleanup of event listeners

### Data Loading
- Progressive loading with smooth UX
- 100-500 rows per chunk
- Background prefetching

## Future Enhancements

### Phase 6: Advanced Features (Future)
- Column filtering UI
- Advanced search with regex
- Column grouping and aggregation  
- Export to multiple formats
- Print functionality
- Themes and customization

### Phase 7: Performance Optimizations (Future)
- Web Workers for data processing
- IndexedDB caching
- Service Worker integration
- Progressive Web App features

## Implementation Checklist

### Setup Phase
- [x] Create DataTable component structure
- [x] Set up TypeScript interfaces
- [x] Configure TanStack Virtual

### Core Implementation
- [x] **Phase 1**: Core DataTable Foundation
- [x] **Phase 2**: Selection & Interaction System  
- [x] **Phase 3**: Cell System & Editing
- [x] **Phase 4**: Preview Panel & Advanced Features
- [x] **Phase 5**: TableViewPanel Integration

### Quality Assurance
- [ ] Unit test coverage > 80%
- [ ] Integration tests for key workflows
- [ ] Performance benchmarking
- [ ] Accessibility audit
- [ ] Cross-browser testing

### Documentation
- [ ] Component API documentation
- [ ] Usage examples
- [ ] Performance guidelines
- [ ] Troubleshooting guide

## Risk Mitigation

### High-Risk Areas

**Virtualization Performance**:
- **Risk**: Scroll stuttering or layout thrashing
- **Mitigation**: Extensive testing with large datasets, fallback to simpler virtualization

**Selection State Complexity**:
- **Risk**: State conflicts and synchronization issues  
- **Mitigation**: Simple state management, comprehensive test coverage

**Edit Mode Conflicts**:
- **Risk**: Multiple edit states causing data corruption
- **Mitigation**: Single edit state, proper event handling, validation

**Memory Leaks**:
- **Risk**: Event listeners and DOM references not cleaned up
- **Mitigation**: Proper cleanup in useEffect, React DevTools monitoring

### Fallback Plans

- **TanStack Virtual Issues**: Fallback to React Window
- **Complex Selection**: Simplify to row-only selection
- **Edit Conflicts**: Implement row-level locking
- **Performance Issues**: Reduce feature complexity

## Success Metrics

### User Experience
- Smooth scrolling performance (60fps)
- Intuitive selection behavior
- Quick edit operations (< 50ms latency)
- Responsive context menus

### Developer Experience
- Clean component interfaces
- Comprehensive TypeScript types
- Good documentation
- Easy to extend and customize

### Technical Metrics
- Bundle size impact < 100KB
- Memory usage < 50MB for 10k rows
- Test coverage > 80%
- No accessibility violations

---

## Phase 6: Real Data Integration ✅ COMPLETED

**Duration**: 1 day

**Tasks**:
- [x] Create TableDataService for `db_table_data` command integration
- [x] Implement TableDataTypes with discriminated unions for type safety
- [x] Create useTableData React hook for component integration  
- [x] Map ColumnMeta to ColumnDefinition in TableViewPanel
- [x] Replace mock data with real database calls
- [x] Implement proper error handling and loading states
- [x] Add streaming support with pagination
- [x] Fix TypeScript strict type checking

**Key Files**:
- `src/services/tableDataService.ts` - Service for managing table data streaming
- `src/services/tableDataTypes.ts` - Complete type definitions with discriminated unions
- `src/hooks/useTableData.ts` - React hook for easy component integration
- `src/screens/workspace/components/panels/TableViewPanel.tsx` - Updated to use real data

**Implementation Details**:

### TableDataService Architecture
- Event-based streaming using Tauri's `db_table_data` command
- Automatic timeout management (30 seconds)
- Proper cleanup of resources and event listeners
- Type-safe parameter validation
- Stream state tracking for multiple concurrent streams

### Type Safety Features  
- Discriminated unions for FilterSpec ensuring compile-time validation
- Complete CellValue type system integration
- No `any` types used - strict TypeScript compliance
- Proper null/undefined handling throughout

### React Hook Integration
- Manages loading, streaming, and error states
- Automatic cleanup on component unmount
- Pagination support with `loadMore()` function
- Refresh functionality with `refresh()` function
- Memory-safe state updates with mounted component checks

### Database Type Mapping
- Comprehensive mapping from database types to CellValue types
- Support for all major database systems (PostgreSQL, MySQL, SQLite, MSSQL, MariaDB)
- Proper handling of nullable fields, precision, scale
- Primary key detection for row identification

**Success Criteria**:
- ✅ Real database connections working
- ✅ Streaming data loading with proper pagination
- ✅ Error states handled gracefully
- ✅ TypeScript strict mode with no errors
- ✅ Memory leaks prevented with proper cleanup
- ✅ All database types mapped correctly

---

This specification provides a comprehensive roadmap for implementing a high-performance, feature-rich DataTable component that will serve as the foundation for database table visualization in DevDB Studio.