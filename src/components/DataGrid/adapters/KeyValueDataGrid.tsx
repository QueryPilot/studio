/**
 * KeyValueDataGrid - Redis key browser using the unified DataGrid
 *
 * Features:
 * - Type-aware column mapping for all Redis types
 * - Key metadata header (type, TTL, size)
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useRef } from 'react';
import { EditableDataGrid, type EditableDataGridRef } from '../base';
import { KeyHeader } from '../components/KeyHeader';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import { DataGridEmptyState, DataGridErrorState } from '../components/DataGridStates';
import { useKeyValueData } from '../hooks/useKeyValueData';
import { useCrudStore } from '@/stores/crudStore';
import { useDataGridRenderers } from '../renderers';
import type { GridRowInsertEvent, GridRowDeleteEvent } from '../types';
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
  gridId: _gridId,
  connectionId,
  database,
  initialKey,
  className,
}: KeyValueDataGridProps) {
  void _gridId; // Reserved for future use (persisted view state)
  const gridRef = useRef<EditableDataGridRef>(null);
  const { customRenderers } = useDataGridRenderers();
  const stageCommand = useCrudStore((s) => s.stageCommand);

  // Get key-value data
  const data = useKeyValueData({
    connectionId,
    database,
    initialKey,
    enabled: true,
  });

  // Table key for CRUD staging
  const tableKey = data.currentKey
    ? `${connectionId}:${database}::${data.currentKey.key}`
    : null;

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: Parameters<typeof data.createEditCommand>[0]) => {
      const cmd = data.createEditCommand(event);
      if (cmd) {
        stageCommand(cmd);
        logger.info('keyvalue-grid', 'Staged edit command');
      }
      return undefined;
    },
    [data, stageCommand]
  );

  // Handle row insert
  const handleRowInsert = useCallback(
    (event: GridRowInsertEvent) => {
      for (const row of event.rows) {
        const cmd = data.createInsertCommand(row as Record<string, unknown>);
        stageCommand(cmd);
      }
      logger.info('keyvalue-grid', `Staged ${event.rows.length} insert commands`);
      return undefined;
    },
    [data, stageCommand]
  );

  // Handle row delete
  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent) => {
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

  // No key selected
  if (!data.currentKey && !data.isLoading) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <DataGridEmptyState
          title="No key selected"
          description="Select a key from the sidebar to view its contents"
        />
      </div>
    );
  }

  // Loading state
  if (data.isLoading && data.rows.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />
        <DataGridSkeleton />
      </div>
    );
  }

  // Error state
  if (data.error) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />
        <DataGridErrorState
          error={data.error.message}
          onRetry={data.refetch}
        />
      </div>
    );
  }

  // Empty state (key exists but no data, e.g., empty list)
  if (data.rows.length === 0 && data.currentKey) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />
        <DataGridEmptyState
          title={`Empty ${data.currentKey.type}`}
          description={`This ${data.currentKey.type} key contains no data`}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Key metadata header */}
      <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />

      {/* Data grid */}
      {data.currentKey && tableKey && (
        <div className="flex-1 min-h-0">
          <EditableDataGrid
            ref={gridRef}
            tableKey={tableKey}
            rows={data.rows}
            columns={data.columns}
            getCellContent={data.getCellContent}
            customRenderers={customRenderers}
            onCellEditCommit={handleCellEditCommit}
            onRowInsert={handleRowInsert}
            onRowDelete={handleRowDelete}
          />
        </div>
      )}

      {/* Status footer */}
      <div className="flex items-center justify-between py-2 px-4 border-t border-border bg-muted/30 text-xs text-muted-foreground">
        <div>
          {data.currentKey && (
            <span>
              {data.rows.length} {data.rows.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        {data.isLoading && (
          <span className="text-primary">Loading...</span>
        )}
      </div>
    </div>
  );
});

export default KeyValueDataGrid;
