/**
 * KeyValueDataGrid - Redis key browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Type-aware column mapping for all Redis types
 * - Key metadata header in topToolbar (type, TTL, size)
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useMemo } from 'react';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { KeyHeader } from '../components/KeyHeader';
import { useKeyValueData } from '../hooks/useKeyValueData';
import { useCrudStore } from '@/stores/crudStore';
import type { GridEditCommitEvent, GridRowInsertEvent, GridRowDeleteEvent, GridRowModel } from '../types';
import type { CellValue } from '@/types';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface KeyValueDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Redis database index */
  database: number;
  /** Initial key to display */
  initialKey?: string;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const KeyValueDataGrid = memo(function KeyValueDataGrid({
  gridId,
  connectionId,
  database,
  initialKey,
  className,
}: KeyValueDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);

  // Get key-value data
  const data = useKeyValueData({
    connectionId,
    database,
    initialKey,
    enabled: true,
  });

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      const cmd = data.createEditCommand(event);
      if (cmd) {
        stageCommand(cmd);
        logger.info('keyvalue-grid', 'Staged edit command');
      }
      return undefined;
    },
    [data, stageCommand]
  );

  const extractRowValues = useCallback((row: GridRowModel): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    for (const [key, cell] of Object.entries(row)) {
      if (key.startsWith('__')) {
        continue;
      }
      if (cell && typeof cell === 'object' && 'value' in cell) {
        values[key] = (cell as CellValue).value;
      } else {
        values[key] = cell;
      }
    }
    return values;
  }, []);

  // Handle row insert
  const handleRowInsert = useCallback(
    (event: GridRowInsertEvent) => {
      if (data.currentKey?.type === 'stream') {
        logger.warn('keyvalue-grid', 'Insert ignored for stream keys');
        return undefined;
      }
      for (const row of event.rows) {
        const cmd = data.createInsertCommand(extractRowValues(row));
        stageCommand(cmd);
      }
      logger.info('keyvalue-grid', `Staged ${event.rows.length} insert commands`);
      return undefined;
    },
    [data, stageCommand, extractRowValues]
  );

  // Handle row delete
  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent) => {
      if (data.currentKey?.type === 'list' || data.currentKey?.type === 'zset' || data.currentKey?.type === 'stream') {
        logger.warn('keyvalue-grid', 'Row delete ignored for unsupported key type');
        return undefined;
      }
      for (const row of event.rows) {
        const cmd = data.createDeleteCommand(row);
        stageCommand(cmd);
      }
      logger.info('keyvalue-grid', `Staged ${event.rows.length} delete commands`);
      return undefined;
    },
    [data, stageCommand]
  );

  // Handle refresh
  const handleRefresh = useCallback(() => {
    data.refetch();
    logger.info('keyvalue-grid', 'Refreshing key data');
  }, [data]);

  // Key metadata header toolbar
  const topToolbar = useMemo(
    () => data.currentKey && <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />,
    [data.currentKey, handleRefresh]
  );

  // Determine read-only state (streams are read-only)
  const readOnly = data.currentKey?.type === 'stream';

  // Loading and error states
  const isLoading = data.isLoading && data.rows.length === 0;
  const errorMessage = data.error ? data.error.message : null;

  // Show empty state if no key selected
  if (!data.currentKey && !data.isLoading) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center', className)}>
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">No key selected</p>
          <p className="text-sm text-muted-foreground/70">Select a key from the sidebar to view its contents</p>
        </div>
      </div>
    );
  }

  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      isLoading={isLoading}
      error={errorMessage}
      hasMore={data.hasMore}
      onLoadMore={data.fetchNextPage}
      estimatedTotal={data.rows.length}
      isEstimatedCount={false}
      onCellEditCommit={handleCellEditCommit}
      onRowInsert={handleRowInsert}
      onRowDelete={handleRowDelete}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={String(database)}
      tableName={data.currentKey?.key || 'redis'}
      paradigm="keyvalue"
      enableFiltering={false}
      enableSorting={false}
      enableExport={true}
      enableRowPinning={false}
      enableFKPreview={false}
      readOnly={readOnly}
      className={cn('keyvalue-datagrid', className)}
    />
  );
});

export default KeyValueDataGrid;
