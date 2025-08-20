# P1-002: Virtual Data Grid Implementation

## Priority
P1 - Core Feature

## Dependencies
- P0-004: Cursor Management (provides paginated data)
- P1-003: Column Metadata (needs column info for rendering)

## Estimated Effort  
6-8 hours

## Problem Statement
Current data grid loads all rows into DOM, causing severe performance issues with tables >1000 rows. No virtualization means excessive memory usage and laggy scrolling.

## Acceptance Criteria
- [ ] Only visible rows are rendered in DOM
- [ ] Smooth scrolling for 100k+ rows
- [ ] Column virtualization for wide tables (100+ columns)
- [ ] Maintains scroll position on data refresh
- [ ] Selection state preserved during scrolling
- [ ] Sticky header with column resize handles

## Implementation Notes

### Virtual Grid Setup (React/TypeScript)
```typescript
// src/components/DataViewer/VirtualDataGrid.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState, useMemo } from 'react';

interface VirtualDataGridProps {
  columns: ColumnMeta[];
  rows: string[][];
  estimatedRowHeight?: number;
  estimatedColumnWidth?: number;
  onCellEdit?: (rowIndex: number, columnIndex: number, value: string) => void;
}

export function VirtualDataGrid({
  columns,
  rows,
  estimatedRowHeight = 32,
  estimatedColumnWidth = 150,
  onCellEdit,
}: VirtualDataGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Selection state
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  
  // Column widths
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  
  // Row virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 5,  // Render 5 extra rows above/below viewport
  });
  
  // Column virtualizer for horizontal scrolling
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => columnWidths[index] || estimatedColumnWidth,
    overscan: 3,
  });
  
  // Calculate total dimensions
  const totalHeight = rowVirtualizer.getTotalSize();
  const totalWidth = columnVirtualizer.getTotalSize();
  
  // Get visible items
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  
  // Memoize visible data
  const visibleData = useMemo(() => {
    return virtualRows.map(virtualRow => ({
      row: rows[virtualRow.index],
      virtualRow,
      cells: virtualColumns.map(virtualColumn => ({
        value: rows[virtualRow.index][virtualColumn.index],
        virtualColumn,
        columnMeta: columns[virtualColumn.index],
      })),
    }));
  }, [virtualRows, virtualColumns, rows, columns]);
  
  return (
    <div ref={containerRef} className="relative flex flex-col h-full">
      {/* Sticky Header */}
      <div 
        className="sticky top-0 z-10 bg-background border-b"
        style={{ width: totalWidth }}
      >
        <div className="flex">
          {/* Row number header */}
          <div className="sticky left-0 z-20 bg-background border-r px-2 py-1 w-16">
            #
          </div>
          
          {/* Column headers */}
          {virtualColumns.map(virtualColumn => (
            <div
              key={virtualColumn.key}
              className="flex items-center justify-between border-r"
              style={{
                position: 'absolute',
                left: 0,
                transform: `translateX(${virtualColumn.start}px)`,
                width: virtualColumn.size,
              }}
            >
              <span className="px-2 py-1 truncate">
                {columns[virtualColumn.index].name}
              </span>
              
              {/* Resize handle */}
              <div
                className="w-1 h-full cursor-col-resize hover:bg-primary"
                onMouseDown={(e) => handleColumnResize(virtualColumn.index, e)}
              />
            </div>
          ))}
        </div>
      </div>
      
      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onScroll={(e) => {
          // Sync header scroll
          if (containerRef.current) {
            const header = containerRef.current.querySelector('.sticky');
            if (header) {
              header.scrollLeft = e.currentTarget.scrollLeft;
            }
          }
        }}
      >
        {/* Virtual spacer for correct scrollbar */}
        <div
          style={{
            height: totalHeight,
            width: totalWidth,
            position: 'relative',
          }}
        >
          {/* Rendered rows */}
          {visibleData.map(({ row, virtualRow, cells }) => (
            <div
              key={virtualRow.key}
              className={cn(
                "absolute top-0 left-0 flex",
                selectedRows.has(virtualRow.index) && "bg-accent"
              )}
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                width: totalWidth,
              }}
            >
              {/* Row number */}
              <div 
                className="sticky left-0 z-10 bg-background border-r px-2 py-1 w-16 text-muted-foreground"
                onClick={() => toggleRowSelection(virtualRow.index)}
              >
                {virtualRow.index + 1}
              </div>
              
              {/* Cells */}
              {cells.map(({ value, virtualColumn, columnMeta }) => {
                const cellKey = `${virtualRow.index}-${virtualColumn.index}`;
                const isSelected = selectedCells.has(cellKey);
                
                return (
                  <div
                    key={virtualColumn.key}
                    className={cn(
                      "absolute border-r border-b px-2 py-1",
                      isSelected && "bg-primary/10"
                    )}
                    style={{
                      left: virtualColumn.start,
                      width: virtualColumn.size,
                    }}
                    onClick={() => toggleCellSelection(cellKey)}
                    onDoubleClick={() => startCellEdit(
                      virtualRow.index,
                      virtualColumn.index
                    )}
                  >
                    <CellRenderer
                      value={value}
                      columnMeta={columnMeta}
                      isEditing={false}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {/* Status bar */}
      <div className="border-t px-2 py-1 text-sm text-muted-foreground">
        Showing rows {virtualRows[0]?.index + 1 || 0}-
        {virtualRows[virtualRows.length - 1]?.index + 1 || 0} of {rows.length}
      </div>
    </div>
  );
  
  function handleColumnResize(columnIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[columnIndex] || estimatedColumnWidth;
    
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      
      setColumnWidths(prev => ({
        ...prev,
        [columnIndex]: newWidth,
      }));
      
      // Recalculate virtualizer
      columnVirtualizer.measure();
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
  
  function toggleRowSelection(rowIndex: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  }
  
  function toggleCellSelection(cellKey: string) {
    setSelectedCells(prev => {
      const next = new Set(prev);
      if (next.has(cellKey)) {
        next.delete(cellKey);
      } else {
        next.add(cellKey);
      }
      return next;
    });
  }
}

// Cell renderer based on type
function CellRenderer({ 
  value, 
  columnMeta, 
  isEditing 
}: {
  value: string;
  columnMeta: ColumnMeta;
  isEditing: boolean;
}) {
  // Delegate to appropriate cell component based on type
  if (columnMeta.db_type.includes('INT') || 
      columnMeta.db_type.includes('DECIMAL')) {
    return <NumericCell value={value} columnMeta={columnMeta} isEditing={isEditing} />;
  }
  
  if (columnMeta.db_type.includes('BOOL')) {
    return <BooleanCell value={value} isEditing={isEditing} />;
  }
  
  if (columnMeta.db_type.includes('JSON')) {
    return <JsonCell value={value} isEditing={isEditing} />;
  }
  
  // Default text cell
  return <TextCell value={value} isEditing={isEditing} />;
}
```

### Performance Optimizations
```typescript
// src/hooks/useVirtualGrid.ts
export function useVirtualGrid({
  data,
  columns,
  pageSize = 1000,
}) {
  // Fetch more data when approaching end
  useEffect(() => {
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current || {};
    
    if (scrollHeight - scrollTop - clientHeight < 500) {
      // Within 500px of bottom, fetch next page
      fetchNextPage();
    }
  }, [scrollTop]);
  
  // Debounced column resize
  const debouncedResize = useMemo(
    () => debounce((index: number, width: number) => {
      saveColumnWidth(index, width);
    }, 300),
    []
  );
  
  // Memoize heavy computations
  const processedData = useMemo(() => {
    return data.map(row => processRow(row, columns));
  }, [data, columns]);
  
  return {
    processedData,
    // ...
  };
}
```

## Files to Modify
- Create `src/components/DataViewer/VirtualDataGrid.tsx` - Main virtual grid
- Create `src/hooks/useVirtualGrid.ts` - Virtual grid logic
- Update `src/components/DataViewer/index.tsx` - Use new virtual grid
- Create cell components in `src/components/cells/`
- Update `src/stores/uiStore.ts` - Track column widths

## Testing Requirements
1. **Performance Tests**
   - Load 100k rows, measure initial render time
   - Scroll performance should be 60fps
   - Memory usage should stay constant

2. **Functionality Tests**
   - Column resize persists
   - Selection survives scrolling
   - Edit mode works correctly

3. **Manual Testing**
   - Test with various data types
   - Test with 200+ columns
   - Test on low-end hardware

## Success Metrics
- Initial render < 100ms for any data size
- Smooth 60fps scrolling
- Memory usage < 200MB for 100k rows
- No scroll position jumping

## Notes
- Consider implementing keyboard navigation
- May need custom scrollbars for better control
- Future: Cell range selection with Shift+Click