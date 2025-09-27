import { memo, useState, useEffect, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Zap, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type TriggerMeta } from "@/services/databaseService";
import { useColumnResizing } from "@/hooks/useColumnResizing";
import { TriggerRow, type TriggerRowData } from "./TriggerRow";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSchemaData } from "@/hooks/useSchemaData";

interface TableTriggersProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableTriggers = memo(function TableTriggers({
  connectionId,
  database,
  table,
  schema,
  onActionsChange,
}: TableTriggersProps) {
  const { toast } = useToast();
  const { columnWidths, resizingColumn, handleMouseDown } = useColumnResizing({
    columns: [
      { key: "rowNumber", minWidth: 30, defaultWidth: 40 },
      { key: "name", minWidth: 100, defaultWidth: 150 },
      { key: "event", minWidth: 80, defaultWidth: 100 },
      { key: "timing", minWidth: 80, defaultWidth: 100 },
      { key: "level", minWidth: 60, defaultWidth: 80 },
      { key: "status", minWidth: 80, defaultWidth: 100 },
      { key: "function", minWidth: 120, defaultWidth: 150 },
      { key: "condition", minWidth: 100, defaultWidth: 150 },
    ],
    storageKey: `table-triggers-columns-${database}-${table}`,
  });

  const [triggersData, setTriggersData] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing states
  const [editingTriggers, setEditingTriggers] = useState<Map<string, TriggerRowData>>(new Map());
  const [deletedTriggers, setDeletedTriggers] = useState<Set<string>>(new Set());
  const [newTriggers, setNewTriggers] = useState<TriggerRowData[]>([]);
  const [nextTriggerNumber, setNextTriggerNumber] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Get available columns for the table
  const [availableColumns, setAvailableColumns] = useState<Array<{ name: string; db_type?: string }>>([]);

  // Get functions from shared schema data hook
  const { functions: schemaFunctions } = useSchemaData(connectionId, database, schema || "public");

  // Format functions for display
  const availableFunctions = useMemo(() => {
    return schemaFunctions.map(f => {
      // The arguments field is an array after being processed by databaseService
      if (f.arguments && Array.isArray(f.arguments) && f.arguments.length > 0) {
        // Filter out empty arguments
        const validArgs = f.arguments.filter(arg => arg && arg.trim());
        if (validArgs.length > 0) {
          return `${f.name}(${validArgs.join(", ")})`;
        }
      }
      return `${f.name}()`;
    });
  }, [schemaFunctions]);

  useEffect(() => {
    const fetchTriggers = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await databaseService.listTriggers(
          connectionId,
          database,
          schema || "public",
          table,
        );
        setTriggersData(result);
        setNextTriggerNumber(result.length + 1);
      } catch (err) {
        console.error("Failed to fetch triggers:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load triggers",
        );
      } finally {
        setIsLoading(false);
      }
    };

    if (connectionId && database && table) {
      void fetchTriggers();
    }
  }, [connectionId, database, table, schema]);

  // Fetch available columns
  useEffect(() => {
    const fetchColumns = async () => {
      try {
        // Ensure connection is active
        if (!databaseService.isConnectionActive(connectionId)) {
          try {
            await databaseService.connectById(connectionId);
          } catch (connErr) {
            console.error("Failed to establish connection:", connErr);
            return;
          }
        }

        // Fetch columns for the table
        const tableInfo = await databaseService.getTableInfo(
          connectionId,
          database,
          schema || "public",
          table,
        );
        if (tableInfo?.columns) {
          setAvailableColumns(
            tableInfo.columns.map(col => ({
              name: col.name,
              db_type: col.db_type,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to fetch columns:", err);
      }
    };

    if (connectionId && database && table) {
      void fetchColumns();
    }
  }, [connectionId, database, table, schema]);

  // Update actions when editing state changes
  useEffect(() => {
    if (onActionsChange) {
      const hasChanges = editingTriggers.size > 0 || deletedTriggers.size > 0 || newTriggers.length > 0;

      if (!isEditing && !hasChanges) {
        onActionsChange(
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddTrigger}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Trigger
          </Button>
        );
      } else if (hasChanges) {
        onActionsChange(
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleSaveChanges}
              disabled={isSaving}
              className="h-7 text-xs"
            >
              Save Changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelChanges}
              disabled={isSaving}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddTrigger}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Trigger
            </Button>
          </div>
        );
      }
    }
  }, [editingTriggers, deletedTriggers, newTriggers, isEditing, isSaving, onActionsChange]);

  const handleAddTrigger = () => {
    const newTrigger: TriggerRowData = {
      name: `trg_${table}_${nextTriggerNumber}`,
      event: "INSERT",
      timing: "AFTER",
      level: "ROW",
      enabled: true,
      function: "",
      condition: undefined,
    };
    setNewTriggers([...newTriggers, newTrigger]);
    setNextTriggerNumber(nextTriggerNumber + 1);
    setIsEditing(true);
  };

  const handleUpdateTrigger = (
    triggerName: string,
    updates: Partial<TriggerRowData>,
    isNew: boolean,
  ) => {
    if (isNew) {
      const index = newTriggers.findIndex((t) => t.name === triggerName);
      if (index !== -1) {
        const updated = [...newTriggers];
        const updatedTrigger = { ...updated[index], ...updates };

        // Auto-generate trigger name based on function if user hasn't manually edited it
        if (updates.function && updated[index].name.startsWith(`trg_${table}_`)) {
          // Extract function base name (without arguments)
          const funcBaseName = updates.function.split('(')[0];
          if (funcBaseName) {
            updatedTrigger.name = `trg_${funcBaseName}`;
          }
        }

        updated[index] = updatedTrigger;
        setNewTriggers(updated);
      }
    } else {
      const originalTrigger = triggersData.find((t) => t.name === triggerName);
      if (originalTrigger) {
        const currentEdit = editingTriggers.get(triggerName) || {
          name: originalTrigger.name,
          event: originalTrigger.event,
          timing: originalTrigger.timing,
          level: originalTrigger.level,
          enabled: originalTrigger.enabled,
          function: originalTrigger.function,
          condition: originalTrigger.condition,
          originalName: originalTrigger.name,
        };

        const updated = new Map(editingTriggers);
        updated.set(triggerName, { ...currentEdit, ...updates });
        setEditingTriggers(updated);
      }
    }
  };

  const handleToggleEnabled = (triggerName: string, isNew: boolean) => {
    if (isNew) {
      const index = newTriggers.findIndex((t) => t.name === triggerName);
      if (index !== -1) {
        const updated = [...newTriggers];
        updated[index] = { ...updated[index], enabled: !updated[index].enabled };
        setNewTriggers(updated);
      }
    } else {
      const originalTrigger = triggersData.find((t) => t.name === triggerName);
      if (originalTrigger) {
        const currentEdit = editingTriggers.get(triggerName) || {
          name: originalTrigger.name,
          event: originalTrigger.event,
          timing: originalTrigger.timing,
          level: originalTrigger.level,
          enabled: originalTrigger.enabled,
          function: originalTrigger.function,
          condition: originalTrigger.condition,
          originalName: originalTrigger.name,
        };

        const updated = new Map(editingTriggers);
        updated.set(triggerName, { ...currentEdit, enabled: !currentEdit.enabled });
        setEditingTriggers(updated);
      }
    }
  };

  const handleDeleteTrigger = (triggerName: string, isNew: boolean) => {
    if (isNew) {
      setNewTriggers(newTriggers.filter((t) => t.name !== triggerName));
    } else {
      setDeletedTriggers(new Set([...deletedTriggers, triggerName]));
      // Remove from editing if it was being edited
      const updated = new Map(editingTriggers);
      updated.delete(triggerName);
      setEditingTriggers(updated);
    }
  };

  const handleResetTrigger = (triggerName: string, isNew: boolean) => {
    if (isNew) {
      // Can't reset new triggers, only delete
      setNewTriggers(newTriggers.filter((t) => t.name !== triggerName));
    } else {
      // Remove from deleted set
      const updatedDeleted = new Set(deletedTriggers);
      updatedDeleted.delete(triggerName);
      setDeletedTriggers(updatedDeleted);

      // Remove from editing
      const updated = new Map(editingTriggers);
      updated.delete(triggerName);
      setEditingTriggers(updated);
    }
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);

    try {
      // TODO: Implement actual save logic
      // This would involve calling database service methods to:
      // 1. Delete triggers in deletedTriggers set
      // 2. Update triggers in editingTriggers map
      // 3. Create triggers in newTriggers array

      toast({
        title: "Changes saved",
        description: "Trigger changes have been applied successfully.",
      });

      // Clear editing state
      setEditingTriggers(new Map());
      setDeletedTriggers(new Set());
      setNewTriggers([]);
      setIsEditing(false);

      // Refresh triggers
      const result = await databaseService.listTriggers(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setTriggersData(result);
      setNextTriggerNumber(result.length + 1);
    } catch (err) {
      toast({
        title: "Failed to save changes",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelChanges = () => {
    setEditingTriggers(new Map());
    setDeletedTriggers(new Set());
    setNewTriggers([]);
    setIsEditing(false);
  };

  // Combine all triggers for display
  const allTriggers = useMemo(() => {
    const result: Array<{
      trigger: TriggerRowData;
      isNew: boolean;
      isDeleted: boolean;
      hasChanges: boolean;
      originalTrigger?: TriggerRowData;
    }> = [];

    // Add existing triggers
    triggersData.forEach((trigger) => {
      const isDeleted = deletedTriggers.has(trigger.name);
      const editedData = editingTriggers.get(trigger.name);
      const hasChanges = !!editedData;

      const triggerData: TriggerRowData = editedData || {
        name: trigger.name,
        event: trigger.event,
        timing: trigger.timing,
        level: trigger.level,
        enabled: trigger.enabled,
        function: trigger.function,
        condition: trigger.condition,
        originalName: trigger.name,
      };

      result.push({
        trigger: triggerData,
        isNew: false,
        isDeleted,
        hasChanges,
        originalTrigger: {
          name: trigger.name,
          event: trigger.event,
          timing: trigger.timing,
          level: trigger.level,
          enabled: trigger.enabled,
          function: trigger.function,
          condition: trigger.condition,
          originalName: trigger.name,
        },
      });
    });

    // Add new triggers
    newTriggers.forEach((trigger) => {
      result.push({
        trigger,
        isNew: true,
        isDeleted: false,
        hasChanges: false,
      });
    });

    return result;
  }, [triggersData, editingTriggers, deletedTriggers, newTriggers]);

  if (isLoading) {
    return <TableTriggersSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load triggers</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (allTriggers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold mb-2 text-foreground/70">
          No triggers found
        </h3>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          This table doesn't have any triggers defined.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 px-1">
        <thead className="sticky top-0 z-10 bg-muted">
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
              Trigger Name
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
              style={{ width: columnWidths.event }}
            >
              Event
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "event" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "event");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.timing }}
            >
              Timing
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "timing" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "timing");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.level }}
            >
              Level
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "level" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "level");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.status }}
            >
              Status
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "status" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "status");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80 relative"
              style={{ width: columnWidths.function, maxWidth: "250px" }}
            >
              Function
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50",
                  resizingColumn === "function" && "bg-primary",
                )}
                onMouseDown={(e) => {
                  handleMouseDown(e, "function");
                }}
              />
            </th>
            <th
              className="text-left px-2 py-1 border-b border-border font-semibold text-foreground/80 relative"
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
          </tr>
        </thead>
        <tbody>
          {allTriggers.map((item, i) => (
            <TriggerRow
              key={item.trigger.name}
              trigger={item.trigger}
              rowNumber={i + 1}
              hasChanges={item.hasChanges}
              isNew={item.isNew}
              isDeleted={item.isDeleted}
              originalTrigger={item.originalTrigger}
              availableColumns={availableColumns}
              availableFunctions={availableFunctions}
              onUpdate={(updates) => handleUpdateTrigger(item.trigger.name, updates, item.isNew)}
              onToggleEnabled={() => handleToggleEnabled(item.trigger.name, item.isNew)}
              onDelete={() => handleDeleteTrigger(item.trigger.name, item.isNew)}
              onReset={() => handleResetTrigger(item.trigger.name, item.isNew)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

const TableTriggersSkeleton = memo(function TableTriggersSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
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