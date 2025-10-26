import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { extractCheckCondition } from "@/utils/sql";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { useColumnResizing } from "@/hooks/useColumnResizing";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Plus, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConstraintType } from "@/services/backend";
import { ColumnRow, type ColumnRowData } from "./ColumnRow";
import { toast } from "sonner";
import { databaseService } from "@/services/databaseService";
import type { EditingScopeKey } from "@/stores/tableEditStore.types";
import {
  useTableEditStructure,
  useEnsureScope,
} from "@/stores/tableEditStore.selectors";
import { applyChangesService } from "@/services/applyChangesService";

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableStructure = memo(function TableStructure({
  connectionId,
  database,
  table,
  schema,
  onActionsChange,
}: TableStructureProps) {
  const { columnWidths, resizingColumn, handleMouseDown } = useColumnResizing({
    columns: [
      { key: "rowNumber", minWidth: 40, defaultWidth: 50 },
      { key: "name", minWidth: 100, defaultWidth: 150 },
      { key: "type", minWidth: 150, defaultWidth: 200 },
      { key: "nullable", minWidth: 70, defaultWidth: 80 },
      { key: "default", minWidth: 80, defaultWidth: 100 },
      { key: "check", minWidth: 80, defaultWidth: 100 },
      { key: "foreignKey", minWidth: 120, defaultWidth: 150 },
      { key: "comment", minWidth: 150, defaultWidth: 200 },
    ],
    storageKey: `table-structure-columns-${database}-${table}`,
  });

  const { structure, isLoading, error, refresh } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeConstraints: true,
      includeForeignKeys: true,
    },
  });

  const columns = useMemo(() => structure?.columns || [], [structure?.columns]);
  const foreignKeys = useMemo(
    () => structure?.foreignKeys || [],
    [structure?.foreignKeys],
  );
  const constraints = useMemo(
    () => structure?.constraints || [],
    [structure?.constraints],
  );

  // Define editing scope for centralized store
  const scope: EditingScopeKey = useMemo(
    () => ({
      connectionId,
      database,
      schema: schema || "public",
      table,
    }),
    [connectionId, database, schema, table],
  );

  // Ensure scope exists in store
  useEnsureScope(scope);

  // Use centralized store for editing state
  const {
    editedColumns,
    newColumns: newColumnsMap,
    deletedColumns,
    addDraft,
    updateDraft,
    deleteDraft,
    removeDraft,
    discardAll: discardAllStore,
  } = useTableEditStructure(scope);

  const [isSaving, setIsSaving] = useState(false);

  // Convert Maps to arrays for compatibility with existing render logic
  const editingColumns = useMemo(() => {
    return editedColumns;
  }, [editedColumns]);

  const newColumns = useMemo(() => {
    return Array.from(newColumnsMap.values());
  }, [newColumnsMap]);

  // Convert column data to ColumnRowData format
  const columnsData = useMemo(() => {
    return columns.map((col) => {
      const fkInfo = foreignKeys.find((fk) => fk.columns.includes(col.name));
      const escapeRegExp = (s: string) =>
        s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const checkConstraint = constraints.find((c) => {
        if (c.constraint_type !== ConstraintType.Check || !c.definition)
          return false;
        const pattern = new RegExp(`\\b"?${escapeRegExp(col.name)}"?\\b`, "i");
        return pattern.test(c.definition);
      });

      return {
        name: col.name,
        db_type: col.db_type,
        nullable: col.nullable,
        default: col.default,
        is_pk: col.is_pk,
        is_fk: col.is_fk,
        check_constraint: checkConstraint?.definition
          ? extractCheckCondition(checkConstraint.definition)
          : null,
        foreign_key_ref: fkInfo
          ? {
              table: fkInfo.foreignTable,
              column: fkInfo.foreignColumns[0],
              onUpdate: fkInfo.onUpdate,
              onDelete: fkInfo.onDelete,
            }
          : null,
        comment: col.comment,
        originalName: col.name,
        enum_values: col.enum_values,
        type_category: col.type_category,
      } as ColumnRowData;
    });
  }, [columns, foreignKeys, constraints]);

  // Check if there are any changes
  const hasChanges =
    editedColumns.size > 0 || deletedColumns.size > 0 || newColumnsMap.size > 0;

  // Get all available columns including new ones
  const availableColumns = useMemo(() => {
    const result: Array<{ name: string; db_type: string }> = [];

    // Add existing columns (excluding deleted ones)
    columnsData.forEach((col) => {
      if (!deletedColumns.has(col.name)) {
        const editingData = editingColumns.get(col.name);
        result.push({
          name: editingData?.name || col.name,
          db_type: editingData?.db_type || col.db_type,
        });
      }
    });

    // Add new columns
    newColumns.forEach((col) => {
      if (col.name) {
        result.push({
          name: col.name,
          db_type: col.db_type,
        });
      }
    });

    return result;
  }, [columnsData, editingColumns, deletedColumns, newColumns]);

  // Update editing data for a column
  const updateEditingData = useCallback(
    (columnName: string, updates: Partial<ColumnRowData>) => {
      const originalColumn = columnsData.find((col) => col.name === columnName);
      if (!originalColumn) return;

      const currentEdits = editedColumns.get(columnName) || {};
      const mergedData = { ...originalColumn, ...currentEdits, ...updates };

      updateDraft(columnName, mergedData, originalColumn);
    },
    [columnsData, editedColumns, updateDraft],
  );

  // Handle column deletion
  const handleDeleteColumn = useCallback(
    (columnName: string) => {
      if (deletedColumns.has(columnName)) {
        // Undo deletion - remove from deleted set
        removeDraft(columnName);
      } else {
        // Mark as deleted
        deleteDraft(columnName);
      }
    },
    [deletedColumns, deleteDraft, removeDraft],
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

    // Generate unique ID for new column
    const newId = `new_column_${Date.now()}`;
    addDraft(newId, newColumn);
  }, [addDraft]);

  // Update new column
  const updateNewColumn = useCallback(
    (index: number, updates: Partial<ColumnRowData>) => {
      const newColumnArray = Array.from(newColumnsMap.entries());
      if (index < 0 || index >= newColumnArray.length) return;

      const [columnId, currentData] = newColumnArray[index];
      const mergedData = { ...currentData, ...updates } as ColumnRowData;

      updateDraft(columnId, mergedData);
    },
    [newColumnsMap, updateDraft],
  );

  // Remove new column
  const removeNewColumn = useCallback(
    (index: number) => {
      const newColumnArray = Array.from(newColumnsMap.entries());
      if (index < 0 || index >= newColumnArray.length) return;

      const [columnId] = newColumnArray[index];
      removeDraft(columnId);
    },
    [newColumnsMap, removeDraft],
  );

  // Discard all changes
  const discardAllChanges = useCallback(() => {
    discardAllStore();
    toast({ description: "Discarded all changes" });
  }, [discardAllStore, toast]);

  // Save all changes using centralized apply service
  const handleSaveAllChanges = useCallback(async () => {
    if (
      editedColumns.size === 0 &&
      deletedColumns.size === 0 &&
      newColumnsMap.size === 0
    ) {
      return;
    }

    setIsSaving(true);
    try {
      const currentSchema = schema || "public";

      // For now, keep the existing implementation but use store state
      // TODO: Replace with applyChangesService.applyScope() once fully implemented

      // 1. Drop deleted columns
      for (const columnName of deletedColumns) {
        await databaseService.dropColumn(
          connectionId,
          currentSchema,
          table,
          columnName,
        );
        toast.success(`Dropped column ${columnName}`);
      }

      // 2. Add new columns
      for (const newColumn of newColumns) {
        if (!newColumn.name.trim()) {
          throw new Error("Column name is required");
        }

        const { normalizeDefaultForType } = await import("@/utils/sql");
        const normalizedDefault = normalizeDefaultForType(
          newColumn.default ?? undefined,
          newColumn.db_type,
        );

        await databaseService.addColumn(connectionId, currentSchema, table, {
          name: newColumn.name,
          dataType: newColumn.db_type,
          nullable: newColumn.nullable,
          defaultValue: normalizedDefault ?? undefined,
          checkConstraint: newColumn.check_constraint || undefined,
          comment: newColumn.comment || undefined,
        });
        toast.success(`Added column ${newColumn.name}`);
      }

      // 3. Alter modified columns
      for (const [originalName, changes] of editedColumns) {
        const originalColumn = columnsData.find(
          (col) => col.name === originalName,
        );
        if (!originalColumn) continue;

        // Check if column name changed
        if (changes.name && changes.name !== originalName) {
          await databaseService.renameColumn(
            connectionId,
            currentSchema,
            table,
            originalName,
            changes.name,
          );
          toast.success(`Renamed column ${originalName} to ${changes.name}`);
        }

        // Check for foreign key changes
        if (changes.foreign_key_ref !== undefined) {
          if (
            changes.foreign_key_ref === null &&
            originalColumn.foreign_key_ref
          ) {
            const fk = foreignKeys.find((fk) =>
              fk.columns.includes(originalName),
            );

            if (fk && fk.name) {
              await databaseService.dropForeignKey(
                connectionId,
                currentSchema,
                table,
                fk.name,
              );
              toast.success(`Removed foreign key from ${originalName}`);
            } else {
              toast.error(
                `Could not find foreign key constraint for ${originalName}`,
              );
            }
          } else if (
            changes.foreign_key_ref &&
            (!originalColumn.foreign_key_ref ||
              changes.foreign_key_ref.table !==
                originalColumn.foreign_key_ref.table ||
              changes.foreign_key_ref.column !==
                originalColumn.foreign_key_ref.column)
          ) {
            if (originalColumn.foreign_key_ref) {
              const fk = foreignKeys.find((fk) =>
                fk.columns.includes(originalName),
              );
              if (fk && fk.name) {
                await databaseService.dropForeignKey(
                  connectionId,
                  currentSchema,
                  table,
                  fk.name,
                );
              }
            }
            await databaseService.addForeignKey(
              connectionId,
              currentSchema,
              table,
              {
                constraintName: `${table}_${originalName}_fkey`,
                columnName: originalName,
                referencedTable: changes.foreign_key_ref.table,
                referencedColumn: changes.foreign_key_ref.column,
                onUpdate: "NO ACTION",
                onDelete: "NO ACTION",
              },
            );
            toast.success(`Updated foreign key for ${originalName}`);
          }
        }

        // Check for other modifications
        const needsModification =
          (changes.db_type && changes.db_type !== originalColumn.db_type) ||
          (changes.nullable !== undefined &&
            changes.nullable !== originalColumn.nullable) ||
          (changes.default !== undefined &&
            changes.default !== originalColumn.default) ||
          (changes.check_constraint !== undefined &&
            changes.check_constraint !== originalColumn.check_constraint) ||
          (changes.comment !== undefined &&
            changes.comment !== originalColumn.comment);

        if (needsModification) {
          await databaseService.modifyColumn(
            connectionId,
            currentSchema,
            table,
            {
              name: changes.name || originalName,
              newType:
                changes.db_type !== originalColumn.db_type
                  ? changes.db_type
                  : undefined,
              nullable:
                changes.nullable !== originalColumn.nullable
                  ? changes.nullable
                  : undefined,
              defaultValue:
                changes.default !== originalColumn.default
                  ? await (async () => {
                      const { normalizeDefaultForType } = await import(
                        "@/utils/sql"
                      );
                      return (
                        normalizeDefaultForType(
                          changes.default ?? undefined,
                          changes.db_type || originalColumn.db_type,
                        ) ?? undefined
                      );
                    })()
                  : undefined,
              dropDefault:
                changes.default === null && originalColumn.default !== null,
              newCheckConstraint:
                changes.check_constraint !== undefined &&
                changes.check_constraint !== null
                  ? changes.check_constraint || undefined
                  : undefined,
              dropCheckConstraint:
                changes.check_constraint !== undefined &&
                originalColumn.check_constraint !== null &&
                changes.check_constraint !== originalColumn.check_constraint
                  ? true
                  : false,
              comment:
                changes.comment !== originalColumn.comment
                  ? changes.comment || undefined
                  : undefined,
            },
          );
          toast.success(`Modified column ${changes.name || originalName}`);
        }
      }

      toast.success("All column changes saved successfully");

      // Discard changes from store after successful save
      discardAllStore();

      // Refresh the structure
      await refresh();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save changes: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  }, [
    connectionId,
    schema,
    table,
    editedColumns,
    deletedColumns,
    newColumnsMap,
    newColumns,
    columnsData,
    foreignKeys,
    discardAllStore,
    refresh,
  ]);

  // Update toolbar actions
  useEffect(() => {
    if (!onActionsChange) return;

    const actions = (
      <>
        {hasChanges && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={discardAllChanges}
              className="h-6 text-xs px-2 py-0"
            >
              <X className="h-3 w-3 mr-1" />
              Discard
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAllChanges}
              disabled={isSaving}
              className="h-6 text-xs px-2 py-0"
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Save className="h-3 w-3 mr-1" />
              )}
              Save All
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={addNewColumn}
          className="h-6 text-xs px-2 py-0"
        >
          <Plus className="h-3 w-3 mr-1" />
          New Column
        </Button>
      </>
    );

    onActionsChange(actions);

    // Cleanup on unmount
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
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
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
          <tr className="text-xs" style={{ height: "28px" }}>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.rowNumber }}
            >
              #
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "rowNumber" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "rowNumber");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.name }}
            >
              Column
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "name" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "name");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.type }}
            >
              Type
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "type" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "type");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.nullable }}
            >
              Nullable
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "nullable" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "nullable");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.default }}
            >
              Default
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "default" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "default");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.check }}
            >
              Check
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "check" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "check");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.foreignKey }}
            >
              Foreign Key
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "foreignKey" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "foreignKey");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.comment }}
            >
              Comment / Actions
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "comment" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "comment");
                }}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Existing columns */}
          {columnsData.map((column, i) => {
            const isDeleted = deletedColumns.has(column.name);
            const editingData = editingColumns.get(column.name);

            // Merge original column data with edits
            const displayData: ColumnRowData = {
              ...column,
              ...editingData,
            };

            // Check if row has any changes
            const hasRowChanges = editingData
              ? editingData.name !== column.name ||
                editingData.db_type !== column.db_type ||
                editingData.nullable !== column.nullable ||
                editingData.default !== column.default ||
                editingData.comment !== column.comment
              : false;

            return (
              <ColumnRow
                key={column.name}
                column={displayData}
                rowNumber={i + 1}
                hasChanges={hasRowChanges}
                isDeleted={isDeleted}
                connectionId={connectionId}
                database={database}
                schema={schema}
                originalColumn={column}
                availableColumns={availableColumns}
                onUpdate={(updates) => {
                  // Clear deletion if user starts editing
                  if (isDeleted) {
                    removeDraft(column.name);
                  }
                  updateEditingData(column.name, updates);
                }}
                onDelete={
                  !column.is_pk && !column.is_fk
                    ? () => {
                        handleDeleteColumn(column.name);
                      }
                    : undefined
                }
                onReset={() => {
                  if (isDeleted || hasRowChanges) {
                    // Remove from store (undoes both deletion and edits)
                    removeDraft(column.name);
                  }
                }}
              />
            );
          })}

          {/* New columns */}
          {newColumns.map((newColumn, i) => (
            <ColumnRow
              key={`new-${i}`}
              column={newColumn}
              rowNumber={0}
              hasChanges={true}
              isNew={true}
              connectionId={connectionId}
              database={database}
              schema={schema}
              availableColumns={availableColumns}
              onUpdate={(updates) => {
                updateNewColumn(i, updates);
              }}
              onDelete={() => {
                removeNewColumn(i);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

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
      {Array.from({ length: 10 }).map((_, i) => (
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
