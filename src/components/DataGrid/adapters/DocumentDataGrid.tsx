/**
 * DocumentDataGrid - MongoDB document browser using the unified DataGrid
 *
 * Features:
 * - Drill-down navigation for nested objects/arrays
 * - Dynamic column generation from document keys
 * - Breadcrumb navigation
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useRef } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import { EditableDataGrid, type EditableDataGridRef } from '../base';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import { DataGridEmptyState, DataGridErrorState } from '../components/DataGridStates';
import { useDocumentData } from '../hooks/useDocumentData';
import { useCrudStore } from '@/stores/crudStore';
import { useDataGridRenderers } from '../renderers';
import type { GridRowInsertEvent, GridRowDeleteEvent } from '../types';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface DocumentDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Page size for pagination */
  pageSize?: number;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const DocumentDataGrid = memo(function DocumentDataGrid({
  gridId: _gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
  className,
}: DocumentDataGridProps) {
  void _gridId; // Reserved for future use (persisted view state)
  const gridRef = useRef<EditableDataGridRef>(null);
  const { customRenderers } = useDataGridRenderers();
  const stageCommand = useCrudStore((s) => s.stageCommand);

  // Table key for the EditableDataGrid
  const tableKey = `${connectionId}:${database}::${collection}`;

  // Get document data
  const data = useDocumentData({
    connectionId,
    database,
    collection,
    pageSize,
    enabled: true,
  });

  // Handle cell activation for drill-down
  const handleCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      if (data.canStepInto(row, col)) {
        data.stepInto(row, col);
        logger.info('document-grid', `Drilled into cell [${row}, ${col}]`, {
          path: data.currentPath,
        });
      }
    },
    [data]
  );

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: Parameters<typeof data.createEditCommand>[0]) => {
      const cmd = data.createEditCommand(event);
      if (cmd) {
        stageCommand(cmd);
        logger.info('document-grid', 'Staged edit command');
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
      logger.info('document-grid', `Staged ${event.rows.length} insert commands`);
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
      logger.info('document-grid', `Staged ${event.rows.length} delete commands`);
      return undefined;
    },
    [data, stageCommand]
  );

  // Loading state
  if (data.isLoading && data.rows.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <BreadcrumbNav
          path={data.currentPath}
          collectionName={collection}
          onNavigate={data.navigateToPath}
          onNavigateToRoot={() => data.navigateToPath(-1)}
        />
        <DataGridSkeleton />
      </div>
    );
  }

  // Error state
  if (data.error) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <BreadcrumbNav
          path={data.currentPath}
          collectionName={collection}
          onNavigate={data.navigateToPath}
          onNavigateToRoot={() => data.navigateToPath(-1)}
        />
        <DataGridErrorState
          error={data.error.message}
          onRetry={data.refetch}
        />
      </div>
    );
  }

  // Empty state
  if (data.rows.length === 0 && !data.isLoading) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <BreadcrumbNav
          path={data.currentPath}
          collectionName={collection}
          onNavigate={data.navigateToPath}
          onNavigateToRoot={() => data.navigateToPath(-1)}
        />
        <DataGridEmptyState
          title={data.currentPath.length > 0 ? 'No data at this path' : 'Empty collection'}
          description={
            data.currentPath.length > 0
              ? 'Navigate back to view other data'
              : 'No documents found in this collection'
          }
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Breadcrumb navigation */}
      <BreadcrumbNav
        path={data.currentPath}
        collectionName={collection}
        onNavigate={data.navigateToPath}
        onNavigateToRoot={() => data.navigateToPath(-1)}
      />

      {/* Data grid */}
      <div className="flex-1 min-h-0">
        <EditableDataGrid
          ref={gridRef}
          tableKey={tableKey}
          rows={data.rows}
          columns={data.columns}
          getCellContent={data.getCellContent}
          customRenderers={customRenderers}
          onCellActivated={handleCellActivated}
          onCellEditCommit={handleCellEditCommit}
          onRowInsert={handleRowInsert}
          onRowDelete={handleRowDelete}
        />
      </div>

      {/* Pagination footer */}
      {data.hasMore && (
        <div className="flex items-center justify-center py-2 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={data.fetchNextPage}
            disabled={data.isLoading}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            )}
          >
            {data.isLoading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
});

export default DocumentDataGrid;
