/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { memo, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import Decimal from "decimal.js";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { GridRowModel, GridColumnV2 } from "../types";
import type { CellValue as FrontCellValue } from "@/types/cellValue";
import {
  toDecimal,
  formatDecimalWithLocale,
  isNumericColumnType,
  getNumericCategory,
  NumericCategory,
} from "@/utils/numericPrecision";
import { type GridSelection } from "@glideapps/glide-data-grid";

interface SelectionSummaryProps {
  selectedRows: GridRowModel[];
  selectedRowIndices: Set<number>;
  allRows: GridRowModel[];
  columns: GridColumnV2[];
  gridSelection?: GridSelection;
  className?: string;
}

interface Statistics {
  sum?: Decimal;
  avg?: Decimal;
  median?: Decimal;
  min?: Decimal;
  max?: Decimal;
  count: number;
  countNumbers?: number;
  countUnique?: number;
  countNull?: number;
  isNumeric: boolean;
  // Track if we have mixed integer/decimal columns for formatting
  hasDecimalColumns?: boolean;
}

// Helper to calculate median from sorted Decimal array
const calculateMedian = (values: Decimal[]): Decimal => {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    // Even length: average of two middle values
    return sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2);
  } else {
    // Odd length: middle value
    return sorted[mid]!;
  }
};

export const SelectionSummary = memo(function SelectionSummary({
  selectedRows,
  selectedRowIndices,
  allRows,
  columns,
  gridSelection,
  className,
}: SelectionSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);

  const statistics = useMemo((): Statistics | null => {
    if (selectedRows.length === 0 && selectedRowIndices.size === 0) return null;

    // Calculate count first to check minimum threshold
    const count = gridSelection?.current?.range
      ? gridSelection.current.range.width * gridSelection.current.range.height
      : selectedRowIndices.size;

    // Only show statistics if more than 1 cell is selected
    if (count <= 1) return null;

    const decimalValues: Decimal[] = [];
    const uniqueValues = new Set<string>();
    let nullCount = 0;
    let hasDecimalColumns = false;

    // If we have a specific cell range selection, use that
    if (gridSelection?.current?.range) {
      const range = gridSelection.current.range;
      const colIndices = Array.from(
        { length: range.width },
        (_, i) => range.x + i,
      );
      const rowIndices = Array.from(
        { length: range.height },
        (_, i) => range.y + i,
      );

      rowIndices.forEach((rowIdx) => {
        const row = allRows[rowIdx]; // Use allRows with actual indices
        if (!row) return;

        colIndices.forEach((colIdx) => {
          const column = columns[colIdx];
          if (!column) return;

          const cellValue = row[column.field] as
            | FrontCellValue
            | null
            | undefined;

          // Count null/undefined values
          if (
            !cellValue ||
            cellValue.value === null ||
            cellValue.value === undefined
          ) {
            nullCount++;
            return;
          }

          const val = cellValue.value;

          // Track unique values for non-numeric columns
          uniqueValues.add(String(val));

          // Only process as numeric if column type is numeric
          if (isNumericColumnType(column.type)) {
            const decimal = toDecimal(val);
            if (decimal !== null) {
              decimalValues.push(decimal);

              // Track if we have decimal columns for formatting
              if (getNumericCategory(column.type) === NumericCategory.DECIMAL) {
                hasDecimalColumns = true;
              }
            }
          }
        });
      });
    } else {
      // Otherwise, aggregate all numeric values from selected rows
      Array.from(selectedRowIndices).forEach((rowIdx) => {
        const row = allRows[rowIdx]; // Use allRows with actual indices
        if (!row) return;

        columns.forEach((column) => {
          const cellValue = row[column.field] as
            | FrontCellValue
            | null
            | undefined;

          // Count null/undefined values
          if (
            !cellValue ||
            cellValue.value === null ||
            cellValue.value === undefined
          ) {
            nullCount++;
            return;
          }

          const val = cellValue.value;

          // Track unique values for non-numeric columns
          uniqueValues.add(String(val));

          // Only process as numeric if column type is numeric
          if (isNumericColumnType(column.type)) {
            const decimal = toDecimal(val);
            if (decimal !== null) {
              decimalValues.push(decimal);

              // Track if we have decimal columns for formatting
              if (getNumericCategory(column.type) === NumericCategory.DECIMAL) {
                hasDecimalColumns = true;
              }
            }
          }
        });
      });
    }

    // If we have numeric values, return numeric statistics
    if (decimalValues.length > 0) {
      const sum = decimalValues.reduce(
        (acc, val) => acc.plus(val),
        new Decimal(0),
      );
      const avg = sum.dividedBy(decimalValues.length);
      const median = calculateMedian(decimalValues);
      const min = Decimal.min(...decimalValues);
      const max = Decimal.max(...decimalValues);
      const countNumbers = decimalValues.length;

      return {
        sum,
        avg,
        median,
        min,
        max,
        count,
        countNumbers,
        countNull: nullCount,
        isNumeric: true,
        hasDecimalColumns,
      };
    }

    // Otherwise, return unique count for non-numeric data
    if (uniqueValues.size > 0) {
      return {
        count,
        countUnique: uniqueValues.size,
        countNull: nullCount,
        isNumeric: false,
      };
    }

    // If only nulls selected
    if (nullCount > 0) {
      return {
        count,
        countNull: nullCount,
        isNumeric: false,
      };
    }

    return null;
  }, [selectedRows, selectedRowIndices, allRows, columns, gridSelection]);

  if (!statistics) return null;

  const formatNumber = (decimal: Decimal) => {
    // Use decimal column type if we have mixed columns, otherwise treat as integer
    const columnType = statistics.hasDecimalColumns ? "decimal" : "integer";
    return formatDecimalWithLocale(decimal, columnType);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 px-3 h-6 rounded-md",
            statistics.isNumeric
              ? "bg-green-500/10 hover:bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/20"
              : "bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/20",
            "border transition-colors text-xs font-medium cursor-pointer",
            className,
          )}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          {statistics.isNumeric ? (
            <span>Sum: {formatNumber(statistics.sum!)}</span>
          ) : statistics.countUnique !== undefined ? (
            <span>Unique: {statistics.countUnique}</span>
          ) : (
            <span>Null: {statistics.countNull}</span>
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-3 text-sm">
        <div className="space-y-2">
          <div className="flex justify-between items-center pb-2 border-b">
            <span className="font-semibold">Selection Statistics</span>
          </div>
          <div className="space-y-1.5">
            {statistics.isNumeric ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sum:</span>
                  <span className="font-mono font-medium">
                    {formatNumber(statistics.sum!)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg:</span>
                  <span className="font-mono font-medium">
                    {formatNumber(statistics.avg!)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Median:</span>
                  <span className="font-mono font-medium">
                    {formatNumber(statistics.median!)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Min:</span>
                  <span className="font-mono font-medium">
                    {formatNumber(statistics.min!)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max:</span>
                  <span className="font-mono font-medium">
                    {formatNumber(statistics.max!)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Count:</span>
                  <span className="font-mono font-medium">
                    {statistics.count.toLocaleString()}
                  </span>
                </div>

                {statistics.countNull !== undefined &&
                  statistics.countNull > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">NULL:</span>
                      <span className="font-mono font-medium">
                        {statistics.countNull.toLocaleString()}
                      </span>
                    </div>
                  )}
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Count:</span>
                  <span className="font-mono font-medium">
                    {statistics.count.toLocaleString()}
                  </span>
                </div>
                {statistics.countUnique !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unique:</span>
                    <span className="font-mono font-medium">
                      {statistics.countUnique.toLocaleString()}
                    </span>
                  </div>
                )}
                {statistics.countNull !== undefined &&
                  statistics.countNull > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">NULL:</span>
                      <span className="font-mono font-medium">
                        {statistics.countNull.toLocaleString()}
                      </span>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
