import { memo, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Copy, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewTableProps {
  data: Record<string, any>;
}

// Use deep comparison for memo to prevent re-renders on reference changes
const arePropsEqual = (prev: PreviewTableProps, next: PreviewTableProps) => {
  // Quick equality check for same reference
  if (prev.data === next.data) return true;

  // Deep comparison of data keys and values
  const prevKeys = Object.keys(prev.data).sort();
  const nextKeys = Object.keys(next.data).sort();

  if (prevKeys.length !== nextKeys.length) return false;

  // Check if all keys and values are the same
  return prevKeys.every((key, index) => {
    return key === nextKeys[index] && prev.data[key] === next.data[key];
  });
};

export const PreviewTable = memo(({ data }: PreviewTableProps) => {
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const previewData = useMemo(
    () =>
      Object.entries(data)
        .filter(([key]) => key !== "_rowIndex")
        .map(([key, value]) => ({ field: key, value })),
    [data],
  );

  const autoSizedColumns = useMemo<
    ColumnDef<{ field: string; value: any }>[]
  >(() => {
    // Calculate the exact width needed for the field column
    const maxFieldLength = Math.max(
      ...previewData.map((item) => item.field.length),
      5, // Minimum 5 characters (for "Field" header)
    );
    // Use more precise calculation: ~7px per character + padding
    const fieldWidth = Math.min(maxFieldLength * 7 + 24, 250); // Cap at 250px

    return [
      {
        accessorKey: "field",
        header: "Field",
        size: fieldWidth,
        minSize: 60,
        maxSize: 250,
        cell: ({ getValue }) => {
          const fieldName = getValue() as string;
          const cellId = `field-${fieldName}`;
          
          const handleCopy = () => {
            navigator.clipboard.writeText(fieldName);
            setCopiedCell(cellId);
            setTimeout(() => setCopiedCell(null), 3000);
          };
          
          return (
            <div className="group flex items-center justify-between h-7 px-2 select-text">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap truncate select-text flex-1 mr-1">
                {fieldName}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleCopy}
              >
                {copiedCell === cellId ? (
                  <ClipboardCheck className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          );
        },
      },
      {
        accessorKey: "value",
        header: "Value",
        size: undefined, // Let it take remaining space
        minSize: 150,
        maxSize: undefined,
        cell: ({ getValue }) => {
          const value = getValue();
          const isMultiple = value === "(multiple values)";
          const cellId = `value-${Math.random()}`; // Unique ID for copy tracking
          
          const handleCopy = () => {
            let textToCopy = "";
            if (value === null) {
              textToCopy = "NULL";
            } else if (typeof value === "object") {
              textToCopy = JSON.stringify(value, null, 2);
            } else {
              textToCopy = String(value);
            }
            
            navigator.clipboard.writeText(textToCopy);
            setCopiedCell(cellId);
            setTimeout(() => setCopiedCell(null), 3000);
          };
          
          return (
            <div className="group flex items-center justify-between min-h-[28px] px-2 py-0.5 select-text relative">
              <div className="flex-1 mr-1">
                {isMultiple ? (
                  <span className="text-xs text-muted-foreground italic select-text">{value}</span>
                ) : value === null ? (
                  <span className="text-xs text-muted-foreground italic select-text">NULL</span>
                ) : typeof value === "object" ? (
                  <pre className="text-xs whitespace-pre-wrap break-words font-mono select-text">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                ) : typeof value === "boolean" ? (
                  <span
                    className={cn(
                      "text-xs font-mono select-text",
                      value ? "text-green-600" : "text-red-600",
                    )}
                  >
                    {String(value)}
                  </span>
                ) : typeof value === "string" && value.length > 100 ? (
                  <span className="text-xs break-words select-text">{value}</span>
                ) : (
                  <span className="text-xs truncate select-text" title={String(value)}>{String(value)}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleCopy}
              >
                {copiedCell === cellId ? (
                  <ClipboardCheck className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          );
        },
      },
    ];
  }, [previewData]);

  const previewTable = useReactTable({
    data: previewData,
    columns: autoSizedColumns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 50,
      maxSize: 500,
    },
  });

  return (
    <div className="overflow-auto w-full">
      <table className="w-full select-text" style={{ tableLayout: "auto" }}>
        <colgroup>
          {previewTable.getAllColumns().map((column, index) => (
            <col
              key={column.id}
              style={{
                width: index === 0 ? `${column.getSize()}px` : undefined,
                minWidth: index === 0 ? `${column.getSize()}px` : "150px",
              }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
          {previewTable.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-left text-xs font-medium h-7 px-2 bg-muted/30 relative border-r border-border/50 last:border-r-0 select-text"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                  {header.column.getCanResize() && (
                    <div
                      className={cn(
                        "absolute top-0 right-0 w-1 h-full cursor-col-resize select-none touch-none opacity-0 hover:opacity-100 hover:bg-primary/20",
                        header.column.getIsResizing() &&
                          "opacity-100 bg-primary",
                      )}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {previewTable.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="border-r border-border/50 last:border-r-0 align-top select-text"
                  style={{
                    width:
                      cell.column.id === "field"
                        ? `${cell.column.getSize()}px`
                        : undefined,
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}, arePropsEqual); // Use custom comparison function

PreviewTable.displayName = "PreviewTable";
