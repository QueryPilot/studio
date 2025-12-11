import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle, IconBolt } from "@tabler/icons-react";
import { databaseService, type TriggerMeta } from "@/services/databaseService";
import { EditableDataGrid } from "@/components/DataGridV2/base/EditableDataGrid";
import type {
  GridEditCommitEvent,
  GridRowModel,
} from "@/components/DataGridV2/types";
import { useColumnSizing } from "@/components/DataGridV2/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGridV2/renderers/TextCell";
import { triggerColumns } from "./columns";
import { transformTriggersToRows } from "./utils";
import type { TriggerGridRow } from "./types";

type AnyCell = CustomCell<Record<string, unknown>>;

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
  onActionsChange: _onActionsChange,
}: TableTriggersProps) {
  const [triggers, setTriggers] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTriggers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await databaseService.listTriggers(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setTriggers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load triggers");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadTriggers();
  }, [loadTriggers]);

  const hasTriggers = useMemo(() => triggers.length > 0, [triggers.length]);

  // Transform to grid rows
  const gridRows = useMemo(() => transformTriggersToRows(triggers), [triggers]);

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: triggerColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // Cell content factory
  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      const fieldValue = row[column.field as keyof TriggerGridRow];

      // Row number (right-aligned, muted)
      if (column.field === "row_number") {
        return {
          kind: GridCellKind.Text,
          data: String(fieldValue),
          displayData: String(fieldValue),
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Enabled column (center-aligned with color)
      if (column.field === "enabled") {
        const enabledValue = String(fieldValue);
        const isEnabled = enabledValue === "YES";
        return {
          kind: GridCellKind.Text,
          data: enabledValue,
          displayData: enabledValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "center" as const,
          themeOverride: isEnabled
            ? {
                bgCell: "rgba(16, 185, 129, 0.15)", // emerald
                textDark: "#059669",
              }
            : {
                bgCell: "rgba(239, 68, 68, 0.15)", // red
                textDark: "#dc2626",
              },
        } as const;
      }

      // Event and Function columns (monospace) - editable for viewing
      if (column.field === "event" || column.field === "function") {
        const value = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: value || null,
          },
          copyData: value,
          readonly: true, // Read-only but allows overlay to view full content
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Condition column (monospace with blue color) - editable for viewing
      if (column.field === "condition") {
        const conditionValue = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: conditionValue || null,
          },
          copyData: conditionValue,
          readonly: true, // Read-only but allows overlay to view full content
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
            textDark: "#3b82f6", // blue-500
          },
        } as const;
      }

      // Default text cell
      const displayValue = String(fieldValue ?? "");
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: false,
      } as const;
    },
    [gridRows, sizedColumns],
  );

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>],
    [],
  );

  // Handle cell edit commit (for read-only overlays, just cancel)
  const handleCellEditCommit = useCallback((_event: GridEditCommitEvent) => {
    // Read-only - don't actually save edits
    return undefined;
  }, []);

  if (isLoading) {
    return <TableTriggersSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load triggers</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasTriggers) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <IconBolt className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-xs">This table has no triggers.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        <EditableDataGrid
          rows={gridRows as unknown as GridRowModel[]}
          columns={sizedColumns}
          getCellContent={getCellContent}
          customRenderers={customRenderers}
          onCellEditCommit={handleCellEditCommit}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
        />
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Total triggers: {triggers.length}
        <button
          type="button"
          onClick={() => loadTriggers().catch(() => undefined)}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
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

export default TableTriggers;
