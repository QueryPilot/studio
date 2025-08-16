# DataViewer Component Architecture

## Overview
The DataViewer component has been refactored into a modular structure for better maintainability and performance optimization.

## Structure

```
DataViewer/
├── index.tsx              # Main exports
├── DataViewer.tsx         # Main component logic
├── types.ts              # TypeScript interfaces and types
├── constants.ts          # Configuration constants
├── utils.ts              # Utility functions
└── components/           # Sub-components
    ├── index.ts          # Component exports
    ├── DraggableHeader.tsx    # Column header with drag & resize
    ├── StructureTable.tsx     # Table structure view
    ├── PreviewTable.tsx       # Row details preview table
    ├── DetailsPanel.tsx       # Details panel container
    ├── SkeletonRow.tsx        # Loading skeleton row
    ├── VirtualRow.tsx         # Virtual scrolling row
    └── Toolbar.tsx            # Main toolbar

```

## Key Features

### Performance Optimizations
- **Virtual Scrolling**: Only renders visible rows using TanStack Virtual
- **Windowed Data**: Keeps max 1000 rows in memory (WINDOW_SIZE)
- **Lazy Loading**: Fetches data in chunks of 100 rows (FETCH_SIZE)
- **Memoization**: All sub-components use React.memo
- **Deferred Selection**: Uses useDeferredValue for selection state

### User Experience
- **Column Reordering**: Drag & drop columns with DnD Kit
- **Column Resizing**: Live resize with visual feedback
- **Row Selection**: Click-drag selection with keyboard shortcuts
- **Details Panel**: Resizable panel with table/JSON views
- **Data/Structure Views**: Toggle between data and schema views

## Component Responsibilities

### DataViewer.tsx
- Main state management
- Data fetching and caching
- Virtual scrolling setup
- Event handlers

### Components

#### Toolbar
- View mode switching (data/structure)
- Global search
- Column visibility controls
- Export functionality

#### DraggableHeader
- Column drag & drop
- Column resizing
- Sort controls

#### VirtualRow
- Row rendering with virtualization
- Selection state visualization
- Click/hover interactions

#### DetailsPanel
- Selected row details
- Table/JSON view modes
- Multi-row selection handling

#### StructureTable
- Table schema display
- Column metadata
- Constraints visualization

## Usage

```tsx
import { DataViewer } from "@/components/DataViewer";

<DataViewer 
  tableName="users"
  schema="public"
  connectionId={connectionId}
  onRowClick={(row) => console.log(row)}
/>
```

## Future Optimizations
- Column virtualization for wide tables
- Web Worker for heavy computations
- IndexedDB caching for offline support
- Incremental search indexing