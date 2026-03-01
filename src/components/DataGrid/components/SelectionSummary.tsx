/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { memo, useMemo, useCallback } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Decimal from "decimal.js";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { GridRowModel, GridColumnV2 } from "../types";
import type { CellValue as FrontCellValue } from "@/types";
import {
  toDecimal,
  formatDecimalWithLocale,
  isNumericColumnType,
  getNumericCategory,
  NumericCategory,
} from "@/utils/numericPrecision";
import { type GridSelection } from "@glideapps/glide-data-grid";
import {
  useSelectionStatsPreferencesStore,
  type NumericStatKey,
  type NonNumericStatKey,
} from "@/stores/useSelectionStatsPreferencesStore";

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

const NUMERIC_STAT_ORDER: NumericStatKey[] = ["sum", "avg", "median", "min", "max", "count", "null"];
const NON_NUMERIC_STAT_ORDER: NonNumericStatKey[] = ["count", "unique", "null"];

const NUMERIC_STAT_LABELS: Record<NumericStatKey, string> = {
  sum: "Sum", avg: "Avg", median: "Median", min: "Min", max: "Max", count: "Count", null: "Null",
};

const NON_NUMERIC_STAT_LABELS: Record<NonNumericStatKey, string> = {
  count: "Count", unique: "Unique", null: "Null",
};

const NUMERIC_CYCLE_ORDER: NumericStatKey[] = ["sum", "avg", "median", "min", "max"];

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
  const {
    enabledNumericStats,
    enabledNonNumericStats,
    isExpanded,
    toggleNumericStat,
    toggleNonNumericStat,
    setExpanded,
    resetToDefaults,
  } = useSelectionStatsPreferencesStore();

  const statistics = useMemo((): Statistics | null => {
    if (selectedRows.length === 0 && selectedRowIndices.size === 0) return null;

    // Calculate count first to check minimum threshold
    const count = gridSelection?.current?.range
      ? gridSelection.current.range.width * gridSelection.current.range.height
      : selectedRowIndices.size;

    // Only show statistics if more than 1 cell is selected
    if (count <= 1) return null;

    // For large selections, skip expensive statistics (sum/avg/median/unique).
    // Computing stats over 5k+ rows × columns creates millions of iterations.
    const STATS_THRESHOLD = 5000;
    if (count > STATS_THRESHOLD) {
      return { count, isNumeric: false };
    }

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

  const formatNumber = useCallback(
    (decimal: Decimal) => {
      const columnType = statistics?.hasDecimalColumns ? "decimal" : "integer";
      return formatDecimalWithLocale(decimal, columnType);
    },
    [statistics?.hasDecimalColumns],
  );

  const getStatValue = useCallback(
    (key: NumericStatKey | NonNumericStatKey): string | null => {
      if (!statistics) return null;

      switch (key) {
        case "sum":
          return statistics.sum ? formatNumber(statistics.sum) : null;
        case "avg":
          return statistics.avg ? formatNumber(statistics.avg) : null;
        case "median":
          return statistics.median ? formatNumber(statistics.median) : null;
        case "min":
          return statistics.min ? formatNumber(statistics.min) : null;
        case "max":
          return statistics.max ? formatNumber(statistics.max) : null;
        case "count":
          return statistics.count.toLocaleString();
        case "unique":
          return statistics.countUnique !== undefined
            ? statistics.countUnique.toLocaleString()
            : null;
        case "null":
          return statistics.countNull !== undefined && statistics.countNull > 0
            ? statistics.countNull.toLocaleString()
            : null;
        default:
          return null;
      }
    },
    [statistics, formatNumber],
  );

  const visibleStats = useMemo(() => {
    if (!statistics) return [];

    if (statistics.isNumeric) {
      return NUMERIC_STAT_ORDER.filter((key) => {
        if (!enabledNumericStats.includes(key)) return false;
        return getStatValue(key) !== null;
      }).map((key) => ({
        key,
        label: NUMERIC_STAT_LABELS[key],
        value: getStatValue(key)!,
      }));
    }

    return NON_NUMERIC_STAT_ORDER.filter((key) => {
      if (!enabledNonNumericStats.includes(key)) return false;
      return getStatValue(key) !== null;
    }).map((key) => ({
      key,
      label: NON_NUMERIC_STAT_LABELS[key],
      value: getStatValue(key)!,
    }));
  }, [statistics, enabledNumericStats, enabledNonNumericStats, getStatValue]);

  const handleCopyValue = useCallback(async (value: string) => {
    await writeClipboardText(value);
    toast.success("Copied to clipboard");
  }, []);

  const handleCycleStat = useCallback(
    (currentKey: NumericStatKey) => {
      // Only cycle for stats in the cycle order (not count/null)
      const cycleIdx = NUMERIC_CYCLE_ORDER.indexOf(currentKey);
      if (cycleIdx === -1) return;

      const nextIdx = (cycleIdx + 1) % NUMERIC_CYCLE_ORDER.length;
      const nextKey = NUMERIC_CYCLE_ORDER[nextIdx]!;

      // Enable the next stat and disable the current one
      if (!enabledNumericStats.includes(nextKey)) {
        toggleNumericStat(nextKey);
      }
      if (enabledNumericStats.includes(currentKey)) {
        // Only disable if we'll still have at least 1 stat after enabling the next
        toggleNumericStat(currentKey);
      }
    },
    [enabledNumericStats, toggleNumericStat],
  );

  if (!statistics || visibleStats.length === 0) return null;

  const isNumeric = statistics.isNumeric;
  const primaryStat = visibleStats[0]!;
  const colorBase = isNumeric ? "green" : "blue";

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "flex items-center gap-1.5 px-2 h-6 rounded-md border transition-colors text-xs cursor-default",
          isNumeric
            ? "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"
            : "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400",
          className,
        )}
      >
        {isExpanded ? (
          <>
            {visibleStats.map((stat, idx) => (
              <span key={stat.key} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <span
                    className={cn(
                      "w-px h-3.5",
                      colorBase === "green"
                        ? "bg-green-500/20"
                        : "bg-blue-500/20",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "text-muted-foreground",
                    isNumeric &&
                      NUMERIC_CYCLE_ORDER.includes(
                        stat.key as NumericStatKey,
                      ) &&
                      "cursor-pointer hover:underline",
                  )}
                  onClick={(e) => {
                    if (
                      isNumeric &&
                      NUMERIC_CYCLE_ORDER.includes(stat.key as NumericStatKey)
                    ) {
                      e.stopPropagation();
                      handleCycleStat(stat.key as NumericStatKey);
                    }
                  }}
                >
                  {stat.label}:
                </span>
                <span
                  className="font-mono font-medium cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopyValue(stat.value);
                  }}
                >
                  {stat.value}
                </span>
              </span>
            ))}
            <IconChevronLeft
              className="h-3 w-3 ml-0.5 opacity-50 cursor-pointer hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            />
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{primaryStat.label}:</span>
            <span
              className="font-mono font-medium cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void handleCopyValue(primaryStat.value);
              }}
            >
              {primaryStat.value}
            </span>
            <IconChevronRight
              className="h-3 w-3 ml-0.5 opacity-50 cursor-pointer hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            />
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48 text-xs p-1">
        {isNumeric
          ? NUMERIC_STAT_ORDER.map((key) => {
              // Skip "null" if no nulls
              if (key === "null" && (!statistics.countNull || statistics.countNull === 0)) {
                return null;
              }
              return (
                <ContextMenuCheckboxItem
                  key={key}
                  checked={enabledNumericStats.includes(key)}
                  onCheckedChange={() => { toggleNumericStat(key); }}
                >
                  {NUMERIC_STAT_LABELS[key]}
                </ContextMenuCheckboxItem>
              );
            })
          : NON_NUMERIC_STAT_ORDER.map((key) => {
              // Skip "null" if no nulls
              if (key === "null" && (!statistics.countNull || statistics.countNull === 0)) {
                return null;
              }
              return (
                <ContextMenuCheckboxItem
                  key={key}
                  checked={enabledNonNumericStats.includes(key)}
                  onCheckedChange={() => { toggleNonNumericStat(key); }}
                >
                  {NON_NUMERIC_STAT_LABELS[key]}
                </ContextMenuCheckboxItem>
              );
            })}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={resetToDefaults}>
          Reset to Defaults
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
