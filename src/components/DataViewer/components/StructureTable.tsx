import { memo, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  getFilteredRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { type TableColumn } from "../types";

interface StructureTableProps {
  tableStructure: TableColumn[];
  globalFilter?: string;
}

export const StructureTable = memo(
  ({ tableStructure, globalFilter }: StructureTableProps) => {
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
              <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                <span className="truncate text-xs" title={value}>
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
              <div className="min-h-[26px] px-2 py-0.5 flex items-center">
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
              </div>
            );
          },
        },
        {
          id: "constraints",
          header: "Constraints",
          size: 150,
          minSize: 100,
          cell: ({ row }) => (
            <div className="min-h-[26px] px-2 py-0.5 flex items-center gap-1">
              {row.original.is_primary_key && (
                <span
                  className="px-1 py-0.5 bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium"
                  title="Primary Key"
                >
                  PK
                </span>
              )}
              {row.original.is_foreign_key && (
                <span
                  className="px-1 py-0.5 bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded text-xs font-medium"
                  title="Foreign Key"
                >
                  FK
                </span>
              )}
              {row.original.is_unique && !row.original.is_primary_key && (
                <span
                  className="px-1 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded text-xs font-medium"
                  title="Unique"
                >
                  UQ
                </span>
              )}
              {row.original.is_indexed &&
                !row.original.is_primary_key &&
                !row.original.is_unique && (
                  <span
                    className="px-1 py-0.5 bg-green-500/20 text-green-700 dark:text-green-400 rounded text-xs font-medium"
                    title="Indexed"
                  >
                    IX
                  </span>
                )}
            </div>
          ),
        },
        {
          id: "references",
          header: "References",
          size: 200,
          minSize: 120,
          maxSize: 300,
          cell: ({ row }) => {
            const fkRef = row.original.fk_reference;
            if (!fkRef) {
              return (
                <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                  <span className="text-xs text-muted-foreground">-</span>
                </div>
              );
            }

            return (
              <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                <span
                  className="px-1 py-0.5 bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded text-xs font-medium truncate cursor-pointer hover:bg-purple-500/30"
                  title={`${fkRef.referenced_table}.${fkRef.referenced_column}\nON DELETE: ${fkRef.on_delete}\nON UPDATE: ${fkRef.on_update}`}
                  onClick={() => {
                    // TODO: Navigate to referenced table
                    console.log("Navigate to:", fkRef.referenced_table);
                  }}
                >
                  {fkRef.referenced_table}.{fkRef.referenced_column}
                </span>
              </div>
            );
          },
        },
        {
          id: "check_constraint",
          header: "Check",
          size: 200,
          minSize: 100,
          maxSize: 400,
          cell: ({ row }) => {
            const checkConstraint = row.original.check_constraint;
            if (!checkConstraint) {
              return (
                <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                  <span className="text-xs text-muted-foreground">-</span>
                </div>
              );
            }

            return (
              <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                <span
                  className="truncate text-xs font-mono text-muted-foreground"
                  title={checkConstraint}
                >
                  {checkConstraint}
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
              <div className="min-h-[26px] px-2 py-0.5 flex items-center">
                <span
                  className="truncate text-xs font-mono text-muted-foreground"
                  title={value}
                >
                  {value}
                </span>
              </div>
            );
          },
        },
      ];
    }, [tableStructure]);

    const structureTable = useReactTable({
      data: tableStructure,
      columns: structureColumns,
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

    return (
      <table className="w-full select-none" style={{ tableLayout: "auto" }}>
        <colgroup>
          {structureTable.getAllColumns().map((column, index) => (
            <col
              key={column.id}
              style={{
                width:
                  index === 0 ? `${String(column.getSize())}px` : undefined,
                minWidth:
                  index === 0 ? `${String(column.getSize())}px` : "80px",
              }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
          {structureTable.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header, index) => (
                <th
                  key={header.id}
                  className={cn(
                    "text-left text-xs font-medium h-7 px-2 bg-muted/30 relative select-none",
                    index !== headerGroup.headers.length - 1 &&
                      "border-r border-border/50",
                    index === 0 &&
                      "sticky left-0 z-50 bg-white/95 dark:bg-background/95 [backdrop-filter]:bg-background/60 shadow-[2px_0_4px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_4px_rgba(0,0,0,0.2)]",
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
              {row.getVisibleCells().map((cell, index) => (
                <td
                  key={cell.id}
                  className={cn(
                    "border-r border-border/50 last:border-r-0 align-top select-none",
                    index === 0 &&
                      "sticky left-0 z-30 bg-white dark:bg-background/95 [backdrop-filter]:bg-background/60 shadow-[2px_0_2px_rgba(0,0,0,0.03)] dark:shadow-[2px_0_2px_rgba(0,0,0,0.1)]",
                  )}
                  style={{
                    width:
                      cell.column.id === "column_name"
                        ? `${String(cell.column.getSize())}px`
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
