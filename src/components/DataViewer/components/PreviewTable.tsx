import { memo, useMemo, useState, useRef, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Clipboard, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewTableProps {
  data: Record<string, any>;
}

export const PreviewTable = memo(({ data }: PreviewTableProps) => {
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const previewData = useMemo(
    () =>
      Object.entries(data)
        .filter(([key]) => key !== "_rowIndex")
        .map(([key, value]) => ({ field: key, value })),
    [data],
  );

  // Handle delayed hover for showing copy button
  const handleCellMouseEnter = useCallback((cellId: string) => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // Set new timeout to show button after 300ms
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCell(cellId);
    }, 300);
  }, []);

  const handleCellMouseLeave = useCallback(() => {
    // Clear timeout if mouse leaves before delay
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredCell(null);
  }, []);

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
            <div
              className="group relative h-8 px-2 select-text flex items-center"
              onMouseEnter={() => handleCellMouseEnter(cellId)}
              onMouseLeave={handleCellMouseLeave}
            >
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap truncate select-text">
                {fieldName}
              </span>
              {hoveredCell === cellId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 bg-background/95 rounded"
                  onClick={handleCopy}
                >
                  {copiedCell === cellId ? (
                    <ClipboardCheck className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                </Button>
              )}
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
        cell: ({ getValue, row }) => {
          const value = getValue();
          const isMultiple = value === "(multiple values)";
          const fieldName = row.original.field;
          const cellId = `value-${fieldName}`; // Stable ID based on field name

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
            <div
              className="group relative min-h-[32px] px-2 py-0.5 select-text"
              onMouseEnter={() =>
                value !== null && !isMultiple && handleCellMouseEnter(cellId)
              }
              onMouseLeave={handleCellMouseLeave}
            >
              <div className="pr-6">
                {isMultiple ? (
                  <span className="text-sm text-muted-foreground italic select-text">
                    {value}
                  </span>
                ) : value === null ? (
                  <span className="text-sm text-muted-foreground italic select-text">
                    NULL
                  </span>
                ) : typeof value === "object" ? (
                  <pre className="text-sm whitespace-pre-wrap break-words font-mono select-text">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                ) : typeof value === "boolean" ? (
                  <span
                    className={cn(
                      "text-sm font-mono select-text",
                      value ? "text-green-600" : "text-red-600",
                    )}
                  >
                    {String(value)}
                  </span>
                ) : typeof value === "string" && value.length > 100 ? (
                  <span className="text-sm break-words select-text">
                    {value}
                  </span>
                ) : (
                  <span
                    className="text-sm truncate select-text"
                    title={String(value)}
                  >
                    {String(value)}
                  </span>
                )}
              </div>
              {value !== null && !isMultiple && hoveredCell === cellId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-6 w-6 p-0 bg-background/95 rounded"
                  onClick={handleCopy}
                >
                  {copiedCell === cellId ? (
                    <ClipboardCheck className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          );
        },
      },
    ];
  }, [
    previewData,
    copiedCell,
    hoveredCell,
    handleCellMouseEnter,
    handleCellMouseLeave,
  ]);

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
                className="text-left text-sm font-medium h-9 px-2 bg-muted/30 relative border-r border-border/50 last:border-r-0 select-text"
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
                      header.column.getIsResizing() && "opacity-100 bg-primary",
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
  );
}); // Removed custom comparison to allow internal state updates

PreviewTable.displayName = "PreviewTable";
