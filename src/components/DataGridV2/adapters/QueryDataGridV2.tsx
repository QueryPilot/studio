import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GridSelection,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";
import { GridCellKind, type Theme } from "@glideapps/glide-data-grid";
import { EditableDataGrid } from "../base";
import type { GridColumnV2, GridRowModel } from "../types";
import type { GlideQueryDataGridProps } from "@/components/DataGridV2/glide/types";
import { buildTableCell } from "@/components/DataGridV2/glide/cellFactory";
import {
  useGridPreferences,
  useGridPreferencesHydrated,
  upsertGridColumnsState,
} from "../stores";
import {
  useColumnPinning,
  useColumnSizing,
  useColumnVisibility,
  usePersistentViewState,
  useGridHistory,
} from "../hooks";
import {
  applyPinnedOrdering,
  filterVisibleColumns,
  reorderColumns,
} from "./columnUtils";
import { toCellValue } from "../utils/valueHelpers";
import {
  DataGridEmptyState,
  DataGridErrorState,
} from "@/components/DataGridV2/components/DataGridStates";
import { DataGridSkeleton } from "@/components/DataGridV2/components/DataGridSkeleton";
import { DataGridStatusBar } from "@/components/DataGridV2/components/DataGridStatusBar";

export interface QueryDataGridV2Props extends GlideQueryDataGridProps {
  gridId: string;
  className?: string;
  isLoading?: boolean;
  error?: string | null;
}

const DEFAULT_COLUMN_STATE = {
  order: [] as string[],
  widths: {} as Record<string, number>,
  visibility: {} as Record<string, boolean>,
  pinned: [] as string[],
};

export const QueryDataGridV2 = memo(function QueryDataGridV2(
  props: QueryDataGridV2Props,
) {
  const { gridId, data, isLoading = false, error, className } = props;

  const preferences = useGridPreferences(gridId);
  const hydrated = useGridPreferencesHydrated();
  const history = useGridHistory();
  const {
    persistedView,
    persistSelection,
    persistScrollOffset,
    persistActiveCell,
  } = usePersistentViewState(gridId);

  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    persistedView.selection,
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!persistedView.serializedSelection) {
      setGridSelection(undefined);
      return;
    }
    setGridSelection(persistedView.selection);
  }, [hydrated, persistedView.serializedSelection, persistedView.selection]);

  const columnNames = useMemo(() => data?.columns ?? [], [data?.columns]);
  const columnMeta = useMemo(() => data?.columnMeta ?? [], [data?.columnMeta]);

  const baseColumns = useMemo<GridColumnV2[]>(
    () =>
      columnNames.map((name, index) => {
        const meta = columnMeta[index];
        return {
          id: name || `col_${index}`,
          field: name,
          title: name,
          name,
          type: meta?.db_type,
          meta: meta ?? undefined,
        } satisfies GridColumnV2;
      }),
    [columnMeta, columnNames],
  );

  const rows: GridRowModel[] = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.map((rowValues) => {
      const record: GridRowModel = {};
      columnNames.forEach((name, colIndex) => {
        record[name] = toCellValue(
          rowValues[colIndex],
          columnMeta[colIndex]?.db_type,
        );
      });
      return record;
    });
  }, [columnMeta, columnNames, data?.rows]);

  const columnState = preferences?.columns ?? DEFAULT_COLUMN_STATE;

  // Track if we've initialized this grid to prevent infinite loops
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || baseColumns.length === 0 || initializedRef.current) return;

    const expectedOrder = baseColumns.map((column) => column.id);
    const currentOrder = columnState.order;
    const currentVisibility = columnState.visibility;

    const needsOrderSync =
      currentOrder.length !== expectedOrder.length ||
      currentOrder.some((id, index) => id !== expectedOrder[index]);

    const visibilityEntries = Object.keys(currentVisibility);
    const requiresVisibilitySync =
      visibilityEntries.length === 0 ||
      visibilityEntries.some((id) => !expectedOrder.includes(id));

    if (needsOrderSync || requiresVisibilitySync) {
      upsertGridColumnsState(gridId, (draft) => {
        if (needsOrderSync) {
          draft.order = expectedOrder;
        }
        if (requiresVisibilitySync) {
          const next: Record<string, boolean> = {};
          expectedOrder.forEach((id) => {
            const existing = draft.visibility[id];
            next[id] = existing === false ? false : true;
          });
          draft.visibility = next;
        }
      });
      initializedRef.current = true;
    } else {
      // Already initialized
      initializedRef.current = true;
    }
  }, [
    baseColumns,
    gridId,
    hydrated,
    columnState.order,
    columnState.visibility,
  ]);

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order],
  );

  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: reorderedColumns,
      initialWidths: columnState.widths,
      onChange: (widths) => {
        upsertGridColumnsState(gridId, (draft) => {
          draft.widths = widths;
        });
      },
    });

  const { visibleColumns } = useColumnVisibility({
    columns: sizedColumns,
    initialHidden: Object.entries(columnState.visibility)
      .filter(([, visible]) => !visible)
      .map(([id]) => id),
    onChange: (visibility) => {
      upsertGridColumnsState(gridId, (draft) => {
        draft.visibility = visibility;
      });
    },
  });

  const { pinnedColumns: _pinnedColumns } = useColumnPinning({
    columns: sizedColumns,
    initialPinned: columnState.pinned,
    onChange: (pinned) => {
      upsertGridColumnsState(gridId, (draft) => {
        draft.pinned = pinned;
      });
    },
  });

  const { columns: finalColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(
      visibleColumns,
      columnState.visibility,
    );
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [columnState.pinned, columnState.visibility, visibleColumns]);

  const handleGetCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumns[colIndex];
      const row = rows[rowIndex];
      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        } as const;
      }
      const value = row[column.field];
      return buildTableCell({ value, column, meta: column.meta ?? undefined });
    },
    [finalColumns, rows],
  );

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      persistSelection(selection);
    },
    [persistSelection],
  );

  // Debounced scroll persistence to avoid infinite loops
  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      // Debounce scroll persistence to avoid too many updates
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        persistScrollOffset({ x: region.x, y: region.y });
      }, 150);
    },
    [persistScrollOffset],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex) return;
      upsertGridColumnsState(gridId, (draft) => {
        const order = draft.order.length
          ? [...draft.order]
          : finalColumns.map((column) => column.id);
        const [moved] = order.splice(startIndex, 1);
        if (moved === undefined) return;
        order.splice(endIndex, 0, moved);
        draft.order = order;
      });
    },
    [finalColumns, gridId],
  );

  const selectedRowCount = gridSelection ? gridSelection.rows.length : 0;

  // Row highlighting for selected rows (compute before any early returns)
  const selectedRowsSet = useMemo(() => {
    const rowsSel = gridSelection ? gridSelection.rows.toArray() : [];
    return new Set<number>(rowsSel);
  }, [gridSelection]);

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      if (selectedRowsSet.has(rowIndex)) {
        return {
          bgCell: "rgba(252, 163, 17, 0.10)", // accent @ 10%
          bgCellMedium: "rgba(252, 163, 17, 0.12)",
        } as Partial<Theme>;
      }
      return undefined;
    },
    [selectedRowsSet],
  );

  if (!hydrated) {
    return null;
  }

  if (error) {
    return <DataGridErrorState error={error} />;
  }

  if (isLoading) {
    return <DataGridSkeleton />;
  }

  if (!data || rows.length === 0) {
    return (
      <DataGridEmptyState
        title="No results"
        description="Execute a query to see results"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <EditableDataGrid
        className={className}
        rows={rows}
        columns={finalColumns}
        getCellContent={handleGetCellContent}
        history={history}
        onColumnResize={(column, newSize) => {
          if (typeof newSize === "number" && newSize > 0) {
            handleColumnResize(column, newSize);
          }
        }}
        onColumnResizeEnd={(column, newSize) => {
          if (typeof newSize === "number" && newSize > 0) {
            handleColumnResizeEnd(column, newSize);
          }
        }}
        onColumnMoved={handleColumnMoved}
        onVisibleRegionChanged={handleVisibleRegionChanged}
        gridSelection={gridSelection}
        onSelectionChange={handleSelectionChange}
        onActiveCellChange={persistActiveCell}
        freezeColumns={freezeColumns}
        getRowThemeOverride={getRowThemeOverride}
      />

      <DataGridStatusBar
        loadedRows={rows.length}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});
