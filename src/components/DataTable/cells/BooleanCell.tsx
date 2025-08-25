import { memo } from 'react';
import { cn } from '@/lib/utils';
// import { Check, X } from 'lucide-react'; // Not used with badge display
import type { CellRendererProps } from '../types';

export const BooleanCell = memo(function BooleanCell({
  value,
  isSelected,
  isHovered,
  onEdit,
  onStartEdit,
  column,
}: CellRendererProps) {
  const boolValue = value?.value_type === 'Boolean' ? value.value : null;
  
  const handleClick = () => {
    if (column.editable !== false) {
      onEdit({ 
        value_type: 'Boolean', 
        value: boolValue === null ? true : !boolValue,
        db_type: value?.db_type || 'BOOLEAN',
        is_truncated: false
      });
    }
  };
  
  const handleDoubleClick = () => {
    if (column.editable !== false) {
      onStartEdit();
      handleClick();
    }
  };
  
  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "px-2 py-1 text-sm flex items-center cursor-default truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
        column.editable !== false && "cursor-pointer"
      )}
      title={boolValue === null ? 'NULL' : boolValue ? 'true' : 'false'}
    >
      {boolValue === true && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          true
        </span>
      )}
      {boolValue === false && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          false
        </span>
      )}
      {boolValue === null && (
        <span className="text-muted-foreground text-xs">NULL</span>
      )}
    </div>
  );
});