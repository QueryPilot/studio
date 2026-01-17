/**
 * SqlDataGrid - SQL table browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - SQL-specific toolbar with Add Row and Staging Actions
 * - FK preview, filtering, sorting, export, row pinning
 * - CRUD operations via the staging pipeline
 */

import { memo, useMemo, useCallback, useRef, useState, useEffect } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { Button } from '@/components/ui/button';
import { IconPlus } from '@tabler/icons-react';
import { StagingActionsToolbar } from '../components/StagingActionsToolbar';
import { useTableDataQuery } from '@/hooks/useTableDataQuery';
import { useTableFullStructure } from '@/hooks/useTableFullStructure';
import { useCrudStore } from '@/stores/crudStore';
import { useDataInvalidationStore } from '@/stores/dataInvalidationStore';
import { buildGridCellV2 } from '../utils/cellFactory';
import { createInsertCommand, createCrudTarget } from '../utils/crudHelpers';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent, GridRowInsertEvent, GridRowDeleteEvent } from '../types';
import type { ColumnMeta } from '@/types';
import type { TableDataRow } from '@/services/tableDataTypes';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface SqlDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** Schema name (optional) */
  schema?: string;
  /** Table name */
  table: string;
  /** Is this a view? */
  isView?: boolean;
  /** Entity kind */
  kind?: 'Table' | 'View' | 'MaterializedView';
  /** Actions change callback */
  onActionsChange?: (actions: React.ReactNode) => void;
  /** Initial WHERE clause filter */
  initialFilter?: string;
  /** Panel ID for FK reference navigation */
  panelId?: string;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const SqlDataGrid = memo(function SqlDataGrid({
  gridId,
  connectionId,
  database,
  schema,
  table,
  isView = false,
  kind = 'Table',
  initialFilter,
  className,
}: SqlDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const hasStagedChanges = useCrudStore((s) => {
    const target = createCrudTarget({ connectionId, database, schema, table });
    return (s.commands[target]?.length ?? 0) > 0;
  });

  const registerListener = useDataInvalidationStore((s) => s.registerListener);

  // Determine entity type
  const entityType: 'table' | 'view' | 'materialized_view' =
    kind === 'MaterializedView'
      ? 'materialized_view'
      : kind === 'View' || isView
      ? 'view'
      : 'table';

  const readOnly = entityType !== 'table';

  // Load table structure for FK data and column metadata
  const { structure: tableStructure } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeIndexes: false,
      includeConstraints: true,
      includeTriggers: false,
      includeStatistics: false,
      includeForeignKeys: true,
    },
  });

  // Load table data with pagination
  const {
    rows: rawRows,
    columns: rawColumns,
    status,
    error: queryError,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    estimatedTotal,
    isEstimatedCount,
  } = useTableDataQuery({
    connectionId,
    database,
    schema,
    entityName: table,
    entityType,
    pageSize: 300,
    enabled: true,
    reuseStructure: true,
  });

  // Register data invalidation listener
  useEffect(() => {
    const unsubscribe = registerListener(
      { connectionId, database, schema, table },
      () => {
        logger.info('sql-datagrid', 'Data invalidated, refetching', { table });
        refetch();
      }
    );
    return unsubscribe;
  }, [connectionId, database, schema, table, registerListener, refetch]);

  // Transform raw data to GridRowModel and GridColumnV2
  const rows = useMemo<GridRowModel[]>(() => {
    return rawRows.map((row: TableDataRow, idx) => ({
      id: `row_${idx}`,
      data: row.data,
      isLoading: false,
    }));
  }, [rawRows]);

  const columns = useMemo<GridColumnV2[]>(() => {
    return rawColumns.map((col: ColumnMeta, idx) => ({
      id: `col_${idx}`,
      field: `col_${idx}`,
      title: col.name,
      name: col.name,
      width: 150,
      type: col.type,
      meta: col,
    }));
  }, [rawColumns]);

  // getCellContent for Glide Data Grid
  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIdx, rowIdx] = cell;
      if (rowIdx >= rows.length || colIdx >= columns.length) {
        return { kind: 'text' as const, data: '', displayData: '', allowOverlay: false };
      }
      const row = rows[rowIdx];
      const column = columns[colIdx];
      const value = row.data[colIdx];
      return buildGridCellV2(value, column, {
        connectionId,
        database,
        schema,
        table,
        rowData: row.data,
        foreignKeys: tableStructure?.foreignKeys ?? [],
      });
    },
    [rows, columns, connectionId, database, schema, table, tableStructure]
  );

  // CRUD handlers
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      // TODO: Create edit command and stage it
      logger.info('sql-datagrid', 'Cell edit commit', event);
    },
    []
  );

  const handleRowInsert = useCallback(
    (event: GridRowInsertEvent) => {
      // TODO: Create insert command and stage it
      logger.info('sql-datagrid', 'Row insert', event);
    },
    []
  );

  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent) => {
      // TODO: Create delete command and stage it
      logger.info('sql-datagrid', 'Row delete', event);
    },
    []
  );

  const handleAddRow = useCallback(() => {
    if (!tableStructure) return;
    const cmd = createInsertCommand({
      target: createCrudTarget({ connectionId, database, schema, table }),
      columns: tableStructure.columns,
      values: [],
    });
    stageCommand(cmd);
    logger.info('sql-datagrid', 'Added new row command');
  }, [connectionId, database, schema, table, tableStructure, stageCommand]);

  // SQL-specific toolbar
  const topToolbar = useMemo(
    () => (
      <div className="flex items-center gap-2 pb-1.5 pt-0.5">
        {/* Add Row Button (tables only) */}
        {kind === 'Table' && !readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddRow}
            title="Add new row"
          >
            <IconPlus className="h-3 w-3" />
          </Button>
        )}

        {/* Staging Actions */}
        {hasStagedChanges && (
          <StagingActionsToolbar
            connectionId={connectionId}
            database={database}
            schema={schema}
            table={table}
            onCommitSuccess={refetch}
          />
        )}
      </div>
    ),
    [kind, readOnly, hasStagedChanges, connectionId, database, schema, table, refetch, handleAddRow]
  );

  // Loading and error states
  const isLoading = status === 'loading' && !isFetching;
  const errorMessage = queryError ? String(queryError) : null;

  return (
    <BaseDataGrid
      gridId={gridId}
      rows={rows}
      columns={columns}
      getCellContent={getCellContent}
      isLoading={isLoading}
      isLoadingMore={isFetchingNextPage}
      error={errorMessage}
      hasMore={hasNextPage}
      onLoadMore={fetchNextPage}
      estimatedTotal={estimatedTotal}
      isEstimatedCount={isEstimatedCount}
      onCellEditCommit={handleCellEditCommit}
      onRowInsert={handleRowInsert}
      onRowDelete={handleRowDelete}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={database}
      schema={schema}
      tableName={table}
      paradigm="sql"
      enableFKPreview={true}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={true}
      readOnly={readOnly}
      className={cn('sql-datagrid', className)}
    />
  );
});
