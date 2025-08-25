import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  Database,
  Key,
  Zap,
  Filter,
  Search,
  RefreshCw,
  Download,
} from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import { PreviewPanel } from "@/components/DataTable/components/PreviewPanel";
import {
  copyAsJson,
  copyAsCsv,
  copyAsInsert,
  copyToClipboard,
} from "@/components/DataTable/utils/copyUtils";
import { useTableData } from "@/hooks/useTableData";
import type {
  DataTableRow,
  ColumnDefinition,
  CellValue,
} from "@/components/DataTable/types";
import type { TabState } from "@/types/workspaceScreen";
import type { ColumnMeta } from "@/types/database";

interface TableTabPayload {
  tableName: string;
  schema: string;
  database: string;
  isView?: boolean;
}

interface TableViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

// Map ColumnMeta to ColumnDefinition for DataTable
const mapColumnMetaToDefinition = (
  columnMeta: ColumnMeta,
): ColumnDefinition => {
  // Map database types to cell value types
  const getValueType = (dbType: string): ColumnDefinition["valueType"] => {
    const lowerType = dbType.toLowerCase();

    // Boolean types
    if (lowerType.includes("bool") || lowerType === "bit") return "Boolean";

    // Integer types
    if (
      lowerType.includes("int") ||
      lowerType.includes("serial") ||
      lowerType === "bigint" ||
      lowerType === "smallint"
    )
      return "Integer";

    // Decimal/Float types
    if (
      lowerType.includes("decimal") ||
      lowerType.includes("numeric") ||
      lowerType.includes("float") ||
      lowerType.includes("real") ||
      lowerType.includes("double") ||
      lowerType === "money"
    )
      return "Decimal";

    // Date/Time types
    if (lowerType.includes("timestamp") || lowerType.includes("datetime"))
      return "DateTime";
    if (lowerType.includes("date")) return "Date";
    if (lowerType.includes("time")) return "Time";

    // JSON types
    if (lowerType.includes("json") || lowerType.includes("jsonb"))
      return "Json";

    // UUID types
    if (lowerType.includes("uuid") || lowerType.includes("uniqueidentifier"))
      return "Uuid";

    // Binary types
    if (
      lowerType.includes("binary") ||
      lowerType.includes("blob") ||
      lowerType.includes("bytea") ||
      lowerType === "varbinary"
    )
      return "Binary";

    // Geometry types
    if (
      lowerType.includes("geometry") ||
      lowerType.includes("geography") ||
      lowerType.includes("point") ||
      lowerType.includes("polygon")
    )
      return "Geometry";

    // XML types
    if (lowerType.includes("xml")) return "Xml";

    // Array types
    if (lowerType.includes("[]") || lowerType.includes("array")) return "Array";

    // Enum types
    if (lowerType.includes("enum") || columnMeta.enum_values) return "Enum";

    // Default to Text for varchar, char, text, etc.
    return "Text";
  };

  return {
    id: columnMeta.name,
    name: columnMeta.name,
    dbType: columnMeta.db_type,
    valueType: getValueType(columnMeta.db_type),
    editable:
      !columnMeta.is_pk && !columnMeta.is_identity && !columnMeta.is_computed,
    sortable: true,
    filterable: true,
    metadata: {
      precision: columnMeta.precision ?? undefined,
      scale: columnMeta.scale ?? undefined,
      enum_values: columnMeta.enum_values,
    },
  };
};

export const TableViewPanel = memo(function TableViewPanel({
  tab,
  connectionId,
  isActive: _isActive,
  onUpdate: _onUpdate,
  onClose: _onClose,
}: TableViewPanelProps) {
  const [activeTab, setActiveTab] = useState("data");
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);

  // Extract payload data directly to avoid store mutation issues
  const payload = tab.payload as TableTabPayload;
  const tableName = payload.tableName || "Unknown Table";
  const schema = payload.schema || "public";
  const database = payload.database || "postgres";

  // Use TableDataService
  const {
    isLoading,
    isStreaming,
    error,
    columns: rawColumns,
    rows,
    hasNextPage,
    totalLoadedRows,
    loadData,
    loadMore,
    refresh,
    clearData,
  } = useTableData();

  // Transform ColumnMeta to ColumnDefinition
  const columns = useMemo((): ColumnDefinition[] => {
    const fromMeta = rawColumns.map((cm) => {
      const def = mapColumnMetaToDefinition(cm);
      // Add sensible sizing so headers are visible and cells readable
      const min = Math.max(80, Math.min(200, cm.name.length * 10));
      const max = Math.max(min, 420);
      return {
        ...def,
        minWidth: def.minWidth ?? min,
        maxWidth: def.maxWidth ?? max,
        width: def.width ?? Math.min(Math.max(min, 140), max),
      };
    });

    if (fromMeta.length > 0) return fromMeta;

    // Fallback: infer columns from first row if metadata is empty
    const firstRow = rows[0];
    if (!firstRow) return [];
    return Object.keys(firstRow).map((key) => {
      const cell = firstRow[key];
      const name = key;
      const min = Math.max(80, Math.min(200, name.length * 10));
      const max = Math.max(min, 420);
      const vt = cell?.value_type;
      const dbt = cell?.db_type;
      return {
        id: key,
        name,
        dbType: dbt ?? "TEXT",
        valueType: vt ?? "Text",
        sortable: true,
        editable: true,
        minWidth: min,
        maxWidth: max,
        width: Math.min(Math.max(min, 140), max),
      } satisfies ColumnDefinition;
    });
  }, [rawColumns, rows]);

  // Convert backend rows to DataTableRow format
  const dataTableRows = useMemo((): DataTableRow[] => {
    return rows;
  }, [rows]);

  // Load data when component mounts or table changes
  useEffect(() => {
    if (connectionId && tableName && tableName !== "Unknown Table") {
      void loadData({
        connectionId,
        database,
        table: tableName,
        schema: schema !== "public" ? schema : undefined,
        limit: 100,
      });
    }

    // Cleanup on unmount or table change
    return () => {
      clearData();
    };
    // Use primitive values as dependencies instead of payload object reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, tableName, schema]);

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery) return dataTableRows;

    return dataTableRows.filter((row) => {
      return Object.values(row).some((cell) => {
        if (cell.value === null) return false;
        const cellString =
          typeof cell.value === "string" || typeof cell.value === "number"
            ? String(cell.value)
            : JSON.stringify(cell.value);
        return cellString.toLowerCase().includes(searchQuery.toLowerCase());
      });
    });
  }, [dataTableRows, searchQuery]);

  const selectedRowsData = useMemo(() => {
    return filteredData.filter((row) => {
      // Find the primary key column or use first column as row identifier
      const primaryKeyColumn =
        rawColumns.find((col) => col.is_pk) || rawColumns[0];
      if (!primaryKeyColumn) return false;

      const cellValue = row[primaryKeyColumn.name]?.value;
      const rowId =
        typeof cellValue === "string" || typeof cellValue === "number"
          ? String(cellValue)
          : JSON.stringify(cellValue || "");
      return selectedRows.has(rowId);
    });
  }, [filteredData, selectedRows, rawColumns]);

  // Handle row selection
  const handleRowSelect = useCallback(
    (rows: DataTableRow[], mode: "single" | "range" | "toggle") => {
      const primaryKeyColumn =
        rawColumns.find((col) => col.is_pk) || rawColumns[0];
      if (!primaryKeyColumn) return;

      const rowIds = rows.map((row) => {
        const cellValue = row[primaryKeyColumn.name]?.value;
        return typeof cellValue === "string" || typeof cellValue === "number"
          ? String(cellValue)
          : JSON.stringify(cellValue || "");
      });

      if (mode === "single") {
        setSelectedRows(new Set(rowIds));
      } else if (mode === "toggle") {
        setSelectedRows((prev) => {
          const newSet = new Set(prev);
          rowIds.forEach((id) => {
            if (newSet.has(id)) {
              newSet.delete(id);
            } else {
              newSet.add(id);
            }
          });
          return newSet;
        });
      } else {
        // range mode
        setSelectedRows(new Set(rowIds));
      }
    },
    [rawColumns],
  );

  // Handle cell edit
  const handleCellEdit = useCallback(
    (_rowId: string, _columnId: string, _value: CellValue) => {
      // TODO: Implement actual cell editing via data service
    },
    [],
  );

  // Handle row delete
  const handleRowDelete = useCallback((_rows: DataTableRow[]) => {
    // TODO: Implement actual row deletion via data service
  }, []);

  // Handle copy operations
  const handleCopy = useCallback(
    (format: "json" | "csv" | "insert") => {
      let text = "";
      const columnInfo = columns.map((col) => ({ id: col.id, name: col.name }));

      switch (format) {
        case "json":
          text = copyAsJson(selectedRowsData, columnInfo);
          break;
        case "csv":
          text = copyAsCsv(selectedRowsData, columnInfo);
          break;
        case "insert":
          text = copyAsInsert(selectedRowsData, columnInfo, tableName);
          break;
      }

      void copyToClipboard(text);
    },
    [selectedRowsData, columns, tableName],
  );

  // Handle load more data
  const handleLoadMore = useCallback(() => {
    if (!isLoading && !isStreaming && hasNextPage) {
      void loadMore();
    }
  }, [isLoading, isStreaming, hasNextPage, loadMore]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div className="flex-none border-b bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">
              {schema}.{tableName}
            </h2>
            <p className="text-sm text-muted-foreground">
              Table • {filteredData.length.toLocaleString()} of{" "}
              {totalLoadedRows.toLocaleString()} loaded
              {hasNextPage && " (more available)"}
            </p>
            {error && (
              <p className="text-sm text-red-500 mt-1">Error: {error}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                handleCopy("csv");
              }}
              disabled={selectedRows.size === 0}
            >
              <Download className="h-3 w-3 mr-1" />
              Export
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="data" className="gap-1">
              <Table className="h-3 w-3" />
              Data
            </TabsTrigger>
            <TabsTrigger value="structure" className="gap-1">
              <Database className="h-3 w-3" />
              Structure
            </TabsTrigger>
            <TabsTrigger value="indexes" className="gap-1">
              <Key className="h-3 w-3" />
              Indexes
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-1">
              <Zap className="h-3 w-3" />
              Triggers
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsContent value="data" className="h-full flex flex-col">
            <div className="flex-none p-3 border-b">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search data..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                    }}
                    className="pl-7"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowPreview(!showPreview);
                  }}
                  disabled={selectedRows.size === 0}
                >
                  <Filter className="h-3 w-3 mr-1" />
                  Preview ({selectedRows.size})
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <DataTable
                data={filteredData}
                columns={columns}
                isLoading={isLoading || isStreaming}
                rowIdField={
                  rawColumns.find((col) => col.is_pk)?.name ||
                  rawColumns[0]?.name ||
                  "id"
                }
                onLoadMore={handleLoadMore}
                hasNextPage={hasNextPage}
                selectedRows={selectedRows}
                onRowSelect={handleRowSelect}
                onCellEdit={handleCellEdit}
                // editableColumns={
                //   new Set(
                //     columns.filter((col) => col.editable).map((col) => col.id),
                //   )
                // }
                onRowDelete={handleRowDelete}
                onCopyRows={(_rows, format) => {
                  handleCopy(format);
                }}
                showPreviewPanel={showPreview}
                previewMode="table"
                onPreviewModeChange={() => {}}
              />
            </div>

            {showPreview && (
              <PreviewPanel
                selectedRows={selectedRowsData}
                columns={columns.map((col) => ({
                  id: col.id,
                  name: col.name,
                  dbType: col.dbType,
                }))}
                isOpen={showPreview}
                onClose={() => {
                  setShowPreview(false);
                }}
                onCopy={handleCopy}
              />
            )}
          </TabsContent>

          <TabsContent value="structure" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Table structure view coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="indexes" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Indexes & constraints view coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="triggers" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Triggers view coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});
