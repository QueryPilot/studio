import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  useDeferredValue,
  useTransition,
} from "react";
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
  ColumnOrderState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
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
  MoreVertical,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { cacheService } from "@/services/cacheService";
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

// Draggable header component for column reordering
const DraggableHeader = memo(
  ({ column, header }: { column: any; header: any }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: column.id,
    });

    const isLastColumn = header.column.getIsLastColumn();
    const columnWidth = header.getSize();
    const style = {
      // Only apply horizontal transform to prevent vertical movement
      transform: transform ? `translateX(${transform.x}px)` : undefined,
      transition,
      opacity: isDragging ? 0.5 : 1,
      cursor: isDragging ? "grabbing" : "grab",
      width: columnWidth,
      minWidth: Math.max(columnWidth, 100),
      maxWidth: isLastColumn ? undefined : columnWidth,
      flex: isLastColumn ? "1 1 auto" : "none",
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className="relative flex items-center text-left text-xs bg-muted/50 border-r border-border/50 box-border"
        {...attributes}
      >
        <div
          className="flex items-center justify-between w-full px-1.5 py-0.5 h-7"
          {...listeners}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </div>

        {/* Column resize handle */}
        {!header.isPlaceholder && header.column.getCanResize() && (
          <div
            onMouseDown={(e) => {
              e.stopPropagation(); // Fix: Prevent resize from triggering DnD
              header.getResizeHandler()(e);
            }}
            onTouchStart={(e) => {
              e.stopPropagation(); // Fix: Prevent resize from triggering DnD on touch
              header.getResizeHandler()(e);
            }}
            className={cn(
              "absolute -right-0.5 top-0 h-full w-1 cursor-col-resize select-none touch-none z-20",
              "hover:bg-primary/50",
              header.column.getIsResizing() && "bg-primary",
            )}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    );
  },
);
DraggableHeader.displayName = "DraggableHeader";

// Memoized details panel to prevent unnecessary re-renders during scroll
// Structure table component with resizable columns
const StructureTable = memo(({ tableStructure }: { tableStructure: any[] }) => {
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
            const isLast = index === structureTable.getAllColumns().length - 1;
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
});

// Preview table component with auto-sizing columns
const PreviewTable = memo(({ data }: { data: Record<string, any> }) => {
  const previewData = useMemo(
    () =>
      Object.entries(data)
        .filter(([key]) => key !== "_rowIndex")
        .map(([key, value]) => ({ field: key, value })),
    [data],
  );

  // Auto-calculate column sizes based on content
  const autoSizedColumns = useMemo<
    ColumnDef<{ field: string; value: any }>[]
  >(() => {
    // Calculate exact width needed for field names
    const maxFieldLength = Math.max(
      ...previewData.map((item) => item.field.length),
      5,
    );
    const fieldWidth = Math.min(maxFieldLength * 7 + 16, 200); // Tighter sizing

    return [
      {
        accessorKey: "field",
        header: "Field",
        size: fieldWidth,
        minSize: 50,
        maxSize: 200,
        cell: ({ getValue }) => (
          <div className="px-1.5 py-0.5">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {getValue() as string}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "value",
        header: "Value",
        size: 300,
        minSize: 100,
        maxSize: 600,
        cell: ({ getValue }) => {
          const value = getValue();
          const isMultiple = value === "(multiple values)";
          return (
            <div className="text-xs px-1.5 py-0.5">
              {isMultiple ? (
                <span className="text-muted-foreground italic">{value}</span>
              ) : value === null ? (
                <span className="text-muted-foreground italic">NULL</span>
              ) : typeof value === "object" ? (
                <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : typeof value === "boolean" ? (
                <span
                  className={cn(
                    "font-mono",
                    value ? "text-green-600" : "text-red-600",
                  )}
                >
                  {String(value)}
                </span>
              ) : (
                <span className="break-all font-mono">{String(value)}</span>
              )}
            </div>
          );
        },
      },
    ];
  }, [previewData]);

  const previewTable = useReactTable({
    data: previewData,
    columns: autoSizedColumns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 50,
      maxSize: 500,
    },
  });

  return (
    <div className="overflow-auto w-full">
      <table className="w-full" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {previewTable.getAllColumns().map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {previewTable.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-left text-xs font-medium px-1.5 py-0.5 bg-muted/30 relative border-r border-border/50"
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
          {previewTable.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b hover:bg-muted/20">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  style={{ width: `${cell.column.getSize()}px` }}
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
});

const DetailsPanel = memo(
  ({
    showDetails,
    getSelectionDetails,
    selectedRow,
    rowSelection,
    detailViewMode,
    setDetailViewMode,
    setShowDetails,
    rows,
  }: {
    showDetails: boolean;
    getSelectionDetails: any;
    selectedRow: any;
    rowSelection: RowSelectionState;
    detailViewMode: DetailViewMode;
    setDetailViewMode: (mode: DetailViewMode) => void;
    setShowDetails: (show: boolean) => void;
    rows: any[];
  }) => {
    if (!showDetails || (!getSelectionDetails && !selectedRow)) return null;

    return (
      <div className="flex flex-col h-full bg-muted/10 border-t">
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted/50 border rounded-md p-0.5">
              <ToggleButton
                isActive={detailViewMode === "table"}
                onClick={() => setDetailViewMode("table")}
              >
                <TableProperties className="h-3 w-3 mr-1" />
                Preview
              </ToggleButton>
              <ToggleButton
                isActive={detailViewMode === "json"}
                onClick={() => setDetailViewMode("json")}
              >
                <FileJson className="h-3 w-3 mr-1" />
                JSON
              </ToggleButton>
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
        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-2">
            {detailViewMode === "table" ? (
              <PreviewTable data={getSelectionDetails || selectedRow || {}} />
            ) : (
              <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto">
                {(() => {
                  const selectedIds = Object.keys(rowSelection).filter(
                    (k) => rowSelection[k],
                  );
                  if (selectedIds.length > 1) {
                    // Show array of selected rows for JSON view
                    const selectedRows = selectedIds
                      .map((id) => rows.find((r) => r.id === id)?.original)
                      .filter(Boolean)
                      .map((row) => {
                        const cleanRow = { ...row };
                        delete cleanRow._rowIndex;
                        return cleanRow;
                      });
                    return JSON.stringify(selectedRows, null, 2);
                  } else {
                    // Single row or shared values
                    const data = getSelectionDetails || selectedRow || {};
                    const cleanData = Object.fromEntries(
                      Object.entries(data).filter(
                        ([key]) => key !== "_rowIndex",
                      ),
                    );
                    return JSON.stringify(cleanData, null, 2);
                  }
                })()}
              </pre>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  },
);
DetailsPanel.displayName = "DetailsPanel";

// Skeleton loading row component
const SkeletonRow = memo(
  ({ virtualRow, columnCount }: { virtualRow: any; columnCount: number }) => (
    <div
      className="flex absolute w-full animate-pulse"
      style={{
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        willChange: "transform",
      }}
    >
      {Array.from({ length: columnCount }).map((_, index) => (
        <div
          key={index}
          className="flex items-center px-2 py-0.5 border-b border-r border-border/50"
          style={{
            width: `${100 / columnCount}%`,
          }}
        >
          <div className="h-3 bg-muted/50 rounded w-3/4"></div>
        </div>
      ))}
    </div>
  ),
);
SkeletonRow.displayName = "SkeletonRow";

// Memoized row component with improved performance
const VirtualRow = memo(
  ({
    row,
    virtualRow,
    isSelected,
    isHighlighted,
    onMouseDown,
    onMouseEnter,
    onDoubleClick,
  }: {
    row: any;
    virtualRow: any;
    isSelected: boolean;
    isHighlighted: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
    onDoubleClick: () => void;
  }) => (
    <div
      className={cn(
        "flex absolute w-full hover:bg-muted/30 cursor-pointer select-none border-l-2 border-transparent",
        isSelected && "bg-primary/10 border-l-primary/60",
        isHighlighted && "bg-accent/50",
      )}
      style={{
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        willChange: "transform",
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
    >
      {row.getVisibleCells().map((cell: any, index: number) => {
        const isLastColumn = index === row.getVisibleCells().length - 1;
        return (
          <div
            key={cell.id}
            className="flex items-center px-1.5 py-0.5 text-xs border-b border-r border-border/50 box-border"
            style={{
              width: cell.column.getSize(),
              minWidth: Math.max(cell.column.getSize(), 100),
              maxWidth: isLastColumn ? undefined : cell.column.getSize(),
              flex: isLastColumn ? "1 1 auto" : "none",
            }}
          >
            <div className="overflow-hidden w-full">
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          </div>
        );
      })}
    </div>
  ),
);
VirtualRow.displayName = "VirtualRow";

export function DataViewer({
  tableName,
  schema = "public",
  connectionId,
  onRowClick,
}: DataViewerProps) {
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
  const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [estimatedRowCount, setEstimatedRowCount] = useState<number | null>(
    null,
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>("table");
  const [detailsPanelSize, setDetailsPanelSize] = useState(30); // 30% default size

  // Click-drag selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null,
  );

  // Performance optimization: Defer expensive details calculation during selection
  const deferredRowSelection = useDeferredValue(rowSelection);
  const [, startTransition] = useTransition();

  // Infinite scroll state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const { activeConnectionId, connections } = useConnectionStore();
  const activeConnection = connectionId || activeConnectionId;

  // Refs for virtual scrolling
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Load saved column order on mount
  useEffect(() => {
    const loadColumnOrder = async () => {
      if (!activeConnection) return;

      const savedOrder = await cacheService.getColumnOrder(
        activeConnection,
        schema,
        tableName,
      );
      if (savedOrder && savedOrder.length > 0) {
        console.log(
          `[DataViewer] Loaded column order for ${schema}.${tableName}:`,
          savedOrder,
        );
        setColumnOrder(savedOrder);
      }
    };

    loadColumnOrder();
  }, [activeConnection, schema, tableName]);

  // Handle column drag end
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (active.id !== over?.id) {
        const oldIndex = columnOrder.indexOf(active.id as string);
        const newIndex = columnOrder.indexOf(over?.id as string);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
          setColumnOrder(newOrder);

          // Save the new column order
          if (activeConnection) {
            await cacheService.setColumnOrder(
              activeConnection,
              schema,
              tableName,
              newOrder,
            );
            console.log(
              `[DataViewer] Saved new column order for ${schema}.${tableName}`,
            );
          }
        }
      }
    },
    [columnOrder, activeConnection, schema, tableName],
  );

  // Fetch estimated row count
  const fetchEstimatedCount = useCallback(async () => {
    if (!activeConnection) return;

    try {
      const countQuery = `
        SELECT reltuples::BIGINT AS estimate
        FROM pg_class
        WHERE oid = '"${schema}"."${tableName}"'::regclass;
      `;

      const result = await secureDatabaseService.executeQuery(
        activeConnection,
        countQuery,
      );
      if (result.rows.length > 0 && result.rows[0]?.[0]) {
        setEstimatedRowCount(result.rows[0]![0]);
      }
    } catch (err) {
      console.error("Error fetching estimated count:", err);
      // Fallback to actual count if estimate fails
      try {
        const exactQuery = `SELECT COUNT(*) FROM "${schema}"."${tableName}"`;
        const result = await secureDatabaseService.executeQuery(
          activeConnection,
          exactQuery,
        );
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

      const result = await secureDatabaseService.executeQuery(
        activeConnection,
        structureQuery,
      );
      const structure = result.rows.map((row) => ({
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
  const loadTableData = useCallback(
    async (newOffset: number = 0, append: boolean = false) => {
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
          orderBy =
            "ORDER BY " +
            sorting
              .map((s) => `"${s.id}" ${s.desc ? "DESC" : "ASC"}`)
              .join(", ");
        }

        // Check cache first (only for non-sorted data)
        let result;
        if (sorting.length === 0) {
          const cached = cacheService.getTableData(
            activeConnection,
            schema,
            tableName,
            newOffset,
            FETCH_SIZE,
          );
          if (cached) {
            console.log(
              `[DataViewer] Cache hit for ${schema}.${tableName} at offset ${newOffset}`,
            );
            result = {
              columns: cached.columns,
              rows: cached.rows,
              execution_time: 0,
            };
          }
        }

        if (!result) {
          // Fetch data with offset and limit
          const query = `
          SELECT * FROM "${schema}"."${tableName}"
          ${orderBy}
          LIMIT ${FETCH_SIZE} OFFSET ${newOffset}
        `;

          result = await secureDatabaseService.executeQuery(
            activeConnection,
            query,
          );

          // Cache the result (only for non-sorted data)
          if (sorting.length === 0) {
            await cacheService.setTableData(
              activeConnection,
              schema,
              tableName,
              newOffset,
              FETCH_SIZE,
              {
                columns: result.columns,
                rows: result.rows,
                totalCount: estimatedRowCount || 0,
                timestamp: Date.now(),
              },
            );
          }
        }

        if (!append && result.rows.length > 0) {
          // Calculate initial column sizes based on content and column names
          const getInitialColumnSize = (colName: string) => {
            // Min size based on column name length
            const headerSize = colName.length * 8 + 24;
            const minSize = Math.max(headerSize, 100); // Minimum 100px for all columns

            // Sample first few rows to estimate content width
            const sampleSize = Math.min(result.rows.length, 10);
            let maxContentLength = 0;

            for (let i = 0; i < sampleSize; i++) {
              const value = result.rows[i][colName];
              if (value !== null && value !== undefined) {
                const stringValue = String(value);
                maxContentLength = Math.max(
                  maxContentLength,
                  stringValue.length,
                );
              }
            }

            // Estimate width based on content (average 6px per character for data)
            const contentSize = Math.min(maxContentLength * 6 + 24, 400);

            // Set reasonable defaults for common column patterns
            const lowerCol = colName.toLowerCase();
            let defaultSize = 120;

            if (lowerCol === "id" || lowerCol.endsWith("_id")) defaultSize = 60;
            else if (
              lowerCol.includes("date") ||
              lowerCol.includes("time") ||
              lowerCol.includes("_at")
            )
              defaultSize = 140;
            else if (lowerCol.includes("email")) defaultSize = 180;
            else if (lowerCol.includes("name") || lowerCol.includes("title"))
              defaultSize = 150;
            else if (
              lowerCol.includes("description") ||
              lowerCol.includes("content") ||
              lowerCol.includes("text")
            )
              defaultSize = 250;
            else if (lowerCol.includes("url") || lowerCol.includes("link"))
              defaultSize = 200;
            else if (lowerCol.includes("status") || lowerCol.includes("type"))
              defaultSize = 100;

            // Use the larger of: header size, content size, or default size
            const finalSize = Math.max(minSize, contentSize, defaultSize);

            return {
              size: Math.min(finalSize, 400), // Cap at 400px
              min: minSize,
              max: 500,
            };
          };

          // Generate columns without checkbox
          const tableColumns: ColumnDef<any>[] = [
            ...result.columns.map((col: string) => {
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
                    return (
                      <span className="text-muted-foreground italic text-xs">
                        NULL
                      </span>
                    );
                  }
                  if (typeof value === "boolean") {
                    return (
                      <span
                        className={cn(
                          "font-mono text-xs",
                          value ? "text-green-600" : "text-red-600",
                        )}
                      >
                        {String(value)}
                      </span>
                    );
                  }
                  if (typeof value === "object") {
                    return (
                      <span
                        className="font-mono text-xs"
                        title={JSON.stringify(value)}
                      >
                        {JSON.stringify(value).substring(0, 50)}...
                      </span>
                    );
                  }
                  return (
                    <span
                      className="block truncate text-xs"
                      title={String(value)}
                    >
                      {String(value)}
                    </span>
                  );
                },
                size: sizing.size,
                minSize: sizing.min,
                maxSize: sizing.max,
                enableSorting: true,
                enableHiding: true,
              };
            }),
          ];

          setColumns(tableColumns);

          // Set initial column order if not already set
          if (columnOrder.length === 0) {
            const order = result.columns.map((col: string) => col);
            setColumnOrder(order);
          }
        }

        // Convert rows to objects
        const tableData = result.rows.map((row, idx) => {
          const rowObj: any = { _rowIndex: newOffset + idx };
          result.columns.forEach((col: string, index: number) => {
            rowObj[col] = row[index];
          });
          return rowObj;
        });

        if (append) {
          setData((prev) => {
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
        setError(
          err instanceof Error ? err.message : "Failed to load table data",
        );
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
      }
    },
    [activeConnection, tableName, schema, sorting, connections],
  );

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

  // Memoize columns to prevent unnecessary re-renders
  const memoizedColumns = useMemo(() => columns, [JSON.stringify(columns)]);

  // Table instance with memoized options
  const table = useReactTable({
    data,
    columns: memoizedColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      columnSizing,
      columnOrder,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    enableRowSelection: true,
    defaultColumn: {
      size: 150,
      minSize: 50,
      maxSize: 400,
    },
    enableMultiRowSelection: true,
  });

  const { rows } = table.getRowModel();

  // Virtualizer for rows with improved performance
  const rowVirtualizer = useVirtualizer({
    count: rows.length + (isFetchingMore ? 10 : 0), // Add skeleton rows when loading
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(() => 28, []), // Compact row height
    overscan: 30, // Further increased overscan for smoother scrolling
    scrollMargin: 0,
    getItemKey: useCallback((index: number) => index, []),
    measureElement:
      typeof window !== "undefined" && window.ResizeObserver
        ? undefined
        : undefined,
  });

  // Handle infinite scroll with optimized debouncing
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastScrollTop = useRef(0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const container = e.currentTarget;
      const { scrollHeight, scrollTop, clientHeight } = container;

      // Only trigger on downward scroll
      const isScrollingDown = scrollTop > lastScrollTop.current;
      lastScrollTop.current = scrollTop;

      if (!isScrollingDown) return;

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Reduced debounce for faster response
      scrollTimeoutRef.current = setTimeout(() => {
        // Load more when approaching bottom (increased threshold for earlier loading)
        if (
          scrollHeight - scrollTop - clientHeight < 800 &&
          !isFetchingMore &&
          hasMore
        ) {
          loadTableData(offset, true);
        }
      }, 50); // Reduced from 100ms to 50ms
    },
    [offset, isFetchingMore, hasMore, loadTableData],
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+A or Ctrl+A to select all visible rows
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        const activeElement = document.activeElement;
        const isEditableElement =
          activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA";

        if (!isEditableElement && viewMode === "data") {
          e.preventDefault();
          table.toggleAllPageRowsSelected();
        }
      }

      // ESC to close details panel
      if (e.key === "Escape" && showDetails) {
        setShowDetails(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [table, viewMode, showDetails]);

  // Export data as CSV - memoized to prevent recreation
  const exportAsCSV = useCallback(() => {
    const headers = table
      .getAllColumns()
      .map((col) => col.id)
      .join(",");
    const rows = table
      .getFilteredRowModel()
      .rows.map((row) =>
        table
          .getAllColumns()
          .map((col) => {
            const value = row.getValue(col.id);
            if (value === null) return "";
            if (typeof value === "string" && value.includes(",")) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(","),
      )
      .join("\n");

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table, tableName]);

  // Handle row selection with click-drag - memoized callbacks
  const handleRowMouseDown = useCallback(
    (rowId: string, event: React.MouseEvent) => {
      event.preventDefault();

      // Find the actual row index for range selection
      const rowIndex = rows.findIndex((r) => r.id === rowId);
      if (rowIndex === -1) return;

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
          const row = rows[i];
          if (row) {
            newSelection[row.id] = true;
          }
        }
        setRowSelection(newSelection);
      } else if (event.metaKey || event.ctrlKey) {
        // Toggle single row with Cmd/Ctrl
        setRowSelection((prev) => ({
          ...prev,
          [rowId]: !prev[rowId],
        }));
        setLastSelectedIndex(rowIndex);
      } else {
        // Start new selection
        setIsSelecting(true);
        setSelectionStart(rowIndex);
        setRowSelection({ [rowId]: true });
        setLastSelectedIndex(rowIndex);
      }
    },
    [
      lastSelectedIndex,
      rowSelection,
      setRowSelection,
      setLastSelectedIndex,
      rows,
    ],
  );

  const handleRowMouseEnter = useCallback(
    (rowId: string) => {
      if (isSelecting && selectionStart !== null) {
        // Find the actual row index for range selection
        const rowIndex = rows.findIndex((r) => r.id === rowId);
        if (rowIndex === -1) return;

        const start = Math.min(selectionStart, rowIndex);
        const end = Math.max(selectionStart, rowIndex);
        const newSelection: RowSelectionState = {};

        for (let i = start; i <= end; i++) {
          const row = rows[i];
          if (row) {
            newSelection[row.id] = true;
          }
        }
        setRowSelection(newSelection);
      }
    },
    [isSelecting, selectionStart, rows],
  );

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  // Add global mouse up listener
  useEffect(() => {
    if (isSelecting) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => document.removeEventListener("mouseup", handleMouseUp);
    }
    return undefined;
  }, [isSelecting]);

  // Handle row click for details
  const handleRowClick = useCallback(
    (row: any) => {
      setSelectedRow(row);
      setShowDetails(true);
      onRowClick?.(row);
    },
    [onRowClick],
  );

  // Get selected count
  const selectedCount = Object.keys(rowSelection).filter(
    (k) => rowSelection[k],
  ).length;
  const {
    setSelectedRowCount,
    setTotalRowCount,
    setEstimatedRowCount: setUIEstimatedRowCount,
    setIsLoadingData,
    setCurrentTableName,
  } = useUIStore();

  // Update UI store
  useEffect(() => {
    setSelectedRowCount(selectedCount);

    // Clean up when component unmounts
    return () => {
      setSelectedRowCount(0);
    };
  }, [selectedCount, setSelectedRowCount]);

  // Update table info in UI store
  useEffect(() => {
    setCurrentTableName(tableName);
    setTotalRowCount(table.getFilteredRowModel().rows.length);
    setUIEstimatedRowCount(estimatedRowCount);

    return () => {
      setCurrentTableName(null);
      setTotalRowCount(0);
      setUIEstimatedRowCount(null);
    };
  }, [
    tableName,
    table.getFilteredRowModel().rows.length,
    estimatedRowCount,
    setCurrentTableName,
    setTotalRowCount,
    setUIEstimatedRowCount,
  ]);

  // Update loading state
  useEffect(() => {
    setIsLoadingData(isLoading || isFetchingMore);

    return () => {
      setIsLoadingData(false);
    };
  }, [isLoading, isFetchingMore, setIsLoadingData]);

  // Auto-show details when rows are selected (only after selection is complete)
  useEffect(() => {
    if (selectedCount > 0 && !showDetails && !isSelecting) {
      startTransition(() => {
        setShowDetails(true);
      });
    }
  }, [selectedCount, isSelecting]);

  // Calculate details for multiple selected rows - use deferred values for performance
  const getSelectionDetails = useMemo(() => {
    // Use deferred selection during drag operations to prevent expensive recalculations
    const selectionToUse = isSelecting ? deferredRowSelection : rowSelection;
    const selectedIds = Object.keys(selectionToUse).filter(
      (key) => selectionToUse[key],
    );
    if (selectedIds.length === 0) return null;

    if (selectedIds.length === 1) {
      // Single row selected - show that row
      const firstId = selectedIds[0];
      const row = rows.find((r) => r.id === firstId);
      return row?.original || selectedRow;
    }

    // Multiple rows selected - calculate shared values
    const selectedRows = selectedIds
      .map((id) => rows.find((r) => r.id === id)?.original)
      .filter(Boolean);
    if (selectedRows.length === 0) return null;

    const firstRow = selectedRows[0];
    const sharedValues: Record<string, any> = {};

    // Check each field for shared values
    Object.keys(firstRow).forEach((key) => {
      if (key === "_rowIndex") return;

      const firstValue = firstRow[key];
      const allSame = selectedRows.every((row) => {
        const value = row[key];
        // Deep equality check for objects
        if (typeof value === "object" && value !== null) {
          return JSON.stringify(value) === JSON.stringify(firstValue);
        }
        return value === firstValue;
      });

      if (allSame) {
        sharedValues[key] = firstValue;
      } else {
        sharedValues[key] = "(multiple values)";
      }
    });

    return sharedValues;
  }, [deferredRowSelection, rowSelection, rows, selectedRow, isSelecting]);

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
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-0.5 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-muted/50 border rounded-md p-0.5 h-6">
            <ToggleButton
              isActive={viewMode === "data"}
              onClick={() => setViewMode("data")}
            >
              <Table className="h-3 w-3 mr-1" />
              Data
            </ToggleButton>
            <ToggleButton
              isActive={viewMode === "structure"}
              onClick={() => setViewMode("structure")}
            >
              <Database className="h-3 w-3 mr-1" />
              Structure
            </ToggleButton>
          </div>

          {viewMode === "data" && (
            <>
              {/* Global search */}
              <div className="relative flex-1 flex items-center bg-muted/50 border rounded-md px-1.5 h-6 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
                <Search className="h-3 w-3 text-muted-foreground mr-1" />
                <Input
                  placeholder="Search..."
                  value={globalFilter ?? ""}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="h-4 border-0 !bg-transparent !outline-none px-0 text-xs focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {viewMode === "data" && (
            <>
              {/* Column visibility */}
              <DropdownMenu
                open={isColumnsDropdownOpen}
                onOpenChange={setIsColumnsDropdownOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs bg-muted/50 border rounded-md hover:bg-muted/70"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56"
                  onInteractOutside={() => setIsColumnsDropdownOpen(false)}
                >
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-medium">Visible Columns</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        table.getAllColumns().forEach((column) => {
                          column.toggleVisibility(true);
                        });
                      }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <DropdownMenuSeparator />
                  <ScrollArea className="h-64">
                    <div className="px-1">
                      {table.getAllColumns().map((column) => {
                        return (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            className="text-xs py-1.5 cursor-pointer"
                            checked={column.getIsVisible()}
                            onCheckedChange={(value) =>
                              column.toggleVisibility(!!value)
                            }
                            onSelect={(e) => e.preventDefault()}
                          >
                            <span className="truncate" title={column.id}>
                              {column.id}
                            </span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* More Actions Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs bg-muted/50 border rounded-md hover:bg-muted/70"
                  >
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onClick={exportAsCSV}>
                    <Download className="h-3 w-3 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                  {selectedRow && (
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={() => setShowDetails(!showDetails)}
                    >
                      {showDetails ? (
                        <ChevronDown className="h-3 w-3 mr-2" />
                      ) : (
                        <ChevronUp className="h-3 w-3 mr-2" />
                      )}
                      Row Details
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {viewMode === "structure" && (
            <span className="text-xs text-muted-foreground">
              {tableStructure.length} columns
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden transition-opacity duration-150">
        {viewMode === "data" ? (
          /* Data View with Virtual Scrolling */
          <div
            ref={tableContainerRef}
            className={cn(
              "h-full overflow-auto",
              isSelecting && "no-select",
            )}
            style={{
              contain: "strict",
              overscrollBehavior: "contain",
            }}
            onScroll={handleScroll}
          >
            <div style={{ minWidth: "100%" }}>
              {/* Table Header with Drag and Drop */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToHorizontalAxis]}
              >
                <div 
                  className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
                  style={{
                    width: `${table.getAllColumns().reduce((sum, col) => sum + col.getSize(), 0)}px`
                  }}
                >
                  {table.getHeaderGroups().map((headerGroup) => (
                    <div
                      key={headerGroup.id}
                      className="flex h-7 border-b border-border/50"
                      style={{
                        width: `${table.getAllColumns().reduce((sum, col) => sum + col.getSize(), 0)}px`
                      }}
                    >
                      <SortableContext
                        items={columnOrder}
                        strategy={horizontalListSortingStrategy}
                      >
                        {headerGroup.headers.map((header) => (
                          <DraggableHeader
                            key={header.id}
                            column={header.column}
                            header={header}
                          />
                        ))}
                      </SortableContext>
                    </div>
                  ))}
                </div>
              </DndContext>

              {/* Virtual Table Body */}
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: `${table.getAllColumns().reduce((sum, col) => sum + col.getSize(), 0)}px`,
                  position: "relative",
                }}
              >
                {rows.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-xs">
                      No data available
                    </p>
                  </div>
                ) : (
                  rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const isSkeletonRow = virtualRow.index >= rows.length;

                    if (isSkeletonRow) {
                      // Show skeleton row when loading more data
                      return (
                        <SkeletonRow
                          key={`skeleton-${virtualRow.index}`}
                          virtualRow={virtualRow}
                          columnCount={table.getAllColumns().length}
                        />
                      );
                    }

                    const row = rows[virtualRow.index] as Row<any>;
                    if (!row) return null;

                    return (
                      <VirtualRow
                        key={row.id}
                        row={row}
                        virtualRow={virtualRow}
                        isSelected={row.getIsSelected()}
                        isHighlighted={
                          selectedRow?._rowIndex === row.original._rowIndex
                        }
                        onMouseDown={(e) => handleRowMouseDown(row.id, e)}
                        onMouseEnter={() => handleRowMouseEnter(row.id)}
                        onDoubleClick={() => handleRowClick(row.original)}
                      />
                    );
                  })
                )}
              </div>

              {/* Loading more indicator */}
              {isFetchingMore && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                  <span className="text-xs text-muted-foreground">
                    Loading more...
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Structure View */
          <StructureTable tableStructure={tableStructure} />
        )}
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <ResizablePanelGroup direction="vertical" className="h-full">
        <ResizablePanel 
          defaultSize={showDetails ? (100 - detailsPanelSize) : 100} 
          minSize={30}
        >
          <div className="h-full flex flex-col">{tableContent}</div>
        </ResizablePanel>
        {showDetails && (selectedCount > 0 || selectedRow) && (
          <>
            <ResizableHandle />
            <ResizablePanel
              defaultSize={showDetails ? detailsPanelSize : 0}
              minSize={15}
              maxSize={70}
              onResize={(size) => setDetailsPanelSize(size)}
            >
              <DetailsPanel
                showDetails={showDetails}
                getSelectionDetails={getSelectionDetails}
                selectedRow={selectedRow}
                rowSelection={rowSelection}
                detailViewMode={detailViewMode}
                setDetailViewMode={setDetailViewMode}
                setShowDetails={setShowDetails}
                rows={rows}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
