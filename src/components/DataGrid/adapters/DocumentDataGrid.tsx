/**
 * DocumentDataGrid - MongoDB document browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Drill-down navigation for nested objects/arrays
 * - Dynamic column generation from document keys
 * - Breadcrumb navigation in topToolbar
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useMemo } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { useDocumentData } from '../hooks/useDocumentData';
import { useCrudStore } from '@/stores/crudStore';
import type { GridEditCommitEvent, GridRowInsertEvent, GridRowDeleteEvent, GridRowModel } from '../types';
import type { CellValue } from '@/types';
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
  gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
  className,
}: DocumentDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);

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
        return true;
      }
      return false;
    },
    [data]
  );

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      const cmd = data.createEditCommand(event);
      if (cmd) {
        stageCommand(cmd);
        logger.info('document-grid', 'Staged edit command');
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
      if (data.currentPath.length > 0) {
        logger.warn('document-grid', 'Insert ignored for nested paths');
        return undefined;
      }
      for (const row of event.rows) {
        const cmd = data.createInsertCommand(extractRowValues(row));
        stageCommand(cmd);
      }
      logger.info('document-grid', `Staged ${event.rows.length} insert commands`);
      return undefined;
    },
    [data, stageCommand, extractRowValues]
  );

  // Handle row delete
  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent) => {
      if (data.currentPath.length > 0) {
        logger.warn('document-grid', 'Delete ignored for nested paths');
        return undefined;
      }
      for (const row of event.rows) {
        const cmd = data.createDeleteCommand(row);
        stageCommand(cmd);
      }
      logger.info('document-grid', `Staged ${event.rows.length} delete commands`);
      return undefined;
    },
    [data, stageCommand]
  );

  // Breadcrumb navigation toolbar
  const topToolbar = useMemo(
    () => (
      <BreadcrumbNav
        path={data.currentPath}
        collectionName={collection}
        onNavigate={data.navigateToPath}
        onNavigateToRoot={() => data.navigateToPath(-1)}
      />
    ),
    [data.currentPath, data.navigateToPath, collection]
  );

  // Determine read-only state (nested paths are read-only)
  const readOnly = data.currentPath.length > 0;

  // Loading and error states
  const isLoading = data.isLoading && data.rows.length === 0;
  const errorMessage = data.error ? data.error.message : null;

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
      estimatedTotal={data.totalCount}
      isEstimatedCount={false}
      onCellActivated={handleCellActivated}
      onCellEditCommit={handleCellEditCommit}
      onRowInsert={handleRowInsert}
      onRowDelete={handleRowDelete}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={database}
      tableName={collection}
      paradigm="document"
      enableFiltering={false}
      enableSorting={false}
      enableExport={true}
      enableRowPinning={false}
      enableFKPreview={false}
      readOnly={readOnly}
      className={cn('document-datagrid', className)}
    />
  );
});

export default DocumentDataGrid;
