import { memo } from "react";
import type { Row } from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";
import { CellValueRenderer } from "../cells/CellValueRenderer";
import { CellWithCopy } from "./CellWithCopy";
import { cn } from "@/lib/utils";

interface DataGridRowProps {
  virtualItem: VirtualItem;
  row: Row<TableDataRow> | undefined;
  tableWidth: number;
  columns: ColumnMeta[];
  getAdjustedColumnWidth: (column: { getSize: () => number }, columnIndex?: number) => number;
  isLastRow?: boolean;
}

export const DataGridRow = memo(function DataGridRow({
  virtualItem,
  row,
  tableWidth,
  columns,
  getAdjustedColumnWidth,
  isLastRow = false,
}: DataGridRowProps) {
  if (!row) return null;

  return (
    <div
      key={virtualItem.key}
      data-index={virtualItem.index}
      style={{
        position: "absolute",
        top: virtualItem.start + 32, // +32px offset for header
        left: 0,
        right: 0,
        width: '100%',
        height: `${virtualItem.size}px`,
      }}
    >
      <table className="table-fixed w-full">
        <tbody>
          <tr
            className={cn(
              "hover:bg-primary/10 transition-colors border-b",
              virtualItem.index % 2 === 0 && "bg-muted/10",
            )}
            style={{ height: "28px" }}
          >
            {row.getVisibleCells().map((cell, columnIndex) => {
              const cellValue = cell.getValue() as CellValue | undefined;
              const column = columns.find((col) => col.name === cell.column.id);
              const adjustedCellWidth = getAdjustedColumnWidth(cell.column, columnIndex);

              // Check if cell is NULL
              const isNull =
                !cellValue ||
                cellValue.value === null ||
                cellValue.value === undefined;

              // Get text value for copy
              const getCopyText = (): string => {
                if (isNull) {
                  console.log("Copy: NULL value");
                  return "NULL";
                }
                if (typeof cellValue.value === "string") {
                  console.log("Copy: string value", cellValue.value);
                  return cellValue.value;
                }
                const jsonValue = JSON.stringify(cellValue.value);
                console.log("Copy: non-string value", jsonValue);
                return jsonValue;
              };

              let cellContent: React.ReactNode;
              if (cellValue && column) {
                cellContent = (
                  <CellValueRenderer cell={cellValue} column={column} />
                );
              } else if (cellValue) {
                cellContent = (
                  <span className="text-xs truncate block">
                    {JSON.stringify(cellValue)}
                  </span>
                );
              } else {
                cellContent = (
                  <span className="text-muted-foreground italic text-xs">
                    -
                  </span>
                );
              }

              return (
                <td
                  key={cell.id}
                  className="px-1.5 py-0.5 text-xs text-foreground/80 dark:text-foreground/70 border-r last:border-r-0"
                  style={{
                    width: adjustedCellWidth,
                    minWidth: adjustedCellWidth,
                    maxWidth: adjustedCellWidth,
                    overflow: "hidden",
                  }}
                >
                  {isNull ? (
                    <div
                      className={cn("h-full", {
                        "text-right":
                          cellValue?.value_type === "Integer" ||
                          cellValue?.value_type === "Decimal",
                      })}
                    >
                      {cellContent}
                    </div>
                  ) : (
                    <CellWithCopy
                      value={getCopyText()}
                      className={cn("h-full", {
                        "justify-end":
                          cellValue.value_type === "Integer" ||
                          cellValue.value_type === "Decimal",
                      })}
                    >
                      {cellContent}
                    </CellWithCopy>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
});
