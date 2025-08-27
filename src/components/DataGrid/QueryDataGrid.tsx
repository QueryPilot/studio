import { memo } from "react";
import { ScrollArea } from '@/components/ui/scroll-area';
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import { cn } from '@/lib/utils';

interface QueryDataGridProps {
  connectionId: string;
  query: string;
  className?: string;
  data?: {
    columns: string[];
    rows: unknown[][];
  };
}

export const QueryDataGrid = memo(function QueryDataGrid({
  connectionId: _connectionId,
  query: _query,
  className,
  data,
}: QueryDataGridProps) {
  if (!data || !data.rows.length) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground bg-muted/10", className)}>
        <div className="text-center">
          <p className="text-sm">No data to display</p>
          <p className="text-xs mt-1">Execute a query to see results</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col", className)}>
      <ScrollArea className="flex-1">
        <div className="w-full">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-background border-b">
              <tr>
                {data.columns.map((col, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 text-xs font-semibold text-foreground/80 bg-muted/30"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    "hover:bg-muted/30 transition-colors",
                    rowIndex % 2 === 0 && "bg-muted/10"
                  )}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-3 py-1.5 text-xs font-mono border-r border-border/30 last:border-r-0"
                    >
                      {cell === null ? (
                        <span className="text-muted-foreground italic">NULL</span>
                      ) : typeof cell === 'boolean' ? (
                        <span className={cell ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                          {cell.toString().toUpperCase()}
                        </span>
                      ) : typeof cell === 'number' ? (
                        <span className="text-blue-600 font-medium">
                          {cell}
                        </span>
                      ) : typeof cell === 'object' ? (
                        <span className="text-orange-600 text-xs">
                          {JSON.stringify(cell)}
                        </span>
                      ) : (
                        <span className="break-words">
                          {String(cell)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>
      
      {/* Status Bar */}
      <DataGridStatusBar 
        loadedRows={data.rows.length}
      />
    </div>
  );
});