# TanStack Table Grid Implementation Blueprint

## Quick Start Code Examples

### 1. Enhanced useTableData Hook

```typescript
// src/hooks/useInfiniteTableData.ts
import { useMemo, useCallback, useRef, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTableData } from './useTableData';
import type { CellValue, ColumnMeta } from '@/types/database';

export function useInfiniteTableData(params: {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const {
    columns,
    rows,
    hasNextPage,
    isLoading,
    loadData,
    loadMore,
  } = useTableData();

  // Initialize data loading
  useEffect(() => {
    void loadData({
      connectionId: params.connectionId,
      database: params.database,
      table: params.table,
      schema: params.schema,
      limit: 100,
    });
  }, [params.connectionId, params.database, params.table, params.schema]);

  // Create stable column definitions
  const columnDefs = useMemo<ColumnDef<any>[]>(() => 
    columns.map(col => ({
      id: col.name,
      accessorKey: col.name,
      header: col.name,
      size: getColumnSize(col),
      cell: ({ getValue }) => {
        const cellValue = getValue() as CellValue;
        return <CellValueRenderer value={cellValue} column={col} />;
      },
    })),
    [columns]
  );

  // Table instance
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
  });

  // Row virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => 35, []),
    overscan: 10,
  });

  // Infinite scroll detection
  useEffect(() => {
    const [lastItem] = [...rowVirtualizer.getVirtualItems()].reverse();
    
    if (!lastItem) return;
    
    if (
      lastItem.index >= rows.length - 1 &&
      hasNextPage &&
      !isLoading
    ) {
      void loadMore();
    }
  }, [
    hasNextPage,
    loadMore,
    rows.length,
    isLoading,
    rowVirtualizer.getVirtualItems(),
  ]);

  return {
    table,
    rowVirtualizer,
    containerRef,
    isLoading,
    hasNextPage,
  };
}

// Helper functions
function getColumnSize(column: ColumnMeta): number {
  // Size based on data type
  const typeSizes: Record<string, number> = {
    'INTEGER': 80,
    'BIGINT': 100,
    'BOOLEAN': 60,
    'DATE': 100,
    'DATETIME': 150,
    'TIMESTAMP': 150,
    'UUID': 280,
    'JSON': 200,
    'TEXT': 200,
    'VARCHAR': 150,
  };
  
  const dbType = column.db_type.toUpperCase();
  for (const [type, size] of Object.entries(typeSizes)) {
    if (dbType.includes(type)) return size;
  }
  
  return 150; // Default size
}
```

### 2. Cell Value Renderer Component

```typescript
// src/components/cells/CellValueRenderer.tsx
import { memo } from 'react';
import type { CellValue, ColumnMeta } from '@/types/database';
import { cn } from '@/lib/utils';

export const CellValueRenderer = memo(function CellValueRenderer({
  value,
  column,
}: {
  value: CellValue;
  column: ColumnMeta;
}) {
  if (value.value === null) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }

  switch (value.value_type) {
    case 'Integer':
    case 'Decimal':
      return (
        <span className="text-right tabular-nums">
          {formatNumber(value.value, value.metadata)}
        </span>
      );
      
    case 'Boolean':
      return (
        <span className={cn(
          'px-2 py-0.5 rounded text-xs font-medium',
          value.value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        )}>
          {value.value ? 'TRUE' : 'FALSE'}
        </span>
      );
      
    case 'Date':
      return <span>{formatDate(value.value)}</span>;
      
    case 'DateTime':
      return (
        <span className="text-sm">
          {formatDateTime(value.value, value.metadata?.timezone)}
        </span>
      );
      
    case 'Json':
      return (
        <JsonPreview 
          value={value.value} 
          truncated={value.is_truncated}
        />
      );
      
    case 'Binary':
      return (
        <span className="text-xs text-muted-foreground">
          Binary ({formatBytes(value.byte_size || 0)})
        </span>
      );
      
    case 'Uuid':
      return (
        <code className="text-xs bg-muted px-1 rounded">
          {value.value}
        </code>
      );
      
    case 'Text':
    default:
      return (
        <TextCell 
          value={value.value} 
          truncated={value.is_truncated}
          maxLength={value.metadata?.max_length}
        />
      );
  }
});

// Helper components
const TextCell = memo(({ value, truncated, maxLength }: any) => (
  <div className="truncate max-w-xs" title={truncated ? value : undefined}>
    {value}
    {truncated && <span className="text-muted-foreground">...</span>}
  </div>
));

const JsonPreview = memo(({ value, truncated }: any) => {
  const preview = typeof value === 'string' 
    ? value 
    : JSON.stringify(value, null, 2);
    
  return (
    <pre className="text-xs bg-muted p-1 rounded truncate max-w-xs">
      {preview.substring(0, 50)}
      {(truncated || preview.length > 50) && '...'}
    </pre>
  );
});

// Formatting utilities
function formatNumber(value: number, metadata?: any): string {
  if (metadata?.scale !== undefined) {
    return value.toFixed(metadata.scale);
  }
  return value.toLocaleString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string, timezone?: string): string {
  const date = new Date(value);
  return date.toLocaleString() + (timezone ? ` (${timezone})` : '');
}

function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}
```

### 3. Virtual Data Grid Component

```typescript
// src/components/VirtualDataGrid.tsx
import { useInfiniteTableData } from '@/hooks/useInfiniteTableData';
import { flexRender } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';

export function VirtualDataGrid({
  connectionId,
  database,
  table,
  schema,
}: {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}) {
  const {
    table: tableInstance,
    rowVirtualizer,
    containerRef,
    isLoading,
    hasNextPage,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  const { rows } = tableInstance.getRowModel();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows?.[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0)
      : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header */}
      <div className="flex-none overflow-hidden border-b">
        <table className="w-full">
          <thead className="bg-muted/50">
            {tableInstance.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    {/* Resize Handle */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          'inline-block w-1 h-full cursor-col-resize select-none touch-none',
                          header.column.getIsResizing() && 'bg-primary'
                        )}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        </table>
      </div>

      {/* Virtual Body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ contain: 'strict' }}
      >
        <table className="w-full">
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualRows.map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  className="border-b hover:bg-muted/50 transition-colors"
                  style={{ height: `${virtualRow.size}px` }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className="px-2 py-1 text-sm"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">
              Loading more data...
            </span>
          </div>
        )}

        {/* End of Data */}
        {!hasNextPage && rows.length > 0 && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            End of data
          </div>
        )}
      </div>
    </div>
  );
}
```

### 4. Updated TableViewPanel Integration

```typescript
// src/screens/workspace/components/panels/TableViewPanel.tsx
import { VirtualDataGrid } from '@/components/VirtualDataGrid';

export const TableViewPanel = memo(function TableViewPanel({
  tab,
  connectionId,
}: TableViewPanelProps) {
  const payload = tab.payload as TableTabPayload;
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex-none border-b bg-background p-4">
        <h2 className="text-lg font-semibold">
          {payload.schema}.{payload.tableName}
        </h2>
      </div>
      
      <div className="flex-1 min-h-0">
        <VirtualDataGrid
          connectionId={connectionId}
          database={payload.database}
          table={payload.tableName}
          schema={payload.schema}
        />
      </div>
    </div>
  );
});
```

## Installation & Setup

```bash
# Install required packages
pnpm add @tanstack/react-table @tanstack/react-virtual

# Type definitions are included
```

## Performance Optimizations Checklist

- [x] Memoized column definitions
- [x] Virtualized row rendering
- [x] Cell component memoization
- [x] Overscan for smooth scrolling
- [x] Fixed table header
- [x] CSS containment for performance
- [x] Lazy loading for large cells
- [x] Infinite scroll with cursor pagination
- [x] Resize mode optimization
- [x] Type-specific cell renderers

## Testing Scenarios

1. **Large Dataset**: Load 10,000+ rows
2. **Wide Tables**: 50+ columns
3. **Mixed Data Types**: All CellValueTypes
4. **Fast Scrolling**: Maintain 60fps
5. **Resize Columns**: Smooth interaction
6. **Filter/Sort**: Responsive updates

## Next Steps

1. Add column filtering UI
2. Implement sorting controls
3. Add column visibility toggles
4. Implement row selection
5. Add export functionality
6. Implement cell editing (if needed)
7. Add keyboard navigation
8. Implement column pinning