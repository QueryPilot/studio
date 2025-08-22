import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useDeferredValue,
} from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type ColumnSizingState,
  type Row,
  type ColumnOrderState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { cacheService } from "@/services/cacheService";
import { useUIStore } from "@/stores/uiStore";

import {
  type DataViewerProps,
  type ViewMode,
  type DetailViewMode,
  type TableColumn,
} from "./types";
import { FETCH_SIZE, OVERSCAN } from "./constants";
import { getInitialColumnSize } from "./utils";
import { DataCell } from "@/components/cells";
import {
  DraggableHeader,
  StructureTable,
  IndexesTable,
  TriggersTable,
  DetailsPanel,
  SkeletonRow,
  VirtualRow,
  Toolbar,
  RowContextMenu,
  TableSkeleton,
  type TableIndex,
} from "./components";
import {
  copyAsCSV,
  copyAsJSON,
  copyAsSQLValues,
  copyAsInsertStatement,
} from "./utils/copyUtils";

export function DataViewer({
  tableName,
  schema = "public",
  connectionId,
  onRowClick,
  initialViewMode,
  preloadedData,
}: DataViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || "data");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<ColumnDef<any>[]>([]);
  const [tableStructure, setTableStructure] = useState<TableColumn[]>([]);
  const [tableIndexes, setTableIndexes] = useState<TableIndex[]>([]);
  const [tableTriggers, setTableTriggers] = useState<any[]>([]);
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
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>("table");
  const [detailsPanelSize, setDetailsPanelSize] = useState(30); // 30% default size

  // Cell selection and editing state
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [cellValues, setCellValues] = useState<Map<string, any>>(new Map());

  // Click-drag selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null,
  );

  // Infinite scroll state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const { activeConnectionId, connections } = useConnectionStore();
  const activeConnection = connectionId || activeConnectionId;
  const { setQueryTime: setUIQueryTime } = useUIStore();

  // Refs for virtual scrolling
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Drag and drop sensors - disable auto-scroll to prevent scrolling during column drag
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

  // Update viewMode when initialViewMode changes
  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode);
    }
  }, [initialViewMode]);

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
        // Column order loaded successfully
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
            // Column order saved successfully
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
        WHERE oid = '"${schema}"."${tableName}"'::regclass
      `;

      const result = await secureDatabaseService.executeQuery(
        activeConnection,
        countQuery,
      );
      if (result.rows.length > 0 && result.rows[0]?.[0]) {
        setEstimatedRowCount(result.rows[0][0]);
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

  // Fetch table indexes
  const fetchTableIndexes = useCallback(async () => {
    if (!activeConnection) return;

    try {
      const database = ''; // Use default database for now
      const indexes = await secureDatabaseService.getTableIndexes(
        activeConnection,
        database,
        schema,
        tableName
      );
      
      setTableIndexes(indexes);
    } catch (err) {
      console.error("Error fetching table indexes:", err);
      setTableIndexes([]);
    }
  }, [activeConnection, schema, tableName]);

  // Fetch table triggers
  const fetchTableTriggers = useCallback(async () => {
    if (!activeConnection) return;

    try {
      // Get connection details to determine database type
      const connection = connections.get(activeConnection);
      if (!connection) return;

      console.log('Fetching triggers for:', { 
        type: connection.config.type, 
        tableName, 
        schema,
        database: connection.config.database 
      });

      let triggersQuery = '';

      switch (connection.config.type) {
        case 'postgresql':
          // Use template literals for PostgreSQL to avoid parameter binding issues
          triggersQuery = `
            SELECT 
              tg.trigger_name as name,
              tg.event_manipulation as event,
              tg.action_timing as timing,
              tg.action_orientation as level,
              CASE 
                WHEN tg.is_trigger_enabled = 'YES' THEN true
                ELSE false
              END as enabled,
              tg.action_statement as function_name,
              pg_get_triggerdef(t.oid) as definition
            FROM information_schema.triggers tg
            LEFT JOIN pg_trigger t ON t.tgname = tg.trigger_name
            LEFT JOIN pg_class c ON c.oid = t.tgrelid
            WHERE tg.event_object_table = '${String(tableName).replace(/'/g, "''")}'  
              AND tg.trigger_schema = '${String(schema).replace(/'/g, "''")}'
            ORDER BY tg.trigger_name;
          `;
          break;

        case 'mysql': {
          const mysqlSchema = schema || connection.config.database;
          triggersQuery = `
            SELECT 
              TRIGGER_NAME as name,
              EVENT_MANIPULATION as event,
              ACTION_TIMING as timing,
              ACTION_ORIENTATION as level,
              CASE 
                WHEN TRIGGER_NAME IS NOT NULL THEN true
                ELSE false
              END as enabled,
              ACTION_STATEMENT as function_name,
              CONCAT(
                'CREATE TRIGGER ', TRIGGER_NAME, ' ',
                ACTION_TIMING, ' ', EVENT_MANIPULATION, ' ',
                'ON ', EVENT_OBJECT_TABLE, ' ',
                'FOR EACH ', ACTION_ORIENTATION, ' ',
                ACTION_STATEMENT
              ) as definition
            FROM information_schema.TRIGGERS
            WHERE EVENT_OBJECT_TABLE = '${String(tableName).replace(/'/g, "''")}'
              AND TRIGGER_SCHEMA = '${String(mysqlSchema).replace(/'/g, "''")}'
            ORDER BY TRIGGER_NAME;
          `;
          break;
        }

        case 'sqlite':
          triggersQuery = `
            SELECT 
              name,
              CASE 
                WHEN sql LIKE '%INSERT%' THEN 'INSERT'
                WHEN sql LIKE '%UPDATE%' THEN 'UPDATE'
                WHEN sql LIKE '%DELETE%' THEN 'DELETE'
                ELSE 'UNKNOWN'
              END as event,
              CASE 
                WHEN sql LIKE '%BEFORE%' THEN 'BEFORE'
                WHEN sql LIKE '%AFTER%' THEN 'AFTER'
                WHEN sql LIKE '%INSTEAD OF%' THEN 'INSTEAD OF'
                ELSE 'UNKNOWN'
              END as timing,
              CASE 
                WHEN sql LIKE '%FOR EACH ROW%' THEN 'ROW'
                ELSE 'STATEMENT'
              END as level,
              1 as enabled,
              '' as function_name,
              sql as definition
            FROM sqlite_master
            WHERE type = 'trigger'
              AND tbl_name = '${String(tableName).replace(/'/g, "''")}'
            ORDER BY name;
          `;
          break;

        default:
          console.warn(`Triggers not supported for database type: ${connection.config.type}`);
          setTableTriggers([]);
          return;
      }
      
      console.log('Executing trigger query:', triggersQuery);
      
      const result = await secureDatabaseService.executeQuery(
        activeConnection,
        triggersQuery
      );
      
      console.log('Trigger query result:', result);
      
      const triggers = result.rows.map((row: any) => ({
        name: row[0],
        event: row[1],
        timing: row[2],
        level: row[3],
        enabled: row[4],
        function_name: row[5],
        definition: row[6],
      }));
      
      console.log('Parsed triggers:', triggers);
      setTableTriggers(triggers);
    } catch (err) {
      console.error("Failed to fetch table triggers:", err);
      setTableTriggers([]);
    }
  }, [activeConnection, connections, schema, tableName]);

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
          CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
          fk.constraint_name as fk_constraint_name,
          fk.referenced_schema,
          fk.referenced_table,
          fk.referenced_column,
          fk.delete_rule,
          fk.update_rule,
          chk.check_clause
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
          SELECT 
            kcu.column_name,
            kcu.constraint_name,
            ccu.table_schema AS referenced_schema,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            rc.delete_rule,
            rc.update_rule
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          JOIN information_schema.referential_constraints rc
            ON rc.constraint_name = tc.constraint_name
            AND rc.constraint_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND kcu.table_schema = '${schema}'
            AND kcu.table_name = '${tableName}'
        ) fk ON c.column_name = fk.column_name
        LEFT JOIN (
          SELECT 
            ccu.column_name,
            pg_get_constraintdef(con.oid) AS check_clause
          FROM pg_constraint con
          JOIN pg_attribute a ON a.attnum = ANY(con.conkey)
          JOIN pg_class cl ON cl.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = con.conname
            AND ccu.table_schema = n.nspname
          WHERE con.contype = 'c'
            AND n.nspname = '${schema}'
            AND cl.relname = '${tableName}'
        ) chk ON c.column_name = chk.column_name
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
        fk_reference: row[6] ? {
          constraint_name: row[7],
          referenced_schema: row[8],
          referenced_table: row[9],
          referenced_column: row[10],
          on_delete: row[11],
          on_update: row[12],
        } : undefined,
        check_constraint: row[13] || undefined,
      }));

      setTableStructure(structure);
      setStructureLoaded(true);
    } catch (err) {
      console.error("Error fetching table structure:", err);
    }
  }, [activeConnection, schema, tableName]);

  // Load table data with bidirectional windowing
  const loadTableData = useCallback(
    async (
      newOffset: number = 0,
      append: boolean = false,
      prepend: boolean = false,
    ) => {
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

      if (!append && !prepend) {
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
            // Cache hit for table data
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
          // Generate columns without checkbox
          const tableColumns: ColumnDef<any>[] = [
            ...result.columns.map((col: string, index: number) => {
              const sizing = getInitialColumnSize(col, result.rows);
              // Try to get column metadata from result or from table structure
              const colMeta = result.columnMeta?.[index];
              const structureCol = tableStructure.find(s => s.column_name === col);
              const columnMetadata = colMeta || (structureCol ? {
                name: col,
                db_type: structureCol.data_type,
                nullable: structureCol.is_nullable === 'YES',
                character_maximum_length: structureCol.character_maximum_length,
              } : undefined);
              
              return {
                accessorKey: col,
                meta: columnMetadata, // Add metadata for cell editing
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
                  
                  // Use DataCell only if we have column metadata
                  if (columnMetadata) {
                    return (
                      <DataCell
                        value={value}
                        columnMeta={columnMetadata}
                        isEditing={false}
                      />
                    );
                  }
                  
                  // Fallback to basic rendering when no metadata
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
                    const jsonStr = JSON.stringify(value);
                    return (
                      <span
                        className="block truncate font-mono text-xs whitespace-nowrap"
                        title={jsonStr}
                      >
                        {jsonStr}
                      </span>
                    );
                  }
                  return (
                    <span
                      className="block truncate text-xs whitespace-nowrap"
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

        // Convert rows to objects with unique row IDs
        // Use a combination of offset, index, and first few cell values for uniqueness
        const tableData = result.rows.map((row, idx) => {
          const absoluteIndex = newOffset + idx;
          // Create a unique key using index and first few values
          const rowKey = `${absoluteIndex}_${row.slice(0, 3).join('_')}`;
          const rowObj: any = { 
            _rowIndex: absoluteIndex,
            _rowKey: rowKey 
          };
          result.columns.forEach((col: string, index: number) => {
            rowObj[col] = row[index];
          });
          return rowObj;
        });

        if (append) {
          // Simple append without removing old data for now
          setData((prev) => [...prev, ...tableData]);
        } else {
          // Initial load or refresh
          setData(tableData);
        }

        // Update offset for next fetch
        if (!prepend) {
          setOffset(newOffset + result.rows.length);
        }

        // Check if we've hit the end
        const hitEnd = result.rows.length < FETCH_SIZE;
        setHasMore(!hitEnd);

        // Update total rows known if we hit the end
        if (hitEnd && !prepend) {
          const total = newOffset + result.rows.length;
          // Update UI store with exact count
          useUIStore.getState().setEstimatedRowCount(total);
        }

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
    // If we have preloaded data, use it directly
    if (preloadedData) {
      setIsLoading(false);
      
      // Transform the data from array of arrays to array of objects if needed
      let transformedData = preloadedData.data;
      if (preloadedData.data.length > 0 && Array.isArray(preloadedData.data[0])) {
        // Data is in array format, need to transform to object format
        transformedData = preloadedData.data.map((row: any, idx: number) => {
          const rowKey = `${idx}_${row.slice(0, 3).join('_')}`;
          const rowObj: any = { 
            _rowIndex: idx,
            _rowKey: rowKey
          };
          if (preloadedData.columns) {
            preloadedData.columns.forEach((col: string, colIndex: number) => {
              rowObj[col] = row[colIndex];
            });
          }
          return rowObj;
        });
      } else if (preloadedData.data.length > 0 && !preloadedData.data[0]._rowIndex) {
        // Data is already in object format but missing _rowIndex and _rowKey
        transformedData = preloadedData.data.map((row: any, idx: number) => {
          const rowValues = Object.values(row).slice(0, 3).join('_');
          return {
            ...row,
            _rowIndex: idx,
            _rowKey: `${idx}_${rowValues}`
          };
        });
      }
      
      setData(transformedData);
      setDataLoaded(true);
      setHasMore(false); // All data is preloaded
      setEstimatedRowCount(preloadedData.totalRows || transformedData.length);
      
      // Generate columns from the data
      if (preloadedData.columns && preloadedData.columns.length > 0) {
        const generatedColumns: ColumnDef<any>[] = preloadedData.columns.map((col) => {
          const columnSize = getInitialColumnSize(col, transformedData);
          // Create basic metadata for preloaded columns
          const columnMetadata = {
            name: col,
            db_type: "text", // Default type for preloaded data
            nullable: true,
          };
          return {
            id: col,
            accessorKey: col,
            meta: columnMetadata,
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
                const jsonStr = JSON.stringify(value, null, 2);
                return (
                  <span
                    className="block truncate font-mono text-xs whitespace-nowrap"
                    title={jsonStr}
                  >
                    {jsonStr}
                  </span>
                );
              }
              return (
                <span
                  className="block truncate text-xs whitespace-nowrap"
                  title={String(value)}
                >
                  {String(value)}
                </span>
              );
            },
            size: columnSize.size,
            minSize: columnSize.min,
            maxSize: columnSize.max,
            enableSorting: true,
            enableResizing: true,
            enableHiding: true,
          };
        });
        setColumns(generatedColumns);
        setColumnOrder(preloadedData.columns);
        
        // Initialize column sizing state
        const sizingState: ColumnSizingState = {};
        preloadedData.columns.forEach((col) => {
          const size = getInitialColumnSize(col, transformedData);
          sizingState[col] = size.size;
        });
        setColumnSizing(sizingState);
      }
      
      // Create mock structure for query results
      const mockStructure: TableColumn[] = preloadedData.columns.map((col) => ({
        column_name: col,
        data_type: "text",
        is_nullable: "YES",
        column_default: null,
        character_maximum_length: null,
        is_primary_key: false,
        is_foreign_key: false,
      }));
      setTableStructure(mockStructure);
      setStructureLoaded(true);
      
      // Set query time in UI store if provided
      if (preloadedData.queryTime !== undefined) {
        setUIQueryTime(preloadedData.queryTime);
      }
    } else if (activeConnection) {
      // Normal mode - fetch from database
      setOffset(0);
      setHasMore(true);

      void loadTableData(0, false);
      void fetchEstimatedCount();
      void fetchTableStructure();
    }
  }, [activeConnection, tableName, schema, preloadedData]);

  // Don't reload when switching view modes - data is already cached
  useEffect(() => {
    // This effect is intentionally empty - we preload both views
  }, [viewMode]);

  // Load indexes when indexes view is selected
  useEffect(() => {
    if (viewMode === "indexes" && tableIndexes.length === 0) {
      void fetchTableIndexes();
    }
  }, [viewMode, fetchTableIndexes]);

  // Load triggers when triggers view is selected
  useEffect(() => {
    if (viewMode === "triggers" && tableTriggers.length === 0) {
      void fetchTableTriggers();
    }
  }, [viewMode, fetchTableTriggers, tableTriggers.length]);

  // Handle sorting changes
  useEffect(() => {
    if (viewMode === "data" && !isLoading) {
      // Reset state and reload when sorting changes
      setOffset(0);
      setHasMore(true);
      setData([]);
      void loadTableData(0, false);
    }
  }, [sorting]);

  // Memoize columns using stable key instead of JSON.stringify
  const columnKey = useMemo(() => {
    return columns
      .map((col) => {
        const key = typeof col === "object" && col.id ? col.id : String(col);
        return key;
      })
      .join(",");
  }, [columns]);

  const memoizedColumns = useMemo(() => columns, [columnKey]);

  // Memoize table state object to prevent unnecessary recalculations
  const tableState = useMemo(
    () => ({
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      columnSizing,
      columnOrder,
      selectedRowIds,
    }),
    [
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      columnSizing,
      columnOrder,
      selectedRowIds,
    ],
  );

  // Table instance with memoized options
  const table = useReactTable({
    data,
    columns: memoizedColumns,
    state: tableState,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: (updater) => {
      // Convert TanStack Table's RowSelectionState updates to Set updates
      if (typeof updater === "function") {
        const currentState = Array.from(selectedRowIds).reduce<
          Record<string, boolean>
        >((acc, id) => {
          acc[id] = true;
          return acc;
        }, {});
        const newState = updater(currentState);
        const newSet = new Set(
          Object.keys(newState).filter((id) => newState[id]),
        );
        setSelectedRowIds(newSet);
      } else {
        const newSet = new Set(
          Object.keys(updater).filter((id) => updater[id]),
        );
        setSelectedRowIds(newSet);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    enableRowSelection: true,
    getRowId: useCallback((row: any) => row._rowKey || String(row._rowIndex), []), // Use unique rowKey if available
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
    count: data.length + (hasMore ? 5 : 0), // Add 5 skeleton rows when loading more
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(() => 28, []), // Row height for text-xs
    overscan: OVERSCAN, // Use constant from constants.ts
    scrollMargin: 0,
    getItemKey: useCallback((index: number) => index, []),
    measureElement:
      typeof window !== "undefined" && window.ResizeObserver
        ? undefined
        : undefined,
  });

  // Virtualizer for columns - only activate when there are many columns
  const visibleColumns = table.getVisibleLeafColumns();
  const shouldVirtualizeColumns = visibleColumns.length > 15; // Threshold for column virtualization

  const columnVirtualizer = useVirtualizer({
    count: shouldVirtualizeColumns ? visibleColumns.length : 0,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        // Always return the actual column size for accurate virtualization
        return visibleColumns[index]?.getSize() ?? 150;
      },
      [visibleColumns],
    ),
    horizontal: true, // Key option for column virtualization
    overscan: 3, // Render more columns off-screen to prevent gaps
    scrollMargin: 0,
    getItemKey: useCallback(
      (index: number) => {
        return shouldVirtualizeColumns
          ? visibleColumns[index]?.id ?? index
          : index;
      },
      [shouldVirtualizeColumns, visibleColumns],
    ),
  });

  // Memoize total table width calculation to prevent recalculation on every render
  const totalTableWidth = useMemo(() => {
    if (shouldVirtualizeColumns && columnVirtualizer) {
      // Use virtualizer's total size when virtualizing columns
      return `${columnVirtualizer.getTotalSize()}px`;
    }
    // When not virtualizing, use minimum of 100% to fill container
    const width = table
      .getAllColumns()
      .reduce((sum, col) => sum + col.getSize(), 0);
    // Use 100% if columns don't fill the container, otherwise use actual width
    return width < 800 ? "100%" : `${width}px`;
  }, [
    shouldVirtualizeColumns,
    columnVirtualizer?.getTotalSize(),
    table
      .getAllColumns()
      .map((c) => c.getSize())
      .join(","),
  ]); // Only recalculate when column sizes change

  // Simple infinite scroll handler for better performance
  const handleScroll = useCallback(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const { scrollHeight, scrollTop, clientHeight } = container;

    // Load more when near bottom
    if (
      scrollHeight - scrollTop - clientHeight < 500 &&
      !isFetchingMore &&
      hasMore
    ) {
      void loadTableData(offset, true, false);
    }
  }, [offset, isFetchingMore, hasMore, loadTableData]);

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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
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

      // Check if it's a right-click
      if (event.button === 2) {
        // Right-click behavior:
        // - If clicking on already selected row, preserve selection
        // - If clicking on unselected row, select only that row
        if (!selectedRowIds.has(rowId)) {
          setSelectedRowIds(new Set([rowId]));
          setLastSelectedIndex(rowIndex);
        }
        // Don't start drag selection on right-click
        return;
      }

      // Left-click behavior (button === 0)
      // If shift is held and we have a last selected index, select range
      if (event.shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        // Keep existing selections if Cmd/Ctrl is held
        if (event.metaKey || event.ctrlKey) {
          setSelectedRowIds((prev) => {
            const newSet = new Set(prev);
            for (let i = start; i <= end; i++) {
              const row = rows[i];
              if (row) {
                newSet.add(row.id);
              }
            }
            return newSet;
          });
        } else {
          const newSet = new Set<string>();
          for (let i = start; i <= end; i++) {
            const row = rows[i];
            if (row) {
              newSet.add(row.id);
            }
          }
          setSelectedRowIds(newSet);
        }
      } else if (event.metaKey || event.ctrlKey) {
        // Toggle single row with Cmd/Ctrl
        setSelectedRowIds((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(rowId)) {
            newSet.delete(rowId);
          } else {
            newSet.add(rowId);
          }
          return newSet;
        });
        setLastSelectedIndex(rowIndex);
      } else {
        // Start new selection
        setIsSelecting(true);
        setSelectionStart(rowIndex);
        setSelectedRowIds(new Set([rowId]));
        setLastSelectedIndex(rowIndex);
      }
    },
    [lastSelectedIndex, rows, selectedRowIds],
  );

  const handleRowMouseEnter = useCallback(
    (rowId: string) => {
      if (isSelecting && selectionStart !== null) {
        // Find the actual row index for range selection
        const rowIndex = rows.findIndex((r) => r.id === rowId);
        if (rowIndex === -1) return;

        const start = Math.min(selectionStart, rowIndex);
        const end = Math.max(selectionStart, rowIndex);
        const newSet = new Set<string>();

        for (let i = start; i <= end; i++) {
          const row = rows[i];
          if (row) {
            newSet.add(row.id);
          }
        }
        setSelectedRowIds(newSet);
      }
    },
    [isSelecting, selectionStart, rows],
  );

  // Auto-scroll during drag selection
  const autoScrollRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelecting || !tableContainerRef.current) return;

      const container = tableContainerRef.current;
      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY;
      const scrollSpeed = 3;
      const scrollThreshold = 50;

      // Clear existing auto-scroll
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }

      let shouldScroll = false;
      let scrollDirection = 0;

      // Check if we need to auto-scroll
      if (mouseY < rect.top + scrollThreshold) {
        shouldScroll = true;
        scrollDirection = -scrollSpeed;
      } else if (mouseY > rect.bottom - scrollThreshold) {
        shouldScroll = true;
        scrollDirection = scrollSpeed;
      }

      if (shouldScroll) {
        const scroll = () => {
          if (!isSelecting || !tableContainerRef.current) return;

          const newScrollTop = Math.max(
            0,
            Math.min(
              container.scrollHeight - container.clientHeight,
              container.scrollTop + scrollDirection,
            ),
          );

          if (newScrollTop !== container.scrollTop) {
            container.scrollTop = newScrollTop;
            autoScrollRef.current = requestAnimationFrame(scroll);
          }
        };
        autoScrollRef.current = requestAnimationFrame(scroll);
      }
    },
    [isSelecting],
  );

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
    setSelectionStart(null);

    // Clean up auto-scroll
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  // Add global mouse up listener
  useEffect(() => {
    if (isSelecting) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
    return undefined;
  }, [isSelecting, handleMouseUp]);

  // Cleanup auto-scroll on unmount
  useEffect(() => {
    return () => {
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
      }
    };
  }, []);

  // Handle row click for details
  const handleRowClick = useCallback(
    (row: any) => {
      setSelectedRow(row);
      setShowDetails(true);
      onRowClick?.(row);
    },
    [onRowClick],
  );

  // Handle cell selection
  const handleCellClick = useCallback(
    (rowId: string, columnId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setSelectedCell({ rowId, columnId });
      // Clear editing if clicking on a different cell
      if (editingCell && (editingCell.rowId !== rowId || editingCell.columnId !== columnId)) {
        setEditingCell(null);
      }
    },
    [editingCell],
  );

  // Handle cell double-click to edit
  const handleCellDoubleClick = useCallback(
    (rowId: string, columnId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setSelectedCell({ rowId, columnId });
      setEditingCell({ rowId, columnId });
    },
    [],
  );

  // Handle cell edit button click
  const handleEditButtonClick = useCallback(
    (rowId: string, columnId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      setSelectedCell({ rowId, columnId });
      setEditingCell({ rowId, columnId });
    },
    [],
  );

  // Handle cell value change
  const handleCellValueChange = useCallback(
    (rowId: string, columnId: string, value: any) => {
      const key = `${rowId}-${columnId}`;
      setCellValues((prev) => {
        const newMap = new Map(prev);
        newMap.set(key, value);
        return newMap;
      });
    },
    [],
  );

  // Handle edit complete
  const handleEditComplete = useCallback(() => {
    if (editingCell) {
      // Here you would typically save the value to the database
      // For now, just clear the editing state
      setEditingCell(null);
    }
  }, [editingCell]);

  // Handle Tab navigation in edit mode
  const handleCellKeyDown = useCallback(
    (event: React.KeyboardEvent, rowId: string, columnId: string) => {
      if (event.key === "Tab" && editingCell) {
        event.preventDefault();
        
        const visibleColumns = table.getVisibleLeafColumns();
        const currentColIndex = visibleColumns.findIndex((col) => col.id === columnId);
        const currentRowIndex = rows.findIndex((row) => row.id === rowId);
        
        let nextRowId = rowId;
        let nextColumnId = columnId;
        
        if (event.shiftKey) {
          // Tab backward
          if (currentColIndex > 0) {
            // Move to previous column in same row
            nextColumnId = visibleColumns[currentColIndex - 1]?.id || columnId;
          } else if (currentRowIndex > 0) {
            // Move to last column of previous row
            const prevRow = rows[currentRowIndex - 1];
            if (prevRow) {
              nextRowId = prevRow.id;
              nextColumnId = visibleColumns[visibleColumns.length - 1]?.id || columnId;
            }
          }
        } else {
          // Tab forward
          if (currentColIndex < visibleColumns.length - 1) {
            // Move to next column in same row
            nextColumnId = visibleColumns[currentColIndex + 1]?.id || columnId;
          } else if (currentRowIndex < rows.length - 1) {
            // Move to first column of next row
            const nextRow = rows[currentRowIndex + 1];
            if (nextRow) {
              nextRowId = nextRow.id;
              nextColumnId = visibleColumns[0]?.id || columnId;
            }
          }
        }
        
        // Save current cell and move to next
        handleEditComplete();
        setSelectedCell({ rowId: nextRowId, columnId: nextColumnId });
        setEditingCell({ rowId: nextRowId, columnId: nextColumnId });
      } else if (event.key === "Escape" && editingCell) {
        // Cancel editing
        setEditingCell(null);
        // Optionally reset the value
        const key = `${rowId}-${columnId}`;
        setCellValues((prev) => {
          const newMap = new Map(prev);
          newMap.delete(key);
          return newMap;
        });
      } else if (event.key === "Enter" && !editingCell && selectedCell) {
        // Enter on selected cell starts editing
        if (selectedCell.rowId === rowId && selectedCell.columnId === columnId) {
          setEditingCell({ rowId, columnId });
        }
      }
    },
    [editingCell, selectedCell, table, rows, handleEditComplete],
  );

  // Memoize selected rows to avoid expensive recalculation on every render
  const selectedRows = useMemo(() => {
    const selectedIds = Array.from(selectedRowIds);
    return rows
      .filter((row) => selectedIds.includes(row.id))
      .map((row) => row.original);
  }, [selectedRowIds, rows]);

  // Context menu handlers - directly use memoized selectedRows

  const handleCopyAsCSV = useCallback(() => {
    if (selectedRows.length === 0) return;
    const cols = Object.keys(selectedRows[0]);
    copyAsCSV(selectedRows, cols);
  }, [selectedRows]);

  const handleCopyAsJSON = useCallback(() => {
    if (selectedRows.length === 0) return;
    copyAsJSON(selectedRows);
  }, [selectedRows]);

  const handleCopyAsSQLValues = useCallback(() => {
    if (selectedRows.length === 0) return;
    const cols = Object.keys(selectedRows[0]);
    copyAsSQLValues(selectedRows, cols);
  }, [selectedRows]);

  const handleCopyAsInsert = useCallback(() => {
    if (selectedRows.length === 0) return;
    const cols = Object.keys(selectedRows[0]);
    copyAsInsertStatement(selectedRows, cols, tableName, schema);
  }, [selectedRows, tableName, schema]);

  // const handleViewDetails = useCallback(() => {
  //   const selectedRows = getSelectedRows();
  //   if (selectedRows.length === 1) {
  //     setSelectedRow(selectedRows[0]);
  //   } else if (selectedRows.length > 1) {
  //     // For multiple rows, the preview panel will show shared values
  //     setSelectedRow(null); // Clear single row selection
  //   }
  //   setShowDetails(true);
  // }, [getSelectedRows]);

  // Handle hiding columns
  const handleHideColumn = useCallback(
    (columnId: string) => {
      const column = table.getColumn(columnId);
      if (column) {
        column.toggleVisibility(false);
      }
    },
    [table],
  );

  // Get selected count
  const selectedCount = selectedRowIds.size;
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
      setUIQueryTime(null);
    };
  }, [
    tableName,
    table.getFilteredRowModel().rows.length,
    estimatedRowCount,
    setCurrentTableName,
    setTotalRowCount,
    setUIEstimatedRowCount,
    setUIQueryTime,
  ]);

  // Update loading state
  useEffect(() => {
    setIsLoadingData(isLoading || isFetchingMore);

    return () => {
      setIsLoadingData(false);
    };
  }, [isLoading, isFetchingMore, setIsLoadingData]);

  // Disabled auto-show details - user must manually open it
  // useEffect(() => {
  //   if (selectedCount > 0 && !showDetails && !isSelecting) {
  //     setShowDetails(true);
  //   }
  // }, [selectedCount, showDetails, isSelecting]);

  // Use deferred selection for preview panel to prevent re-renders during drag
  const previewSelectedRowIds = useDeferredValue(selectedRowIds);

  // Add a flag to track if we should update the preview
  const [shouldUpdatePreview, setShouldUpdatePreview] = useState(true);

  // Debounce preview updates during selection
  useEffect(() => {
    if (isSelecting) {
      setShouldUpdatePreview(false);
      const timer = setTimeout(() => {
        setShouldUpdatePreview(true);
      }, 100); // Debounce for 100ms
      return () => {
        clearTimeout(timer);
      };
    } else {
      setShouldUpdatePreview(true);
    }
    return undefined; // Explicit return for else branch
  }, [isSelecting]);

  // Calculate details for multiple selected rows - use heavily deferred values
  const getSelectionDetails = useMemo(() => {
    // Don't calculate during active selection unless debounced
    if (isSelecting && !shouldUpdatePreview) {
      return null; // Return null during active drag to prevent calculation
    }

    // Use deferred selection for all calculations
    const selectionToUse = previewSelectedRowIds;
    const selectedIds = Array.from(selectionToUse);
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
      if (key === "_rowIndex" || key === "_rowKey") return;

      const firstValue = firstRow[key];
      const allSame = selectedRows.every((row) => {
        const value = row[key];
        // Use reference equality for objects instead of JSON.stringify
        if (typeof value === "object" && value !== null) {
          return value === firstValue;
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
  }, [
    previewSelectedRowIds,
    rows,
    selectedRow,
    isSelecting,
    shouldUpdatePreview,
  ]);

  // Show skeleton loading on initial load
  if (!dataLoaded && !structureLoaded && isLoading) {
    return <TableSkeleton />;
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
      <Toolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        isColumnsDropdownOpen={isColumnsDropdownOpen}
        setIsColumnsDropdownOpen={setIsColumnsDropdownOpen}
        table={table}
        exportAsCSV={exportAsCSV}
        selectedRow={selectedRow}
        showDetails={showDetails}
        setShowDetails={setShowDetails}
        tableStructure={tableStructure}
        columnVisibility={columnVisibility}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden transition-opacity duration-150">
        {viewMode === "data" ? (
          /* Data View with Virtual Scrolling */
          <div
            ref={tableContainerRef}
            className={cn("h-full overflow-auto", isSelecting && "no-select")}
            style={{
              contain: "strict",
              overscrollBehavior: "contain",
            }}
            onScroll={handleScroll}
            onMouseMove={handleMouseMove}
          >
            {/* HTML Table with CSS Grid for virtualization */}
            <table
              style={{
                display: "grid",
                width: totalTableWidth,
                minWidth: "100%",
              }}
            >
              {/* Table Header with Drag and Drop */}
              <thead
                style={{
                  display: "grid",
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}
                className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
              >
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                  modifiers={[restrictToHorizontalAxis]}
                  autoScroll={false}
                >
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr
                      key={headerGroup.id}
                      className="h-7 border-b border-border/50"
                      style={{
                        display: "flex",
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      <SortableContext
                        items={columnOrder}
                        strategy={horizontalListSortingStrategy}
                      >
                        {shouldVirtualizeColumns &&
                        columnVirtualizer &&
                        columnVirtualizer.getVirtualItems().length > 0 ? (
                          // Column virtualization enabled for headers
                          <>
                            {/* Spacer for headers before virtual range */}
                            {(() => {
                              const firstItem =
                                columnVirtualizer.getVirtualItems()[0];
                              const spacerWidth = firstItem?.start || 0;
                              return spacerWidth > 0 ? (
                                <th
                                  style={{
                                    width: spacerWidth,
                                    minWidth: spacerWidth,
                                    maxWidth: spacerWidth,
                                    padding: 0,
                                    border: "none",
                                    backgroundColor: "transparent",
                                    fontSize: 0,
                                    lineHeight: 0,
                                    flexShrink: 0,
                                  }}
                                />
                              ) : null;
                            })()}
                            {columnVirtualizer
                              .getVirtualItems()
                              .map((virtualColumn: any) => {
                                const header =
                                  headerGroup.headers[virtualColumn.index];
                                if (!header) return null;

                                return (
                                  <DraggableHeader
                                    key={header.id}
                                    column={header.column}
                                    header={header}
                                    onHideColumn={handleHideColumn}
                                    virtualSize={header.getSize()}
                                  />
                                );
                              })}
                            {/* Spacer for headers after virtual range */}
                            {(() => {
                              const lastItem =
                                columnVirtualizer.getVirtualItems()[
                                  columnVirtualizer.getVirtualItems().length - 1
                                ];
                              const remainingWidth = lastItem
                                ? columnVirtualizer.getTotalSize() -
                                  lastItem.end
                                : 0;
                              return remainingWidth > 0 ? (
                                <th
                                  style={{
                                    width: remainingWidth,
                                    minWidth: remainingWidth,
                                    maxWidth: remainingWidth,
                                    padding: 0,
                                    border: "none",
                                    backgroundColor: "transparent",
                                    fontSize: 0,
                                    lineHeight: 0,
                                    flexShrink: 0,
                                  }}
                                />
                              ) : null;
                            })()}
                          </>
                        ) : (
                          // Standard header rendering - all headers visible
                          headerGroup.headers.map((header) => (
                            <DraggableHeader
                              key={header.id}
                              column={header.column}
                              header={header}
                              onHideColumn={handleHideColumn}
                            />
                          ))
                        )}
                      </SortableContext>
                    </tr>
                  ))}
                </DndContext>
              </thead>

              {/* Virtual Table Body */}
              <tbody
                style={{
                  display: "grid",
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: "relative",
                }}
              >
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={table.getAllColumns().length}
                      className="flex items-center justify-center h-32"
                    >
                      <p className="text-muted-foreground text-xs">
                        No data available
                      </p>
                    </td>
                  </tr>
                ) : (
                  rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    // Simple index mapping
                    const isSkeletonRow = virtualRow.index >= data.length;

                    if (isSkeletonRow) {
                      // Show skeleton row when data is not loaded
                      return (
                        <SkeletonRow
                          key={`skeleton-${virtualRow.index}`}
                          virtualRow={virtualRow}
                          columns={table.getAllColumns()}
                          columnVirtualizer={
                            shouldVirtualizeColumns
                              ? columnVirtualizer
                              : undefined
                          }
                          shouldVirtualizeColumns={shouldVirtualizeColumns}
                        />
                      );
                    }

                    const row = rows[virtualRow.index] as Row<any>;
                    if (!row) return null;

                    return (
                      <RowContextMenu
                        key={row.id}
                        selectedRows={
                          selectedRowIds.has(row.id)
                            ? selectedRows
                            : [row.original] // If this row isn't selected, it will be the only selection
                        }
                        onCopyAsCSV={() => {
                          // Ensure selection is updated before copying
                          if (!selectedRowIds.has(row.id)) {
                            const newSelection = new Set([row.id]);
                            setSelectedRowIds(newSelection);
                            // Copy just this row
                            const cols = Object.keys(row.original);
                            copyAsCSV([row.original], cols);
                          } else {
                            handleCopyAsCSV();
                          }
                        }}
                        onCopyAsJSON={() => {
                          if (!selectedRowIds.has(row.id)) {
                            const newSelection = new Set([row.id]);
                            setSelectedRowIds(newSelection);
                            copyAsJSON([row.original]);
                          } else {
                            handleCopyAsJSON();
                          }
                        }}
                        onCopyAsSQL={() => {
                          if (!selectedRowIds.has(row.id)) {
                            const newSelection = new Set([row.id]);
                            setSelectedRowIds(newSelection);
                            const cols = Object.keys(row.original);
                            copyAsSQLValues([row.original], cols);
                          } else {
                            handleCopyAsSQLValues();
                          }
                        }}
                        onCopyAsInsert={() => {
                          if (!selectedRowIds.has(row.id)) {
                            const newSelection = new Set([row.id]);
                            setSelectedRowIds(newSelection);
                            const cols = Object.keys(row.original);
                            copyAsInsertStatement(
                              [row.original],
                              cols,
                              tableName,
                              schema,
                            );
                          } else {
                            handleCopyAsInsert();
                          }
                        }}
                        onViewDetails={() => {
                          if (!selectedRowIds.has(row.id)) {
                            // Single unselected row - select it and show details
                            setSelectedRowIds(new Set([row.id]));
                            setSelectedRow(row.original);
                          } else if (selectedRowIds.size === 1) {
                            // Single selected row
                            setSelectedRow(row.original);
                          } else {
                            // Multiple selected rows - preview will show shared values
                            setSelectedRow(null);
                          }
                          setShowDetails(true);
                        }}
                        tableName={tableName}
                        schema={schema}
                        onOpenChange={(open) => {
                          // When context menu opens, handle selection
                          if (open && !selectedRowIds.has(row.id)) {
                            // If right-clicking on unselected row, select only that row
                            setSelectedRowIds(new Set([row.id]));
                          }
                          // If row is already selected, keep current selection
                        }}
                      >
                        <VirtualRow
                          row={row}
                          virtualRow={virtualRow}
                          isSelected={selectedRowIds.has(row.id)}
                          isHighlighted={false} // Only true when editing, not for selection/preview
                          isSelecting={isSelecting}
                          selectedCell={selectedCell}
                          editingCell={editingCell}
                          cellValues={cellValues}
                          columnVirtualizer={
                            shouldVirtualizeColumns
                              ? columnVirtualizer
                              : undefined
                          }
                          shouldVirtualizeColumns={shouldVirtualizeColumns}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleRowMouseDown(row.id, e);
                          }}
                          onMouseEnter={() => {
                            handleRowMouseEnter(row.id);
                          }}
                          onDoubleClick={() => {
                            handleRowClick(row.original);
                          }}
                          onCellClick={handleCellClick}
                          onCellDoubleClick={handleCellDoubleClick}
                          onEditButtonClick={handleEditButtonClick}
                          onCellValueChange={handleCellValueChange}
                          onEditComplete={handleEditComplete}
                          onCellKeyDown={handleCellKeyDown}
                        />
                      </RowContextMenu>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Removed loading spinner - skeleton rows already indicate loading */}
          </div>
        ) : viewMode === "structure" ? (
          /* Structure View */
          <div className="h-full overflow-auto">
            <StructureTable tableStructure={tableStructure} globalFilter={globalFilter} />
          </div>
        ) : viewMode === "indexes" ? (
          /* Indexes View */
          <div className="h-full overflow-auto">
            <IndexesTable indexes={tableIndexes} globalFilter={globalFilter} />
          </div>
        ) : (
          /* Triggers View */
          <div className="h-full overflow-auto">
            <TriggersTable triggers={tableTriggers} globalFilter={globalFilter} />
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <ResizablePanelGroup direction="vertical" className="h-full">
        <ResizablePanel
          defaultSize={showDetails ? 100 - detailsPanelSize : 100}
          minSize={30}
        >
          <div className="h-full flex flex-col">{tableContent}</div>
        </ResizablePanel>
        {showDetails && viewMode === "data" && (
          <>
            <ResizableHandle />
            <ResizablePanel
              defaultSize={showDetails ? detailsPanelSize : 0}
              minSize={15}
              maxSize={70}
              onResize={(size) => {
                setDetailsPanelSize(size);
              }}
            >
              <DetailsPanel
                showDetails={showDetails}
                getSelectionDetails={getSelectionDetails}
                selectedRow={selectedRow}
                selectedRowIds={previewSelectedRowIds} // Use deferred IDs for preview
                detailViewMode={detailViewMode}
                setDetailViewMode={setDetailViewMode}
                setShowDetails={setShowDetails}
                setSelectedRowIds={setSelectedRowIds}
                setSelectedRow={setSelectedRow}
                rows={rows}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
