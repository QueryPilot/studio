import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTableData } from "@/hooks/useTableData";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "@/services/tableDataTypes";
import { ScrollVelocityTracker } from "../utils/scrollVelocityTracker";
import { FastRenderStrategy } from "../utils/fastRenderStrategy";

interface UseInfiniteTableDataParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export function useInfiniteTableData(params: UseInfiniteTableDataParams) {
  const containerRef = useRef<HTMLDivElement>(null);
  const velocityTracker = useRef(new ScrollVelocityTracker());
  const { connectionId, database, table, schema } = params;

  const {
    columns,
    rows,
    hasNextPage,
    isLoading,
    isStreaming,
    error,
    loadData,
    loadMore,
    refresh,
    estimatedTotal,
  } = useTableData();

  // Initialize data loading
  useEffect(() => {
    if (connectionId && table) {
      void loadData({
        connectionId,
        database,
        table,
        schema,
        limit: 100,
      });
    }
  }, [connectionId, database, table, schema, loadData]);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Create stable column definitions
  const columnDefs = useMemo<ColumnDef<TableDataRow>[]>(() => {
    if (!columns.length) return [];

    return columns.map((col: ColumnMeta) => ({
      id: col.name,
      accessorKey: col.name,
      header: col.name,
      size: getColumnSize(col),
      minSize: 50,
      maxSize: 500,
      enableSorting: true,
      enableColumnFilter: true,
    }));
  }, [columns]);

  // Table instance
  const tableInstance = useReactTable({
    data: rows,
    columns: columnDefs,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
    defaultColumn: {
      size: 150,
      minSize: 50,
      maxSize: 500,
    },
  });

  // Dynamic overscan based on scroll velocity
  const [dynamicOverscan, setDynamicOverscan] = useState(20);
  
  // Row virtualizer with optimized settings for fixed height
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => FastRenderStrategy.ROW_HEIGHT, []), // Fixed row height
    overscan: dynamicOverscan, // Dynamic overscan based on velocity
    scrollMargin: 0,
    measureElement: undefined, // Disable measurement for fixed height
    scrollPaddingStart: 0,
    scrollPaddingEnd: 0,
  });

  // Update overscan based on scroll velocity
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Update velocity tracker
    velocityTracker.current.update(container.scrollTop);
    
    // Update dynamic overscan
    const newOverscan = velocityTracker.current.getOverscan();
    setDynamicOverscan(prev => {
      // Only update if significantly different
      return Math.abs(prev - newOverscan) > 10 ? newOverscan : prev;
    });
  }, []);
  
  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);
  
  // Infinite scroll detection
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];

    if (!lastItem) return;

    // Check if we're near the bottom
    if (
      lastItem.index >= rows.length - 1 &&
      hasNextPage &&
      !isLoading &&
      !isStreaming
    ) {
      void loadMore();
    }
  }, [
    hasNextPage,
    loadMore,
    rows.length,
    isLoading,
    isStreaming,
    rowVirtualizer,
  ]);

  return {
    tableInstance,
    rowVirtualizer,
    containerRef,
    isLoading,
    isStreaming,
    error,
    hasNextPage,
    refresh,
    loadData,
    columns,
    rows,
    estimatedTotal,
  };
}

// Helper function to determine column size based on data type
function getColumnSize(column: ColumnMeta): number {
  const dbType = column.db_type.toUpperCase();

  // Calculate minimum width based on header text length
  const headerMinWidth = Math.max(60, column.name.length * 8 + 40); // 8px per char + 40px padding

  // Database-specific type patterns
  const typeSizeMap: Array<[RegExp, number]> = [
    // Numeric types
    [/^(TINY)?INT/, 80],
    [/^SMALLINT/, 90],
    [/^(MEDIUM)?INT/, 100],
    [/^BIG(INT|SERIAL)/, 120],
    [/^SERIAL/, 100],
    [/^DECIMAL|^NUMERIC|^MONEY/, 120],
    [/^(REAL|FLOAT|DOUBLE)/, 110],

    // Boolean
    [/^BOOL/, 60],

    // Date/Time
    [/^DATE/, 100],
    [/^TIME/, 100],
    [/^TIMESTAMP/, 180],
    [/^DATETIME/, 160],
    [/^INTERVAL/, 120],

    // String types
    [/^CHAR\(\d+\)/, 100],
    // VARCHAR with length - handled separately below
    [/^TEXT/, 200],
    [/^(LONG)?TEXT/, 250],
    [/^CLOB/, 250],

    // Binary
    [/^(BLOB|BYTEA|BINARY)/, 150],
    [/^VARBINARY/, 150],

    // UUID
    [/^UUID/, 280],

    // JSON
    [/^JSON/, 200],
    [/^XML/, 200],

    // Arrays
    [/^ARRAY/, 200],
    [/\[\]$/, 200],

    // Geometry
    [/^(POINT|LINE|POLYGON|GEOMETRY)/, 150],
  ];

  let calculatedWidth: number = 150; // Default width

  // Check VARCHAR with length separately
  const varcharMatch = dbType.match(/^VARCHAR\((\d+)\)/);
  if (varcharMatch && varcharMatch[1]) {
    const length = parseInt(varcharMatch[1], 10);
    calculatedWidth = Math.min(Math.max(100, length * 8), 300);
  } else {
    // Check each pattern
    let matched = false;
    for (const [pattern, size] of typeSizeMap) {
      if (typeof size === "number" && dbType.match(pattern)) {
        calculatedWidth = size;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Check for primary key
      if (column.is_pk) {
        calculatedWidth = 100;
      }
      // Check for foreign key
      else if (column.is_fk) {
        calculatedWidth = 120;
      }
      // Default size based on nullable
      else {
        calculatedWidth = column.nullable ? 150 : 130;
      }
    }
  }

  // Ensure minimum width accommodates header text
  return Math.max(calculatedWidth, headerMinWidth);
}
