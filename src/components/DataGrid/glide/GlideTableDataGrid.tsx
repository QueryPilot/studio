import { memo, useCallback, useMemo, useState, useEffect } from "react";
import {
  type GridCell,
  type Item,
  type GridColumn,
  type Rectangle,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { EnhancedGlideWrapper } from "./EnhancedGlideWrapper";
import { useInfiniteTableData } from "../hooks/useInfiniteTableData";
import {
  shouldUseFullWidth,
  type GlideTableDataGridProps,
  type DataGridColumn,
} from "./types";
import { buildTableCell } from "./cellFactory";
import { cn } from "@/lib/utils";
import type { ColumnMeta as TableColumnMeta } from "@/types/database";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { CellValue } from "@/types/cellValue";
// import { getCellRendererFromColumnMeta } from "./types";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import {
  DataGridErrorState,
  DataGridEmptyState,
} from "../components/DataGridStates";
import { usePanelStore } from "@/stores/panelStore";

export const GlideTableDataGrid = memo(function GlideTableDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: GlideTableDataGridProps) {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
  const [selectedRowCount, setSelectedRowCount] = useState(0);

  // Get current tab and panel store
  const { getCurrentTab, updateTabUI } = usePanelStore();
  const currentTab = getCurrentTab();

  // Fetch table data using existing hook
  const {
    isLoading,
    isLoadingMore,
    error,
    columns: tableColumns,
    rows,
    estimatedTotal,
    loadMore,
    hasNextPage,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  // Use tab-specific column state from store
  const columnWidths = useMemo(
    () => currentTab?.ui.columnWidths || {},
    [currentTab],
  );
  const tabColumnOrder = useMemo(
    () => currentTab?.ui.columnOrder || [],
    [currentTab],
  );

  // Initialize column order when columns change or tab changes
  const columnOrder = useMemo<number[]>(() => {
    if (tableColumns.length === 0) return [] as number[];

    // If tab has saved order and matches column count, use it
    if (tabColumnOrder.length === tableColumns.length) {
      return tabColumnOrder
        .map((name) => tableColumns.findIndex((col) => col.name === name))
        .filter((idx) => idx !== -1);
    }

    // Otherwise use default order and save it
    const defaultOrder = tableColumns.map((_, index) => index);
    return defaultOrder;
  }, [tableColumns, tabColumnOrder]);

  // Initialize tab column order outside of render to avoid setState in render
  useEffect(() => {
    if (tableColumns.length === 0) return;
    if (!currentTab) return;
    if (tabColumnOrder.length === tableColumns.length) return;
    updateTabUI(currentTab.id, {
      columnOrder: tableColumns.map((col) => col.name),
    });
  }, [tableColumns, tabColumnOrder.length, currentTab, updateTabUI]);

  // Convert columns to Glide format with reordering
  const columns = useMemo<DataGridColumn[]>(() => {
    console.log(
      `[GlideTableDataGrid] Converting ${tableColumns.length} columns to Glide format`,
    );
    if (tableColumns.length === 0) return [];

    // Use column order if available, otherwise use default order
    const orderedIndices =
      columnOrder.length > 0
        ? columnOrder
        : tableColumns.map((_, index) => index);

    return orderedIndices
      .map((originalIndex) => {
        const col = tableColumns[originalIndex];
        if (!col) return null;

        const colId = col.name || `col_${originalIndex}`;

        // Calculate base width - use full content width for date/time/number columns
        let baseWidth: number;
        if (shouldUseFullWidth(col.db_type)) {
          // For date/time/number columns, calculate based on typical content length
          if (col.db_type.toLowerCase().includes("timestamp")) {
            // Timestamps like "2025-08-31T10:44:52" need ~160px
            baseWidth = 180;
          } else if (col.db_type.toLowerCase().includes("date")) {
            // Dates like "2025-08-31" need ~100px
            baseWidth = 120;
          } else if (col.db_type.toLowerCase().includes("time")) {
            // Times like "10:44:52" need ~80px
            baseWidth = 100;
          } else {
            // Numbers - use header width or minimum 100px
            baseWidth = Math.max(100, col.name.length * 8 + 40);
          }
        } else {
          // Text columns - use standard calculation
          baseWidth = Math.max(80, Math.min(200, col.name.length * 7 + 40));
        }

        const meta = col as unknown as TableColumnMeta;
        return {
          id: colId,
          name: col.name,
          title: col.name,
          width: columnWidths[colId] || baseWidth,
          type: col.db_type,
          meta,
          grow: 0, // Set to 0 to allow manual resizing
          hasMenu: false,
          themeOverride: undefined,
        } as unknown as DataGridColumn;
      })
      .filter(Boolean) as DataGridColumn[];
  }, [tableColumns, columnWidths, columnOrder]);

  // Column metadata in the same ordering as `columns` (derived, not changing existing column typing)
  const columnMetas = useMemo(() => {
    if (tableColumns.length === 0) return [] as TableColumnMeta[];
    const orderedIndices =
      columnOrder.length > 0 ? columnOrder : tableColumns.map((_, i) => i);
    return orderedIndices.map(
      (idx) => tableColumns[idx] as unknown as TableColumnMeta,
    );
  }, [tableColumns, columnOrder]);

  // Get cell content callback
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;

      if (!rows[row] || !columns[col]) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        };
      }

      const column = columns[col];
      const rowData: TableDataRow = rows[row];

      const value: CellValue | undefined = rowData[column.name] as
        | CellValue
        | undefined;
      return buildTableCell({ value, column, meta: columnMetas[col] });
    },
    [rows, columns, columnMetas],
  );

  // Calculate optimal column width based on content
  const calculateOptimalWidth = useCallback(
    (colIndex: number): number => {
      if (!columns[colIndex]) return 150;

      const column = columns[colIndex];
      const headerWidth = column.name.length * 8 + 40; // Header text width

      // Create a canvas for accurate text measurement
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return headerWidth;

      // Use the same font as the grid
      ctx.font =
        "400 12px Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";

      // Sample all rows (or up to 1000 for performance)
      let maxContentWidth = headerWidth;
      const sampleSize = Math.min(1000, rows.length);

      for (let i = 0; i < sampleSize; i++) {
        const cellValueUnknown = rows[i]?.[column.name] as unknown;
        const hasInnerValue =
          typeof cellValueUnknown === "object" &&
          cellValueUnknown !== null &&
          Object.prototype.hasOwnProperty.call(
            cellValueUnknown as Record<string, unknown>,
            "value",
          );
        let displayValue: unknown;
        if (hasInnerValue) {
          const cv = cellValueUnknown as { value?: unknown };
          displayValue = cv.value;
        } else {
          displayValue = cellValueUnknown;
        }
        let textValue: string;
        if (displayValue === null || displayValue === undefined) {
          textValue = "";
        } else if (typeof displayValue === "object") {
          try {
            textValue = JSON.stringify(displayValue as Record<string, unknown>);
          } catch {
            textValue = "[object]";
          }
        } else {
          textValue = String(displayValue);
        }

        // Measure actual text width
        const textWidth = ctx.measureText(textValue).width;
        const contentWidth = textWidth + 16; // Add padding
        maxContentWidth = Math.max(maxContentWidth, contentWidth);
      }

      // Cap at 800px max for readability
      return Math.min(maxContentWidth, 800);
    },
    [columns, rows],
  );

  // Handle column resize
  const handleColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      const colId = columns[colIndex]?.id;
      if (colId && currentTab) {
        updateTabUI(currentTab.id, {
          columnWidths: {
            ...columnWidths,
            [colId]: newSize,
          },
        });
      }
    },
    [columns, currentTab, updateTabUI, columnWidths],
  );

  // Handle column move (drag and drop)
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex || !currentTab || tableColumns.length === 0)
        return;

      const newOrder = [...columnOrder];
      const moved = newOrder.splice(startIndex, 1);
      const movedColumn = moved.length > 0 ? moved[0] : startIndex;
      newOrder.splice(endIndex, 0, movedColumn);

      // Convert indices back to column names
      const newColumnOrder = newOrder
        .map((idx) => tableColumns[idx]?.name)
        .filter((n): n is string => Boolean(n));

      updateTabUI(currentTab.id, {
        columnOrder: newColumnOrder,
      });
    },
    [columnOrder, currentTab, updateTabUI, tableColumns],
  );

  // Handle column resize end (double-click to auto-size)
  const handleColumnResizeEnd = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      // Check if this is a double-click (size is -1 indicates auto-size request)
      if (
        newSize < 0 &&
        currentTab &&
        Number.isInteger(colIndex) &&
        colIndex >= 0 &&
        colIndex < columns.length
      ) {
        const idx: number = colIndex;
        const optimalWidth: number = calculateOptimalWidth(idx);
        const colId: string | undefined = columns[idx]?.id;
        if (colId) {
          updateTabUI(currentTab.id, {
            columnWidths: {
              ...columnWidths,
              [colId]: optimalWidth,
            },
          });
        }
      }
      // For normal resize end, the width is already set by handleColumnResize
    },
    [columns, calculateOptimalWidth, currentTab, updateTabUI, columnWidths],
  );

  // Get raw cell value for popup
  const getCellValue = useCallback(
    (cell: Item): unknown => {
      const [col, row] = cell;

      if (!rows[row] || !columns[col]) {
        return null;
      }

      const column = columns[col];
      const rowData = rows[row];
      // rowData is now an object with column names as keys
      const value = rowData[column.name];

      // Return the actual CellValue structure (value property contains the data)
      return value?.value ?? value;
    },
    [rows, columns],
  );

  // Handle cell click
  const handleCellClicked = useCallback((cell: Item) => {
    const [col, row] = cell;
    console.log(`Cell clicked: [${col}, ${row}]`);
  }, []);

  // Handle visible region change for infinite scrolling
  const handleVisibleRegionChanged = useCallback((range: Rectangle) => {
    // Use RAF for smooth updates
    requestAnimationFrame(() => {
      const newRange = { start: range.y, end: range.y + range.height };
      setVisibleRange(newRange);
    });
  }, []);

  // Handle selection change
  const handleSelectionChange = useCallback((count: number) => {
    setSelectedRowCount(count);
  }, []);

  useEffect(() => {
    const endRow = visibleRange.end;
    const buffer = 500; // Load more when within 500 rows of the end
    const threshold = rows.length - buffer;

    if (hasNextPage && endRow > threshold && !isLoadingMore) {
      void loadMore();
    }
  }, [visibleRange.end, rows.length, hasNextPage, isLoadingMore, loadMore]);

  // Error state
  if (error) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <DataGridErrorState error={error} />
      </div>
    );
  }

  // Empty state
  if (!isLoading && rows.length === 0) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <DataGridEmptyState />
      </div>
    );
  }

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      <div className="flex-1 w-full min-h-0">
        <EnhancedGlideWrapper
          columns={columns}
          rows={rows.length}
          getCellContent={getCellContent}
          getCellValue={getCellValue}
          onCellClicked={handleCellClicked}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
          onColumnMoved={handleColumnMoved}
          onVisibleRegionChanged={handleVisibleRegionChanged}
          onSelectionChange={handleSelectionChange}
          className="h-full w-full"
          freezeColumns={0}
          rowMarkers="none"
          headerHeight={28}
          rowHeight={28}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          estimatedTotal={estimatedTotal || undefined}
        />
      </div>

      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal || undefined}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});
