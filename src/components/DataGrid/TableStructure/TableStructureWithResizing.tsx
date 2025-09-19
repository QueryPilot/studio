import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Plus, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConstraintType } from "@/services/backend";
import { ColumnRow, type ColumnRowData } from "./ColumnRow";
import { toast } from "sonner";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableStructureWithResizing = memo(
  function TableStructureWithResizing({
    connectionId,
    database,
    table,
    schema,
    onActionsChange,
  }: TableStructureProps) {
    const { structure, isLoading, error, refetch } = useTableFullStructure({
      connectionId,
      database,
      table,
      schema,
      options: {
        includeConstraints: true,
        includeForeignKeys: true,
      },
    });

    const columns = structure?.columns || [];
    const foreignKeys = structure?.foreignKeys || [];
    const constraints = structure?.constraints || [];

    // State for editing
    const [editingColumns, setEditingColumns] = useState<
      Map<string, Partial<ColumnRowData>>
    >(new Map());
    const [deletedColumns, setDeletedColumns] = useState<Set<string>>(
      new Set(),
    );
    const [newColumns, setNewColumns] = useState<ColumnRowData[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [columnResizeMode, setColumnResizeMode] = useState<
      "onChange" | "onEnd"
    >("onChange");

    // Convert column data to ColumnRowData format
    const columnsData = useMemo(() => {
      return columns.map((col) => {
        const fkInfo = foreignKeys.find((fk) => fk.columns.includes(col.name));
        const checkConstraint = constraints.find(
          (c) =>
            c.constraint_type === ConstraintType.Check &&
            c.definition?.includes(col.name),
        );

        return {
          name: col.name,
          db_type: col.db_type,
          nullable: col.nullable,
          default: col.default,
          is_pk: col.is_pk,
          is_fk: col.is_fk,
          check_constraint: checkConstraint?.definition || null,
          foreign_key_ref: fkInfo
            ? {
                table: fkInfo.foreignTable,
                column: fkInfo.foreignColumns[0],
              }
            : null,
          comment: col.comment,
          originalName: col.name,
        } as ColumnRowData;
      });
    }, [columns, foreignKeys, constraints]);

    // Combine existing and new columns for table data
    const tableData = useMemo(() => {
      const existingRows = columnsData.map((column, i) => {
        const isDeleted = deletedColumns.has(column.name);
        const editingData = editingColumns.get(column.name);
        const displayData: ColumnRowData = {
          ...column,
          ...editingData,
        };

        return {
          rowNumber: i + 1,
          column: displayData,
          originalColumn: column,
          isDeleted,
          isNew: false,
          hasChanges: editingData
            ? editingData.name !== column.name ||
              editingData.db_type !== column.db_type ||
              editingData.nullable !== column.nullable ||
              editingData.default !== column.default ||
              editingData.comment !== column.comment
            : false,
        };
      });

      const newRows = newColumns.map((column, i) => ({
        rowNumber: 0,
        column,
        originalColumn: column,
        isDeleted: false,
        isNew: true,
        hasChanges: true,
      }));

      return [...existingRows, ...newRows];
    }, [columnsData, editingColumns, deletedColumns, newColumns]);

    // Define columns for TanStack Table
    const columnHelper = createColumnHelper<(typeof tableData)[0]>();

    const tableColumns = useMemo(
      () => [
        columnHelper.accessor("rowNumber", {
          header: "#",
          size: 50,
          minSize: 40,
          maxSize: 60,
          cell: ({ row }) => (
            <div className="px-2 text-muted-foreground">
              {row.original.isNew ? "-" : row.original.rowNumber}
            </div>
          ),
        }),
        columnHelper.accessor("column.name", {
          header: "Column",
          size: 150,
          minSize: 100,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              onDelete={
                !row.original.column.is_pk && !row.original.column.is_fk
                  ? () => {
                      handleDeleteColumn(row.original.column.name);
                    }
                  : undefined
              }
              onReset={() => {
                handleResetColumn(
                  row.original.column.name,
                  row.original.isDeleted,
                  row.original.hasChanges,
                );
              }}
              renderMode="cell"
              cellType="name"
            />
          ),
        }),
        columnHelper.accessor("column.db_type", {
          header: "Type",
          size: 200,
          minSize: 150,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              renderMode="cell"
              cellType="type"
            />
          ),
        }),
        columnHelper.accessor("column.nullable", {
          header: "Nullable",
          size: 80,
          minSize: 70,
          maxSize: 100,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              renderMode="cell"
              cellType="nullable"
            />
          ),
        }),
        columnHelper.accessor("column.default", {
          header: "Default",
          size: 100,
          minSize: 80,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              renderMode="cell"
              cellType="default"
            />
          ),
        }),
        columnHelper.accessor("column.check_constraint", {
          header: "Check",
          size: 100,
          minSize: 80,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              renderMode="cell"
              cellType="check"
            />
          ),
        }),
        columnHelper.accessor("column.foreign_key_ref", {
          header: "Foreign Key",
          size: 150,
          minSize: 120,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              renderMode="cell"
              cellType="foreignKey"
            />
          ),
        }),
        columnHelper.accessor("column.comment", {
          header: "Comment / Actions",
          size: 200,
          minSize: 150,
          cell: ({ row }) => (
            <ColumnRow
              column={row.original.column}
              rowNumber={row.original.rowNumber}
              hasChanges={row.original.hasChanges}
              isNew={row.original.isNew}
              isDeleted={row.original.isDeleted}
              originalColumn={row.original.originalColumn}
              connectionId={connectionId}
              onUpdate={(updates) => {
                updateEditingData(row.original.column.name, updates);
              }}
              onDelete={
                !row.original.column.is_pk && !row.original.column.is_fk
                  ? () => {
                      handleDeleteColumn(row.original.column.name);
                    }
                  : undefined
              }
              onReset={() => {
                handleResetColumn(
                  row.original.column.name,
                  row.original.isDeleted,
                  row.original.hasChanges,
                );
              }}
              renderMode="cell"
              cellType="comment"
            />
          ),
        }),
      ],
      [connectionId],
    );

    const tableInstance = useReactTable({
      data: tableData,
      columns: tableColumns,
      getCoreRowModel: getCoreRowModel(),
      columnResizeMode,
      defaultColumn: {
        minSize: 50,
        maxSize: 500,
      },
    });

    // Check if there are any changes
    const hasChanges =
      editingColumns.size > 0 ||
      deletedColumns.size > 0 ||
      newColumns.length > 0;

    // Update editing data for a column
    const updateEditingData = useCallback(
      (columnName: string, updates: Partial<ColumnRowData>) => {
        setEditingColumns((prev) => {
          const newMap = new Map(prev);
          const currentData = newMap.get(columnName) || {};
          newMap.set(columnName, { ...currentData, ...updates });
          return newMap;
        });
      },
      [],
    );

    // Handle column deletion
    const handleDeleteColumn = useCallback((columnName: string) => {
      setDeletedColumns((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(columnName)) {
          newSet.delete(columnName);
        } else {
          newSet.add(columnName);
        }
        return newSet;
      });
    }, []);

    // Handle reset column
    const handleResetColumn = useCallback(
      (columnName: string, isDeleted: boolean, hasRowChanges: boolean) => {
        if (isDeleted) {
          setDeletedColumns((prev) => {
            const newSet = new Set(prev);
            newSet.delete(columnName);
            return newSet;
          });
        } else if (hasRowChanges) {
          setEditingColumns((prev) => {
            const newMap = new Map(prev);
            newMap.delete(columnName);
            return newMap;
          });
        }
      },
      [],
    );

    // Add new column
    const addNewColumn = useCallback(() => {
      const newColumn: ColumnRowData = {
        name: "",
        db_type: "text",
        nullable: true,
        default: null,
        is_pk: false,
        is_fk: false,
        check_constraint: null,
        foreign_key_ref: null,
        comment: null,
      };
      setNewColumns((prev) => [...prev, newColumn]);
    }, []);

    // Update new column
    const updateNewColumn = useCallback(
      (index: number, updates: Partial<ColumnRowData>) => {
        setNewColumns((prev) => {
          const newArray = [...prev];
          newArray[index] = { ...newArray[index], ...updates };
          return newArray;
        });
      },
      [],
    );

    // Remove new column
    const removeNewColumn = useCallback((index: number) => {
      setNewColumns((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Discard all changes
    const discardAllChanges = useCallback(() => {
      setEditingColumns(new Map());
      setDeletedColumns(new Set());
      setNewColumns([]);
    }, []);

    // Save all changes
    const handleSaveAllChanges = useCallback(async () => {
      setIsSaving(true);
      try {
        // TODO: Implement actual save logic
        toast.success("Column changes saved successfully");
        discardAllChanges();
        await refetch();
      } catch (error) {
        toast.error("Failed to save changes: " + error);
      } finally {
        setIsSaving(false);
      }
    }, [discardAllChanges, refetch]);

    // Update action buttons
    useEffect(() => {
      if (!onActionsChange) return;

      const actions = hasChanges ? (
        <div className="flex items-center gap-2">
          <Button onClick={addNewColumn} variant="outline" size="sm">
            <Plus className="h-3 w-3 mr-1" />
            Add Column
          </Button>
          <div className="flex-1" />
          <Button
            onClick={discardAllChanges}
            variant="outline"
            size="sm"
            disabled={isSaving}
          >
            <X className="h-3 w-3 mr-1" />
            Discard
          </Button>
          <Button
            onClick={handleSaveAllChanges}
            variant="default"
            size="sm"
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save Changes
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={addNewColumn} variant="outline" size="sm">
            <Plus className="h-3 w-3 mr-1" />
            Add Column
          </Button>
        </div>
      );

      onActionsChange(actions);
      return () => {
        onActionsChange(null);
      };
    }, [
      hasChanges,
      isSaving,
      onActionsChange,
      discardAllChanges,
      handleSaveAllChanges,
      addNewColumn,
    ]);

    if (isLoading) {
      return <TableStructureSkeleton />;
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            Failed to load structure
          </h3>
          <p className="text-sm text-muted-foreground max-w-md text-center select-text">
            {error}
          </p>
        </div>
      );
    }

    return (
      <div className="h-full overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-muted border-b border-border">
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="text-xs"
                style={{ height: "28px" }}
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
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
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none",
                          "hover:bg-primary/50 transition-colors",
                          header.column.getIsResizing() && "bg-primary",
                        )}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {tableInstance.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "group transition-colors text-xs",
                  row.original.isDeleted &&
                    "bg-destructive/10 hover:bg-destructive/15 opacity-75",
                  row.original.isNew &&
                    "bg-green-50 dark:bg-green-900/20 hover:bg-green-50 dark:hover:bg-green-900/30",
                  row.original.hasChanges &&
                    !row.original.isDeleted &&
                    !row.original.isNew &&
                    "bg-primary/5 hover:bg-primary/10",
                )}
                style={{ height: "28px" }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="border-b border-r border-border"
                    style={{ width: cell.column.getSize() }}
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
  },
);

const TableStructureSkeleton = memo(function TableStructureSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
});
