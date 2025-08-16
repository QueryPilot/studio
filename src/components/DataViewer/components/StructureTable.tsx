import { memo, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { TableColumn } from "../types";

interface StructureTableProps {
  tableStructure: TableColumn[];
}

export const StructureTable = memo(
  ({ tableStructure }: StructureTableProps) => {
    const structureColumns = useMemo<ColumnDef<any>[]>(
      () => [
        {
          accessorKey: "column_name",
          header: "Column",
          size: 150,
          minSize: 100,
          maxSize: 300,
          cell: ({ getValue }) => (
            <span
              className="block truncate text-xs font-mono"
              title={getValue() as string}
            >
              {getValue() as string}
            </span>
          ),
        },
        {
          accessorKey: "data_type",
          header: "Type",
          size: 120,
          minSize: 80,
          maxSize: 200,
          cell: ({ row }) => {
            const value = `${row.original.data_type}${
              row.original.character_maximum_length
                ? ` (${row.original.character_maximum_length})`
                : ""
            }`;
            return (
              <span className="block truncate text-xs" title={value}>
                {value}
              </span>
            );
          },
        },
        {
          accessorKey: "is_nullable",
          header: "Nullable",
          size: 80,
          minSize: 60,
          maxSize: 120,
          cell: ({ getValue }) => {
            const value = getValue() as string;
            return (
              <span
                className={cn(
                  "px-1 py-0.5 rounded text-xs",
                  value === "YES"
                    ? "bg-yellow-500/20 text-yellow-700"
                    : "bg-green-500/20 text-green-700",
                )}
              >
                {value}
              </span>
            );
          },
        },
        {
          accessorKey: "column_default",
          header: "Default",
          size: 150,
          minSize: 100,
          maxSize: 250,
          cell: ({ getValue }) => {
            const value = String(getValue() || "-");
            return (
              <span
                className="block truncate text-xs font-mono text-muted-foreground"
                title={value}
              >
                {value}
              </span>
            );
          },
        },
        {
          id: "constraints",
          header: "Constraints",
          size: 120,
          minSize: 80,
          cell: ({ row }) => (
            <div className="flex gap-1">
              {row.original.is_primary_key && (
                <span className="px-1 py-0.5 bg-blue-500/20 text-blue-700 rounded text-xs">
                  PK
                </span>
              )}
              {row.original.is_foreign_key && (
                <span className="px-1 py-0.5 bg-purple-500/20 text-purple-700 rounded text-xs">
                  FK
                </span>
              )}
            </div>
          ),
        },
      ],
      [],
    );

    const structureTable = useReactTable({
      data: tableStructure,
      columns: structureColumns,
      getCoreRowModel: getCoreRowModel(),
      enableColumnResizing: true,
      columnResizeMode: "onChange",
      defaultColumn: {
        minSize: 50,
        maxSize: 500,
      },
    });

    return (
      <div className="h-full overflow-auto">
        <table className="w-full" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {structureTable.getAllColumns().map((column, index) => {
              const isLast =
                index === structureTable.getAllColumns().length - 1;
              return (
                <col
                  key={column.id}
                  style={{
                    width: isLast ? undefined : column.getSize(),
                    minWidth: column.getSize(),
                  }}
                />
              );
            })}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {structureTable.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left text-xs font-medium px-2 py-1 bg-muted/50 relative border-r border-border/50"
                    style={{ width: header.getSize() }}
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
            {structureTable.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b hover:bg-muted/30">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="text-xs px-2 py-1 border-r border-border/50 overflow-hidden"
                    style={{
                      width: cell.column.getSize(),
                      maxWidth: cell.column.getSize(),
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
  },
);

StructureTable.displayName = "StructureTable";
