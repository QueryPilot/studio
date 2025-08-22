import { memo, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  getFilteredRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Zap } from "lucide-react";

export interface TableIndex {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
  definition?: string;
}

interface IndexesTableProps {
  indexes: TableIndex[];
  globalFilter?: string;
}

export const IndexesTable = memo(({ indexes, globalFilter }: IndexesTableProps) => {
  const indexColumns = useMemo<ColumnDef<TableIndex>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Index Name",
        size: 200,
        minSize: 100,
        maxSize: 300,
        cell: ({ getValue }) => (
          <div className="h-6 px-2 flex items-center">
            <span
              className="truncate text-xs font-mono"
              title={getValue() as string}
            >
              {getValue() as string}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "columns",
        header: "Columns",
        size: 250,
        minSize: 150,
        maxSize: 400,
        cell: ({ getValue }) => {
          const columns = getValue() as string[];
          return (
            <div className="min-h-[26px] px-2 py-0.5 flex items-center">
              <span className="truncate text-xs" title={columns.join(", ")}>
                {columns.join(", ")}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "index_type",
        header: "Type",
        size: 100,
        minSize: 80,
        maxSize: 150,
        cell: ({ getValue }) => (
          <div className="min-h-[26px] px-2 py-0.5 flex items-center">
            <span className="text-xs uppercase font-medium">
              {getValue() as string}
            </span>
          </div>
        ),
      },
      {
        id: "properties",
        header: "Properties",
        size: 120,
        minSize: 100,
        cell: ({ row }) => (
          <div className="min-h-[26px] px-2 py-0.5 flex items-center gap-1">
            {row.original.is_primary && (
              <span className="px-1 py-0.5 bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium">
                PRIMARY
              </span>
            )}
            {row.original.is_unique && !row.original.is_primary && (
              <span className="px-1 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded text-xs font-medium">
                UNIQUE
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "definition",
        header: "Definition",
        size: 300,
        minSize: 200,
        cell: ({ getValue }) => {
          const def = getValue() as string | undefined;
          if (!def) return <div className="min-h-[26px]" />;

          return (
            <div className="min-h-[26px] px-2 py-0.5 flex items-center">
              <span
                className="truncate text-xs font-mono text-muted-foreground"
                title={def}
              >
                {def}
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  const indexTable = useReactTable({
    data: indexes,
    columns: indexColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      globalFilter,
    },
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 50,
      maxSize: 500,
    },
  });

  if (indexes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">No indexes found for this table</p>
        </div>
      </div>
    );
  }

  return (
    <table className="w-full select-none" style={{ tableLayout: "auto" }}>
      <colgroup>
        {indexTable.getAllColumns().map((column) => (
          <col
            key={column.id}
            style={{
              width: `${String(column.getSize())}px`,
              minWidth: `${String(column.getSize())}px`,
            }}
          />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
        {indexTable.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="border-b">
            {headerGroup.headers.map((header, index) => (
              <th
                key={header.id}
                className={cn(
                  "text-left text-xs font-medium h-7 px-2 bg-muted/30 relative select-none",
                  index !== headerGroup.headers.length - 1 &&
                    "border-r border-border/50",
                  index === 0 &&
                    "sticky left-0 z-50 bg-white/95 dark:bg-background/95 backdrop-blur dark:[backdrop-filter]:bg-background/60 shadow-[2px_0_4px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_4px_rgba(0,0,0,0.2)]",
                )}
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
        {indexTable.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-b hover:bg-muted/30">
            {row.getVisibleCells().map((cell, index) => (
              <td
                key={cell.id}
                className={cn(
                  "border-r border-border/50 last:border-r-0 align-top select-none",
                  index === 0 &&
                    "sticky left-0 z-30 bg-white dark:bg-background/95 dark:[backdrop-filter]:bg-background/60 shadow-[2px_0_2px_rgba(0,0,0,0.03)] dark:shadow-[2px_0_2px_rgba(0,0,0,0.1)]",
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

IndexesTable.displayName = "IndexesTable";
