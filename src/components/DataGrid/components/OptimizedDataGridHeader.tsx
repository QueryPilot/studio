import { memo, useCallback, useMemo } from "react";
import { flexRender } from "@tanstack/react-table";
import type { Table } from "@tanstack/react-table";
import type { TableDataRow } from "@/services/tableDataTypes";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptimizedDataGridHeaderProps {
  tableInstance: Table<TableDataRow>;
  getAdjustedColumnWidth: (column: { getSize: () => number }, columnIndex?: number) => number;
  isScrolled?: boolean;
  gridTemplateColumns?: string;
}

export const OptimizedDataGridHeader = memo(function OptimizedDataGridHeader({
  tableInstance,
  getAdjustedColumnWidth,
  isScrolled = false,
  gridTemplateColumns,
}: OptimizedDataGridHeaderProps) {
  const handleSort = useCallback(
    (column: { getCanSort: () => boolean; toggleSorting: () => void }) => {
      if (column.getCanSort()) {
        column.toggleSorting();
      }
    },
    [],
  );

  // Get header groups
  const headerGroups = tableInstance.getHeaderGroups();
  
  // Calculate grid template if not provided
  const calculatedGridTemplate = useMemo(() => {
    if (gridTemplateColumns) return gridTemplateColumns;
    
    if (headerGroups.length > 0 && headerGroups[0]?.headers?.length > 0) {
      return headerGroups[0].headers
        .map((header, index) => {
          const width = getAdjustedColumnWidth(header.column, index);
          return `${width}px`;
        })
        .join(' ');
    }
    return '';
  }, [gridTemplateColumns, headerGroups, getAdjustedColumnWidth]);

  if (headerGroups.length === 0) return null;

  return (
    <div 
      className={cn(
        "sticky top-0 z-20 bg-background border-b transition-shadow duration-200",
        isScrolled ? "shadow-sm" : ""
      )} 
      style={{ 
        height: "32px",
        width: 'max-content', // Allow header to extend to full width
        minWidth: '100%', // But at least fill the viewport
        contain: 'layout style paint',
      }}
    >
      {headerGroups.map((headerGroup) => (
        <div 
          key={headerGroup.id} 
          className="h-full w-full"
          style={{
            display: 'grid',
            gridTemplateColumns: calculatedGridTemplate,
          }}
          role="row"
        >
          {headerGroup.headers.map((header) => {
            const column = header.column;
            const isSorted = column.getIsSorted();
            
            return (
              <div
                key={header.id}
                className={cn(
                  "relative px-1.5 text-left text-xs font-semibold",
                  "text-foreground/85 dark:text-foreground/75",
                  "border-r last:border-r-0 h-8",
                  "flex items-center"
                )}
                style={{
                  borderColor: 'hsl(var(--border) / 0.3)',
                }}
                role="columnheader"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 p-0 text-xs font-semibold hover:bg-transparent",
                    "w-full flex items-center justify-between",
                    isSorted && "text-primary",
                  )}
                  onClick={() => handleSort(column)}
                >
                  <span className="truncate">
                    {header.isPlaceholder
                      ? null
                      : flexRender(column.columnDef.header, header.getContext())}
                  </span>
                  <span className="ml-1 flex-shrink-0">
                    {isSorted === "asc" ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : isSorted === "desc" ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : column.getCanSort() ? (
                      <ChevronsUpDown className="h-3 w-3 opacity-50" />
                    ) : null}
                  </span>
                </Button>
                
                {header.column.getCanResize() && (
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={cn(
                      "absolute right-0 top-0 h-full w-1",
                      "cursor-col-resize select-none touch-none",
                      "hover:bg-primary/50 transition-colors",
                      header.column.getIsResizing() && "bg-primary",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});