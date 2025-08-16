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
    const structureColumns = useMemo<ColumnDef<any>[]>(() => {
      // Calculate the exact width needed for the column name column
      const maxColumnNameLength = Math.max(
        ...tableStructure.map((item) => item.column_name.length),
        6, // Minimum 6 characters (for "Column" header)
      );
      // Use more precise calculation: ~7px per character + padding
      const columnNameWidth = Math.min(maxColumnNameLength * 7 + 24, 250); // Cap at 250px

      return [
        {
          accessorKey: "column_name",
          header: "Column",
          size: columnNameWidth,
          minSize: 60,
          maxSize: 250,
          cell: ({ getValue }) => (
            <div className="h-7 px-2 flex items-center">
              <span
                className="truncate text-sm font-mono"
                title={getValue() as string}
              >
                {getValue() as string}
              </span>
            </div>
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
              <div className="min-h-[32px] px-2 py-0.5 flex items-center">
                <span className="truncate text-sm" title={value}>
                  {value}
                </span>
              </div>
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
              <div className="min-h-[32px] px-2 py-0.5 flex items-center">
                <span
                  className={cn(
                    "px-1 py-0.5 rounded text-sm",
                    value === "YES"
                      ? "bg-yellow-500/20 text-yellow-700"
                      : "bg-green-500/20 text-green-700",
                  )}
                >
                  {value}
                </span>
              </div>
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
              <div className="min-h-[32px] px-2 py-0.5 flex items-center">
                <span
                  className="truncate text-sm font-mono text-muted-foreground"
                  title={value}
                >
                  {value}
                </span>
              </div>
            );
          },
        },
        {
          id: "constraints",
          header: "Constraints",
          size: 120,
          minSize: 80,
          cell: ({ row }) => (
            <div className="min-h-[32px] px-2 py-0.5 flex items-center gap-1">
              {row.original.is_primary_key && (
                <span className="px-1 py-0.5 bg-blue-500/20 text-blue-700 rounded text-sm">
                  PK
                </span>
              )}
              {row.original.is_foreign_key && (
                <span className="px-1 py-0.5 bg-purple-500/20 text-purple-700 rounded text-sm">
                  FK
                </span>
              )}
            </div>
          ),
        },
      ];
    }, [tableStructure]);

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
      <table className="w-full select-none" style={{ tableLayout: "auto" }}>
        <colgroup>
          {structureTable.getAllColumns().map((column, index) => (
            <col
              key={column.id}
              style={{
                width: index === 0 ? `${column.getSize()}px` : undefined,
                minWidth: index === 0 ? `${column.getSize()}px` : "80px",
              }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
          {structureTable.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-left text-sm font-medium h-9 px-2 bg-muted/30 relative border-r border-border/50 last:border-r-0 select-none"
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
                  className="border-r border-border/50 last:border-r-0 align-top select-none"
                  style={{
                    width:
                      cell.column.id === "column_name"
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
  },
);

StructureTable.displayName = "StructureTable";
