/**
 * Sticky table header component with column titles and sorting
 */
import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type ColumnDefinition, VIRTUALIZATION_CONFIG } from '../types';

interface TableHeaderProps {
  columns: ColumnDefinition[];
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  className?: string;
}

const TableHeader = memo(function TableHeader({
  columns,
  sortColumn,
  sortDirection,
  onSort,
  className,
}: TableHeaderProps) {
  
  const handleSort = useCallback((columnId: string) => {
    if (!onSort) return;
    
    if (sortColumn === columnId) {
      // Toggle direction if same column
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      onSort(columnId, newDirection);
    } else {
      // Default to ascending for new column
      onSort(columnId, 'asc');
    }
  }, [sortColumn, sortDirection, onSort]);

  const renderSortIcon = (columnId: string, sortable: boolean) => {
    if (!sortable) return null;
    
    if (sortColumn === columnId) {
      return sortDirection === 'asc' ? (
        <ChevronUp className="h-3 w-3 ml-1" />
      ) : (
        <ChevronDown className="h-3 w-3 ml-1" />
      );
    }
    
    return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-50" />;
  };

  const totalWidth = columns.reduce((acc, col) => 
    acc + (col.width || VIRTUALIZATION_CONFIG.DEFAULT_COLUMN_WIDTH), 0
  );

  return (
    <div
      className={cn(
        "flex border-b bg-background/95 backdrop-blur sticky top-0 z-10 shadow-sm",
        className
      )}
      style={{ 
        height: VIRTUALIZATION_CONFIG.HEADER_HEIGHT,
        minWidth: totalWidth,
      }}
    >
      {columns.map((column) => (
        <div
          key={`header-${column.id}`}
          className={cn(
            "flex items-center px-2 border-r last:border-r-0 bg-muted/20 flex-shrink-0",
            column.sticky === 'left' && "sticky left-0 z-20",
            column.sticky === 'right' && "sticky right-0 z-20"
          )}
          style={{
            width: column.width || VIRTUALIZATION_CONFIG.DEFAULT_COLUMN_WIDTH,
            minWidth: column.minWidth || VIRTUALIZATION_CONFIG.MIN_COLUMN_WIDTH,
            maxWidth: column.maxWidth || VIRTUALIZATION_CONFIG.MAX_COLUMN_WIDTH,
          }}
        >
          {column.sortable ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto p-1 -m-1 justify-start text-left font-medium text-xs",
                "hover:bg-muted/50 transition-colors w-full"
              )}
              onClick={() => handleSort(column.id)}
              title={`Sort by ${column.name}`}
            >
              <span className="truncate flex-1">{column.name}</span>
              {renderSortIcon(column.id, column.sortable)}
            </Button>
          ) : (
            <div
              className="flex items-center w-full font-medium text-xs text-muted-foreground"
              title={`${column.name} (${column.dbType})`}
            >
              <span className="truncate flex-1">{column.name}</span>
            </div>
          )}
          
          {/* Column metadata indicator - only show for numeric types */}
          <div className="flex items-center ml-1 gap-1">
            {column.metadata?.precision && 
             column.valueType !== 'Text' && 
             column.valueType !== 'Unknown' && (
              <span 
                className="text-xs text-muted-foreground/60"
                title={`Precision: ${column.metadata.precision}${column.metadata.scale ? `, Scale: ${column.metadata.scale}` : ''}`}
              >
                ({column.metadata.precision}{column.metadata.scale ? `,${column.metadata.scale}` : ''})
              </span>
            )}
            {column.editable && (
              <div
                className="w-1.5 h-1.5 rounded-full bg-green-500"
                title="Editable column"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
});

export { TableHeader };