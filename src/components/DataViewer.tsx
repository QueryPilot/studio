import { useState, useEffect, useRef, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  ColumnSizingState,
  Row,
  RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Eye,
  Loader2,
  Download,
  Table,
  Database,
  X,
  FileJson,
  TableProperties,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUIStore } from "@/stores/uiStore";

interface DataViewerProps {
  tableName: string;
  schema?: string;
  connectionId?: string;
  onRowClick?: (row: any) => void;
}

type ViewMode = "data" | "structure";
type DetailViewMode = "table" | "json";

interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}

const WINDOW_SIZE = 1000; // Keep 1000 records in memory
const FETCH_SIZE = 100; // Fetch 100 records at a time

export function DataViewer({ tableName, schema = "public", connectionId, onRowClick }: DataViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("data");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<ColumnDef<any>[]>([]);
  const [tableStructure, setTableStructure] = useState<TableColumn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [estimatedRowCount, setEstimatedRowCount] = useState<number | null>(null);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>("table");
  const [detailsPanelSize, setDetailsPanelSize] = useState(30); // 30% default size
  
  // Click-drag selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Infinite scroll state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const { activeConnectionId, connections } = useConnectionStore();
  const activeConnection = connectionId || activeConnectionId;

  // Refs for virtual scrolling
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Fetch estimated row count
  const fetchEstimatedCount = useCallback(async () => {
    if (!activeConnection) return;
    
    try {
      const countQuery = `
        SELECT reltuples::BIGINT AS estimate
        FROM pg_class
        WHERE oid = '"${schema}"."${tableName}"'::regclass;
      `;
      
      const result = await secureDatabaseService.executeQuery(activeConnection, countQuery);
      if (result.rows.length > 0 && result.rows[0]?.[0]) {
        setEstimatedRowCount(result.rows[0]![0]);
      }
    } catch (err) {
      console.error("Error fetching estimated count:", err);
      // Fallback to actual count if estimate fails
      try {
        const exactQuery = `SELECT COUNT(*) FROM "${schema}"."${tableName}"`;
        const result = await secureDatabaseService.executeQuery(activeConnection, exactQuery);
        if (result.rows.length > 0 && result.rows[0]) {
          setEstimatedRowCount(result.rows[0][0]);
        }
      } catch {
        // Ignore fallback error
      }
    }
  }, [activeConnection, schema, tableName]);

  // Fetch table structure
  const fetchTableStructure = useCallback(async () => {
    if (!activeConnection) return;
    
    try {
      const structureQuery = `
        SELECT 
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
          CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = '${schema}'
            AND tc.table_name = '${tableName}'
        ) pk ON c.column_name = pk.column_name
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = '${schema}'
            AND tc.table_name = '${tableName}'
        ) fk ON c.column_name = fk.column_name
        WHERE c.table_schema = '${schema}'
          AND c.table_name = '${tableName}'
        ORDER BY c.ordinal_position;
      `;
      
      const result = await secureDatabaseService.executeQuery(activeConnection, structureQuery);
      const structure = result.rows.map(row => ({
        column_name: row[0],
        data_type: row[1],
        is_nullable: row[2],
        column_default: row[3],
        character_maximum_length: row[4],
        is_primary_key: row[5],
        is_foreign_key: row[6],
      }));
      
      setTableStructure(structure);
      setStructureLoaded(true);
    } catch (err) {
      console.error("Error fetching table structure:", err);
    }
  }, [activeConnection, schema, tableName]);

  // Load table data with windowing
  const loadTableData = useCallback(async (newOffset: number = 0, append: boolean = false) => {
    if (!activeConnection) {
      setError("No active database connection");
      setIsLoading(false);
      return;
    }

    const connection = connections.get(activeConnection);
    if (!connection || connection.status !== "connected") {
      setError("Database not connected");
      setIsLoading(false);
      return;
    }

    if (!append) {
      setIsLoading(true);
    } else {
      setIsFetchingMore(true);
    }
    setError(null);

    try {
      // Build sort clause
      let orderBy = "";
      if (sorting.length > 0) {
        orderBy = "ORDER BY " + sorting.map(s => `"${s.id}" ${s.desc ? 'DESC' : 'ASC'}`).join(", ");
      }

      // Fetch data with offset and limit
      const query = `
        SELECT * FROM "${schema}"."${tableName}"
        ${orderBy}
        LIMIT ${FETCH_SIZE} OFFSET ${newOffset}
      `;

      const result = await secureDatabaseService.executeQuery(activeConnection, query);
      
      if (!append && result.rows.length > 0) {
        // Calculate initial column sizes
        const getInitialColumnSize = (colName: string) => {
          // Min size is column name length * 8 pixels
          const minSize = Math.max(colName.length * 8, 50);
          
          // Set reasonable defaults for common column names
          const lowerCol = colName.toLowerCase();
          if (lowerCol === 'id' || lowerCol.endsWith('_id')) return { size: 60, min: minSize };
          if (lowerCol === 'created_at' || lowerCol === 'updated_at') return { size: 120, min: minSize };
          if (lowerCol === 'email') return { size: 180, min: minSize };
          if (lowerCol === 'name' || lowerCol === 'title') return { size: 150, min: minSize };
          if (lowerCol === 'description' || lowerCol === 'content') return { size: 250, min: minSize };
          if (lowerCol === 'url' || lowerCol.includes('url')) return { size: 200, min: minSize };
          
          return { size: Math.min(150, Math.max(minSize, 100)), min: minSize };
        };
        
        // Generate columns without checkbox
        const tableColumns: ColumnDef<any>[] = [
          ...result.columns.map((col) => {
            const sizing = getInitialColumnSize(col);
            return {
              accessorKey: col,
              header: ({ column }: any) => {
                const handleSort = () => {
                  const currentSort = column.getIsSorted();
                  if (currentSort === false) {
                    column.toggleSorting(false); // Set to ascending
                  } else if (currentSort === "asc") {
                    column.toggleSorting(true); // Set to descending
                  } else {
                    column.clearSorting(); // Clear sorting on third click
                  }
                };
                
                return (
                  <Button
                    variant="ghost"
                    className="h-6 px-1 font-semibold text-xs w-full justify-between hover:bg-transparent"
                    onClick={handleSort}
                  >
                    <span className="truncate">{col}</span>
                    <span className="ml-1 flex-shrink-0">
                      {column.getIsSorted() === "asc" ? (
                        <ArrowUp className="h-2.5 w-2.5" />
                      ) : column.getIsSorted() === "desc" ? (
                        <ArrowDown className="h-2.5 w-2.5" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 opacity-20" />
                      )}
                    </span>
                  </Button>
                );
              },
              cell: ({ getValue }: any) => {
                const value = getValue();
                if (value === null) {
                  return <span className="text-muted-foreground italic text-xs">NULL</span>;
                }
                if (typeof value === "boolean") {
                  return <span className={cn("font-mono text-xs", value ? "text-green-600" : "text-red-600")}>{String(value)}</span>;
                }
                if (typeof value === "object") {
                  return <span className="font-mono text-xs" title={JSON.stringify(value)}>{JSON.stringify(value).substring(0, 50)}...</span>;
                }
                return <span className="block truncate text-xs" title={String(value)}>{String(value)}</span>;
              },
              size: sizing.size,
              minSize: sizing.min,
              maxSize: 400,
              enableSorting: true,
              enableHiding: true,
            };
          })
        ];

        setColumns(tableColumns);
      }

      // Convert rows to objects
      const tableData = result.rows.map((row, idx) => {
        const rowObj: any = { _rowIndex: newOffset + idx };
        result.columns.forEach((col, index) => {
          rowObj[col] = row[index];
        });
        return rowObj;
      });

      if (append) {
        setData(prev => {
          const newData = [...prev, ...tableData];
          // Keep only WINDOW_SIZE records
          if (newData.length > WINDOW_SIZE) {
            const start = newData.length - WINDOW_SIZE;
            return newData.slice(start);
          }
          return newData;
        });
      } else {
        setData(tableData);
      }

      setOffset(newOffset + result.rows.length);
      setHasMore(result.rows.length === FETCH_SIZE);
      setDataLoaded(true);
    } catch (err) {
      console.error("Error loading table data:", err);
      setError(err instanceof Error ? err.message : "Failed to load table data");
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  }, [activeConnection, tableName, schema, sorting, connections]);

  // Initial load - separate effects to prevent flashing
  useEffect(() => {
    // Load both data and structure on mount
    if (activeConnection) {
      loadTableData(0, false);
      fetchEstimatedCount();
      fetchTableStructure();
    }
  }, [activeConnection, tableName, schema]);
  
  // Don't reload when switching view modes - data is already cached
  useEffect(() => {
    // This effect is intentionally empty - we preload both views
  }, [viewMode]);

  // Handle sorting changes
  useEffect(() => {
    if (viewMode === "data" && !isLoading) {
      // Reset and reload when sorting changes
      setOffset(0);
      setData([]);
      loadTableData(0, false);
    }
  }, [sorting]);

  // Table instance
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      columnSizing,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    enableRowSelection: true,
    enableMultiRowSelection: true,
  });

  const { rows } = table.getRowModel();

  // Virtualizer for rows
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 28, // Compact row height
    overscan: 10,
  });

  // Handle infinite scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const { scrollHeight, scrollTop, clientHeight } = container;
    
    // Load more when scrolled to bottom
    if (scrollHeight - scrollTop - clientHeight < 500 && !isFetchingMore && hasMore) {
      loadTableData(offset, true);
    }
  }, [offset, isFetchingMore, hasMore, loadTableData]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+A or Ctrl+A to select all visible rows
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const activeElement = document.activeElement;
        const isEditableElement = 
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA';
        
        if (!isEditableElement && viewMode === "data") {
          e.preventDefault();
          table.toggleAllPageRowsSelected();
        }
      }
      
      // ESC to close details panel
      if (e.key === 'Escape' && showDetails) {
        setShowDetails(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [table, viewMode, showDetails]);

  // Export data as CSV
  const exportAsCSV = () => {
    const headers = table.getAllColumns()
      .map(col => col.id)
      .join(",");
    const rows = table.getFilteredRowModel().rows.map(row => 
      table.getAllColumns()
        .map(col => {
          const value = row.getValue(col.id);
          if (value === null) return "";
          if (typeof value === "string" && value.includes(",")) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(",")
    ).join("\n");
    
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle row selection with click-drag
  const handleRowMouseDown = (rowIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    
    // If shift is held and we have a last selected index, select range
    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, rowIndex);
      const end = Math.max(lastSelectedIndex, rowIndex);
      const newSelection: RowSelectionState = {};
      
      // Keep existing selections if Cmd/Ctrl is held
      if (event.metaKey || event.ctrlKey) {
        Object.assign(newSelection, rowSelection);
      }
      
      for (let i = start; i <= end; i++) {
        newSelection[i] = true;
      }
      setRowSelection(newSelection);
    } else if (event.metaKey || event.ctrlKey) {
      // Toggle single row with Cmd/Ctrl
      setRowSelection(prev => ({
        ...prev,
        [rowIndex]: !prev[rowIndex]
      }));
      setLastSelectedIndex(rowIndex);
    } else {
      // Start new selection
      setIsSelecting(true);
      setSelectionStart(rowIndex);
      setRowSelection({ [rowIndex]: true });
      setLastSelectedIndex(rowIndex);
    }
  };
  
  const handleRowMouseEnter = (rowIndex: number) => {
    if (isSelecting && selectionStart !== null) {
      const start = Math.min(selectionStart, rowIndex);
      const end = Math.max(selectionStart, rowIndex);
      const newSelection: RowSelectionState = {};
      
      for (let i = start; i <= end; i++) {
        newSelection[i] = true;
      }
      setRowSelection(newSelection);
    }
  };
  
  const handleMouseUp = () => {
    setIsSelecting(false);
  };
  
  // Add global mouse up listener
  useEffect(() => {
    if (isSelecting) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isSelecting]);
  
  // Handle row click for details
  const handleRowClick = (row: any) => {
    setSelectedRow(row);
    setShowDetails(true);
    onRowClick?.(row);
  };

  // Get selected count
  const selectedCount = Object.keys(rowSelection).length;
  const { setSelectedRowCount } = useUIStore();
  
  // Update selected row count in UI store
  useEffect(() => {
    setSelectedRowCount(selectedCount);
    
    // Clean up when component unmounts
    return () => {
      setSelectedRowCount(0);
    };
  }, [selectedCount, setSelectedRowCount]);

  // Only show loading on initial load, not when switching views
  if (!dataLoaded && !structureLoaded && isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading table...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  const tableContent = (
    <>
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-muted rounded-md p-0.5">
            <Button
              variant={viewMode === "data" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setViewMode("data")}
            >
              <Table className="h-3 w-3 mr-1" />
              Data
            </Button>
            <Button
              variant={viewMode === "structure" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setViewMode("structure")}
            >
              <Database className="h-3 w-3 mr-1" />
              Structure
            </Button>
          </div>

          {viewMode === "data" && (
            <>
              {/* Global search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={globalFilter ?? ""}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="h-6 w-40 pl-7 text-xs"
                />
              </div>

              {/* Column visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                    <Eye className="h-3 w-3 mr-1" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <ScrollArea className="h-64">
                    {table.getAllColumns()
                      .map((column) => {
                        return (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            className="text-xs"
                            checked={column.getIsVisible()}
                            onCheckedChange={(value) => column.toggleVisibility(!!value)}
                          >
                            {column.id}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                  </ScrollArea>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Export */}
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={exportAsCSV}>
                <Download className="h-3 w-3 mr-1" />
                Export
              </Button>

              {/* Row Details Toggle */}
              {selectedRow && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setShowDetails(!showDetails)}
                >
                  {showDetails ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronUp className="h-3 w-3 mr-1" />}
                  Row Details
                </Button>
              )}
            </>
          )}
        </div>

        {/* Row count and selection */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {viewMode === "data" && selectedCount > 0 && (
            <span className="text-primary font-medium">
              {selectedCount} selected
            </span>
          )}
          <span>
            {viewMode === "data" 
              ? `${table.getFilteredRowModel().rows.length} rows${estimatedRowCount ? ` (~${estimatedRowCount.toLocaleString()} total)` : ""}`
              : `${tableStructure.length} columns`
            }
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden transition-opacity duration-150">
        {viewMode === "data" ? (
          /* Data View with Virtual Scrolling */
          <div 
            ref={tableContainerRef}
            className={cn("h-full overflow-auto", isSelecting && "no-select")}
            onScroll={handleScroll}
          >
            <div style={{ minWidth: table.getCenterTotalSize() }}>
              {/* Table Header */}
              <div className="sticky top-0 z-10 bg-background border-b">
                {table.getHeaderGroups().map((headerGroup) => (
                  <div key={headerGroup.id} className="flex">
                    {headerGroup.headers.map((header) => (
                      <div
                        key={header.id}
                        className="relative flex items-center text-left text-xs px-2 py-1 bg-muted/50 border-r border-border"
                        style={{
                          width: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        
                        {/* Column resize handle */}
                        {!header.isPlaceholder && header.column.getCanResize() && (
                          <div
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={cn(
                              "absolute -right-0.5 top-0 h-full w-1 cursor-col-resize select-none touch-none z-20",
                              "hover:bg-primary/50",
                              header.column.getIsResizing() && "bg-primary"
                            )}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Virtual Table Body */}
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {rows.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-xs">No data available</p>
                  </div>
                ) : (
                  rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index] as Row<any>;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          "flex absolute w-full hover:bg-muted/30 transition-colors cursor-pointer select-none",
                          row.getIsSelected() && "bg-muted/50",
                          selectedRow?._rowIndex === row.original._rowIndex && "bg-accent/50"
                        )}
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        onMouseDown={(e) => handleRowMouseDown(virtualRow.index, e)}
                        onMouseEnter={() => handleRowMouseEnter(virtualRow.index)}
                        onDoubleClick={() => handleRowClick(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            className="flex items-center px-2 py-0.5 text-xs border-b border-r border-border/50"
                            style={{
                              width: cell.column.getSize(),
                            }}
                          >
                            <div className="overflow-hidden w-full">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Loading more indicator */}
              {isFetchingMore && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                  <span className="text-xs text-muted-foreground">Loading more...</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Structure View */
          <div className="h-full overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="text-left text-xs font-medium px-2 py-1 bg-muted/50">Column</th>
                  <th className="text-left text-xs font-medium px-2 py-1 bg-muted/50">Type</th>
                  <th className="text-left text-xs font-medium px-2 py-1 bg-muted/50">Nullable</th>
                  <th className="text-left text-xs font-medium px-2 py-1 bg-muted/50">Default</th>
                  <th className="text-left text-xs font-medium px-2 py-1 bg-muted/50">Constraints</th>
                </tr>
              </thead>
              <tbody>
                {tableStructure.map((col, idx) => (
                  <tr key={idx} className="border-b hover:bg-muted/30">
                    <td className="text-xs px-2 py-1 font-mono">{col.column_name}</td>
                    <td className="text-xs px-2 py-1">
                      {col.data_type}
                      {col.character_maximum_length && ` (${col.character_maximum_length})`}
                    </td>
                    <td className="text-xs px-2 py-1">
                      <span className={cn(
                        "px-1 py-0.5 rounded text-xs",
                        col.is_nullable === "YES" ? "bg-yellow-500/20 text-yellow-700" : "bg-green-500/20 text-green-700"
                      )}>
                        {col.is_nullable}
                      </span>
                    </td>
                    <td className="text-xs px-2 py-1 font-mono text-muted-foreground">
                      {col.column_default || "-"}
                    </td>
                    <td className="text-xs px-2 py-1">
                      <div className="flex gap-1">
                        {col.is_primary_key && (
                          <span className="px-1 py-0.5 bg-blue-500/20 text-blue-700 rounded text-xs">PK</span>
                        )}
                        {col.is_foreign_key && (
                          <span className="px-1 py-0.5 bg-purple-500/20 text-purple-700 rounded text-xs">FK</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  const detailsPanel = selectedRow && showDetails && (
    <div className="flex flex-col bg-muted/10 border-t">
      <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Row Details</span>
          <div className="flex items-center bg-muted rounded-md p-0.5">
            <Button
              variant={detailViewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-1.5 text-xs"
              onClick={() => setDetailViewMode("table")}
            >
              <TableProperties className="h-3 w-3 mr-0.5" />
              Table
            </Button>
            <Button
              variant={detailViewMode === "json" ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-1.5 text-xs"
              onClick={() => setDetailViewMode("json")}
            >
              <FileJson className="h-3 w-3 mr-0.5" />
              JSON
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => setShowDetails(false)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-2">
        {detailViewMode === "table" ? (
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left text-xs font-medium px-2 py-1 bg-muted/30 w-1/3">Field</th>
                <th className="text-left text-xs font-medium px-2 py-1 bg-muted/30">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(selectedRow).map(([key, value]) => {
                if (key === "_rowIndex") return null;
                return (
                  <tr key={key} className="border-b hover:bg-muted/20">
                    <td className="text-xs font-medium px-2 py-1 text-muted-foreground">{key}</td>
                    <td className="text-xs px-2 py-1 font-mono">
                      {value === null ? (
                        <span className="text-muted-foreground italic">NULL</span>
                      ) : typeof value === "object" ? (
                        <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
                      ) : typeof value === "boolean" ? (
                        <span className={cn("font-mono", value ? "text-green-600" : "text-red-600")}>{String(value)}</span>
                      ) : (
                        <span className="break-all">{String(value)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(selectedRow).filter(([key]) => key !== "_rowIndex")
              ),
              null,
              2
            )}
          </pre>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {showDetails && selectedRow ? (
        <ResizablePanelGroup direction="vertical" className="h-full">
          <ResizablePanel defaultSize={100 - detailsPanelSize} minSize={30}>
            <div className="h-full flex flex-col">
              {tableContent}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel 
            defaultSize={detailsPanelSize} 
            minSize={15} 
            maxSize={70}
            onResize={(size) => setDetailsPanelSize(size)}
          >
            {detailsPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="h-full flex flex-col">
          {tableContent}
        </div>
      )}
    </div>
  );
}