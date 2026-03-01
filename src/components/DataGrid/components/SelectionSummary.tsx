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
  formatDecimal,
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
    cycleNumericStat,
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

  const columnType = statistics?.hasDecimalColumns ? "decimal" : "integer";

  const formatNumber = useCallback(
    (decimal: Decimal) => formatDecimalWithLocale(decimal, columnType),
    [columnType],
  );

  // Raw format without thousand separators — used for clipboard copy
  const formatRawNumber = useCallback(
    (decimal: Decimal) => formatDecimal(decimal, columnType),
    [columnType],
  );

  // Helper to get a Decimal stat value by key
  const getDecimalForKey = useCallback(
    (key: string): Decimal | undefined => {
      if (!statistics) return undefined;
      switch (key) {
        case "sum": return statistics.sum;
        case "avg": return statistics.avg;
        case "median": return statistics.median;
        case "min": return statistics.min;
        case "max": return statistics.max;
        default: return undefined;
      }
    },
    [statistics],
  );

  const getStatValue = useCallback(
    (key: NumericStatKey | NonNumericStatKey): { display: string; raw: string } | null => {
      if (!statistics) return null;

      const decimal = getDecimalForKey(key);
      if (decimal !== undefined) {
        return { display: formatNumber(decimal), raw: formatRawNumber(decimal) };
      }

      switch (key) {
        case "count":
          return { display: statistics.count.toLocaleString(), raw: String(statistics.count) };
        case "unique":
          return statistics.countUnique !== undefined
            ? { display: statistics.countUnique.toLocaleString(), raw: String(statistics.countUnique) }
            : null;
        case "null":
          return statistics.countNull !== undefined && statistics.countNull > 0
            ? { display: statistics.countNull.toLocaleString(), raw: String(statistics.countNull) }
            : null;
        default:
          return null;
      }
    },
    [statistics, formatNumber, formatRawNumber, getDecimalForKey],
  );

  const visibleStats = useMemo(() => {
    if (!statistics) return [];

    if (statistics.isNumeric) {
      return NUMERIC_STAT_ORDER.filter((key) => {
        if (!enabledNumericStats.includes(key)) return false;
        return getStatValue(key) !== null;
      }).map((key) => {
        const stat = getStatValue(key)!;
        return { key, label: NUMERIC_STAT_LABELS[key], value: stat.display, rawValue: stat.raw };
      });
    }

    return NON_NUMERIC_STAT_ORDER.filter((key) => {
      if (!enabledNonNumericStats.includes(key)) return false;
      return getStatValue(key) !== null;
    }).map((key) => {
      const stat = getStatValue(key)!;
      return { key, label: NON_NUMERIC_STAT_LABELS[key], value: stat.display, rawValue: stat.raw };
    });
  }, [statistics, enabledNumericStats, enabledNonNumericStats, getStatValue]);

  const handleCopyValue = useCallback(async (value: string) => {
    try {
      await writeClipboardText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }, []);

  const handleCycleStat = useCallback(
    (currentKey: NumericStatKey) => {
      // Only cycle for stats in the cycle order (not count/null)
      const cycleIdx = NUMERIC_CYCLE_ORDER.indexOf(currentKey);
      if (cycleIdx === -1) return;

      // Find the next stat in cycle that is NOT already visible
      for (let i = 1; i < NUMERIC_CYCLE_ORDER.length; i++) {
        const nextKey = NUMERIC_CYCLE_ORDER[(cycleIdx + i) % NUMERIC_CYCLE_ORDER.length]!;
        if (!enabledNumericStats.includes(nextKey)) {
          cycleNumericStat(currentKey, nextKey);
          return;
        }
      }
      // All cycleable stats are already visible — do nothing
    },
    [cycleNumericStat, enabledNumericStats],
  );

  if (!statistics || visibleStats.length === 0) return null;

  const isNumeric = statistics.isNumeric;
  const primaryStat = visibleStats[0]!;

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
                      isNumeric
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
                  title={`${stat.rawValue} — click to copy`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopyValue(stat.rawValue);
                  }}
                >
                  {stat.value}
                </span>
              </span>
            ))}
            <button
              className={cn(
                "flex items-center justify-center w-5 h-6 transition-colors",
                isNumeric
                  ? "text-green-700/60 dark:text-green-400/60 hover:text-green-700 dark:hover:text-green-400"
                  : "text-blue-700/60 dark:text-blue-400/60 hover:text-blue-700 dark:hover:text-blue-400",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              aria-label="Collapse statistics"
            >
              <IconChevronLeft className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{primaryStat.label}:</span>
            <span
              className="font-mono font-medium cursor-pointer"
              title={`${primaryStat.rawValue} — click to copy`}
              onClick={(e) => {
                e.stopPropagation();
                void handleCopyValue(primaryStat.rawValue);
              }}
            >
              {primaryStat.value}
            </span>
            <button
              className={cn(
                "flex items-center justify-center w-5 h-6 transition-colors",
                isNumeric
                  ? "text-green-700/60 dark:text-green-400/60 hover:text-green-700 dark:hover:text-green-400"
                  : "text-blue-700/60 dark:text-blue-400/60 hover:text-blue-700 dark:hover:text-blue-400",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              aria-label="Expand statistics"
            >
              <IconChevronRight className="h-3 w-3" />
            </button>
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48 text-xs p-1">
        {isNumeric
          ? NUMERIC_STAT_ORDER.map((key) => {
              if (key === "null" && (!statistics.countNull || statistics.countNull === 0)) {
                return null;
              }
              const isChecked = enabledNumericStats.includes(key);
              const isLastEnabled = isChecked && enabledNumericStats.length === 1;
              return (
                <ContextMenuCheckboxItem
                  key={key}
                  checked={isChecked}
                  disabled={isLastEnabled}
                  onCheckedChange={() => { toggleNumericStat(key); }}
                >
                  {NUMERIC_STAT_LABELS[key]}
                </ContextMenuCheckboxItem>
              );
            })
          : NON_NUMERIC_STAT_ORDER.map((key) => {
              if (key === "null" && (!statistics.countNull || statistics.countNull === 0)) {
                return null;
              }
              const isChecked = enabledNonNumericStats.includes(key);
              const isLastEnabled = isChecked && enabledNonNumericStats.length === 1;
              return (
                <ContextMenuCheckboxItem
                  key={key}
                  checked={isChecked}
                  disabled={isLastEnabled}
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
