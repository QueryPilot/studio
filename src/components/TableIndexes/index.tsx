import React, { memo, useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Plus, Save, X, Loader2 } from "lucide-react";
import { databaseService, type TableIndex } from "@/services/databaseService";
import { type IndexUsageStats } from "@/services/backend";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTableColumns } from "@/hooks/useTableFullStructure";
import { useColumnResizing } from "@/hooks/useColumnResizing";
import { cn } from "@/lib/utils";
import { IndexRow, type IndexRowData } from "./IndexRow";

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
  onActionsChange,
}: TableIndexesProps) {
  const { columnWidths, resizingColumn, handleMouseDown } = useColumnResizing({
    columns: [
      { key: "rowNumber", minWidth: 30, defaultWidth: 40 },
      { key: "name", minWidth: 100, defaultWidth: 150 },
      { key: "columns", minWidth: 150, defaultWidth: 200 },
      { key: "type", minWidth: 80, defaultWidth: 100 },
      { key: "unique", minWidth: 60, defaultWidth: 70 },
      { key: "condition", minWidth: 100, defaultWidth: 150 },
      { key: "size", minWidth: 60, defaultWidth: 70 },
      { key: "usage", minWidth: 80, defaultWidth: 100 },
    ],
    storageKey: `table-indexes-columns-${database}-${table}`,
  });

  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [usageStats, setUsageStats] = useState<Map<string, IndexUsageStats>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingIndexes, setEditingIndexes] = useState<
    Map<string, IndexRowData>
  >(new Map());
  const [newIndexes, setNewIndexes] = useState<IndexRowData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deletedIndexes, setDeletedIndexes] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [manuallyEditedNames, setManuallyEditedNames] = useState<Set<string>>(
    new Set(),
  );

  const { columns: availableColumns } = useTableColumns({
    connectionId,
    database,
    table,
    schema,
  });

  const fetchIndexes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await databaseService.tableIndexes(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setIndexes(result);
      // Don't initialize editingIndexes with all indexes - only add when actually edited
      setEditingIndexes(new Map());

      setStatsLoading(true);
      try {
        const stats = await databaseService.getIndexUsageStats(
          connectionId,
          table,
        );
        const statsMap = new Map<string, IndexUsageStats>();
        stats.forEach((stat) => {
          statsMap.set(stat.index_name, stat);
        });
        setUsageStats(statsMap);
      } catch (err) {
        console.error("Could not fetch index usage stats:", err);
      } finally {
        setStatsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load indexes");
      console.error("Failed to fetch table indexes:", err);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void fetchIndexes();
  }, [fetchIndexes]);

  const validateIndexData = useCallback(
    (data: IndexRowData): string | null => {
      if (!data.name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(data.name)) {
        return "Invalid index name. Use only letters, numbers, and underscores.";
      }
      if (data.columns.length === 0) {
        return "At least one column is required.";
      }
      const isDuplicate = indexes.some((idx) => {
        if (data.originalName && idx.name === data.originalName) return false;
        return idx.name === data.name;
      });
      if (isDuplicate) {
        return "An index with this name already exists.";
      }
      const isNewDuplicate = newIndexes.some(
        (idx) => idx !== data && idx.name === data.name,
      );
      if (isNewDuplicate) {
        return "Multiple new indexes have the same name.";
      }
      return null;
    },
    [indexes, newIndexes],
  );

  const addNewIndex = useCallback(() => {
    const newIndex: IndexRowData = {
      name: "",
      columns: [],
      unique: false,
      type: "btree",
      condition: "",
    };
    setNewIndexes((prev) => [...prev, newIndex]);
    setHasChanges(true);
  }, []);

  const updateNewIndex = (index: number, updates: Partial<IndexRowData>) => {
    setNewIndexes((prev) => {
      const updated = [...prev];
      const currentIndex = updated[index];
      const mergedIndex = { ...currentIndex, ...updates };
      const tempId = `new-${index}`;

      // Track manual name edits - only if the name actually changes from auto-generated
      if (updates.name !== undefined) {
        // Check if this is likely a manual edit (not empty and different from what would be auto-generated)
        const wouldBeAutoGenerated =
          mergedIndex.columns && mergedIndex.columns.length > 0;
        if (wouldBeAutoGenerated && mergedIndex.columns) {
          const columnNames = mergedIndex.columns.join("_");
          const prefix = mergedIndex.unique ? "unique" : "idx";
          const autoBaseName = `${prefix}_${table}_${columnNames}`;

          // Only mark as manually edited if the user typed something different
          if (updates.name && !updates.name.startsWith(autoBaseName)) {
            setManuallyEditedNames((prev) => {
              const newSet = new Set(prev);
              newSet.add(tempId);
              return newSet;
            });
          }
        } else if (updates.name && updates.name.trim() !== "") {
          // If no columns selected yet but user typed a name, mark as manual
          setManuallyEditedNames((prev) => {
            const newSet = new Set(prev);
            newSet.add(tempId);
            return newSet;
          });
        }
      }

      // Auto-generate index name only if not manually edited
      if (
        (updates.columns || updates.unique !== undefined) &&
        mergedIndex.columns &&
        mergedIndex.columns.length > 0 &&
        !manuallyEditedNames.has(tempId) &&
        updates.name === undefined // Don't auto-generate if this is a name update
      ) {
        const columnNames = mergedIndex.columns.join("_");
        const prefix = mergedIndex.unique ? "unique" : "idx";
        const baseName = `${prefix}_${table}_${columnNames}`;

        // Check if this name already exists and add a suffix if needed
        let finalName = baseName;
        let suffix = 1;
        while (
          indexes.some((idx) => idx.name === finalName) ||
          updated.some((idx, i) => i !== index && idx.name === finalName)
        ) {
          finalName = `${baseName}_${suffix}`;
          suffix++;
        }

        updates.name = finalName;
      }

      updated[index] = { ...updated[index], ...updates } as IndexRowData;
      return updated;
    });
    setHasChanges(true);
  };

  const removeNewIndex = (index: number) => {
    const tempId = `new-${index}`;
    setManuallyEditedNames((prev) => {
      const newSet = new Set(prev);
      newSet.delete(tempId);
      return newSet;
    });
    setNewIndexes((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      // Check if we still have changes after removal
      const stillHasChanges =
        updated.length > 0 ||
        editingIndexes.size > 0 ||
        deletedIndexes.size > 0;
      setHasChanges(stillHasChanges);
      return updated;
    });
  };

  const updateEditingData = (
    indexName: string,
    updates: Partial<IndexRowData>,
  ) => {
    // Track manual name edits
    if (updates.name !== undefined) {
      setManuallyEditedNames((prev) => {
        const newSet = new Set(prev);
        if (updates.name && updates.name.trim() !== "") {
          newSet.add(indexName);
        } else {
          newSet.delete(indexName);
        }
        return newSet;
      });
    }

    setEditingIndexes((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(indexName);
      const originalIndex = indexes.find((idx) => idx.name === indexName);
      const mergedData = { ...originalIndex, ...existing, ...updates };

      // Auto-generate index name only if not manually edited
      if (
        (updates.columns || updates.unique !== undefined) &&
        mergedData.columns &&
        mergedData.columns.length > 0 &&
        !manuallyEditedNames.has(indexName) &&
        updates.name === undefined
      ) {
        const currentName = mergedData.name || "";
        const shouldGenerate =
          !currentName || currentName === originalIndex?.name;

        if (shouldGenerate) {
          const columnNames = mergedData.columns.join("_");
          const prefix = mergedData.unique ? "unique" : "idx";
          const baseName = `${prefix}_${table}_${columnNames}`;

          // Check if this name already exists and add a suffix if needed
          let finalName = baseName;
          let suffix = 1;
          while (
            indexes.some(
              (idx) => idx.name === finalName && idx.name !== indexName,
            ) ||
            Array.from(newMap.values()).some(
              (idx) => idx.name === finalName && idx.originalName !== indexName,
            )
          ) {
            finalName = `${baseName}_${suffix}`;
            suffix++;
          }

          updates.name = finalName;
        }
      }

      if (existing) {
        newMap.set(indexName, { ...existing, ...updates });
      } else {
        // If not already editing, create editing data for this index
        const originalIndex = indexes.find((idx) => idx.name === indexName);
        if (originalIndex) {
          newMap.set(indexName, {
            originalName: originalIndex.name,
            name: originalIndex.name,
            columns: originalIndex.columns,
            unique: originalIndex.unique,
            type: originalIndex.index_type,
            condition: originalIndex.condition || "",
            primary: originalIndex.primary,
            size: originalIndex.size,
            foreign_key: originalIndex.foreign_key,
            ...updates,
          });
        }
      }
      return newMap;
    });
    setHasChanges(true);
  };

  const handleSaveAllChanges = useCallback(async () => {
    setIsSaving(true);
    const errors: string[] = [];

    try {
      const currentSchema = schema || "public";

      // Handle deletions first
      for (const indexName of deletedIndexes) {
        try {
          await databaseService.dropIndex(
            connectionId,
            currentSchema,
            indexName,
          );
          toast.success(`Dropped index ${indexName}`);
        } catch (err) {
          const msg =
            typeof err === "string"
              ? err
              : err instanceof Error
              ? err.message
              : JSON.stringify(err);
          errors.push(`Failed to delete ${indexName}: ${msg}`);
        }
      }

      // Handle existing index modifications
      for (const [_, editData] of editingIndexes) {
        // Skip if index is marked for deletion
        const originalName = editData.originalName || editData.name;
        if (deletedIndexes.has(originalName)) continue;

        const validationError = validateIndexData(editData);
        if (validationError) {
          errors.push(`${originalName}: ${validationError}`);
          continue;
        }

        // Find original for comparison
        const original = indexes.find((i) => i.name === originalName);
        const typeChanged = editData.type !== original?.index_type;
        const columnsChanged =
          JSON.stringify(editData.columns) !==
          JSON.stringify(original?.columns);
        const uniqueChanged = editData.unique !== original?.unique;
        const conditionChanged =
          (editData.condition || "") !== (original?.condition || "");
        const nameChanged = editData.name !== originalName;

        const needsRecreate =
          typeChanged || columnsChanged || uniqueChanged || conditionChanged;

        if (needsRecreate) {
          try {
            await databaseService.dropIndex(
              connectionId,
              currentSchema,
              originalName,
            );
          } catch (err) {
            const msg =
              typeof err === "string"
                ? err
                : err instanceof Error
                ? err.message
                : JSON.stringify(err);
            errors.push(`Failed to drop ${originalName}: ${msg}`);
            // If we can't drop, skip recreating
            continue;
          }

          try {
            await databaseService.createIndex(
              connectionId,
              currentSchema,
              table,
              {
                name: editData.name,
                columns: editData.columns,
                unique: editData.unique,
                indexType: editData.type,
                condition: editData.condition || undefined,
              },
            );
            toast.success(
              `Updated index ${originalName}${
                nameChanged ? ` → ${editData.name}` : ""
              }`,
            );
          } catch (err) {
            const msg =
              typeof err === "string"
                ? err
                : err instanceof Error
                ? err.message
                : JSON.stringify(err);
            errors.push(
              `Failed to recreate ${originalName}${
                nameChanged ? ` as ${editData.name}` : ""
              }: ${msg}`,
            );
          }
        } else if (nameChanged && editData.originalName) {
          // Pure rename
          try {
            await databaseService.renameIndex(
              connectionId,
              currentSchema,
              editData.originalName,
              editData.name,
            );
            toast.success(
              `Renamed index ${editData.originalName} to ${editData.name}`,
            );
          } catch (err) {
            const msg =
              typeof err === "string"
                ? err
                : err instanceof Error
                ? err.message
                : JSON.stringify(err);
            errors.push(`Failed to rename ${editData.originalName}: ${msg}`);
          }
        }
      }

      // Handle new indexes
      for (const newIndex of newIndexes) {
        const error = validateIndexData(newIndex);
        if (error) {
          errors.push(`New index: ${error}`);
          continue;
        }

        try {
          await databaseService.createIndex(
            connectionId,
            currentSchema,
            table,
            {
              name: newIndex.name,
              columns: newIndex.columns,
              unique: newIndex.unique,
              indexType: newIndex.type,
              condition: newIndex.condition || undefined,
            },
          );
          toast.success(`Created index ${newIndex.name}`);
        } catch (err) {
          const msg =
            typeof err === "string"
              ? err
              : err instanceof Error
              ? err.message
              : JSON.stringify(err);
          errors.push(
            `Failed to create ${newIndex.name || "new index"}: ${msg}`,
          );
        }
      }

      if (errors.length > 0) {
        // Don't hard refresh on partial failure to avoid flashing; keep edits
        toast.error(`ERROR: ${errors.join(" ")}`);
      } else {
        toast.success("All changes saved successfully");
        setEditingIndexes(new Map());
        setNewIndexes([]);
        setDeletedIndexes(new Set());
        setHasChanges(false);
      }

      // Only refresh when all succeeded to avoid flicker; on errors, let user fix inputs
      if (errors.length === 0) {
        await fetchIndexes();
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    schema,
    fetchIndexes,
    deletedIndexes,
    connectionId,
    editingIndexes,
    indexes,
    validateIndexData,
    newIndexes,
    table,
  ]);

  const handleDeleteIndex = (indexName: string) => {
    setDeletedIndexes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(indexName)) {
        newSet.delete(indexName);
      } else {
        newSet.add(indexName);
      }
      return newSet;
    });
    setHasChanges(true);
  };

  const discardAllChanges = useCallback(() => {
    setEditingIndexes(new Map());
    setNewIndexes([]);
    setDeletedIndexes(new Set());
    setHasChanges(false);
    setManuallyEditedNames(new Set());
  }, []);

  // Update parent with action buttons
  useEffect(() => {
    if (!onActionsChange) return;

    const actions = (
      <>
        {hasChanges && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={discardAllChanges}
              disabled={isSaving}
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
          onClick={addNewIndex}
          className="h-6 text-xs px-2 py-0"
        >
          <Plus className="h-3 w-3 mr-1" />
          New Index
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
    addNewIndex,
  ]);

  if (isLoading) {
    return <TableIndexesSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load indexes</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
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
                Index Name
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
                style={{ width: columnWidths.columns }}
              >
                Columns
                <div
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                    resizingColumn === "columns" && "bg-primary",
                  )}
                  onMouseDown={(e) => {
                    handleMouseDown(e, "columns");
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
                style={{ width: columnWidths.unique }}
              >
                Unique
                <div
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                    resizingColumn === "unique" && "bg-primary",
                  )}
                  onMouseDown={(e) => {
                    handleMouseDown(e, "unique");
                  }}
                />
              </th>
              <th
                className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
                style={{ width: columnWidths.condition }}
              >
                Condition
                <div
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                    resizingColumn === "condition" && "bg-primary",
                  )}
                  onMouseDown={(e) => {
                    handleMouseDown(e, "condition");
                  }}
                />
              </th>
              <th
                className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
                style={{ width: columnWidths.size }}
              >
                Size
                <div
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                    resizingColumn === "size" && "bg-primary",
                  )}
                  onMouseDown={(e) => {
                    handleMouseDown(e, "size");
                  }}
                />
              </th>
              <th
                className="text-left px-2 py-1 border-b border-border font-semibold text-foreground/80 relative"
                style={{ width: columnWidths.usage }}
              >
                Usage
                <div
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                    resizingColumn === "usage" && "bg-primary",
                  )}
                  onMouseDown={(e) => {
                    handleMouseDown(e, "usage");
                  }}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((index, i) => {
              const isDeleted = deletedIndexes.has(index.name);
              const editingData = editingIndexes.get(index.name);
              const displayData = editingData || {
                name: index.name,
                columns: index.columns,
                unique: index.unique,
                type: index.index_type,
                condition: index.condition || "",
                originalName: index.name,
                primary: index.primary,
                size: index.size,
                foreign_key: index.foreign_key,
              };

              // Check if row has any changes - compare display data with original
              const hasRowChanges = editingData
                ? editingData.name !== index.name ||
                  JSON.stringify(editingData.columns) !==
                    JSON.stringify(index.columns) ||
                  editingData.unique !== index.unique ||
                  editingData.type !== index.index_type ||
                  (editingData.condition || "") !== (index.condition || "")
                : false;

              return (
                <IndexRow
                  key={index.name}
                  index={displayData}
                  rowNumber={i + 1}
                  hasChanges={hasRowChanges}
                  isDeleted={isDeleted}
                  connectionId={connectionId}
                  originalIndex={{
                    name: index.name,
                    columns: index.columns,
                    unique: index.unique,
                    type: index.index_type,
                    condition: index.condition || "",
                    originalName: index.name,
                    primary: index.primary,
                    size: index.size,
                    foreign_key: index.foreign_key,
                  }}
                  availableColumns={availableColumns}
                  usageStats={usageStats}
                  statsLoading={statsLoading}
                  onUpdate={(updates) => {
                    // Clear deletion if user starts editing
                    if (isDeleted) {
                      setDeletedIndexes((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(index.name);
                        return newSet;
                      });
                    }
                    updateEditingData(index.name, updates);
                  }}
                  onToggleUnique={() => {
                    if (!index.primary && !index.foreign_key) {
                      // Clear deletion if user starts editing
                      if (isDeleted) {
                        setDeletedIndexes((prev) => {
                          const newSet = new Set(prev);
                          newSet.delete(index.name);
                          return newSet;
                        });
                      }
                      updateEditingData(index.name, {
                        unique: !displayData.unique,
                      });
                    }
                  }}
                  onDelete={
                    !index.primary && !index.foreign_key
                      ? () => {
                          handleDeleteIndex(index.name);
                        }
                      : undefined
                  }
                  onReset={() => {
                    if (isDeleted) {
                      // Undo deletion
                      setDeletedIndexes((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(index.name);
                        return newSet;
                      });
                    } else if (hasRowChanges) {
                      // Reset changes to original values
                      setEditingIndexes((prev) => {
                        const newMap = new Map(prev);
                        newMap.delete(index.name);
                        return newMap;
                      });
                    }
                  }}
                />
              );
            })}

            {/* New index rows */}
            {newIndexes.map((newIndex, i) => (
              <IndexRow
                key={`new-${i}`}
                index={newIndex}
                rowNumber={0}
                hasChanges={true}
                isNew={true}
                connectionId={connectionId}
                availableColumns={availableColumns}
                onUpdate={(updates) => {
                  updateNewIndex(i, updates);
                }}
                onToggleUnique={() => {
                  updateNewIndex(i, { unique: !newIndex.unique });
                }}
                onDelete={() => {
                  removeNewIndex(i);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const TableIndexesSkeleton = memo(function TableIndexesSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
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
