import { memo } from "react";

interface ArrayCellProps {
  value: unknown;
  elementType?: string;
}

export const ArrayCell = memo(function ArrayCell({ value }: ArrayCellProps) {
  const items = Array.isArray(value) ? value : [];
  
  // Format array in PostgreSQL style with curly braces
  if (items.length === 0) {
    return (
      <span className="text-xs text-foreground/80 dark:text-foreground/65 font-mono">
        {}
      </span>
    );
  }
  
  // Format array values with proper spacing
  const formattedItems = items.map((item) => {
    // Handle NULL values in arrays
    if (item === null || item === undefined) {
      return 'NULL';
    }
    // Handle strings with quotes if they contain special characters
    if (typeof item === 'string') {
      // Check if string needs quotes (contains spaces, commas, braces, etc.)
      if (item.includes(',') || item.includes(' ') || item.includes('{') || item.includes('}')) {
        return `"${item.replace(/"/g, '\\"')}"`;
      }
      return item;
    }
    return String(item);
  });
  
  const displayValue = `{${formattedItems.join(',')}}`;
  
  return (
    <span 
      className="text-xs text-foreground/80 dark:text-foreground/65 font-mono truncate block" 
      title={displayValue}
    >
      {displayValue}
    </span>
  );
});