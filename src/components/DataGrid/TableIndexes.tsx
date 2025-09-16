import { memo, useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  AlertCircle,
  KeyRound,
  Hash,
  TrendingUp,
  Plus,
  Save,
  X,
  Trash2,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type TableIndex } from "@/services/databaseService";
import { type IndexUsageStats } from "@/services/backend";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ColumnSelector } from "./ColumnSelector";
import { useTableColumns } from "@/hooks/useTableColumns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

interface NewIndexData {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
  condition: string;
}

interface EditingIndexData extends NewIndexData {
  originalName: string;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
}: TableIndexesProps) {
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [usageStats, setUsageStats] = useState<Map<string, IndexUsageStats>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline editing states
  const [editingIndexes, setEditingIndexes] = useState<Map<string, EditingIndexData>>(new Map());
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // New index state
  const [newIndex, setNewIndex] = useState<NewIndexData>({
    name: "",
    columns: [],
    unique: false,
    type: "btree",
    condition: "",
  });

  // Get available columns for selection
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

      // Fetch usage stats separately (non-blocking)
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

  const generateCreateIndexSQL = (data: NewIndexData): string => {
    const uniqueStr = data.unique ? "UNIQUE " : "";
    const columnsStr = data.columns.join(", ");
    const typeStr = data.type !== "btree" ? ` USING ${data.type}` : "";
    const conditionStr = data.condition ? ` WHERE ${data.condition}` : "";

    return `CREATE ${uniqueStr}INDEX ${data.name} ON ${schema || "public"}.${table}${typeStr} (${columnsStr})${conditionStr}`;
  };

  const generateDropIndexSQL = (indexName: string): string => {
    return `DROP INDEX IF EXISTS ${schema || "public"}.${indexName}`;
  };

  const generateRenameIndexSQL = (oldName: string, newName: string): string => {
    return `ALTER INDEX ${schema || "public"}.${oldName} RENAME TO ${newName}`;
  };

  const validateIndexData = (data: NewIndexData | EditingIndexData): string | null => {
    if (!data.name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(data.name)) {
      return "Invalid index name. Use only letters, numbers, and underscores.";
    }
    if (data.columns.length === 0) {
      return "At least one column is required.";
    }
    // Check for duplicate names (except when editing same index)
    const isDuplicate = indexes.some(idx => {
      if ('originalName' in data && idx.name === data.originalName) return false;
      return idx.name === data.name;
    });
    if (isDuplicate) {
      return "An index with this name already exists.";
    }
    return null;
  };

  const handleCreateIndex = async () => {
    const error = validateIndexData(newIndex);
    if (error) {
      toast.error(error);
      return;
    }

    setIsCreating(true);
    try {
      const sql = generateCreateIndexSQL(newIndex);
      await databaseService.executeQuery(connectionId, sql);
      toast.success(`Index ${newIndex.name} created successfully`);

      // Reset form and refresh
      setNewIndex({
        name: "",
        columns: [],
        unique: false,
        type: "btree",
        condition: "",
      });
      await fetchIndexes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create index");
    } finally {
      setIsCreating(false);
    }
  };

  const startEditing = (index: TableIndex) => {
    const editData: EditingIndexData = {
      originalName: index.name,
      name: index.name,
      columns: index.columns,
      unique: index.unique,
      type: index.index_type,
      condition: index.condition || "",
    };
    setEditingIndexes(prev => new Map(prev).set(index.name, editData));
    setHasChanges(true);
  };

  const updateEditingData = (indexName: string, updates: Partial<EditingIndexData>) => {
    setEditingIndexes(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(indexName);
      if (existing) {
        newMap.set(indexName, { ...existing, ...updates });
      }
      return newMap;
    });
    setHasChanges(true);
  };

  const handleSaveAllChanges = async () => {
    setIsSaving(true);
    const errors: string[] = [];

    try {
      for (const [_, editData] of editingIndexes) {
        const error = validateIndexData(editData);
        if (error) {
          errors.push(`${editData.originalName}: ${error}`);
          continue;
        }

        // If name changed, rename the index
        if (editData.name !== editData.originalName) {
          try {
            const sql = generateRenameIndexSQL(editData.originalName, editData.name);
            await databaseService.executeQuery(connectionId, sql);
          } catch (err) {
            errors.push(`Failed to rename ${editData.originalName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }

      if (errors.length > 0) {
        toast.error(`Some changes failed:\n${errors.join('\n')}`);
      } else {
        toast.success("All changes saved successfully");
        setEditingIndexes(new Map());
        setHasChanges(false);
      }

      await fetchIndexes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteIndex = async (indexName: string) => {
    try {
      const sql = generateDropIndexSQL(indexName);
      await databaseService.executeQuery(connectionId, sql);
      toast.success(`Index ${indexName} deleted successfully`);
      await fetchIndexes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete index");
    } finally {
      setDeleteConfirmIndex(null);
    }
  };

  const toggleUnique = (indexName: string, currentValue: boolean) => {
    // For existing indexes
    if (editingIndexes.has(indexName)) {
      updateEditingData(indexName, { unique: !currentValue });
    } else {
      // Start editing this index
      const index = indexes.find(idx => idx.name === indexName);
      if (index && !index.primary) {
        startEditing(index);
        updateEditingData(indexName, { unique: !currentValue });
      }
    }
  };

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
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 p-2 border-b bg-muted/50">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditingIndexes(new Map());
            setHasChanges(false);
            setNewIndex({ name: "", columns: [], type: "btree", unique: false, condition: "" });
          }}
          disabled={isSaving}
        >
          <X className="h-3 w-3 mr-1" />
          Discard
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Focus on the add new index row
            const nameInput = document.querySelector('input[placeholder="idx_table_column"]') as HTMLInputElement;
            if (nameInput) {
              nameInput.focus();
            }
          }}
        >
          <Plus className="h-3 w-3 mr-1" />
          New Index
        </Button>
        {hasChanges && (
          <Button
            size="sm"
            onClick={handleSaveAllChanges}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-muted border-b border-border">
            <tr className="text-xs" style={{ height: "28px" }}>
              <th className="text-left px-2 py-1 w-10 border-r border-border font-semibold text-foreground/80">
                #
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[150px]">
                Index Name
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[200px]">
                Columns
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[80px]">
                Type
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[70px]">
                Unique
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[150px]">
                Condition
              </th>
              <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 min-w-[70px]">
                Size
              </th>
              <th className="text-left px-2 py-1 border-b border-border font-semibold text-foreground/80 min-w-[80px]">
                Usage
              </th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((index, i) => {
              const editingData = editingIndexes.get(index.name);
              const isEditing = !!editingData;
              const isPrimary = index.primary;
              const displayData = editingData || index;

              return (
                <tr
                  key={index.name}
                  className={cn(
                    "group transition-colors text-xs border-b border-r",
                    isEditing ? "bg-blue-50/50 dark:bg-blue-900/10" : "hover:bg-primary/10",
                    !isEditing && i % 2 === 0 && "bg-muted/10",
                  )}
                  style={{ height: "28px" }}
                  onDoubleClick={() => !isPrimary && !isEditing && startEditing(index)}
                >
                  <td className="px-1.5 py-0.5 border-b border-r text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className={cn(
                    "border-b border-r font-medium text-foreground/80 dark:text-foreground/70",
                    !isEditing && "px-1.5 py-0.5"
                  )}>
                    {isEditing && !isPrimary ? (
                      <input
                        value={displayData.name}
                        onChange={(e) => updateEditingData(index.name, { name: e.target.value })}
                        className="w-full bg-transparent outline-none focus:ring-1 focus:ring-primary/20 rounded px-0.5 text-xs h-5"
                      />
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className={index.primary ? "font-semibold" : ""}>
                          {index.name}
                        </span>
                        <div className="flex items-center gap-1">
                          {index.primary && (
                            <KeyRound className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
                          )}
                          {index.unique && !index.primary && (
                            <Hash className="h-3 w-3 text-blue-600 dark:text-blue-500" />
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className={cn(
                    "border-b border-r text-foreground/80 dark:text-foreground/65 font-mono text-xs",
                    !isEditing && "px-1.5 py-0.5"
                  )}>
                    {isEditing && !isPrimary ? (
                      <ColumnSelector
                        value={editingData?.columns || []}
                        onChange={(cols) => updateEditingData(index.name, { columns: cols })}
                        availableColumns={availableColumns}
                        className="h-5 border-0 bg-transparent hover:bg-muted/50"
                      />
                    ) : (
                      index.columns.join(", ")
                    )}
                  </td>
                  <td className={cn(
                    "border-b border-r text-foreground/80 dark:text-foreground/65",
                    !isEditing && "px-1.5 py-0.5"
                  )}>
                    {isEditing && !isPrimary ? (
                      <Select
                        value={editingData?.type || "btree"}
                        onValueChange={(val) => updateEditingData(index.name, { type: val })}
                      >
                        <SelectTrigger className="h-5 text-xs border-0 bg-transparent hover:bg-muted/50 px-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="btree">btree</SelectItem>
                          <SelectItem value="hash">hash</SelectItem>
                          <SelectItem value="gin">gin</SelectItem>
                          <SelectItem value="gist">gist</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">
                          {index.index_type}
                        </span>
                        {index.index_type === "btree" && (
                          <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />
                        )}
                      </div>
                    )}
                  </td>
                  <td className={cn(
                    "border-b border-r",
                    !isPrimary && "px-1.5 py-0.5"
                  )}>
                    <button
                      onClick={() => !isPrimary && toggleUnique(index.name, displayData.unique)}
                      disabled={isPrimary}
                      className={cn(
                        "inline-flex px-1.5 py-0 rounded text-xs cursor-pointer transition-colors",
                        isPrimary && "cursor-not-allowed opacity-50",
                        displayData.unique
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/40"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
                      )}
                    >
                      {displayData.unique ? "YES" : "NO"}
                    </button>
                  </td>
                  <td className={cn(
                    "border-b border-r text-foreground/60 dark:text-foreground/50 text-xs",
                    !isEditing && "px-1.5 py-0.5"
                  )}>
                    {isEditing && !isPrimary ? (
                      <input
                        value={editingData?.condition || ""}
                        onChange={(e) => updateEditingData(index.name, { condition: e.target.value })}
                        placeholder="WHERE clause"
                        className="w-full bg-transparent outline-none focus:ring-1 focus:ring-primary/20 rounded px-0.5 font-mono text-xs h-5"
                      />
                    ) : (
                      <span className="italic">{index.condition || "-"}</span>
                    )}
                  </td>
                  <td className="px-1.5 py-0.5 border-b border-r text-foreground/70 dark:text-foreground/60 text-xs text-right font-mono">
                    {(() => {
                      const stats = usageStats.get(index.name);
                      return stats?.size_pretty || index.size || "-";
                    })()}
                  </td>
                  <td className="px-1.5 py-0.5 border-b text-foreground/70 dark:text-foreground/60 text-xs">
                    {(() => {
                      const stats = usageStats.get(index.name);
                      if (!stats) {
                        return statsLoading ? (
                          <Skeleton className="h-4 w-16 inline-block" />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        );
                      }

                      const displayValue = stats.is_unused
                        ? "Unused"
                        : stats.scan_count?.toLocaleString() || "Active";

                      const colorClass = stats.is_unused
                        ? "text-red-600 dark:text-red-400"
                        : stats.scan_count && stats.scan_count < 100
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-green-600 dark:text-green-400";

                      return (
                        <HoverCard openDelay={200}>
                          <HoverCardTrigger asChild>
                            <span
                              className={`${colorClass} font-medium cursor-help`}
                            >
                              {displayValue}
                            </span>
                          </HoverCardTrigger>
                          <HoverCardContent
                            className="w-auto p-3"
                            side="top"
                            align="end"
                          >
                            <div className="space-y-1.5">
                              <div className="font-semibold text-sm mb-2">
                                Index Usage Statistics
                              </div>
                              {stats.scan_count !== undefined && (
                                <div className="text-xs flex justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Scans:
                                  </span>
                                  <span className="font-mono">
                                    {stats.scan_count.toLocaleString()}
                                  </span>
                                </div>
                              )}
                              {stats.last_used && (
                                <div className="text-xs flex justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Last Used:
                                  </span>
                                  <span className="font-mono">
                                    {(() => {
                                      const date = new Date(stats.last_used);
                                      const now = new Date();
                                      const diffMs =
                                        now.getTime() - date.getTime();
                                      const diffDays = Math.floor(
                                        diffMs / (1000 * 60 * 60 * 24),
                                      );
                                      const diffHours = Math.floor(
                                        diffMs / (1000 * 60 * 60),
                                      );
                                      const diffMinutes = Math.floor(
                                        diffMs / (1000 * 60),
                                      );

                                      if (diffMinutes < 1) return "Just now";
                                      if (diffMinutes < 60)
                                        return `${diffMinutes}m ago`;
                                      if (diffHours < 24)
                                        return `${diffHours}h ago`;
                                      if (diffDays < 7) return `${diffDays}d ago`;
                                      if (diffDays < 30)
                                        return `${Math.floor(diffDays / 7)}w ago`;
                                      if (diffDays < 365)
                                        return `${Math.floor(
                                          diffDays / 30,
                                        )}mo ago`;
                                      return `${Math.floor(diffDays / 365)}y ago`;
                                    })()}
                                  </span>
                                </div>
                              )}
                              {stats.rows_read !== undefined && (
                                <div className="text-xs flex justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Rows Read:
                                  </span>
                                  <span className="font-mono">
                                    {stats.rows_read.toLocaleString()}
                                  </span>
                                </div>
                              )}
                              {stats.cache_hit_ratio !== undefined && (
                                <div className="text-xs flex justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Cache Hit:
                                  </span>
                                  <span className="font-mono">
                                    {stats.cache_hit_ratio.toFixed(1)}%
                                  </span>
                                </div>
                              )}
                              {stats.efficiency_score !== undefined && (
                                <div className="text-xs flex justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Efficiency:
                                  </span>
                                  <span className="font-mono">
                                    {stats.efficiency_score}/100
                                  </span>
                                </div>
                              )}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}

            {/* Add new index row */}
            <tr className="bg-emerald-50/50 dark:bg-emerald-900/5 border-t border-primary/10" style={{ height: "28px" }}>
              <td className="px-1.5 py-0 border-b border-r">
                <Plus className="h-3 w-3 text-muted-foreground" />
              </td>
              <td className="px-1 py-0 border-b border-r">
                <input
                  placeholder="idx_table_column"
                  value={newIndex.name}
                  onChange={(e) => setNewIndex(prev => ({...prev, name: e.target.value}))}
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground/50 focus:placeholder:text-muted-foreground text-xs h-5"
                />
              </td>
              <td className="px-1 py-0 border-b border-r">
                <ColumnSelector
                  value={newIndex.columns}
                  onChange={(cols) => setNewIndex(prev => ({...prev, columns: cols}))}
                  availableColumns={availableColumns}
                  placeholder="Select columns..."
                  className="h-5 border-0 bg-transparent hover:bg-muted/50 text-xs"
                />
              </td>
              <td className="px-1 py-0 border-b border-r">
                <Select
                  value={newIndex.type}
                  onValueChange={(val) => setNewIndex(prev => ({...prev, type: val}))}
                >
                  <SelectTrigger className="h-5 text-xs border-0 bg-transparent hover:bg-muted/50 px-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="btree">btree</SelectItem>
                    <SelectItem value="hash">hash</SelectItem>
                    <SelectItem value="gin">gin</SelectItem>
                    <SelectItem value="gist">gist</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="px-1 py-0 border-b border-r">
                <button
                  onClick={() => setNewIndex(prev => ({...prev, unique: !prev.unique}))}
                  className={cn(
                    "inline-flex px-1.5 py-0 rounded text-xs cursor-pointer transition-colors",
                    newIndex.unique
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/40"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
                  )}
                >
                  {newIndex.unique ? "YES" : "NO"}
                </button>
              </td>
              <td className="px-1 py-0 border-b border-r">
                <input
                  placeholder="Optional WHERE"
                  value={newIndex.condition}
                  onChange={(e) => setNewIndex(prev => ({...prev, condition: e.target.value}))}
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground/50 focus:placeholder:text-muted-foreground text-xs font-mono h-5"
                />
              </td>
              <td className="px-1.5 py-0 border-b border-r text-muted-foreground text-xs text-center">
                -
              </td>
              <td className="px-1 py-0 border-b">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-2 text-xs hover:bg-primary/10"
                  onClick={handleCreateIndex}
                  disabled={isCreating || !newIndex.name || newIndex.columns.length === 0}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create"
                  )}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmIndex} onOpenChange={() => setDeleteConfirmIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Index</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the index "{deleteConfirmIndex}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmIndex && handleDeleteIndex(deleteConfirmIndex)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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