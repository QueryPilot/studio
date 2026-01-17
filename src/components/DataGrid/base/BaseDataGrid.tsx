import React, { memo, useCallback, useRef, useState, useMemo, useEffect, useDeferredValue } from 'react';
import type {
  GridSelection,
  Item,
  GridCell,
  GridCellKind,
  Rectangle,
} from '@glideapps/glide-data-grid';
import type {
  GridRowModel,
  GridColumnV2,
  GridEditCommitEvent,
  GridRowInsertEvent,
  GridRowDeleteEvent,
} from '../types';
import type { ContextMenuTarget } from '../components/UnifiedContextMenu';
import type { QuickFilterRef } from '../components/QuickFilter';
import type { EditableDataGridRef } from './EditableDataGrid';

import { EditableDataGrid } from './EditableDataGrid';
import { DataGridStatusBar } from '../components/DataGridStatusBar';
import { QuickFilter } from '../components/QuickFilter';
import { UnifiedContextMenu } from '../components/UnifiedContextMenu';
import { buildGridCellV2 } from '../utils/cellFactory';
import { cn } from '@/lib/utils';
import { useCommand } from '@/hooks/useCommand';
import { toast } from 'sonner';

// Hooks
import { useQuickFilter } from '../hooks/useQuickFilter';
import { useAIFilter } from '../hooks/useAIFilter';
import { useColumnSizing } from '../hooks/useColumnSizing';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import { useRowPinning } from '../hooks/useRowPinning';
import { useColumnSorting } from '../hooks/useColumnSorting';
import { useClipboardBridge } from '../hooks/useClipboardBridge';
import { useFillOperations } from '../hooks/useFillOperations';
import { useStagedChangesIndicator } from '../hooks/useStagedChangesIndicator';
import { useGridPreferencesStore } from '../stores/gridPreferencesStore';
import { useCrudStore } from '@/stores/crudStore';

// Utils
import { createDrawHeader } from '../utils/headerUtils';
import { exportToCSV } from '../utils/exportUtils';

export interface BaseDataGridProps {
  // Core data (from data hooks)
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];

  // Loading & errors
  isLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;

  // Pagination
  hasMore?: boolean;
  onLoadMore?: () => void;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;

  // CRUD operations (from data hooks)
  onCellEditCommit?: (event: GridEditCommitEvent) => void;
  onRowInsert?: (event: GridRowInsertEvent) => void;
  onRowDelete?: (event: GridRowDeleteEvent) => void;

  // Optional capabilities (paradigm-specific)
  onCellActivated?: (cell: Item) => boolean; // MongoDB drill-down

  // Slots for paradigm-specific UI
  topToolbar?: React.ReactNode; // BreadcrumbNav | KeyHeader | null
  bottomToolbar?: React.ReactNode; // Custom pagination/actions

  // Paradigm-specific components (rendered by BaseDataGrid)
  fkPreviewComponent?: React.ReactNode; // SQL only
  hoverIconsDrawCell?: (cell: Item, ctx: CanvasRenderingContext2D, rect: Rectangle) => void;
  customGetCellContent?: (cell: Item, baseCell: GridCell) => GridCell; // For paradigm-specific overrides

  // Metadata (for context menu, filtering, etc.)
  connectionId: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: 'sql' | 'document' | 'keyvalue';

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableExport?: boolean;
  enableRowPinning?: boolean;
  enableColumnManagement?: boolean;
  enableClipboard?: boolean;
  enableFillOperations?: boolean;
  enableStagedChanges?: boolean;
  readOnly?: boolean;

  // Styling
  className?: string;

  // Dialect for SQL filtering
  dialect?: string;
}

export const BaseDataGrid = memo(function BaseDataGrid(props: BaseDataGridProps) {
  const {
    gridId,
    rows,
    columns,
    connectionId,
    database,
    schema,
    tableName,
    paradigm,
    dialect,
    enableFiltering = true,
    enableSorting = true,
    enableExport = true,
    enableRowPinning = true,
    enableColumnManagement = true,
    enableClipboard = true,
    enableFillOperations = true,
    enableStagedChanges = true,
    readOnly = false,
    onCellEditCommit,
    onRowInsert,
    onRowDelete,
    onCellActivated,
    topToolbar,
    bottomToolbar,
    fkPreviewComponent,
    hoverIconsDrawCell,
    customGetCellContent,
    className,
  } = props;

  // --- Refs ---
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<EditableDataGridRef>(null);
  const quickFilterRef = useRef<QuickFilterRef>(null);

  // Store refs for callbacks
  const onCellEditCommitRef = useRef(onCellEditCommit);
  const onRowInsertRef = useRef(onRowInsert);
  const onRowDeleteRef = useRef(onRowDelete);

  useEffect(() => {
    onCellEditCommitRef.current = onCellEditCommit;
    onRowInsertRef.current = onRowInsert;
    onRowDeleteRef.current = onRowDelete;
  });

  // --- State ---
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [isEditingCell, setIsEditingCell] = useState(false);
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
  const gridSelectionRef = useRef<GridSelection | undefined>(undefined);
  const contextMenuTargetRef = useRef<ContextMenuTarget | null>(null);

  // --- Column State from Store ---
  const preferences = useGridPreferencesStore((s: any) => s.getPreferences?.(gridId));
  const hydrated = useGridPreferencesStore((s: any) => s.hydrated);
  const columnState = preferences?.columns ?? { order: [], widths: {}, visibility: {}, pinned: [] };

  // --- Filter Columns ---
  const filterColumns = useMemo(() => {
    return columns.filter(
      (col) =>
        !['_rowIndex', '_rowSelection'].includes(col.id) &&
        col.meta?.db_type !== 'BYTEA' &&
        col.meta?.db_type !== 'bytea' &&
        col.meta?.db_type !== 'BLOB' &&
        col.meta?.db_type !== 'blob'
    );
  }, [columns]);

  // --- Quick Filter with AI Support ---
  const { generateFilter: generateAIFilter, isLoading: isAIFilterLoading } = useAIFilter(
    filterColumns,
    tableName ?? '',
    dialect ?? '',
    {
      connectionId,
      schema,
      enableCrossTable: paradigm === 'sql',
    }
  );

  const {
    value: quickFilterValue,
    mode: quickFilterMode,
    activeFilter,
    submit: handleFilterSubmit,
    clear: handleFilterClear,
  } = useQuickFilter({
    columns: filterColumns,
    initialFilter: undefined,
    generateAIFilter,
    clientSideFiltering: false,
  });

  // --- Focus/Blur Handlers ---
  const handleFocusCapture = useCallback(() => {
    setIsGridFocused(true);
  }, []);

  const handleBlurCapture = useCallback((e: React.FocusEvent) => {
    const currentTarget = e.currentTarget as HTMLElement;
    setTimeout(() => {
      if (!currentTarget.contains(document.activeElement)) {
        setIsGridFocused(false);
        setIsEditingCell(false);
      }
    }, 0);
  }, []);

  // --- Keyboard Shortcuts for Quick Filter ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        quickFilterRef.current?.focus();
        return;
      }

      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        !document.activeElement?.hasAttribute('contenteditable')
      ) {
        e.preventDefault();
        quickFilterRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Column Management ---
  const reorderColumns = useCallback(
    (cols: GridColumnV2[], order: string[]): GridColumnV2[] => {
      if (!order || order.length === 0) return cols;
      const orderMap = new Map(order.map((id, index) => [id, index]));
      return [...cols].sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? 9999;
        const bIdx = orderMap.get(b.id) ?? 9999;
        return aIdx - bIdx;
      });
    },
    []
  );

  const baseColumns = useMemo(() => columns, [columns]);
  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order, reorderColumns]
  );

  const { sizedColumns, columnWidths, handleColumnResize } = useColumnSizing({
    columns: reorderedColumns,
    initialWidths: columnState.widths,
  });

  const { visibleColumns } = useColumnVisibility({
    columns: reorderedColumns,
    initialHidden: Object.entries(columnState.visibility)
      .filter(([, visible]) => !visible)
      .map(([id]) => id),
  });

  const filterVisibleColumns = useCallback(
    (cols: GridColumnV2[], visibilityMap: Record<string, boolean>): GridColumnV2[] => {
      return cols.filter((col) => visibilityMap[col.id] !== false);
    },
    []
  );

  const applyPinnedOrdering = useCallback(
    (
      cols: GridColumnV2[],
      pinnedIds: string[]
    ): { columns: GridColumnV2[]; freezeColumns: number } => {
      if (!pinnedIds || pinnedIds.length === 0) {
        return { columns: cols, freezeColumns: 0 };
      }
      const pinnedSet = new Set(pinnedIds);
      const pinned = cols.filter((col) => pinnedSet.has(col.id));
      const unpinned = cols.filter((col) => !pinnedSet.has(col.id));
      return { columns: [...pinned, ...unpinned], freezeColumns: pinned.length };
    },
    []
  );

  const { columns: computedColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(visibleColumns, columnState.visibility);
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [columnState.pinned, columnState.visibility, visibleColumns, filterVisibleColumns, applyPinnedOrdering]);

  const finalColumns = useMemo(() => {
    if (!enableColumnManagement) return columns;
    return computedColumns;
  }, [enableColumnManagement, columns, computedColumns]);

  const finalColumnsRef = useRef(finalColumns);
  useEffect(() => {
    finalColumnsRef.current = finalColumns;
  }, [finalColumns]);

  // --- Row Pinning ---
  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) return `row-${index}`;
      const pkColumns = columns.filter((col) => col.meta?.is_pk);
      if (pkColumns.length === 0) return `row-${index}`;
      const pkParts: string[] = [];
      for (const pkCol of pkColumns) {
        const cellValue = row[pkCol.field];
        const value =
          cellValue && typeof cellValue === 'object' && 'value' in cellValue
            ? cellValue.value
            : cellValue;
        pkParts.push(value != null ? String(value) : 'null');
      }
      return `pk-${pkParts.join('-')}`;
    },
    [columns]
  );

  const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } = useRowPinning({
    rows,
    initialPinned: enableRowPinning ? (preferences?.pinnedRows ?? []) : [],
    maxPinnedRows: 5,
    getRowId: getRowKey,
    onChange: enableRowPinning
      ? (ids) => {
          if (!hydrated) return;
          useGridPreferencesStore.getState().updatePinnedRows(gridId, () => ids);
        }
      : undefined,
  });

  const displayRows = useMemo(() => {
    if (!enableRowPinning) return rows;
    return [...pinnedRows, ...unpinnedRows];
  }, [enableRowPinning, rows, pinnedRows, unpinnedRows]);

  const deferredDisplayRows = useDeferredValue(displayRows);
  const rowsRef = useRef(deferredDisplayRows);
  useEffect(() => {
    rowsRef.current = deferredDisplayRows;
  }, [deferredDisplayRows]);

  // --- Staged Changes Highlighting ---
  const stagedChanges = enableStagedChanges
    ? useStagedChangesIndicator({
        connectionId,
        database,
        schema: schema ?? '',
        table: tableName ?? '',
        rows: deferredDisplayRows,
        columns: finalColumns,
      })
    : { rowChanges: new Map(), cellChanges: new Map(), allChanges: [] };

  const stagedChangesRef = useRef(stagedChanges);
  useEffect(() => {
    stagedChangesRef.current = stagedChanges;
  }, [stagedChanges]);

  // --- Column Sorting ---
  const { sortColumns, getSortIndex, getSortDirection, toggleSort } = useColumnSorting({
    gridId,
    columns: finalColumns,
  });

  const drawHeader = useMemo(
    () =>
      enableSorting
        ? createDrawHeader({
            getSortDirection,
            getSortIndex,
            columns: finalColumns,
            sortedColumnCount: sortColumns.length,
          })
        : undefined,
    [enableSorting, getSortDirection, getSortIndex, finalColumns, sortColumns.length]
  );

  // --- Context Menu Handlers ---
  const handleHeaderContextMenu = useCallback(
    (colIndex: number, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const column = finalColumnsRef.current[colIndex];
      if (!column) return;

      const target: ContextMenuTarget = {
        type: 'header',
        columnIndex: colIndex,
        columnId: column.id,
        columnName: column.name,
        x: event.clientX,
        y: event.clientY,
      };

      contextMenuTargetRef.current = target;
    },
    []
  );

  const handleCellContextMenu = useCallback(
    (cell: Item, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const [colIndex, rowIndex] = cell;
      const column = finalColumnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];
      if (!column || !row) return;

      const target: ContextMenuTarget = {
        type: 'cell',
        cell,
        columnIndex: colIndex,
        rowIndex,
        columnId: column.id,
        columnName: column.name,
        x: event.clientX,
        y: event.clientY,
      };

      contextMenuTargetRef.current = target;
    },
    []
  );

  const handleHeaderClicked = useCallback(
    (colIndex: number, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      if (enableSorting) {
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          toggleSort(column.id, event.shiftKey || false);
        }
      }
    },
    [enableSorting, toggleSort]
  );

  // --- Clipboard Operations ---
  const toTextCallback = useCallback(
    (selection: GridSelection) => {
      if (!selection || !('columns' in selection) || !selection.columns) return '';
      const { rows: selectedRows, columns: selectedCols } = selection;
      const lines: string[] = [];

      for (const rowRange of selectedRows) {
        for (let rowIndex = rowRange[0]; rowIndex <= rowRange[1]; rowIndex++) {
          const row = rowsRef.current[rowIndex];
          if (!row) continue;
          const cells: string[] = [];
          for (const colRange of selectedCols) {
            for (let colIndex = colRange[0]; colIndex <= colRange[1]; colIndex++) {
              const column = finalColumnsRef.current[colIndex];
              if (!column) continue;
              const cellValue = row[column.field];
              const rawValue =
                cellValue && typeof cellValue === 'object' && 'value' in cellValue
                  ? cellValue.value
                  : cellValue;
              cells.push(rawValue != null ? String(rawValue) : '');
            }
          }
          lines.push(cells.join('\t'));
        }
      }
      return lines.join('\n');
    },
    []
  );

  const toJsonCallback = useCallback(
    (selection: GridSelection) => {
      if (!selection || !('columns' in selection) || !selection.columns) return '';
      const { rows: selectedRows, columns: selectedCols } = selection;
      const results: Record<string, unknown>[] = [];

      for (const rowRange of selectedRows) {
        for (let rowIndex = rowRange[0]; rowIndex <= rowRange[1]; rowIndex++) {
          const row = rowsRef.current[rowIndex];
          if (!row) continue;
          const obj: Record<string, unknown> = {};
          for (const colRange of selectedCols) {
            for (let colIndex = colRange[0]; colIndex <= colRange[1]; colIndex++) {
              const column = finalColumnsRef.current[colIndex];
              if (!column) continue;
              const cellValue = row[column.field];
              const rawValue =
                cellValue && typeof cellValue === 'object' && 'value' in cellValue
                  ? cellValue.value
                  : cellValue;
              obj[column.name] = rawValue;
            }
          }
          results.push(obj);
        }
      }
      return JSON.stringify(results, null, 2);
    },
    []
  );

  const { copySelection } = useClipboardBridge({
    toText: enableClipboard ? toTextCallback : undefined,
    toJson: enableClipboard ? toJsonCallback : undefined,
  });

  useCommand(
    'dataGrid.action.copyAsJson',
    enableClipboard
      ? async () => {
          await copySelection(gridSelectionRef.current, 'json');
        }
      : undefined
  );

  // --- Export to CSV ---
  // TODO: Implement export to CSV
  // useEffect(() => {
  //   if (!enableExport) return;
  //   const handleExport = () => {
  //     if (isGridFocused) {
  //       void exportToCSV(deferredDisplayRows, finalColumns, `${tableName ?? 'export'}.csv`);
  //       toast.success('Export started');
  //     }
  //   };
  //   eventBus.on('data-grid:export-csv', handleExport);
  //   return () => eventBus.off('data-grid:export-csv', handleExport);
  // }, [enableExport, deferredDisplayRows, finalColumns, tableName, isGridFocused]);

  // --- getCellContent ---
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
        };
      }

      const cellValue = row[column.field];
      const isReadOnly = readOnly || column.meta?.is_pk || false;

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
        connectionContext: {
          connectionId,
          database,
          schema: schema ?? '',
          table: tableName ?? '',
        },
      });

      // Apply custom getCellContent from paradigm-specific adapter
      const finalCell = customGetCellContent ? customGetCellContent(cell, gridCell) : gridCell;

      // Apply staged changes highlighting
      if (enableStagedChanges) {
        const changes = stagedChangesRef.current;
        const cellKey = `${rowIndex}:${column.name}`;
        if (changes.cellChanges.has(cellKey)) {
          return {
            ...finalCell,
            themeOverride: {
              ...finalCell.themeOverride,
              bgCell: 'rgba(251, 146, 60, 0.15)', // Orange for staged cell changes
            },
          };
        }
      }

      return finalCell;
    },
    [
      readOnly,
      connectionId,
      database,
      schema,
      tableName,
      customGetCellContent,
      enableStagedChanges,
    ]
  );

  // --- getRowThemeOverride ---
  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      if (!enableStagedChanges) return undefined;

      const changes = stagedChangesRef.current;
      const { pendingDeletions, pendingInsertions } = useCrudStore.getState().getConnectionCrud(connectionId, database, schema ?? '', tableName ?? '');

      // Deletion pending
      if (pendingDeletions.has(rowIndex)) {
        return { bgCell: 'rgba(239, 68, 68, 0.06)' }; // Red
      }

      // Insertion pending
      if (pendingInsertions.has(rowIndex)) {
        return { bgCell: 'rgba(34, 197, 94, 0.06)' }; // Green
      }

      // Pinned row
      if (enableRowPinning && rowIndex < pinnedRows.length) {
        return { bgCell: 'rgba(59, 130, 246, 0.08)' }; // Blue
      }

      // Staged changes
      if (changes.rowChanges.has(rowIndex)) {
        return { bgCell: 'rgba(212, 165, 43, 0.04)' }; // Golden
      }

      return undefined;
    },
    [connectionId, database, schema, tableName, enableStagedChanges, enableRowPinning, pinnedRows.length]
  );

  // --- CRUD Handlers ---
  const handleCellEditCommit = useCallback((event: GridEditCommitEvent) => {
    onCellEditCommitRef.current?.(event);
    return undefined;
  }, []);

  const handleRowInsert = useCallback((event: GridRowInsertEvent) => {
    onRowInsertRef.current?.(event);
    return undefined;
  }, []);

  const handleRowDelete = useCallback((event: GridRowDeleteEvent) => {
    onRowDeleteRef.current?.(event);
    return undefined;
  }, []);

  // --- Fill Operations ---
  const { fillDown, fillRight } = useFillOperations({
    getCellContent,
    onBatchEdit: enableFillOperations ? undefined : undefined, // TODO: Implement batch edit
    columnCount: finalColumns.length,
    rowCount: deferredDisplayRows.length,
  });

  useEffect(() => {
    if (!enableFillOperations) return;
    const handleFillKeyDown = (e: KeyboardEvent) => {
      if (!isGridFocused || isEditingCell) return;
      if (e.ctrlKey && !e.metaKey && e.key === 'd') {
        e.preventDefault();
        fillDown(gridSelection);
      }
      if (e.ctrlKey && !e.metaKey && e.key === 'r') {
        e.preventDefault();
        fillRight(gridSelection);
      }
    };
    window.addEventListener('keydown', handleFillKeyDown);
    return () => window.removeEventListener('keydown', handleFillKeyDown);
  }, [enableFillOperations, isGridFocused, isEditingCell, fillDown, fillRight, gridSelection]);

  // --- Selection Management ---
  const handleGridSelectionChange = useCallback((newSelection: GridSelection) => {
    setGridSelection(newSelection);
    gridSelectionRef.current = newSelection;
  }, []);

  // --- Column Reordering ---
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!hydrated || !enableColumnManagement) return;
      const newOrder = [...finalColumns.map((c) => c.id)];
      const [movedId] = newOrder.splice(startIndex, 1);
      newOrder.splice(endIndex, 0, movedId!);
      useGridPreferencesStore.getState().updateColumnOrder(gridId, () => newOrder);
    },
    [gridId, finalColumns, hydrated, enableColumnManagement]
  );

  // --- Context Menu Actions ---
  const handleColumnSort = useCallback(
    (columnId: string) => {
      if (enableSorting) {
        toggleSort(columnId, false);
      }
      contextMenuTargetRef.current = null;
    },
    [enableSorting, toggleSort]
  );

  const handleColumnHide = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      useGridPreferencesStore.getState().updateColumnVisibility(gridId, (draft: any) => {
        draft[columnId] = false;
      });
      contextMenuTargetRef.current = null;
    },
    [gridId, hydrated, enableColumnManagement]
  );

  const handlePinRowsFromMenu = useCallback(
    (rowIndices: number[]) => {
      if (!enableRowPinning) return;
      for (const idx of rowIndices) {
        const row = rowsRef.current[idx];
        if (row) {
          const key = getRowKey(row, idx);
          if (pinnedRowIds.includes(key)) {
            unpinRow(key);
          } else {
            pinRow(key);
          }
        }
      }
      contextMenuTargetRef.current = null;
    },
    [enableRowPinning, getRowKey, pinnedRowIds, pinRow, unpinRow]
  );

  // --- Render ---
  return (
    <div
      ref={wrapperRef}
      className={cn('flex flex-col h-full outline-none', className)}
      data-testid="base-datagrid"
    >
      {/* Top slot - paradigm-specific toolbar */}
      {topToolbar}

      {/* Quick Filter */}
      {enableFiltering && filterColumns.length > 0 && (
        <QuickFilter
          ref={quickFilterRef}
          table={tableName ?? ''}
          value={quickFilterValue}
          mode={quickFilterMode}
          onSubmit={handleFilterSubmit}
          onClear={handleFilterClear}
          isAILoading={isAIFilterLoading}
          dialect={dialect}
          enableSQL={paradigm === 'sql'}
          enableAI={true}
        />
      )}

      {/* Main grid with context menu */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
      >
        <UnifiedContextMenu
          selectedRows={[]} // TODO: implement selected rows tracking
          columns={finalColumns}
          onPinRows={handlePinRowsFromMenu}
          onSort={handleColumnSort}
          onHideColumn={handleColumnHide}
          contextMenuTargetRef={contextMenuTargetRef}
          referencedTableColumns={new Map()} // Paradigm-specific, provided by SQL adapter
        >
          <EditableDataGrid
            ref={gridRef}
            tableKey={gridId}
            rows={deferredDisplayRows}
            columns={finalColumns}
            getCellContent={getCellContent}
            drawHeader={drawHeader}
            drawCell={hoverIconsDrawCell}
            getRowThemeOverride={getRowThemeOverride}
            freezeColumns={enableColumnManagement ? freezeColumns : 0}
            onCellActivated={onCellActivated}
            onCellEditCommit={onCellEditCommit ? handleCellEditCommit : undefined}
            onRowInsert={onRowInsert ? handleRowInsert : undefined}
            onRowDelete={onRowDelete ? handleRowDelete : undefined}
            onColumnResize={enableColumnManagement ? handleColumnResize : undefined}
            onColumnMoved={enableColumnManagement ? handleColumnMoved : undefined}
            onHeaderClicked={handleHeaderClicked}
            onHeaderContextMenu={handleHeaderContextMenu}
            onCellContextMenu={handleCellContextMenu}
            onGridSelectionChange={handleGridSelectionChange}
            onCellEdited={useCallback(() => setIsEditingCell(true), [])}
            onFinishedEditing={useCallback(() => setIsEditingCell(false), [])}
          />
        </UnifiedContextMenu>
      </div>

      {/* Paradigm-specific components (e.g., FK preview for SQL) */}
      {fkPreviewComponent}

      {/* Bottom slot - paradigm-specific */}
      {bottomToolbar}

      {/* Status bar */}
      <DataGridStatusBar
        loadedRows={deferredDisplayRows.length}
        estimatedTotal={props.estimatedTotal}
        isEstimatedCount={props.isEstimatedCount}
        hasMore={props.hasMore}
        totalRows={deferredDisplayRows.length}
        pinnedRowsCount={enableRowPinning ? pinnedRows.length : 0}
        visibleColumnsCount={finalColumns.length}
        totalColumnsCount={columns.length}
        hiddenColumnsCount={columns.length - finalColumns.length}
        pinnedColumnsCount={enableColumnManagement ? freezeColumns : 0}
        sortedColumns={enableSorting ? sortColumns : []}
        stagedCommandsCount={0} // TODO: expose from useCrudStore
      />
    </div>
  );
});
